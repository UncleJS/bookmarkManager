import { Elysia, t } from "elysia";
import { and, asc, desc, eq, isNotNull, isNull, like, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { bookmarks, bookmarkTags, tags } from "../db/schema.ts";
import { ErrorResp, OkResp, S, isDupEntry } from "./shared.ts";

export const tagRoutes = new Elysia()
  .get(
    "/tags",
    async ({ query }) => {
      const limit = Math.min(Number(query.limit ?? 20), 100);
      const offset = Number(query.offset ?? 0);
      const search = query.query?.trim() ?? "";
      const exact = query.exact === "true";
      const sort = query.sort === "alpha" ? "alpha" : "count";
      const archived = query.archived === "true";

      const where = and(
        archived ? isNotNull(tags.archivedAt) : isNull(tags.archivedAt),
        search
          ? exact
            ? sql`LOWER(${tags.name}) = LOWER(${search})`
            : like(tags.name, `%${search}%`)
          : undefined
      );

      const orderBy = sort === "alpha"
        ? [asc(tags.name)]
        : [desc(sql`COUNT(DISTINCT ${bookmarkTags.bookmarkId})`), asc(tags.name)];

      const [rows, [countRow]] = await Promise.all([
        db
          .select({
            id: tags.id,
            name: tags.name,
            archivedAt: tags.archivedAt,
            bookmarkCount: sql<number>`COUNT(DISTINCT ${bookmarkTags.bookmarkId})`,
          })
          .from(tags)
          .leftJoin(
            bookmarkTags,
            and(
              eq(bookmarkTags.tagId, tags.id),
              sql`EXISTS (SELECT 1 FROM bookmarks b WHERE b.id = ${bookmarkTags.bookmarkId} AND b.archived_at IS NULL)`
            )
          )
          .where(where)
          .groupBy(tags.id, tags.name, tags.archivedAt)
          .orderBy(...orderBy)
          .limit(limit)
          .offset(offset),
        db
          .select({ total: sql<number>`COUNT(*)` })
          .from(tags)
          .where(where),
      ]);

      return {
        items: rows.map((r) => ({
          ...r,
          bookmarkCount: Number(r.bookmarkCount),
        })),
        total: Number(countRow.total),
      };
    },
    {
      query: t.Object({
        query: t.Optional(t.String({ description: "Search term - filters tag names using a LIKE %term% match (case-insensitive)" })),
        exact: t.Optional(t.String({ description: "When `true`, returns only exact case-insensitive matches for `query`." })),
        limit: t.Optional(t.String({ description: "Maximum number of tags to return. Default: 20, max: 100" })),
        offset: t.Optional(t.String({ description: "Zero-based offset for pagination. Default: 0" })),
        sort: t.Optional(t.String({ description: "Sort order. `count` (default) sorts by active bookmark count descending then name ascending. `alpha` sorts alphabetically ascending" })),
        archived: t.Optional(t.String({ description: "When `true`, returns archived tags instead of active tags." })),
      }),
      detail: {
        tags: ["tags"],
        summary: "List / search tags",
        description:
          "Returns a paginated list of tags. By default this returns active (non-archived) tags; set `archived=true` to list archived tags instead.\n\n" +
          "Each item includes a `bookmarkCount` that reflects only **active** (non-archived) bookmarks. " +
          "Archived bookmarks are excluded from the count even if they retain tag associations.\n\n" +
          "Set `exact=true` with `query` to perform a case-insensitive exact-name lookup.\n\n" +
          "**Sorting:**\n" +
          "- `count` (default) - most-used tags first; ties broken alphabetically\n" +
          "- `alpha` - alphabetical A -> Z\n\n" +
          "**Search:** pass `query` for a case-insensitive substring match on the tag name.",
        responses: {
          200: {
            description: "Paginated tag list",
            content: {
              "application/json": {
                schema: {
                  type: "object" as const,
                  properties: {
                    items: {
                      type: "array" as const,
                      items: {
                        type: "object" as const,
                        properties: {
                          id: S.num("Tag ID"),
                          name: S.str("Tag name"),
                          archivedAt: S.nullable(S.str("UTC archive timestamp, or null while active")),
                          bookmarkCount: S.num("Number of active bookmarks using this tag"),
                        },
                      },
                    },
                    total: S.num("Total number of tags matching the query (ignoring limit/offset)"),
                  },
                },
              },
            },
          },
        },
      },
    }
  )
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
        set.status = 201;
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
      body: t.Object({
        name: t.String({ description: "Tag name. Must be unique among active tags. Whitespace is trimmed." }),
      }),
      detail: {
        tags: ["tags"],
        summary: "Create a tag",
        description:
          "Creates a new active tag. The name is trimmed of leading/trailing whitespace before saving.\n\n" +
          "Tag names must be unique among **active** tags. Archived tags with the same name do not block creation " +
          "(the uniqueness constraint uses a generated column that is `NULL` when archived).",
        responses: {
          201: {
            description: "Tag created successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object" as const,
                  properties: {
                    id: S.num("New tag ID"),
                    name: S.str("Trimmed tag name as stored"),
                  },
                },
              },
            },
          },
          400: { ...ErrorResp, description: "Validation error - name is blank after trimming" },
          409: { ...ErrorResp, description: "Conflict - an active tag with this name already exists" },
        },
      },
    }
  )
  .patch(
    "/tags/:id",
    async ({ params, body, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: tags.id })
        .from(tags).where(eq(tags.id, id));
      if (!row) { set.status = 404; return { error: "Tag not found" }; }

      const name = body.name.trim();
      if (!name) {
        set.status = 400;
        return { error: "name is required" };
      }

      try {
        await db.update(tags).set({ name }).where(eq(tags.id, id));
        return { ok: true, id, name };
      } catch (err: unknown) {
        if (isDupEntry(err)) {
          set.status = 409;
          return { error: "Tag already exists" };
        }
        throw err;
      }
    },
    {
      body: t.Object({
        name: t.String({ description: "New tag name. Must be non-empty after trimming and unique among active tags." }),
      }),
      detail: {
        tags: ["tags"],
        summary: "Rename a tag",
        description:
          "Updates a tag name after trimming leading/trailing whitespace.\n\n" +
          "Tag names must remain unique among active tags. Archived tags with the same name do not block the rename.",
        responses: {
          200: {
            description: "Tag updated",
            content: {
              "application/json": {
                schema: S.obj("Updated tag", {
                  ok: { type: "boolean" as const, enum: [true], description: "Always true" },
                  id: S.num("Tag ID"),
                  name: S.str("New name as stored"),
                }),
              },
            },
          },
          400: { ...ErrorResp, description: "Validation error - name is blank after trimming" },
          404: { ...ErrorResp, description: "Tag not found" },
          409: { ...ErrorResp, description: "Conflict - an active tag with this name already exists" },
        },
      },
    }
  )
  .patch(
    "/tags/:id/archive",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: tags.id, archivedAt: tags.archivedAt })
        .from(tags).where(eq(tags.id, id));
      if (!row) { set.status = 404; return { error: "Tag not found" }; }
      if (row.archivedAt) { set.status = 409; return { error: "Already archived" }; }

      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(bookmarkTags)
        .innerJoin(bookmarks, and(
          eq(bookmarkTags.bookmarkId, bookmarks.id),
          isNull(bookmarks.archivedAt),
        ))
        .where(and(
          eq(bookmarkTags.tagId, id),
          isNull(bookmarkTags.archivedAt),
        ));
      const total = Number(count);
      if (total > 0) {
        set.status = 409;
        return { error: `Cannot archive: ${total} active bookmark${total === 1 ? "" : "s"} linked to this tag` };
      }

      await db.update(tags).set({ archivedAt: sql`NOW()` }).where(eq(tags.id, id));
      return { ok: true };
    },
    {
      detail: {
        tags: ["tags"],
        summary: "Archive a tag",
        description:
          "Soft-deletes a tag by setting its `archivedAt` timestamp to the current UTC time.\n\n" +
          "**Safety check:** archiving is blocked if any active (non-archived) bookmarks are still linked to the tag. " +
          "The error message reports the exact count. Reassign or archive those bookmarks first, then retry.\n\n" +
          "Archived tags are excluded from `GET /tags` and are not counted in bookmark counts.",
        responses: {
          200: { ...OkResp, description: "Tag archived" },
          404: { ...ErrorResp, description: "Tag not found" },
          409: { ...ErrorResp, description: "Already archived, or active bookmarks are linked to this tag" },
        },
      },
    }
  )
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
    {
      detail: {
        tags: ["tags"],
        summary: "Restore an archived tag",
        description:
          "Clears the `archivedAt` timestamp on a tag, making it active again. " +
          "The tag reappears in `GET /tags` and all previously stored bookmark-tag associations " +
          "become visible again instantly.",
        responses: {
          200: { ...OkResp, description: "Tag restored to active" },
          404: { ...ErrorResp, description: "Tag not found" },
          409: { ...ErrorResp, description: "Tag is not archived" },
        },
      },
    }
  );
