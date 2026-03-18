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

export const groupRoutes = new Elysia()
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
        name: t.String({ description: "Group name. Must be unique among active groups. Whitespace is trimmed." }),
        order: t.Optional(t.Number({ description: "Display sort order. Lower numbers appear first. Defaults to 0." })),
      }),
      detail: {
        tags: ["groups"],
        summary: "Create a classification group",
        description:
          "Creates a new classification group used to organise related classifications.\n\n" +
          "Group names must be unique among **active** groups. Archived groups with the same name " +
          "do not block creation.\n\n" +
          "The `order` field controls the display position in the UI (lower = higher up the list). " +
          "Use `PATCH /classifications/groups/:id/reorder` to change order after creation.",
        responses: {
          201: {
            description: "Group created",
            content: {
              "application/json": {
                schema: S.obj("Created group", {
                  id: S.num("New group ID"),
                  name: S.str("Trimmed name as stored"),
                  order: S.num("Display sort order"),
                }),
              },
            },
          },
          400: { ...ErrorResp, description: "Validation error - name is blank after trimming" },
          409: { ...ErrorResp, description: "Conflict - an active group with this name already exists" },
        },
      },
    }
  )
  .get(
    "/classifications/groups",
    async ({ query }) => {
      const includeArchived = query.archived === "true";
      const groupWhere = includeArchived ? undefined : isNull(classificationGroups.archivedAt);
      const classificationArchivedWhere = includeArchived ? undefined : isNull(classifications.archivedAt);

      const [rows, countRows] = await Promise.all([
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

      const groupIds = rows.map((group) => group.id);
      const classRows = groupIds.length === 0
        ? []
        : await db
          .select({
            id: classifications.id,
            name: classifications.name,
            order: classifications.order,
            groupId: classifications.groupId,
            archivedAt: classifications.archivedAt,
          })
          .from(classifications)
          .where(
            classificationArchivedWhere
              ? and(inArray(classifications.groupId, groupIds), classificationArchivedWhere)
              : inArray(classifications.groupId, groupIds)
          )
          .orderBy(classifications.order, classifications.name);

      const countMap = new Map<number, number>(
        countRows.map((r) => [r.classificationId, Number(r.count)])
      );

      const classificationsByGroup = new Map<number | null, Array<typeof classRows[number]>>();
      for (const classification of classRows) {
        const bucket = classificationsByGroup.get(classification.groupId);
        if (bucket) {
          bucket.push(classification);
          continue;
        }

        classificationsByGroup.set(classification.groupId, [classification]);
      }

      const items = rows.map((g) => ({
        ...g,
        classifications: (classificationsByGroup.get(g.id) ?? [])
          .map((c) => ({ ...c, bookmarkCount: countMap.get(c.id) ?? 0 })),
      }));

      return { items };
    },
    {
      query: t.Object({
        archived: t.Optional(t.String({ description: "Pass `true` to include archived groups in the response. By default only active groups are returned." })),
      }),
      detail: {
        tags: ["groups"],
        summary: "List classification groups",
        description:
          "Returns groups with their nested classifications. " +
          "This is the **management view** and exposes the `archivedAt` field on both groups and " +
          "classifications so the UI can show archived state.\n\n" +
          "**Default:** active groups with active classifications only. Pass `archived=true` to include archived groups " +
          "and archived classifications in the response.\n\n" +
          "Each classification includes `bookmarkCount` reflecting only active (non-archived) bookmarks. " +
          "Groups are ordered by `order` then `name`; classifications within each group are ordered the same way.",
        responses: {
          200: {
            description: "Group list with nested classifications",
            content: {
              "application/json": {
                schema: S.obj("Groups management response", {
                  items: S.arr("List of groups", S.obj("Group with classifications", {
                    id: S.num("Group ID"),
                    name: S.str("Group name"),
                    order: S.num("Display sort order"),
                    archivedAt: S.nullable(S.any("Archive timestamp (UTC), null when active")),
                    classifications: S.arr("Classifications in this group", S.obj("Classification", {
                      id: S.num("Classification ID"),
                      name: S.str("Classification name"),
                      order: S.num("Display sort order"),
                      groupId: S.nullable(S.num("Parent group ID")),
                      archivedAt: S.nullable(S.any("Archive timestamp (UTC), null when active")),
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
      body: t.Object({
        name: t.String({ description: "New group name. Must be non-empty after trimming. Does not need to be globally unique if the existing group is active." }),
      }),
      detail: {
        tags: ["groups"],
        summary: "Rename a classification group",
        description:
          "Updates the display name of a classification group. " +
          "The name is trimmed of leading/trailing whitespace before saving. " +
          "Works on both active and archived groups.",
        responses: {
          200: {
            description: "Group renamed",
            content: {
              "application/json": {
                schema: S.obj("Renamed group", {
                  ok: { type: "boolean" as const, enum: [true], description: "Always true" },
                  id: S.num("Group ID"),
                  name: S.str("New name as stored"),
                }),
              },
            },
          },
          400: { ...ErrorResp, description: "Validation error - name is blank after trimming" },
          404: { ...ErrorResp, description: "Group not found" },
        },
      },
    }
  )
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
      body: t.Object({
        order: t.Number({ description: "New display sort order value. Lower numbers appear first. Values do not need to be contiguous." }),
      }),
      detail: {
        tags: ["groups"],
        summary: "Set display order for a classification group",
        description:
          "Sets the `order` field on a classification group, controlling its position in the UI. " +
          "Groups with lower `order` values appear first; ties are broken alphabetically by name.\n\n" +
          "Order values are arbitrary integers - you can use sparse values (e.g. 10, 20, 30) " +
          "to leave room for future insertions without having to reorder everything.",
        responses: {
          200: { ...OkResp, description: "Order updated" },
          404: { ...ErrorResp, description: "Group not found" },
        },
      },
    }
  )
  .patch(
    "/classifications/groups/:id/archive",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: classificationGroups.id, archivedAt: classificationGroups.archivedAt })
        .from(classificationGroups).where(eq(classificationGroups.id, id));
      if (!row) { set.status = 404; return { error: "Group not found" }; }
      if (row.archivedAt) { set.status = 409; return { error: "Already archived" }; }

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
    {
      detail: {
        tags: ["groups"],
        summary: "Archive a classification group",
        description:
          "Soft-deletes a classification group by setting its `archivedAt` timestamp.\n\n" +
          "**Safety check:** archiving is blocked if any active (non-archived) classifications inside " +
          "this group have active bookmarks assigned to them. " +
          "The error message reports the total active bookmark count across all affected classifications.\n\n" +
          "To proceed: archive or reassign the bookmarks linked to this group's classifications first. " +
          "The group and all its classifications can be restored at any time.",
        responses: {
          200: { ...OkResp, description: "Group archived" },
          404: { ...ErrorResp, description: "Group not found" },
          409: { ...ErrorResp, description: "Already archived, or active bookmarks are linked to classifications in this group" },
        },
      },
    }
  )
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
    {
      detail: {
        tags: ["groups"],
        summary: "Restore an archived classification group",
        description:
          "Clears the `archivedAt` timestamp on a classification group, making it active again.\n\n" +
          "Restoring a group does **not** automatically restore its archived classifications - " +
          "each classification must be restored individually via `PATCH /classifications/:id/restore` if needed.",
        responses: {
          200: { ...OkResp, description: "Group restored to active" },
          404: { ...ErrorResp, description: "Group not found" },
          409: { ...ErrorResp, description: "Group is not archived" },
        },
      },
    }
  );
