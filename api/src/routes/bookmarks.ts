import { Elysia, t } from "elysia";
import { and, asc, desc, eq, inArray, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  bookmarkCategories,
  bookmarkSubcategories,
  bookmarkSubSubcategories,
  bookmarks,
  bookmarkTags,
  categories,
  subcategories,
  subSubcategories,
  tags,
} from "../db/schema.ts";
import {
  BOOKMARK_FLAG_VALUES,
  BOOKMARK_SORT_VALUES,
  duplicateUrlResponse,
  ErrorResp,
  findActiveBookmarksByUrl,
  isDupEntry,
  OkResp,
  PositiveIdParam,
  S,
  type BookmarkFlagColumnMap,
} from "./shared.ts";

function uniqueIds(ids?: number[]): number[] {
  return [...new Set(ids ?? [])].filter(Boolean);
}

async function getActiveClassificationIds(bookmarkId: number): Promise<{
  categoryIds: number[];
  subcategoryIds: number[];
  subSubcategoryIds: number[];
}> {
  const [categoryRows, subcategoryRows, subSubcategoryRows] = await Promise.all([
    db
      .select({ categoryId: bookmarkCategories.categoryId })
      .from(bookmarkCategories)
      .where(and(
        eq(bookmarkCategories.bookmarkId, bookmarkId),
        isNull(bookmarkCategories.archivedAt),
      )),
    db
      .select({ subcategoryId: bookmarkSubcategories.subcategoryId })
      .from(bookmarkSubcategories)
      .where(and(
        eq(bookmarkSubcategories.bookmarkId, bookmarkId),
        isNull(bookmarkSubcategories.archivedAt),
      )),
    db
      .select({ subSubcategoryId: bookmarkSubSubcategories.subSubcategoryId })
      .from(bookmarkSubSubcategories)
      .where(and(
        eq(bookmarkSubSubcategories.bookmarkId, bookmarkId),
        isNull(bookmarkSubSubcategories.archivedAt),
      )),
  ]);

  return {
    categoryIds: categoryRows.map((row) => row.categoryId),
    subcategoryIds: subcategoryRows.map((row) => row.subcategoryId),
    subSubcategoryIds: subSubcategoryRows.map((row) => row.subSubcategoryId),
  };
}

async function findClassificationOverlapError(categoryIds: number[], subcategoryIds: number[], subSubcategoryIds: number[]): Promise<string | null> {
  if (subcategoryIds.length === 0 || subSubcategoryIds.length === 0) return null;

  const selectedSubcategoryIds = new Set(subcategoryIds);
  const childRows = await db
    .select({
      id: subSubcategories.id,
      subcategoryId: subSubcategories.subcategoryId,
    })
    .from(subSubcategories)
    .where(inArray(subSubcategories.id, subSubcategoryIds));

  const hasOverlap = childRows.some((row) => selectedSubcategoryIds.has(row.subcategoryId));
  return hasOverlap
    ? "Cannot assign a bookmark to both a sub-category and one of its nested sub-sub-categories in the same branch"
    : null;
}

async function findCategoryDepthOverlapError(categoryIds: number[], subcategoryIds: number[], subSubcategoryIds: number[]): Promise<string | null> {
  if (categoryIds.length === 0 || (subcategoryIds.length === 0 && subSubcategoryIds.length === 0)) return null;

  const selectedCategoryIds = new Set(categoryIds);
  const [subcategoryRows, subSubcategoryRows] = await Promise.all([
    subcategoryIds.length > 0
      ? db
          .select({
            id: subcategories.id,
            categoryId: subcategories.categoryId,
          })
          .from(subcategories)
          .where(inArray(subcategories.id, subcategoryIds))
      : Promise.resolve([]),
    subSubcategoryIds.length > 0
      ? db
          .select({
            id: subSubcategories.id,
            categoryId: subcategories.categoryId,
          })
          .from(subSubcategories)
          .innerJoin(subcategories, eq(subSubcategories.subcategoryId, subcategories.id))
          .where(inArray(subSubcategories.id, subSubcategoryIds))
      : Promise.resolve([]),
  ]);

  const hasSubcategoryOverlap = subcategoryRows.some((row) => row.categoryId !== null && selectedCategoryIds.has(row.categoryId));
  const hasSubSubcategoryOverlap = subSubcategoryRows.some((row) => row.categoryId !== null && selectedCategoryIds.has(row.categoryId));

  return hasSubcategoryOverlap || hasSubSubcategoryOverlap
    ? "Cannot assign a bookmark to both a category and a deeper taxonomy link in the same category branch"
    : null;
}

export const bookmarkRoutes = new Elysia()
  .post(
    "/bookmarks",
    async ({ body, set }) => {
      const url = body.url.trim();
      const title = body.title.trim();

      if (!url || !title) {
        set.status = 400;
        return { error: "url and title are required" };
      }

      if (!body.allowDuplicate) {
        const existing = await findActiveBookmarksByUrl(url);
        if (existing.length > 0) {
          set.status = 409;
          return duplicateUrlResponse(existing);
        }
      }

      const flags = body.flags ?? {};
      const tagIds = uniqueIds(body.tags);
      const categoryIds = uniqueIds(body.categoryIds);
      const subcategoryIds = uniqueIds(body.subcategoryIds);
      const subSubcategoryIds = uniqueIds(body.subSubcategoryIds);

      const overlapError =
        await findClassificationOverlapError(categoryIds, subcategoryIds, subSubcategoryIds) ??
        await findCategoryDepthOverlapError(categoryIds, subcategoryIds, subSubcategoryIds);
      if (overlapError) {
        set.status = 409;
        return { error: overlapError };
      }

      let bookmarkId: number;
      try {
        bookmarkId = await db.transaction(async (tx) => {
          const [result] = await tx
            .insert(bookmarks)
            .values({
              url,
              title,
              description: body.description ?? null,
              faviconUrl: body.faviconUrl ?? null,
              readLater: flags.readLater ? 1 : 0,
              hotTopic: flags.hotTopic ? 1 : 0,
              cheatsheets: flags.cheatsheets ? 1 : 0,
              forReview: flags.forReview ? 1 : 0,
              archivedAt: flags.archived ? sql`NOW()` : null,
            })
            .$returningId();

          const id = result.id;

          if (tagIds.length > 0) {
            await tx
              .insert(bookmarkTags)
              .values(tagIds.map((tagId) => ({ bookmarkId: id, tagId })));
          }

          if (categoryIds.length > 0) {
            await tx
              .insert(bookmarkCategories)
              .values(categoryIds.map((categoryId) => ({ bookmarkId: id, categoryId })));
          }

          if (subcategoryIds.length > 0) {
            await tx
              .insert(bookmarkSubcategories)
              .values(subcategoryIds.map((subcategoryId) => ({ bookmarkId: id, subcategoryId })));
          }

          if (subSubcategoryIds.length > 0) {
            await tx
              .insert(bookmarkSubSubcategories)
              .values(subSubcategoryIds.map((subSubcategoryId) => ({ bookmarkId: id, subSubcategoryId })));
          }

          return id;
        });
      } catch (err: unknown) {
        if (isDupEntry(err)) {
          // Race condition: another request inserted the same URL between our check and INSERT
          const existing = await findActiveBookmarksByUrl(url);
          set.status = 409;
          return duplicateUrlResponse(existing);
        }
        throw err;
      }

      const [created] = await db
        .select({
          id: bookmarks.id,
          url: bookmarks.url,
          title: bookmarks.title,
          createdAt: bookmarks.createdAt,
        })
        .from(bookmarks)
        .where(eq(bookmarks.id, bookmarkId));

      set.status = 201;
      return created;
    },
    {
      body: t.Object({
        url: t.String({ description: "Full URL of the page to bookmark. Whitespace is trimmed. Required." }),
        title: t.String({ description: "Page title. Whitespace is trimmed. Required." }),
        description: t.Optional(t.String({ description: "Optional freeform notes or description for the bookmark." })),
        categoryIds: t.Optional(t.Array(t.Number(), { description: "IDs of top-level categories to attach directly. Duplicates are deduplicated automatically." })),
        subcategoryIds: t.Optional(t.Array(t.Number(), { description: "IDs of sub-categories to attach. Duplicates are deduplicated automatically." })),
        subSubcategoryIds: t.Optional(t.Array(t.Number(), { description: "IDs of sub-sub-categories to attach. Duplicates are deduplicated automatically." })),
        tags: t.Optional(t.Array(t.Number(), { description: "IDs of tags to attach. Duplicates are deduplicated automatically." })),
        flags: t.Optional(
          t.Object({
            readLater: t.Optional(t.Boolean({ description: "Flag this bookmark as Read Later." })),
            hotTopic: t.Optional(t.Boolean({ description: "Flag this bookmark as a Hot Topic." })),
            cheatsheets: t.Optional(t.Boolean({ description: "Flag this bookmark as a Cheatsheet." })),
            forReview: t.Optional(t.Boolean({ description: "Flag this bookmark as needing Review." })),
            archived: t.Optional(t.Boolean({ description: "If true, the bookmark is created already archived (archivedAt set to NOW())." })),
          })
        ),
        faviconUrl: t.Optional(t.String({ description: "URL of the page favicon, typically captured by the extension at save time." })),
        allowDuplicate: t.Optional(t.Boolean({ description: "Set to true to skip the pre-insert duplicate lookup and rely on the database constraint. Active duplicate URLs still return 409." })),
      }),
      detail: {
        tags: ["bookmarks"],
        summary: "Create a bookmark",
        description:
          "Saves a new bookmark with optional tags, categories, sub-categories, and flags.\n\n" +
          "**Duplicate detection:** by default, if an active bookmark with the same URL already exists " +
          "a `409` is returned with a `duplicates` array listing the existing records. " +
          "Pass `allowDuplicate: true` to skip the preflight lookup and rely on the database uniqueness constraint instead; " +
          "active duplicate URLs still return `409`.\n\n" +
          "**Tags and taxonomy links** must already exist; pass their integer IDs in `tags`, `categoryIds`, `subcategoryIds`, " +
          "and `subSubcategoryIds`. Duplicates in those arrays are silently deduplicated. A bookmark cannot be linked to a direct category " +
          "and also to a deeper sub-category or sub-sub-category in that same category branch.\n\n" +
          "**Flags** are all `false` by default. The special `flags.archived` field allows the " +
          "Chrome extension to save a bookmark directly into the archived state (e.g. when importing " +
          "historical data).",
        responses: {
          201: {
            description: "Bookmark created",
            content: {
              "application/json": {
                schema: S.obj("Created bookmark", {
                  id: S.num("New bookmark ID"),
                  url: S.str("Stored URL"),
                  title: S.str("Stored title"),
                  createdAt: S.any("Creation timestamp (UTC)"),
                }),
              },
            },
          },
          400: { ...ErrorResp, description: "Validation error - url or title is blank after trimming" },
          409: {
            description: "Duplicate URL detected, or the request linked conflicting taxonomy levels in the same branch.",
            content: {
              "application/json": {
                schema: S.obj("Duplicate conflict", {
                  error: S.str("Error message"),
                  duplicates: S.arr("Existing active bookmarks with the same URL", S.obj("Existing bookmark", {
                    id: S.num("Bookmark ID"),
                    url: S.str("URL"),
                    title: S.str("Title"),
                    createdAt: S.any("Creation timestamp (UTC)"),
                  })),
                }),
              },
            },
          },
        },
      },
    }
  )
  .get(
    "/flag-counts",
    async () => {
      const [row] = await db
        .select({
          readLater: sql<number>`SUM(CASE WHEN read_later   = 1 THEN 1 ELSE 0 END)`,
          hotTopic: sql<number>`SUM(CASE WHEN hot_topic    = 1 THEN 1 ELSE 0 END)`,
          cheatsheets: sql<number>`SUM(CASE WHEN cheatsheets  = 1 THEN 1 ELSE 0 END)`,
          forReview: sql<number>`SUM(CASE WHEN for_review   = 1 THEN 1 ELSE 0 END)`,
        })
        .from(bookmarks)
        .where(isNull(bookmarks.archivedAt));

      return {
        readLater: Number(row.readLater ?? 0),
        hotTopic: Number(row.hotTopic ?? 0),
        cheatsheets: Number(row.cheatsheets ?? 0),
        forReview: Number(row.forReview ?? 0),
      };
    },
    {
      detail: {
        tags: ["bookmarks"],
        summary: "Count of active bookmarks per flag",
        description:
          "Returns a single aggregated object with the count of **active** (non-archived) bookmarks " +
          "that have each flag set to `true`.\n\n" +
          "Useful for rendering badge counts in the UI sidebar without fetching full bookmark lists.\n\n" +
          "**Flags:**\n" +
          "- `readLater` - bookmarks saved to read later\n" +
          "- `hotTopic` - bookmarks marked as currently relevant\n" +
          "- `cheatsheets` - bookmarks containing reference material\n" +
          "- `forReview` - bookmarks queued for review",
        responses: {
          200: {
            description: "Flag counts for active bookmarks",
            content: {
              "application/json": {
                schema: {
                  type: "object" as const,
                  properties: {
                    readLater: S.num("Active bookmarks flagged Read Later"),
                    hotTopic: S.num("Active bookmarks flagged Hot Topic"),
                    cheatsheets: S.num("Active bookmarks flagged Cheatsheet"),
                    forReview: S.num("Active bookmarks flagged For Review"),
                  },
                },
              },
            },
          },
        },
      },
    }
  )
  .get(
    "/bookmarks",
    async ({ query, set }) => {
      // --- limit ---
      const rawLimit = query.limit;
      let limit = 20;
      if (rawLimit !== undefined) {
        const n = Number(rawLimit);
        if (!Number.isInteger(n) || n < 1 || n > 100) {
          set.status = 400;
          return { error: "limit must be an integer between 1 and 100" };
        }
        limit = n;
      }

      // --- offset ---
      const rawOffset = query.offset;
      let offset = 0;
      if (rawOffset !== undefined) {
        const n = Number(rawOffset);
        if (!Number.isInteger(n) || n < 0) {
          set.status = 400;
          return { error: "offset must be a non-negative integer" };
        }
        offset = n;
      }

      // --- subcategoryId ---
      const rawSubcategoryId = query.subcategoryId;
      let subcategoryId: number | null = null;
      if (rawSubcategoryId !== undefined) {
        const n = Number(rawSubcategoryId);
        if (!Number.isInteger(n) || n < 1) {
          set.status = 400;
          return { error: "subcategoryId must be a positive integer" };
        }
        subcategoryId = n;
      }

      // --- subSubcategoryId ---
      const rawSubSubcategoryId = query.subSubcategoryId;
      let subSubcategoryId: number | null = null;
      if (rawSubSubcategoryId !== undefined) {
        const n = Number(rawSubSubcategoryId);
        if (!Number.isInteger(n) || n < 1) {
          set.status = 400;
          return { error: "subSubcategoryId must be a positive integer" };
        }
        subSubcategoryId = n;
      }

      // --- tagId ---
      const rawTagId = query.tagId;
      let tagId: number | null = null;
      if (rawTagId !== undefined) {
        const n = Number(rawTagId);
        if (!Number.isInteger(n) || n < 1) {
          set.status = 400;
          return { error: "tagId must be a positive integer" };
        }
        tagId = n;
      }

      // --- flag ---
      const flag = query.flag ?? null;
      if (flag !== null && !BOOKMARK_FLAG_VALUES.includes(flag as typeof BOOKMARK_FLAG_VALUES[number])) {
        set.status = 400;
        return { error: "flag must be one of: readLater, hotTopic, cheatsheets, forReview" };
      }

      // --- sortBy ---
      const rawSortBy = query.sortBy;
      if (rawSortBy !== undefined && !BOOKMARK_SORT_VALUES.includes(rawSortBy as typeof BOOKMARK_SORT_VALUES[number])) {
        set.status = 400;
        return { error: "sortBy must be one of: newest, oldest" };
      }
      const sortBy = rawSortBy === "oldest" ? "oldest" : "newest";

      // --- archived ---
      const rawArchived = query.archived;
      if (rawArchived !== undefined && rawArchived !== "true" && rawArchived !== "false") {
        set.status = 400;
        return { error: "archived must be true or false" };
      }
      const showArchived = rawArchived === "true";

      // --- q (full-text search) ---
      const q = query.q?.trim() ?? "";

      const orderCol = sortBy === "oldest" ? asc(bookmarks.createdAt) : desc(bookmarks.createdAt);

      const conditions = [
        showArchived ? isNotNull(bookmarks.archivedAt) : isNull(bookmarks.archivedAt),
      ];

      if (q) {
        const pattern = `%${q}%`;
        conditions.push(
          or(
            like(bookmarks.title, pattern),
            like(bookmarks.url, pattern),
            like(bookmarks.description, pattern),
          )!
        );
      }

      const flagColMap: BookmarkFlagColumnMap = {
        readLater: bookmarks.readLater,
        hotTopic: bookmarks.hotTopic,
        cheatsheets: bookmarks.cheatsheets,
        forReview: bookmarks.forReview,
      };
      if (flag && flagColMap[flag]) {
        conditions.push(eq(flagColMap[flag], 1));
      }

      if (subcategoryId) {
        const directMatchingIds = db
          .select({ bookmarkId: bookmarkSubcategories.bookmarkId })
          .from(bookmarkSubcategories)
          .where(and(
            eq(bookmarkSubcategories.subcategoryId, subcategoryId),
            isNull(bookmarkSubcategories.archivedAt),
          ));
        const nestedMatchingIds = db
          .select({ bookmarkId: bookmarkSubSubcategories.bookmarkId })
          .from(bookmarkSubSubcategories)
          .innerJoin(subSubcategories, eq(bookmarkSubSubcategories.subSubcategoryId, subSubcategories.id))
          .where(and(
            eq(subSubcategories.subcategoryId, subcategoryId),
            isNull(subSubcategories.archivedAt),
            isNull(bookmarkSubSubcategories.archivedAt),
          ));
        conditions.push(or(
          inArray(bookmarks.id, directMatchingIds),
          inArray(bookmarks.id, nestedMatchingIds),
        )!);
      }

      if (subSubcategoryId) {
        const matchingIds = db
          .select({ bookmarkId: bookmarkSubSubcategories.bookmarkId })
          .from(bookmarkSubSubcategories)
          .where(and(
            eq(bookmarkSubSubcategories.subSubcategoryId, subSubcategoryId),
            isNull(bookmarkSubSubcategories.archivedAt),
          ));
        conditions.push(inArray(bookmarks.id, matchingIds));
      }

      if (tagId) {
        const matchingIds = db
          .select({ bookmarkId: bookmarkTags.bookmarkId })
          .from(bookmarkTags)
          .where(and(
            eq(bookmarkTags.tagId, tagId),
            isNull(bookmarkTags.archivedAt),
          ));
        conditions.push(inArray(bookmarks.id, matchingIds));
      }

      const where = and(...conditions);

      const bookmarkCols = {
        id: bookmarks.id,
        url: bookmarks.url,
        title: bookmarks.title,
        description: bookmarks.description,
        faviconUrl: bookmarks.faviconUrl,
        readLater: bookmarks.readLater,
        hotTopic: bookmarks.hotTopic,
        cheatsheets: bookmarks.cheatsheets,
        forReview: bookmarks.forReview,
        createdAt: bookmarks.createdAt,
        updatedAt: bookmarks.updatedAt,
        archivedAt: bookmarks.archivedAt,
      };

      const [rows, [{ total }]] = await Promise.all([
        db.select(bookmarkCols).from(bookmarks).where(where).orderBy(orderCol).limit(limit).offset(offset),
        db.select({ total: sql<number>`COUNT(*)` }).from(bookmarks).where(where),
      ]);

      const ids = rows.map((r) => r.id);
      const [tagRows, categoryRows, classRows, childClassRows] =
        ids.length > 0
          ? await Promise.all([
              db
                .select({
                  bookmarkId: bookmarkTags.bookmarkId,
                  tagId: tags.id,
                  tagName: tags.name,
                })
                .from(bookmarkTags)
                .innerJoin(tags, eq(bookmarkTags.tagId, tags.id))
                .where(and(
                  inArray(bookmarkTags.bookmarkId, ids),
                  isNull(bookmarkTags.archivedAt),
                )),
              db
                .select({
                  bookmarkId: bookmarkCategories.bookmarkId,
                  categoryId: categories.id,
                  categoryName: categories.name,
                })
                .from(bookmarkCategories)
                .innerJoin(categories, eq(bookmarkCategories.categoryId, categories.id))
                .where(and(
                  inArray(bookmarkCategories.bookmarkId, ids),
                  isNull(bookmarkCategories.archivedAt),
                )),
              db
                .select({
                  bookmarkId: bookmarkSubcategories.bookmarkId,
                  classId: subcategories.id,
                  className: subcategories.name,
                  categoryId: categories.id,
                  categoryName: categories.name,
                })
                .from(bookmarkSubcategories)
                .innerJoin(subcategories, eq(bookmarkSubcategories.subcategoryId, subcategories.id))
                .leftJoin(categories, eq(subcategories.categoryId, categories.id))
                .where(and(
                  inArray(bookmarkSubcategories.bookmarkId, ids),
                  isNull(bookmarkSubcategories.archivedAt),
                )),
              db
                .select({
                  bookmarkId: bookmarkSubSubcategories.bookmarkId,
                  subSubcategoryId: subSubcategories.id,
                  subSubcategoryName: subSubcategories.name,
                  subcategoryId: subcategories.id,
                  subcategoryName: subcategories.name,
                  categoryId: categories.id,
                  categoryName: categories.name,
                })
                .from(bookmarkSubSubcategories)
                .innerJoin(subSubcategories, eq(bookmarkSubSubcategories.subSubcategoryId, subSubcategories.id))
                .innerJoin(subcategories, eq(subSubcategories.subcategoryId, subcategories.id))
                .leftJoin(categories, eq(subcategories.categoryId, categories.id))
                .where(and(
                  inArray(bookmarkSubSubcategories.bookmarkId, ids),
                  isNull(bookmarkSubSubcategories.archivedAt),
                )),
            ])
          : [[], [], [], []];

      const items = rows.map((b) => ({
        ...b,
        tags: tagRows
          .filter((tagRow) => tagRow.bookmarkId === b.id)
          .map((tagRow) => ({ id: tagRow.tagId, name: tagRow.tagName })),
        categories: categoryRows
          .filter((categoryRow) => categoryRow.bookmarkId === b.id)
          .map((categoryRow) => ({ id: categoryRow.categoryId, name: categoryRow.categoryName })),
        subcategories: classRows
          .filter((classRow) => classRow.bookmarkId === b.id)
          .map((classRow) => ({ id: classRow.classId, name: classRow.className, categoryId: classRow.categoryId ?? null, categoryName: classRow.categoryName ?? null })),
        subSubcategories: childClassRows
          .filter((classRow) => classRow.bookmarkId === b.id)
          .map((classRow) => ({
            id: classRow.subSubcategoryId,
            name: classRow.subSubcategoryName,
            subcategoryId: classRow.subcategoryId,
            subcategoryName: classRow.subcategoryName,
            categoryId: classRow.categoryId ?? null,
            categoryName: classRow.categoryName ?? null,
          })),
      }));

      return { items, total: Number(total) };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String({ description: "Maximum number of bookmarks to return. Integer 1–100. Default: 20." })),
        offset: t.Optional(t.String({ description: "Zero-based pagination offset. Non-negative integer. Default: 0." })),
        q: t.Optional(t.String({ description: "Full-text search query. Matches against title, URL, and description using a case-insensitive LIKE search. Combinable with all other filters." })),
        subcategoryId: t.Optional(t.String({ description: "Filter to bookmarks assigned to this subcategory ID. Must be a positive integer." })),
        subSubcategoryId: t.Optional(t.String({ description: "Filter to bookmarks assigned to this sub-sub-category ID. Must be a positive integer." })),
        tagId: t.Optional(t.String({ description: "Filter to bookmarks that have this tag ID attached. Must be a positive integer." })),
        flag: t.Optional(t.String({ description: "Filter to bookmarks with a specific flag set. Allowed values: `readLater`, `hotTopic`, `cheatsheets`, `forReview`." })),
        sortBy: t.Optional(t.String({ description: "Sort order by creation date. `newest` (default) or `oldest`." })),
        archived: t.Optional(t.String({ description: "Pass `true` to return archived bookmarks instead of active ones." })),
      }),
      detail: {
        tags: ["bookmarks"],
        summary: "List bookmarks",
        description:
          "Returns a paginated list of bookmarks with their full tag and taxonomy associations.\n\n" +
          "**Default behaviour:** returns active (non-archived) bookmarks, newest first, 20 per page.\n\n" +
          "**Filters (all combinable with AND logic):**\n" +
          "- `q` - full-text search on title, URL, and description (case-insensitive LIKE)\n" +
          "- `subcategoryId` - bookmarks assigned directly to that subcategory or any nested sub-sub-category\n" +
          "- `subSubcategoryId` - bookmarks assigned to that sub-sub-category\n" +
          "- `tagId` - bookmarks that have that tag\n" +
          "- `flag` - bookmarks with that flag set (`readLater` | `hotTopic` | `cheatsheets` | `forReview`)\n" +
          "- `archived=true` - show archived bookmarks (mutually exclusive with active)\n\n" +
          "Each bookmark item includes fully resolved `tags`, `categories`, `subcategories`, and `subSubcategories` arrays " +
          "with parent breadcrumb metadata. Flags are returned as `0`/`1` integers.",
        responses: {
          200: {
            description: "Paginated bookmark list",
            content: {
              "application/json": {
                schema: S.obj("Bookmark list response", {
                  items: S.arr("Bookmark records", S.obj("Bookmark", {
                    id: S.num("Bookmark ID"),
                    url: S.str("Page URL"),
                    title: S.str("Page title"),
                    description: S.nullable(S.str("Optional notes")),
                    faviconUrl: S.nullable(S.str("Favicon URL")),
                    readLater: S.num("Read Later flag (0 or 1)"),
                    hotTopic: S.num("Hot Topic flag (0 or 1)"),
                    cheatsheets: S.num("Cheatsheet flag (0 or 1)"),
                    forReview: S.num("For Review flag (0 or 1)"),
                    createdAt: S.any("Creation timestamp (UTC)"),
                    updatedAt: S.any("Last-updated timestamp (UTC)"),
                    archivedAt: S.nullable(S.any("Archive timestamp (UTC), null when active")),
                    tags: S.arr("Attached tags", S.obj("Tag", {
                      id: S.num("Tag ID"),
                      name: S.str("Tag name"),
                    })),
                    categories: S.arr("Attached top-level categories", S.obj("Category", {
                      id: S.num("Category ID"),
                      name: S.str("Category name"),
                    })),
                    subcategories: S.arr("Attached sub-categories", S.obj("Sub-category", {
                      id: S.num("Sub-category ID"),
                      name: S.str("Sub-category name"),
                      categoryId: S.nullable(S.num("Parent category ID")),
                      categoryName: S.nullable(S.str("Parent category name")),
                    })),
                    subSubcategories: S.arr("Attached sub-sub-categories", S.obj("Sub-sub-category", {
                      id: S.num("Sub-sub-category ID"),
                      name: S.str("Sub-sub-category name"),
                      subcategoryId: S.num("Parent sub-category ID"),
                      subcategoryName: S.str("Parent sub-category name"),
                      categoryId: S.nullable(S.num("Top-level category ID")),
                      categoryName: S.nullable(S.str("Top-level category name")),
                    })),
                  })),
                  total: S.num("Total matching bookmarks (ignoring limit/offset)"),
                }),
              },
            },
          },
          400: { ...ErrorResp, description: "Invalid query parameter value" },
        },
      },
    }
  )
  .patch(
    "/bookmarks/:id",
    async ({ params, body, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: bookmarks.id }).from(bookmarks).where(eq(bookmarks.id, id));
      if (!row) { set.status = 404; return { error: "Bookmark not found" }; }

      const updates: Record<string, unknown> = {};
      if (body.title !== undefined) {
        const title = body.title.trim();
        if (!title) { set.status = 400; return { error: "title cannot be empty" }; }
        updates.title = title;
      }
      if (body.url !== undefined) {
        const url = body.url.trim();
        if (!url) { set.status = 400; return { error: "url cannot be empty" }; }
        updates.url = url;
      }
      if (body.description !== undefined) updates.description = body.description ?? null;
      if (body.flags !== undefined) {
        const flags = body.flags;
        if (flags.readLater !== undefined) updates.readLater = flags.readLater ? 1 : 0;
        if (flags.hotTopic !== undefined) updates.hotTopic = flags.hotTopic ? 1 : 0;
        if (flags.cheatsheets !== undefined) updates.cheatsheets = flags.cheatsheets ? 1 : 0;
        if (flags.forReview !== undefined) updates.forReview = flags.forReview ? 1 : 0;
      }

      const nextTagIds = body.tagIds !== undefined ? uniqueIds(body.tagIds) : null;
      const nextCategoryIds = body.categoryIds !== undefined ? uniqueIds(body.categoryIds) : null;
      const nextSubcategoryIds = body.subcategoryIds !== undefined ? uniqueIds(body.subcategoryIds) : null;
      const nextSubSubcategoryIds = body.subSubcategoryIds !== undefined ? uniqueIds(body.subSubcategoryIds) : null;

      if (nextCategoryIds !== null || nextSubcategoryIds !== null || nextSubSubcategoryIds !== null) {
        const currentClassificationIds = await getActiveClassificationIds(id);
        const categoryIds = nextCategoryIds ?? currentClassificationIds.categoryIds;
        const subcategoryIds = nextSubcategoryIds ?? currentClassificationIds.subcategoryIds;
        const subSubcategoryIds = nextSubSubcategoryIds ?? currentClassificationIds.subSubcategoryIds;
        const overlapError =
          await findClassificationOverlapError(
            categoryIds,
            subcategoryIds,
            subSubcategoryIds,
          ) ??
          await findCategoryDepthOverlapError(
            categoryIds,
            subcategoryIds,
            subSubcategoryIds,
          );

        if (overlapError) {
          set.status = 409;
          return { error: overlapError };
        }
      }

      const hasAssociationChanges =
        body.tagIds !== undefined ||
        body.categoryIds !== undefined ||
        body.subcategoryIds !== undefined ||
        body.subSubcategoryIds !== undefined;

      await db.transaction(async (tx) => {
        // Always touch updatedAt when anything changes (scalar or associations)
        if (Object.keys(updates).length > 0 || hasAssociationChanges) {
          await tx.update(bookmarks)
            .set({ ...updates, updatedAt: sql`NOW()` })
            .where(eq(bookmarks.id, id));
        }

        if (nextTagIds !== null) {
          const uniqueTagIds = nextTagIds;

          const existingTagLinks = await tx
            .select({ id: bookmarkTags.id, tagId: bookmarkTags.tagId, archivedAt: bookmarkTags.archivedAt })
            .from(bookmarkTags)
            .where(eq(bookmarkTags.bookmarkId, id));

          const desiredTagIds = new Set(uniqueTagIds);
          const tagsToArchive = existingTagLinks
            .filter((link) => link.archivedAt === null && !desiredTagIds.has(link.tagId))
            .map((link) => link.id);

          if (tagsToArchive.length > 0) {
            await tx.update(bookmarkTags)
              .set({ archivedAt: sql`NOW()` })
              .where(inArray(bookmarkTags.id, tagsToArchive));
          }

          const existingTagById = new Map<number, Array<typeof existingTagLinks[number]>>();
          for (const link of existingTagLinks) {
            const bucket = existingTagById.get(link.tagId);
            if (bucket) bucket.push(link);
            else existingTagById.set(link.tagId, [link]);
          }

          for (const tagId of uniqueTagIds) {
            const matchingLinks = existingTagById.get(tagId) ?? [];
            const activeLink = matchingLinks.find((link) => link.archivedAt === null);
            if (activeLink) continue;

            const archivedLink = matchingLinks.find((link) => link.archivedAt !== null);
            if (archivedLink) {
              await tx.update(bookmarkTags)
                .set({ archivedAt: null })
                .where(eq(bookmarkTags.id, archivedLink.id));
            } else {
              await tx.insert(bookmarkTags).values({ bookmarkId: id, tagId });
            }
          }
        }

        if (nextCategoryIds !== null) {
          const uniqueCategoryIds = nextCategoryIds;

          const existingCategoryLinks = await tx
            .select({ id: bookmarkCategories.id, categoryId: bookmarkCategories.categoryId, archivedAt: bookmarkCategories.archivedAt })
            .from(bookmarkCategories)
            .where(eq(bookmarkCategories.bookmarkId, id));

          const desiredCategoryIds = new Set(uniqueCategoryIds);
          const categoriesToArchive = existingCategoryLinks
            .filter((link) => link.archivedAt === null && !desiredCategoryIds.has(link.categoryId))
            .map((link) => link.id);

          if (categoriesToArchive.length > 0) {
            await tx.update(bookmarkCategories)
              .set({ archivedAt: sql`NOW()` })
              .where(inArray(bookmarkCategories.id, categoriesToArchive));
          }

          const existingCategoryById = new Map<number, Array<typeof existingCategoryLinks[number]>>();
          for (const link of existingCategoryLinks) {
            const bucket = existingCategoryById.get(link.categoryId);
            if (bucket) bucket.push(link);
            else existingCategoryById.set(link.categoryId, [link]);
          }

          for (const categoryId of uniqueCategoryIds) {
            const matchingLinks = existingCategoryById.get(categoryId) ?? [];
            const activeLink = matchingLinks.find((link) => link.archivedAt === null);
            if (activeLink) continue;

            const archivedLink = matchingLinks.find((link) => link.archivedAt !== null);
            if (archivedLink) {
              await tx.update(bookmarkCategories)
                .set({ archivedAt: null })
                .where(eq(bookmarkCategories.id, archivedLink.id));
            } else {
              await tx.insert(bookmarkCategories).values({ bookmarkId: id, categoryId });
            }
          }
        }

        if (nextSubcategoryIds !== null) {
          const uniqueSubcategoryIds = nextSubcategoryIds;

          const existingSubcategoryLinks = await tx
            .select({ id: bookmarkSubcategories.id, subcategoryId: bookmarkSubcategories.subcategoryId, archivedAt: bookmarkSubcategories.archivedAt })
            .from(bookmarkSubcategories)
            .where(eq(bookmarkSubcategories.bookmarkId, id));

          const desiredSubcategoryIds = new Set(uniqueSubcategoryIds);
          const subcategoriesToArchive = existingSubcategoryLinks
            .filter((link) => link.archivedAt === null && !desiredSubcategoryIds.has(link.subcategoryId))
            .map((link) => link.id);

          if (subcategoriesToArchive.length > 0) {
            await tx.update(bookmarkSubcategories)
              .set({ archivedAt: sql`NOW()` })
              .where(inArray(bookmarkSubcategories.id, subcategoriesToArchive));
          }

          const existingSubcategoryById = new Map<number, Array<typeof existingSubcategoryLinks[number]>>();
          for (const link of existingSubcategoryLinks) {
            const bucket = existingSubcategoryById.get(link.subcategoryId);
            if (bucket) bucket.push(link);
            else existingSubcategoryById.set(link.subcategoryId, [link]);
          }

          for (const subcategoryId of uniqueSubcategoryIds) {
            const matchingLinks = existingSubcategoryById.get(subcategoryId) ?? [];
            const activeLink = matchingLinks.find((link) => link.archivedAt === null);
            if (activeLink) continue;

            const archivedLink = matchingLinks.find((link) => link.archivedAt !== null);
            if (archivedLink) {
              await tx.update(bookmarkSubcategories)
                .set({ archivedAt: null })
                .where(eq(bookmarkSubcategories.id, archivedLink.id));
            } else {
              await tx.insert(bookmarkSubcategories).values({ bookmarkId: id, subcategoryId });
            }
          }
        }

        if (nextSubSubcategoryIds !== null) {
          const uniqueSubSubcategoryIds = nextSubSubcategoryIds;

          const existingSubSubcategoryLinks = await tx
            .select({ id: bookmarkSubSubcategories.id, subSubcategoryId: bookmarkSubSubcategories.subSubcategoryId, archivedAt: bookmarkSubSubcategories.archivedAt })
            .from(bookmarkSubSubcategories)
            .where(eq(bookmarkSubSubcategories.bookmarkId, id));

          const desiredSubSubcategoryIds = new Set(uniqueSubSubcategoryIds);
          const subSubcategoriesToArchive = existingSubSubcategoryLinks
            .filter((link) => link.archivedAt === null && !desiredSubSubcategoryIds.has(link.subSubcategoryId))
            .map((link) => link.id);

          if (subSubcategoriesToArchive.length > 0) {
            await tx.update(bookmarkSubSubcategories)
              .set({ archivedAt: sql`NOW()` })
              .where(inArray(bookmarkSubSubcategories.id, subSubcategoriesToArchive));
          }

          const existingSubSubcategoryById = new Map<number, Array<typeof existingSubSubcategoryLinks[number]>>();
          for (const link of existingSubSubcategoryLinks) {
            const bucket = existingSubSubcategoryById.get(link.subSubcategoryId);
            if (bucket) bucket.push(link);
            else existingSubSubcategoryById.set(link.subSubcategoryId, [link]);
          }

          for (const subSubcategoryId of uniqueSubSubcategoryIds) {
            const matchingLinks = existingSubSubcategoryById.get(subSubcategoryId) ?? [];
            const activeLink = matchingLinks.find((link) => link.archivedAt === null);
            if (activeLink) continue;

            const archivedLink = matchingLinks.find((link) => link.archivedAt !== null);
            if (archivedLink) {
              await tx.update(bookmarkSubSubcategories)
                .set({ archivedAt: null })
                .where(eq(bookmarkSubSubcategories.id, archivedLink.id));
            } else {
              await tx.insert(bookmarkSubSubcategories).values({ bookmarkId: id, subSubcategoryId });
            }
          }
        }
      });

      return { ok: true };
    },
    {
      params: PositiveIdParam,
      body: t.Object({
        title: t.Optional(t.String({ description: "New title. Whitespace is trimmed. Cannot be set to an empty string." })),
        url: t.Optional(t.String({ description: "New URL. Whitespace is trimmed. Cannot be set to an empty string." })),
        description: t.Optional(t.Nullable(t.String({ description: "New description. Pass null to clear the existing description." }))),
        tagIds: t.Optional(t.Array(t.Number(), { description: "Replacement tag ID list. When provided, ALL existing tag associations are replaced with this set. Pass an empty array to remove all tags." })),
        categoryIds: t.Optional(t.Array(t.Number(), { description: "Replacement top-level category ID list. When provided, ALL existing direct category associations are replaced with this set. Pass an empty array to remove all direct categories." })),
        subcategoryIds: t.Optional(t.Array(t.Number(), { description: "Replacement sub-category ID list. When provided, ALL existing sub-category associations are replaced with this set. Pass an empty array to remove all sub-categories." })),
        subSubcategoryIds: t.Optional(t.Array(t.Number(), { description: "Replacement sub-sub-category ID list. When provided, ALL existing sub-sub-category associations are replaced with this set. Pass an empty array to remove all nested selections." })),
        flags: t.Optional(t.Object({
          readLater: t.Optional(t.Boolean({ description: "Set or clear the Read Later flag." })),
          hotTopic: t.Optional(t.Boolean({ description: "Set or clear the Hot Topic flag." })),
          cheatsheets: t.Optional(t.Boolean({ description: "Set or clear the Cheatsheet flag." })),
          forReview: t.Optional(t.Boolean({ description: "Set or clear the For Review flag." })),
        })),
      }),
      detail: {
        tags: ["bookmarks"],
        summary: "Edit a bookmark",
        description:
          "Partially updates a bookmark. Only fields present in the request body are changed - " +
          "omitting a field leaves its current value untouched.\n\n" +
          "**Tag and taxonomy replacement:** when `tagIds`, `categoryIds`, `subcategoryIds`, or `subSubcategoryIds` are provided, " +
          "the existing associations are **fully replaced** (not merged). " +
          "Removed associations are soft-archived; re-adding a previously removed association restores it. " +
          "Send an empty array to detach all tags, direct categories, sub-categories, or sub-sub-categories. " +
          "A bookmark cannot be linked to a direct category and also to a deeper link in that same category branch.\n\n" +
          "**Flags:** each flag is independent. Omitting a flag key leaves it unchanged. " +
          "Pass `false` to clear a flag that was previously set.\n\n" +
          "**URL:** when provided, whitespace is trimmed and an empty string is rejected with 400.\n\n" +
          "The `updatedAt` timestamp is refreshed whenever any field or association changes.",
        responses: {
          200: { ...OkResp, description: "Bookmark updated successfully" },
          400: { ...ErrorResp, description: "Validation error - invalid id, or title/url is blank after trimming" },
          404: { ...ErrorResp, description: "Bookmark not found" },
          409: { ...ErrorResp, description: "Conflicting taxonomy assignments in the same category branch" },
        },
      },
    }
  )
  .patch(
    "/bookmarks/:id/archive",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: bookmarks.id, archivedAt: bookmarks.archivedAt })
        .from(bookmarks).where(eq(bookmarks.id, id));
      if (!row) { set.status = 404; return { error: "Bookmark not found" }; }
      if (row.archivedAt) { set.status = 409; return { error: "Already archived" }; }
      await db.update(bookmarks).set({ archivedAt: sql`NOW()` }).where(eq(bookmarks.id, id));
      return { ok: true };
    },
    {
      params: PositiveIdParam,
      detail: {
        tags: ["bookmarks"],
        summary: "Archive a bookmark",
        description:
          "Soft-deletes a bookmark by setting its `archivedAt` timestamp to the current UTC time. " +
          "The bookmark record is preserved and can be fully restored via `PATCH /bookmarks/:id/restore`.\n\n" +
          "Archived bookmarks are excluded from `GET /bookmarks` by default and do not appear in flag counts. " +
          "Tag and subcategory associations are retained during archiving.",
        responses: {
          200: { ...OkResp, description: "Bookmark archived" },
          400: { ...ErrorResp, description: "id must be a positive integer" },
          404: { ...ErrorResp, description: "Bookmark not found" },
          409: { ...ErrorResp, description: "Bookmark is already archived" },
        },
      },
    }
  )
  .patch(
    "/bookmarks/:id/restore",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: bookmarks.id, archivedAt: bookmarks.archivedAt })
        .from(bookmarks).where(eq(bookmarks.id, id));
      if (!row) { set.status = 404; return { error: "Bookmark not found" }; }
      if (!row.archivedAt) { set.status = 409; return { error: "Not archived" }; }
      await db.update(bookmarks).set({ archivedAt: null }).where(eq(bookmarks.id, id));
      return { ok: true };
    },
    {
      params: PositiveIdParam,
      detail: {
        tags: ["bookmarks"],
        summary: "Restore an archived bookmark",
        description:
          "Reverses an archive operation by clearing the `archivedAt` timestamp (sets it to `null`). " +
          "The bookmark immediately becomes active again and reappears in standard queries.\n\n" +
          "All tag and subcategory associations that were present at archive time are still intact.",
        responses: {
          200: { ...OkResp, description: "Bookmark restored to active" },
          400: { ...ErrorResp, description: "id must be a positive integer" },
          404: { ...ErrorResp, description: "Bookmark not found" },
          409: { ...ErrorResp, description: "Bookmark is not archived - cannot restore an active bookmark" },
        },
      },
    }
  );
