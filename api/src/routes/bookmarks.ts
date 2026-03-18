import { Elysia, t } from "elysia";
import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  bookmarkClassifications,
  bookmarks,
  bookmarkTags,
  classificationGroups,
  classifications,
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
      const tagIds = [...new Set(body.tags ?? [])].filter(Boolean);
      const classIds = [...new Set(body.classificationIds ?? [])].filter(Boolean);

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

          if (classIds.length > 0) {
            await tx
              .insert(bookmarkClassifications)
              .values(classIds.map((classificationId) => ({ bookmarkId: id, classificationId })));
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
        classificationIds: t.Optional(t.Array(t.Number(), { description: "IDs of classifications to attach. Duplicates are deduplicated automatically." })),
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
        allowDuplicate: t.Optional(t.Boolean({ description: "Set to true to bypass the duplicate URL check and allow saving the same URL more than once." })),
      }),
      detail: {
        tags: ["bookmarks"],
        summary: "Create a bookmark",
        description:
          "Saves a new bookmark with optional tags, classifications, and flags.\n\n" +
          "**Duplicate detection:** by default, if an active bookmark with the same URL already exists " +
          "a `409` is returned with a `duplicates` array listing the existing records. " +
          "Pass `allowDuplicate: true` to skip this check and save regardless.\n\n" +
          "**Tags and classifications** must already exist; pass their integer IDs in `tags` and " +
          "`classificationIds`. Duplicates in those arrays are silently deduplicated.\n\n" +
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
            description: "Duplicate URL detected. The response body includes the existing active bookmarks with that URL.",
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

      // --- classificationId ---
      const rawClassificationId = query.classificationId;
      let classificationId: number | null = null;
      if (rawClassificationId !== undefined) {
        const n = Number(rawClassificationId);
        if (!Number.isInteger(n) || n < 1) {
          set.status = 400;
          return { error: "classificationId must be a positive integer" };
        }
        classificationId = n;
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

      const orderCol = sortBy === "oldest" ? asc(bookmarks.createdAt) : desc(bookmarks.createdAt);

      const conditions = [
        showArchived ? isNotNull(bookmarks.archivedAt) : isNull(bookmarks.archivedAt),
      ];

      const flagColMap: BookmarkFlagColumnMap = {
        readLater: bookmarks.readLater,
        hotTopic: bookmarks.hotTopic,
        cheatsheets: bookmarks.cheatsheets,
        forReview: bookmarks.forReview,
      };
      if (flag && flagColMap[flag]) {
        conditions.push(eq(flagColMap[flag], 1));
      }

      if (classificationId) {
        const matchingIds = db
          .select({ bookmarkId: bookmarkClassifications.bookmarkId })
          .from(bookmarkClassifications)
          .where(and(
            eq(bookmarkClassifications.classificationId, classificationId),
          ));
        conditions.push(inArray(bookmarks.id, matchingIds));
      }

      if (tagId) {
        const matchingIds = db
          .select({ bookmarkId: bookmarkTags.bookmarkId })
          .from(bookmarkTags)
          .where(and(
            eq(bookmarkTags.tagId, tagId),
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
      const [tagRows, classRows] =
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
                .where(inArray(bookmarkTags.bookmarkId, ids)),
              db
                .select({
                  bookmarkId: bookmarkClassifications.bookmarkId,
                  classId: classifications.id,
                  className: classifications.name,
                  groupId: classificationGroups.id,
                  groupName: classificationGroups.name,
                })
                .from(bookmarkClassifications)
                .innerJoin(classifications, eq(bookmarkClassifications.classificationId, classifications.id))
                .leftJoin(classificationGroups, eq(classifications.groupId, classificationGroups.id))
                .where(inArray(bookmarkClassifications.bookmarkId, ids)),
            ])
          : [[], []];

      const items = rows.map((b) => ({
        ...b,
        tags: tagRows
          .filter((tagRow) => tagRow.bookmarkId === b.id)
          .map((tagRow) => ({ id: tagRow.tagId, name: tagRow.tagName })),
        classifications: classRows
          .filter((classRow) => classRow.bookmarkId === b.id)
          .map((classRow) => ({ id: classRow.classId, name: classRow.className, groupId: classRow.groupId ?? null, groupName: classRow.groupName ?? null })),
      }));

      return { items, total: Number(total) };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String({ description: "Maximum number of bookmarks to return. Integer 1–100. Default: 20." })),
        offset: t.Optional(t.String({ description: "Zero-based pagination offset. Non-negative integer. Default: 0." })),
        classificationId: t.Optional(t.String({ description: "Filter to bookmarks assigned to this classification ID. Must be a positive integer." })),
        tagId: t.Optional(t.String({ description: "Filter to bookmarks that have this tag ID attached. Must be a positive integer." })),
        flag: t.Optional(t.String({ description: "Filter to bookmarks with a specific flag set. Allowed values: `readLater`, `hotTopic`, `cheatsheets`, `forReview`." })),
        sortBy: t.Optional(t.String({ description: "Sort order by creation date. `newest` (default) or `oldest`." })),
        archived: t.Optional(t.String({ description: "Pass `true` to return archived bookmarks instead of active ones." })),
      }),
      detail: {
        tags: ["bookmarks"],
        summary: "List bookmarks",
        description:
          "Returns a paginated list of bookmarks with their full tag and classification associations.\n\n" +
          "**Default behaviour:** returns active (non-archived) bookmarks, newest first, 20 per page.\n\n" +
          "**Filters (all combinable with AND logic):**\n" +
          "- `classificationId` - bookmarks assigned to that classification\n" +
          "- `tagId` - bookmarks that have that tag\n" +
          "- `flag` - bookmarks with that flag set (`readLater` | `hotTopic` | `cheatsheets` | `forReview`)\n" +
          "- `archived=true` - show archived bookmarks (mutually exclusive with active)\n\n" +
          "Each bookmark item includes a fully resolved `tags` array and `classifications` array " +
          "(with parent group name). Flags are returned as `0`/`1` integers.",
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
                    classifications: S.arr("Attached classifications", S.obj("Classification", {
                      id: S.num("Classification ID"),
                      name: S.str("Classification name"),
                      groupId: S.nullable(S.num("Parent group ID")),
                      groupName: S.nullable(S.str("Parent group name")),
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

      const hasAssociationChanges = body.tagIds !== undefined || body.classificationIds !== undefined;

      await db.transaction(async (tx) => {
        // Always touch updatedAt when anything changes (scalar or associations)
        if (Object.keys(updates).length > 0 || hasAssociationChanges) {
          await tx.update(bookmarks)
            .set({ ...updates, updatedAt: sql`NOW()` })
            .where(eq(bookmarks.id, id));
        }

        if (body.tagIds !== undefined) {
          const uniqueTagIds = [...new Set(body.tagIds)].filter(Boolean);

          // Soft-archive removed associations
          if (uniqueTagIds.length > 0) {
            await tx.update(bookmarkTags)
              .set({ archivedAt: sql`NOW()` })
              .where(and(
                eq(bookmarkTags.bookmarkId, id),
                notInArray(bookmarkTags.tagId, uniqueTagIds),
                isNull(bookmarkTags.archivedAt),
              ));
          } else {
            // Archiving all
            await tx.update(bookmarkTags)
              .set({ archivedAt: sql`NOW()` })
              .where(and(
                eq(bookmarkTags.bookmarkId, id),
                isNull(bookmarkTags.archivedAt),
              ));
          }

          if (uniqueTagIds.length > 0) {
            for (const tagId of uniqueTagIds) {
              // Try to un-archive an existing row first; if none exists, insert
              const [existing] = await tx
                .select({ id: bookmarkTags.id, archivedAt: bookmarkTags.archivedAt })
                .from(bookmarkTags)
                .where(and(eq(bookmarkTags.bookmarkId, id), eq(bookmarkTags.tagId, tagId)));

              if (existing) {
                if (existing.archivedAt !== null) {
                  await tx.update(bookmarkTags)
                    .set({ archivedAt: null })
                    .where(eq(bookmarkTags.id, existing.id));
                }
                // already active — nothing to do
              } else {
                await tx.insert(bookmarkTags).values({ bookmarkId: id, tagId });
              }
            }
          }
        }

        if (body.classificationIds !== undefined) {
          const uniqueClassIds = [...new Set(body.classificationIds)].filter(Boolean);

          // Soft-archive removed associations
          if (uniqueClassIds.length > 0) {
            await tx.update(bookmarkClassifications)
              .set({ archivedAt: sql`NOW()` })
              .where(and(
                eq(bookmarkClassifications.bookmarkId, id),
                notInArray(bookmarkClassifications.classificationId, uniqueClassIds),
                isNull(bookmarkClassifications.archivedAt),
              ));
          } else {
            await tx.update(bookmarkClassifications)
              .set({ archivedAt: sql`NOW()` })
              .where(and(
                eq(bookmarkClassifications.bookmarkId, id),
                isNull(bookmarkClassifications.archivedAt),
              ));
          }

          if (uniqueClassIds.length > 0) {
            for (const classificationId of uniqueClassIds) {
              const [existing] = await tx
                .select({ id: bookmarkClassifications.id, archivedAt: bookmarkClassifications.archivedAt })
                .from(bookmarkClassifications)
                .where(and(
                  eq(bookmarkClassifications.bookmarkId, id),
                  eq(bookmarkClassifications.classificationId, classificationId),
                ));

              if (existing) {
                if (existing.archivedAt !== null) {
                  await tx.update(bookmarkClassifications)
                    .set({ archivedAt: null })
                    .where(eq(bookmarkClassifications.id, existing.id));
                }
              } else {
                await tx.insert(bookmarkClassifications).values({ bookmarkId: id, classificationId });
              }
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
        classificationIds: t.Optional(t.Array(t.Number(), { description: "Replacement classification ID list. When provided, ALL existing classification associations are replaced with this set. Pass an empty array to remove all classifications." })),
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
          "**Tag and classification replacement:** when `tagIds` or `classificationIds` are provided, " +
          "the existing associations are **fully replaced** (not merged). " +
          "Removed associations are soft-archived; re-adding a previously removed association restores it. " +
          "Send an empty array to detach all tags or classifications.\n\n" +
          "**Flags:** each flag is independent. Omitting a flag key leaves it unchanged. " +
          "Pass `false` to clear a flag that was previously set.\n\n" +
          "**URL:** when provided, whitespace is trimmed and an empty string is rejected with 400.\n\n" +
          "The `updatedAt` timestamp is refreshed whenever any field or association changes.",
        responses: {
          200: { ...OkResp, description: "Bookmark updated successfully" },
          400: { ...ErrorResp, description: "Validation error - invalid id, or title/url is blank after trimming" },
          404: { ...ErrorResp, description: "Bookmark not found" },
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
          "Tag and classification associations are retained during archiving.",
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
          "All tag and classification associations that were present at archive time are still intact.",
        responses: {
          200: { ...OkResp, description: "Bookmark restored to active" },
          400: { ...ErrorResp, description: "id must be a positive integer" },
          404: { ...ErrorResp, description: "Bookmark not found" },
          409: { ...ErrorResp, description: "Bookmark is not archived - cannot restore an active bookmark" },
        },
      },
    }
  );
