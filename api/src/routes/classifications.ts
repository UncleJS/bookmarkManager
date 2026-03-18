import { Elysia, t } from "elysia";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  bookmarkClassifications,
  bookmarks,
  classificationGroups,
  classifications,
} from "../db/schema.ts";
import { ErrorResp, OkResp, S, isDupEntry } from "./shared.ts";

export const classificationRoutes = new Elysia()
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

      const grouped = groups.map((g) => ({
        ...g,
        classifications: classRows
          .filter((c) => c.groupId === g.id)
          .map((c) => ({ ...c, bookmarkCount: countMap.get(c.id) ?? 0 })),
      }));

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
        summary: "List all active classifications, grouped",
        description:
          "Returns all active (non-archived) classifications nested inside their parent groups.\n\n" +
          "Groups are sorted by `order` then `name`. Classifications within each group are also " +
          "sorted by `order` then `name`.\n\n" +
          "Classifications that have no group appear under a synthetic **Ungrouped** entry " +
          "(`id: 0`, `order: 999`) appended at the end of the list.\n\n" +
          "Each classification includes a `bookmarkCount` reflecting only active (non-archived) bookmarks. " +
          "This endpoint is intended for filtering/navigation UI - use `GET /classifications/groups` " +
          "for the management view that also includes archived records.",
        responses: {
          200: {
            description: "Grouped classification list",
            content: {
              "application/json": {
                schema: S.obj("Classification groups response", {
                  groups: S.arr("List of active groups (plus synthetic Ungrouped entry if needed)", S.obj("Classification group", {
                    id: S.num("Group ID (0 = synthetic Ungrouped entry)"),
                    name: S.str("Group name"),
                    order: S.num("Display sort order"),
                    classifications: S.arr("Classifications in this group", S.obj("Classification", {
                      id: S.num("Classification ID"),
                      name: S.str("Classification name"),
                      order: S.num("Display sort order"),
                      groupId: S.nullable(S.num("Parent group ID, or null if ungrouped")),
                      bookmarkCount: S.num("Number of active bookmarks using this classification"),
                    })),
                  })),
                }),
              },
            },
          },
        },
      },
    }
  )
  .post(
    "/classifications",
    async ({ body, set }) => {
      const name = body.name.trim();
      if (!name) {
        set.status = 400;
        return { error: "name is required" };
      }

      let groupId: number | null = body.groupId ?? null;

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
        name: t.String({ description: "Classification name. Must be unique within the target group. Whitespace is trimmed." }),
        groupId: t.Optional(t.Nullable(t.Number({ description: "ID of an existing group to assign this classification to. Omit or pass null to leave ungrouped." }))),
        groupName: t.Optional(t.Nullable(t.String({ description: "If provided (and `groupId` is absent), a new group with this name is created and the classification is placed inside it." }))),
      }),
      detail: {
        tags: ["classifications"],
        summary: "Create a classification",
        description:
          "Creates a new active classification.\n\n" +
          "**Group assignment (pick one):**\n" +
          "- `groupId` - assign to an existing group by ID\n" +
          "- `groupName` - create a brand-new group and place the classification inside it (only used when `groupId` is absent)\n" +
          "- Neither - classification is created ungrouped\n\n" +
          "Classification names must be unique **within their group** among active records. " +
          "A classification named `TypeScript` can exist in both `Languages` and `Frameworks` simultaneously. " +
          "Archived classifications with the same name/group do not block creation.",
        responses: {
          201: {
            description: "Classification created",
            content: {
              "application/json": {
                schema: S.obj("Created classification", {
                  id: S.num("New classification ID"),
                  name: S.str("Trimmed name as stored"),
                  groupId: S.nullable(S.num("Assigned group ID, or null if ungrouped")),
                }),
              },
            },
          },
          400: { ...ErrorResp, description: "Validation error - name is blank after trimming" },
          409: { ...ErrorResp, description: "Conflict - an active classification with this name already exists in the same group" },
        },
      },
    }
  )
  .patch(
    "/classifications/:id/archive",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: classifications.id, archivedAt: classifications.archivedAt })
        .from(classifications).where(eq(classifications.id, id));
      if (!row) { set.status = 404; return { error: "Classification not found" }; }
      if (row.archivedAt) { set.status = 409; return { error: "Already archived" }; }

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
    {
      detail: {
        tags: ["classifications"],
        summary: "Archive a classification",
        description:
          "Soft-deletes a classification by setting its `archivedAt` timestamp.\n\n" +
          "**Safety check:** archiving is blocked if any **active** (non-archived) bookmarks are currently " +
          "assigned to this classification. The error message reports the exact count. " +
          "Reassign or archive those bookmarks first, then retry.\n\n" +
          "Archived classifications no longer appear in `GET /classifications` " +
          "but remain visible in `GET /classifications/groups` for management purposes.",
        responses: {
          200: { ...OkResp, description: "Classification archived" },
          404: { ...ErrorResp, description: "Classification not found" },
          409: { ...ErrorResp, description: "Already archived, or active bookmarks are linked to this classification" },
        },
      },
    }
  )
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
    {
      detail: {
        tags: ["classifications"],
        summary: "Restore an archived classification",
        description:
          "Clears the `archivedAt` timestamp on a classification, making it active again. " +
          "The classification reappears in `GET /classifications` and can be assigned to new bookmarks.\n\n" +
          "Note: if the parent group is also archived, the classification will be restored but its group " +
          "will still be hidden from the active view until the group is also restored.",
        responses: {
          200: { ...OkResp, description: "Classification restored to active" },
          404: { ...ErrorResp, description: "Classification not found" },
          409: { ...ErrorResp, description: "Classification is not archived" },
        },
      },
    }
  )
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
      body: t.Object({
        name: t.String({ description: "New classification name. Must be non-empty after trimming. Must be unique within the same group among active classifications." }),
      }),
      detail: {
        tags: ["classifications"],
        summary: "Rename a classification",
        description:
          "Updates the display name of a classification. " +
          "The name is trimmed of whitespace before saving.\n\n" +
          "Uniqueness is enforced within the classification's group - the same name can exist in different groups. " +
          "Archived classifications with the same name in the same group do not cause a conflict.",
        responses: {
          200: {
            description: "Classification renamed",
            content: {
              "application/json": {
                schema: S.obj("Renamed classification", {
                  ok: { type: "boolean" as const, enum: [true], description: "Always true" },
                  id: S.num("Classification ID"),
                  name: S.str("New name as stored"),
                }),
              },
            },
          },
          400: { ...ErrorResp, description: "Validation error - name is blank after trimming" },
          404: { ...ErrorResp, description: "Classification not found" },
          409: { ...ErrorResp, description: "Conflict - an active classification with this name already exists in the same group" },
        },
      },
    }
  )
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
      body: t.Object({
        order: t.Number({ description: "New display sort order value. Lower numbers appear first within the group. Values do not need to be contiguous." }),
      }),
      detail: {
        tags: ["classifications"],
        summary: "Set display order for a classification",
        description:
          "Sets the `order` field on a classification, controlling its position within its group in the UI. " +
          "Classifications with lower `order` values appear first; ties are broken alphabetically by name.\n\n" +
          "Order values are arbitrary integers - sparse values (e.g. 10, 20, 30) are recommended " +
          "to minimise the need to reorder multiple items at once.",
        responses: {
          200: { ...OkResp, description: "Order updated" },
          404: { ...ErrorResp, description: "Classification not found" },
        },
      },
    }
  );
