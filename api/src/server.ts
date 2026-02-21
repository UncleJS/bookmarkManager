import { Elysia, t } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { db } from "./db/client.ts";
import {
  bookmarks,
  tags,
  classifications,
  classificationGroups,
  bookmarkTags,
  bookmarkClassifications,
} from "./db/schema.ts";
import { eq, isNull, isNotNull, like, and, inArray, sql, desc, asc } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

const UI_DIR = join(import.meta.dir, "ui");

function readUI(name: string): string {
  return readFileSync(join(UI_DIR, name), "utf-8");
}


// ---------------------------------------------------------------------------
// Load .env (Bun reads .env automatically but we call it explicitly for clarity)
// ---------------------------------------------------------------------------

const PORT = Number(process.env.API_PORT ?? 11650);

// ---------------------------------------------------------------------------
// Elysia App
// ---------------------------------------------------------------------------

const app = new Elysia()
  // ── Swagger / OpenAPI ──────────────────────────────────────────────────────
  .use(
    swagger({
      path: "/docs",
      documentation: {
        info: {
          title: "Bookmark Manager API",
          version: "0.1.0",
          description:
            "API for the Bookmark Manager Chrome extension. Manages bookmarks, tags, and classifications.",
        },
        tags: [
          { name: "health", description: "Health check" },
          { name: "bookmarks", description: "Bookmark operations" },
          { name: "tags", description: "Tag management" },
          { name: "classifications", description: "Classification management" },
          { name: "groups", description: "Classification group management" },
        ],
      },
    })
  )

  // ── OpenAPI JSON alias at /openapi.json ───────────────────────────────────
  // @elysiajs/swagger serves the spec at /docs/json; expose the standard path too
  .get("/openapi.json", async ({ redirect }) => redirect("/docs/json"), {
    detail: { tags: ["health"], summary: "OpenAPI spec (alias for /docs/json)" },
  })

  // ── Bookmark viewer UI ────────────────────────────────────────────────────
  .get(
    "/app",
    () =>
      new Response(readUI("app.html"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    {
      detail: { tags: ["health"], summary: "Bookmark viewer web UI" },
    }
  )

  // ── Category management UI ────────────────────────────────────────────────
  .get(
    "/categories",
    () =>
      new Response(readUI("categories.html"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    {
      detail: { tags: ["health"], summary: "Category management web UI" },
    }
  )

  // ── Health ─────────────────────────────────────────────────────────────────
  .get(
    "/health",
    () => ({ status: "ok" }),
    {
      detail: { tags: ["health"], summary: "Health check" },
    }
  )

  // ── Tags: GET /tags ────────────────────────────────────────────────────────
  .get(
    "/tags",
    async ({ query }) => {
      const limit = Math.min(Number(query.limit ?? 20), 100);
      const offset = Number(query.offset ?? 0);
      const search = query.query?.trim() ?? "";

      const where = and(
        isNull(tags.archivedAt),
        search ? like(tags.name, `%${search}%`) : undefined
      );

      const [rows, [countRow]] = await Promise.all([
        db
          .select({ id: tags.id, name: tags.name })
          .from(tags)
          .where(where)
          .limit(limit)
          .offset(offset),
        db
          .select({ total: sql<number>`COUNT(*)` })
          .from(tags)
          .where(where),
      ]);

      return { items: rows, total: Number(countRow.total) };
    },
    {
      query: t.Object({
        query: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
      detail: { tags: ["tags"], summary: "List / search tags" },
    }
  )

  // ── Tags: POST /tags ───────────────────────────────────────────────────────
  .post(
    "/tags",
    async ({ body, set }) => {
      const name = body.name.trim();
      if (!name) {
        set.status = 400;
        return { error: "name is required" };
      }

      try {
        const [result] = await db
          .insert(tags)
          .values({ name })
          .$returningId();
        return { id: result.id, name };
      } catch (err: unknown) {
        if (isDupEntry(err)) {
          set.status = 409;
          return { error: "Tag already exists" };
        }
        throw err;
      }
    },
    {
      body: t.Object({ name: t.String() }),
      detail: { tags: ["tags"], summary: "Create a tag" },
    }
  )

  // ── Classifications: GET /classifications ─────────────────────────────────
  .get(
    "/classifications",
    async () => {
      const [groups, classRows, countRows] = await Promise.all([
        db
          .select({
            id: classificationGroups.id,
            name: classificationGroups.name,
            order: classificationGroups.order,
          })
          .from(classificationGroups)
          .where(isNull(classificationGroups.archivedAt))
          .orderBy(classificationGroups.order, classificationGroups.name),
        db
          .select({
            id: classifications.id,
            name: classifications.name,
            order: classifications.order,
            groupId: classifications.groupId,
          })
          .from(classifications)
          .where(isNull(classifications.archivedAt))
          .orderBy(classifications.order, classifications.name),
        // Active bookmark counts per classification
        db
          .select({
            classificationId: bookmarkClassifications.classificationId,
            count: sql<number>`COUNT(*)`,
          })
          .from(bookmarkClassifications)
          .innerJoin(bookmarks, and(
            eq(bookmarkClassifications.bookmarkId, bookmarks.id),
            isNull(bookmarks.archivedAt)
          ))
          .groupBy(bookmarkClassifications.classificationId),
      ]);

      const countMap = new Map<number, number>(
        countRows.map((r) => [r.classificationId, Number(r.count)])
      );

      // Build grouped response
      const grouped = groups.map((g) => ({
        ...g,
        classifications: classRows
          .filter((c) => c.groupId === g.id)
          .map((c) => ({ ...c, bookmarkCount: countMap.get(c.id) ?? 0 })),
      }));

      // Ungrouped classifications (no group)
      const ungrouped = classRows
        .filter((c) => c.groupId === null)
        .map((c) => ({ ...c, bookmarkCount: countMap.get(c.id) ?? 0 }));
      if (ungrouped.length > 0) {
        grouped.push({
          id: 0,
          name: "Ungrouped",
          order: 999,
          classifications: ungrouped,
        });
      }

      return { groups: grouped };
    },
    {
      detail: {
        tags: ["classifications"],
        summary: "List all classifications (grouped)",
      },
    }
  )

  // ── Classifications: POST /classifications ────────────────────────────────
  .post(
    "/classifications",
    async ({ body, set }) => {
      const name = body.name.trim();
      if (!name) {
        set.status = 400;
        return { error: "name is required" };
      }

      let groupId: number | null = body.groupId ?? null;

      // Create a new group if groupName is provided and no groupId
      if (body.groupName && !groupId) {
        const groupName = body.groupName.trim();
        if (groupName) {
          const [g] = await db
            .insert(classificationGroups)
            .values({ name: groupName })
            .$returningId();
          groupId = g.id;
        }
      }

      try {
        const [result] = await db
          .insert(classifications)
          .values({ name, groupId })
          .$returningId();
        return { id: result.id, name, groupId };
      } catch (err: unknown) {
        if (isDupEntry(err)) {
          set.status = 409;
          return { error: "Classification already exists in this group" };
        }
        throw err;
      }
    },
    {
      body: t.Object({
        name: t.String(),
        groupId: t.Optional(t.Nullable(t.Number())),
        groupName: t.Optional(t.Nullable(t.String())),
      }),
      detail: {
        tags: ["classifications"],
        summary: "Create a classification (and optionally a new group)",
      },
    }
  )

  // ── Bookmarks: POST /bookmarks ────────────────────────────────────────────
  .post(
    "/bookmarks",
    async ({ body, set }) => {
      const url = body.url.trim();
      const title = body.title.trim();

      if (!url || !title) {
        set.status = 400;
        return { error: "url and title are required" };
      }

      // Duplicate detection
      if (!body.allowDuplicate) {
        const existing = await db
          .select({
            id: bookmarks.id,
            url: bookmarks.url,
            title: bookmarks.title,
            createdAt: bookmarks.createdAt,
          })
          .from(bookmarks)
          .where(and(sql`url = ${url}`, isNull(bookmarks.archivedAt)));

        if (existing.length > 0) {
          set.status = 409;
          return {
            error: "Duplicate URL",
            duplicates: existing.map((b) => ({
              id: b.id,
              url: b.url,
              title: b.title,
              createdAt: b.createdAt,
            })),
          };
        }
      }

      // Insert bookmark
      const flags = body.flags ?? {};
      const [result] = await db
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

      const bookmarkId = result.id;

      // Insert tag associations
      const tagIds = [...new Set(body.tags ?? [])].filter(Boolean);
      if (tagIds.length > 0) {
        await db
          .insert(bookmarkTags)
          .values(tagIds.map((tagId) => ({ bookmarkId, tagId })));
      }

      // Insert classification associations
      const classIds = [
        ...new Set(body.classificationIds ?? []),
      ].filter(Boolean);
      if (classIds.length > 0) {
        await db
          .insert(bookmarkClassifications)
          .values(classIds.map((classificationId) => ({ bookmarkId, classificationId })));
      }

      // Return the created bookmark
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
        url: t.String(),
        title: t.String(),
        description: t.Optional(t.String()),
        classificationIds: t.Optional(t.Array(t.Number())),
        tags: t.Optional(t.Array(t.Number())),
        flags: t.Optional(
          t.Object({
            readLater: t.Optional(t.Boolean()),
            hotTopic: t.Optional(t.Boolean()),
            cheatsheets: t.Optional(t.Boolean()),
            forReview: t.Optional(t.Boolean()),
            archived: t.Optional(t.Boolean()),
          })
        ),
        faviconUrl: t.Optional(t.String()),
        allowDuplicate: t.Optional(t.Boolean()),
      }),
      detail: { tags: ["bookmarks"], summary: "Create a bookmark" },
    }
  )

  // ── Bookmarks: GET /bookmarks ─────────────────────────────────────────────
  .get(
    "/bookmarks",
    async ({ query }) => {
      const limit = Math.min(Number(query.limit ?? 20), 100);
      const offset = Number(query.offset ?? 0);
      const classificationId = query.classificationId
        ? Number(query.classificationId)
        : null;
      const sortBy = query.sortBy === "oldest" ? "oldest" : "newest";
      const showArchived = query.archived === "true";

      // Build base WHERE: archived or active
      const baseWhere = showArchived
        ? isNotNull(bookmarks.archivedAt)
        : isNull(bookmarks.archivedAt);

      // When filtering by classification, join through bookmark_classifications
      const orderCol =
        sortBy === "oldest"
          ? asc(bookmarks.createdAt)
          : desc(bookmarks.createdAt);

      let rows;
      let total: number;

      if (classificationId) {
        // Subquery: bookmark IDs that belong to the given classification
        const matchingIds = db
          .select({ bookmarkId: bookmarkClassifications.bookmarkId })
          .from(bookmarkClassifications)
          .where(eq(bookmarkClassifications.classificationId, classificationId));

        const where = and(baseWhere, inArray(bookmarks.id, matchingIds));

        [rows, [{ total: total }]] = await Promise.all([
          db
            .select({
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
            })
            .from(bookmarks)
            .where(where)
            .orderBy(orderCol)
            .limit(limit)
            .offset(offset),
          db.select({ total: sql<number>`COUNT(*)` }).from(bookmarks).where(where),
        ]);
      } else {
        [rows, [{ total: total }]] = await Promise.all([
          db
            .select({
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
            })
            .from(bookmarks)
            .where(baseWhere)
            .orderBy(orderCol)
            .limit(limit)
            .offset(offset),
          db
            .select({ total: sql<number>`COUNT(*)` })
            .from(bookmarks)
            .where(baseWhere),
        ]);
      }

      // Attach tags + classifications to each bookmark
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
                .innerJoin(
                  classifications,
                  eq(bookmarkClassifications.classificationId, classifications.id)
                )
                .leftJoin(
                  classificationGroups,
                  eq(classifications.groupId, classificationGroups.id)
                )
                .where(inArray(bookmarkClassifications.bookmarkId, ids)),
            ])
          : [[], []];

      const items = rows.map((b) => ({
        ...b,
        tags: tagRows
          .filter((t) => t.bookmarkId === b.id)
          .map((t) => ({ id: t.tagId, name: t.tagName })),
        classifications: classRows
          .filter((c) => c.bookmarkId === b.id)
          .map((c) => ({ id: c.classId, name: c.className, groupId: c.groupId ?? null, groupName: c.groupName ?? null })),
      }));

      return { items, total: Number(total) };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
        classificationId: t.Optional(t.String()),
        sortBy: t.Optional(t.String()),
        archived: t.Optional(t.String()),
      }),
      detail: {
        tags: ["bookmarks"],
        summary: "List bookmarks (filter by classificationId, sort by newest/oldest, ?archived=true for archived)",
      },
    }
  )

  // ── Bookmarks: PATCH /bookmarks/:id ──────────────────────────────────────
  .patch(
    "/bookmarks/:id",
    async ({ params, body, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: bookmarks.id }).from(bookmarks).where(eq(bookmarks.id, id));
      if (!row) { set.status = 404; return { error: "Bookmark not found" }; }

      // Build update object from provided fields
      const updates: Record<string, unknown> = {};
      if (body.title !== undefined) {
        const t = body.title.trim();
        if (!t) { set.status = 400; return { error: "title cannot be empty" }; }
        updates.title = t;
      }
      if (body.description !== undefined) updates.description = body.description ?? null;
      if (body.flags !== undefined) {
        const f = body.flags;
        if (f.readLater   !== undefined) updates.readLater   = f.readLater   ? 1 : 0;
        if (f.hotTopic    !== undefined) updates.hotTopic    = f.hotTopic    ? 1 : 0;
        if (f.cheatsheets !== undefined) updates.cheatsheets = f.cheatsheets ? 1 : 0;
        if (f.forReview   !== undefined) updates.forReview   = f.forReview   ? 1 : 0;
      }

      if (Object.keys(updates).length > 0) {
        await db.update(bookmarks).set(updates).where(eq(bookmarks.id, id));
      }

      // Replace tags if provided
      if (body.tagIds !== undefined) {
        await db.delete(bookmarkTags).where(eq(bookmarkTags.bookmarkId, id));
        const uniqueTagIds = [...new Set(body.tagIds)].filter(Boolean);
        if (uniqueTagIds.length > 0) {
          await db.insert(bookmarkTags).values(uniqueTagIds.map(tagId => ({ bookmarkId: id, tagId })));
        }
      }

      // Replace classifications if provided
      if (body.classificationIds !== undefined) {
        await db.delete(bookmarkClassifications).where(eq(bookmarkClassifications.bookmarkId, id));
        const uniqueClassIds = [...new Set(body.classificationIds)].filter(Boolean);
        if (uniqueClassIds.length > 0) {
          await db.insert(bookmarkClassifications).values(uniqueClassIds.map(classificationId => ({ bookmarkId: id, classificationId })));
        }
      }

      return { ok: true };
    },
    {
      body: t.Object({
        title:             t.Optional(t.String()),
        description:       t.Optional(t.Nullable(t.String())),
        tagIds:            t.Optional(t.Array(t.Number())),
        classificationIds: t.Optional(t.Array(t.Number())),
        flags: t.Optional(t.Object({
          readLater:   t.Optional(t.Boolean()),
          hotTopic:    t.Optional(t.Boolean()),
          cheatsheets: t.Optional(t.Boolean()),
          forReview:   t.Optional(t.Boolean()),
        })),
      }),
      detail: { tags: ["bookmarks"], summary: "Edit a bookmark (title, description, flags, tags, classifications)" },
    }
  )

  // ── Bookmarks: PATCH /bookmarks/:id/archive ──────────────────────────────
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
    { detail: { tags: ["bookmarks"], summary: "Archive a bookmark" } }
  )

  // ── Bookmarks: PATCH /bookmarks/:id/restore ───────────────────────────────
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
    { detail: { tags: ["bookmarks"], summary: "Restore an archived bookmark" } }
  )

  // ── Classifications: PATCH /classifications/:id/archive ───────────────────
  .patch(
    "/classifications/:id/archive",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: classifications.id, archivedAt: classifications.archivedAt })
        .from(classifications).where(eq(classifications.id, id));
      if (!row) { set.status = 404; return { error: "Classification not found" }; }
      if (row.archivedAt) { set.status = 409; return { error: "Already archived" }; }

      // Block if active bookmarks are linked
      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(bookmarkClassifications)
        .innerJoin(bookmarks, and(
          eq(bookmarkClassifications.bookmarkId, bookmarks.id),
          isNull(bookmarks.archivedAt)
        ))
        .where(eq(bookmarkClassifications.classificationId, id));
      const n = Number(count);
      if (n > 0) {
        set.status = 409;
        return { error: `Cannot archive: ${n} active bookmark${n === 1 ? "" : "s"} linked to this classification` };
      }

      await db.update(classifications).set({ archivedAt: sql`NOW()` }).where(eq(classifications.id, id));
      return { ok: true };
    },
    { detail: { tags: ["classifications"], summary: "Archive a classification" } }
  )

  // ── Classifications: PATCH /classifications/:id/restore ───────────────────
  .patch(
    "/classifications/:id/restore",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: classifications.id, archivedAt: classifications.archivedAt })
        .from(classifications).where(eq(classifications.id, id));
      if (!row) { set.status = 404; return { error: "Classification not found" }; }
      if (!row.archivedAt) { set.status = 409; return { error: "Not archived" }; }
      await db.update(classifications).set({ archivedAt: null }).where(eq(classifications.id, id));
      return { ok: true };
    },
    { detail: { tags: ["classifications"], summary: "Restore an archived classification" } }
  )

  // ── Tags: PATCH /tags/:id/archive ─────────────────────────────────────────
  .patch(
    "/tags/:id/archive",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: tags.id, archivedAt: tags.archivedAt })
        .from(tags).where(eq(tags.id, id));
      if (!row) { set.status = 404; return { error: "Tag not found" }; }
      if (row.archivedAt) { set.status = 409; return { error: "Already archived" }; }
      await db.update(tags).set({ archivedAt: sql`NOW()` }).where(eq(tags.id, id));
      return { ok: true };
    },
    { detail: { tags: ["tags"], summary: "Archive a tag" } }
  )

  // ── Tags: PATCH /tags/:id/restore ─────────────────────────────────────────
  .patch(
    "/tags/:id/restore",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: tags.id, archivedAt: tags.archivedAt })
        .from(tags).where(eq(tags.id, id));
      if (!row) { set.status = 404; return { error: "Tag not found" }; }
      if (!row.archivedAt) { set.status = 409; return { error: "Not archived" }; }
      await db.update(tags).set({ archivedAt: null }).where(eq(tags.id, id));
      return { ok: true };
    },
    { detail: { tags: ["tags"], summary: "Restore an archived tag" } }
  )

  // ── Classification Groups: POST /classifications/groups ───────────────────
  .post(
    "/classifications/groups",
    async ({ body, set }) => {
      const name = body.name.trim();
      if (!name) { set.status = 400; return { error: "name is required" }; }
      try {
        const [result] = await db
          .insert(classificationGroups)
          .values({ name, order: body.order ?? 0 })
          .$returningId();
        return { id: result.id, name, order: body.order ?? 0 };
      } catch (err: unknown) {
        if (isDupEntry(err)) { set.status = 409; return { error: "Group already exists" }; }
        throw err;
      }
    },
    {
      body: t.Object({
        name: t.String(),
        order: t.Optional(t.Number()),
      }),
      detail: { tags: ["groups"], summary: "Create a classification group" },
    }
  )

  // ── Classification Groups: GET /classifications/groups ────────────────────
  // Returns all groups (active + archived) for the management UI
  .get(
    "/classifications/groups",
    async ({ query }) => {
      const includeArchived = query.archived === "true";
      const groupWhere = includeArchived ? undefined : isNull(classificationGroups.archivedAt);

      const [rows, classRows, countRows] = await Promise.all([
        db
          .select({
            id: classificationGroups.id,
            name: classificationGroups.name,
            order: classificationGroups.order,
            archivedAt: classificationGroups.archivedAt,
          })
          .from(classificationGroups)
          .where(groupWhere)
          .orderBy(classificationGroups.order, classificationGroups.name),
        // All classifications (active + archived) for these groups
        db
          .select({
            id: classifications.id,
            name: classifications.name,
            order: classifications.order,
            groupId: classifications.groupId,
            archivedAt: classifications.archivedAt,
          })
          .from(classifications)
          .orderBy(classifications.order, classifications.name),
        // Active bookmark counts per classification
        db
          .select({
            classificationId: bookmarkClassifications.classificationId,
            count: sql<number>`COUNT(*)`,
          })
          .from(bookmarkClassifications)
          .innerJoin(bookmarks, and(
            eq(bookmarkClassifications.bookmarkId, bookmarks.id),
            isNull(bookmarks.archivedAt)
          ))
          .groupBy(bookmarkClassifications.classificationId),
      ]);

      const countMap = new Map<number, number>(
        countRows.map((r) => [r.classificationId, Number(r.count)])
      );

      const items = rows.map((g) => ({
        ...g,
        classifications: classRows
          .filter((c) => c.groupId === g.id)
          .map((c) => ({ ...c, bookmarkCount: countMap.get(c.id) ?? 0 })),
      }));

      return { items };
    },
    {
      query: t.Object({ archived: t.Optional(t.String()) }),
      detail: { tags: ["groups"], summary: "List classification groups" },
    }
  )

  // ── Classification Groups: PATCH /classifications/groups/:id (rename) ─────
  .patch(
    "/classifications/groups/:id",
    async ({ params, body, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: classificationGroups.id })
        .from(classificationGroups).where(eq(classificationGroups.id, id));
      if (!row) { set.status = 404; return { error: "Group not found" }; }
      const name = body.name.trim();
      if (!name) { set.status = 400; return { error: "name is required" }; }
      await db.update(classificationGroups).set({ name }).where(eq(classificationGroups.id, id));
      return { ok: true, id, name };
    },
    {
      body: t.Object({ name: t.String() }),
      detail: { tags: ["groups"], summary: "Rename a classification group" },
    }
  )

  // ── Classification Groups: PATCH /classifications/groups/:id/reorder ──────
  .patch(
    "/classifications/groups/:id/reorder",
    async ({ params, body, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: classificationGroups.id })
        .from(classificationGroups).where(eq(classificationGroups.id, id));
      if (!row) { set.status = 404; return { error: "Group not found" }; }
      await db.update(classificationGroups).set({ order: body.order }).where(eq(classificationGroups.id, id));
      return { ok: true };
    },
    {
      body: t.Object({ order: t.Number() }),
      detail: { tags: ["groups"], summary: "Set display order for a classification group" },
    }
  )

  // ── Classification Groups: PATCH /classifications/groups/:id/archive ──────
  .patch(
    "/classifications/groups/:id/archive",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: classificationGroups.id, archivedAt: classificationGroups.archivedAt })
        .from(classificationGroups).where(eq(classificationGroups.id, id));
      if (!row) { set.status = 404; return { error: "Group not found" }; }
      if (row.archivedAt) { set.status = 409; return { error: "Already archived" }; }

      // Block if any active classification in the group has active bookmarks
      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(bookmarkClassifications)
        .innerJoin(bookmarks, and(
          eq(bookmarkClassifications.bookmarkId, bookmarks.id),
          isNull(bookmarks.archivedAt)
        ))
        .innerJoin(classifications, and(
          eq(bookmarkClassifications.classificationId, classifications.id),
          isNull(classifications.archivedAt),
          eq(classifications.groupId, id)
        ));
      const n = Number(count);
      if (n > 0) {
        set.status = 409;
        return { error: `Cannot archive: ${n} active bookmark${n === 1 ? "" : "s"} linked to classifications in this group` };
      }

      await db.update(classificationGroups).set({ archivedAt: sql`NOW()` }).where(eq(classificationGroups.id, id));
      return { ok: true };
    },
    { detail: { tags: ["groups"], summary: "Archive a classification group" } }
  )

  // ── Classification Groups: PATCH /classifications/groups/:id/restore ──────
  .patch(
    "/classifications/groups/:id/restore",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: classificationGroups.id, archivedAt: classificationGroups.archivedAt })
        .from(classificationGroups).where(eq(classificationGroups.id, id));
      if (!row) { set.status = 404; return { error: "Group not found" }; }
      if (!row.archivedAt) { set.status = 409; return { error: "Not archived" }; }
      await db.update(classificationGroups).set({ archivedAt: null }).where(eq(classificationGroups.id, id));
      return { ok: true };
    },
    { detail: { tags: ["groups"], summary: "Restore an archived classification group" } }
  )

  // ── Classifications: PATCH /classifications/:id (rename) ──────────────────
  .patch(
    "/classifications/:id",
    async ({ params, body, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: classifications.id })
        .from(classifications).where(eq(classifications.id, id));
      if (!row) { set.status = 404; return { error: "Classification not found" }; }
      const name = body.name.trim();
      if (!name) { set.status = 400; return { error: "name is required" }; }
      try {
        await db.update(classifications).set({ name }).where(eq(classifications.id, id));
        return { ok: true, id, name };
      } catch (err: unknown) {
        if (isDupEntry(err)) { set.status = 409; return { error: "Classification name already exists in this group" }; }
        throw err;
      }
    },
    {
      body: t.Object({ name: t.String() }),
      detail: { tags: ["classifications"], summary: "Rename a classification" },
    }
  )

  // ── Classifications: PATCH /classifications/:id/reorder ───────────────────
  .patch(
    "/classifications/:id/reorder",
    async ({ params, body, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: classifications.id })
        .from(classifications).where(eq(classifications.id, id));
      if (!row) { set.status = 404; return { error: "Classification not found" }; }
      await db.update(classifications).set({ order: body.order }).where(eq(classifications.id, id));
      return { ok: true };
    },
    {
      body: t.Object({ order: t.Number() }),
      detail: { tags: ["classifications"], summary: "Set display order for a classification" },
    }
  )

  // ── Start ──────────────────────────────────────────────────────────────────
  .listen(PORT);

console.log(
  `🔖 Bookmark Manager API running at http://localhost:${PORT}\n` +
    `   Viewer UI  → http://localhost:${PORT}/app\n` +
    `   Swagger UI → http://localhost:${PORT}/docs\n` +
    `   OpenAPI    → http://localhost:${PORT}/openapi.json`
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDupEntry(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "ER_DUP_ENTRY"
  );
}

export type App = typeof app;
