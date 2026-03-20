import { Elysia, t } from "elysia";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  bookmarkSubSubcategories,
  bookmarks,
  categories,
  subcategories,
  subSubcategories,
} from "../db/schema.ts";
import { ErrorResp, OkResp, PositiveIdParam, S, isDupEntry } from "./shared.ts";

export const subSubcategoryRoutes = new Elysia()
  .get(
    "/subSubcategories",
    async () => {
      const [subcategoryRows, itemRows, countRows] = await Promise.all([
        db
          .select({
            id: subcategories.id,
            name: subcategories.name,
            categoryId: subcategories.categoryId,
            categoryName: categories.name,
            order: subcategories.order,
          })
          .from(subcategories)
          .leftJoin(categories, eq(subcategories.categoryId, categories.id))
          .where(isNull(subcategories.archivedAt))
          .orderBy(subcategories.order, subcategories.name),
        db
          .select({
            id: subSubcategories.id,
            name: subSubcategories.name,
            description: subSubcategories.description,
            order: subSubcategories.order,
            subcategoryId: subSubcategories.subcategoryId,
          })
          .from(subSubcategories)
          .where(isNull(subSubcategories.archivedAt))
          .orderBy(subSubcategories.order, subSubcategories.name),
        db
          .select({
            subSubcategoryId: bookmarkSubSubcategories.subSubcategoryId,
            count: sql<number>`COUNT(*)`,
          })
          .from(bookmarkSubSubcategories)
          .innerJoin(bookmarks, and(
            eq(bookmarkSubSubcategories.bookmarkId, bookmarks.id),
            isNull(bookmarks.archivedAt),
          ))
          .where(isNull(bookmarkSubSubcategories.archivedAt))
          .groupBy(bookmarkSubSubcategories.subSubcategoryId),
      ]);

      const countMap = new Map<number, number>(
        countRows.map((row) => [row.subSubcategoryId, Number(row.count)])
      );

      return {
        subcategories: subcategoryRows.map((subcategory) => ({
          ...subcategory,
          subSubcategories: itemRows
            .filter((item) => item.subcategoryId === subcategory.id)
            .map((item) => ({ ...item, bookmarkCount: countMap.get(item.id) ?? 0 })),
        })),
      };
    },
    {
      detail: {
        tags: ["subSubcategories"],
        summary: "List all active sub-sub-categories, grouped by sub-category",
        description:
          "Returns all active (non-archived) sub-sub-categories nested inside their parent sub-categories. " +
          "Each item includes a direct bookmark count for active bookmarks.",
        responses: {
          200: {
            description: "Grouped sub-sub-category list",
            content: {
              "application/json": {
                schema: S.obj("Sub-sub-category response", {
                  subcategories: S.arr("Parent sub-categories", S.obj("Sub-category with children", {
                    id: S.num("Sub-category ID"),
                    name: S.str("Sub-category name"),
                    categoryId: S.nullable(S.num("Parent category ID")),
                    categoryName: S.nullable(S.str("Parent category name")),
                    subSubcategories: S.arr("Nested sub-sub-categories", S.obj("Sub-sub-category", {
                      id: S.num("Sub-sub-category ID"),
                      name: S.str("Sub-sub-category name"),
                      description: S.nullable(S.str("Optional description")),
                      order: S.num("Display sort order"),
                      subcategoryId: S.num("Parent sub-category ID"),
                      bookmarkCount: S.num("Direct active bookmark count"),
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
    "/subSubcategories",
    async ({ body, set }) => {
      const name = body.name.trim();
      if (!name) {
        set.status = 400;
        return { error: "name is required" };
      }

      const description = body.description?.trim() || null;
      try {
        const [result] = await db
          .insert(subSubcategories)
          .values({ name, description, subcategoryId: body.subcategoryId, order: body.order ?? 0 })
          .$returningId();
        set.status = 201;
        return { id: result.id, name, description, subcategoryId: body.subcategoryId, order: body.order ?? 0 };
      } catch (err: unknown) {
        if (isDupEntry(err)) {
          set.status = 409;
          return { error: "Sub-sub-category already exists in this sub-category" };
        }
        throw err;
      }
    },
    {
      body: t.Object({
        name: t.String({ description: "Sub-sub-category name. Must be unique within the parent sub-category." }),
        description: t.Optional(t.Nullable(t.String({ description: "Optional description for the sub-sub-category." }))),
        subcategoryId: t.Number({ description: "Parent sub-category ID." }),
        order: t.Optional(t.Number({ description: "Display sort order. Lower numbers appear first." })),
      }),
      detail: {
        tags: ["subSubcategories"],
        summary: "Create a sub-sub-category",
        description:
          "Creates a third-level taxonomy item nested inside an existing sub-category. " +
          "Names must be unique among active siblings in the same parent sub-category.",
        responses: {
          201: { ...OkResp, description: "Sub-sub-category created" },
          400: { ...ErrorResp, description: "Validation error - name is blank after trimming" },
          409: { ...ErrorResp, description: "Conflict - an active sub-sub-category with this name already exists in the same sub-category" },
        },
      },
    }
  )
  .patch(
    "/subSubcategories/:id/archive",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: subSubcategories.id, archivedAt: subSubcategories.archivedAt })
        .from(subSubcategories).where(eq(subSubcategories.id, id));
      if (!row) { set.status = 404; return { error: "Sub-sub-category not found" }; }
      if (row.archivedAt) { set.status = 409; return { error: "Already archived" }; }

      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(bookmarkSubSubcategories)
        .innerJoin(bookmarks, and(
          eq(bookmarkSubSubcategories.bookmarkId, bookmarks.id),
          isNull(bookmarks.archivedAt),
        ))
        .where(and(
          eq(bookmarkSubSubcategories.subSubcategoryId, id),
          isNull(bookmarkSubSubcategories.archivedAt),
        ));
      const total = Number(count);
      if (total > 0) {
        set.status = 409;
        return { error: `Cannot archive: ${total} active bookmark${total === 1 ? "" : "s"} linked to this sub-sub-category` };
      }

      await db.update(subSubcategories).set({ archivedAt: sql`NOW()` }).where(eq(subSubcategories.id, id));
      return { ok: true };
    },
    {
      params: PositiveIdParam,
      detail: {
        tags: ["subSubcategories"],
        summary: "Archive a sub-sub-category",
        description: "Soft-deletes a sub-sub-category unless active bookmarks still reference it.",
        responses: {
          200: { ...OkResp, description: "Sub-sub-category archived" },
          404: { ...ErrorResp, description: "Sub-sub-category not found" },
          409: { ...ErrorResp, description: "Already archived, or active bookmarks are linked to this sub-sub-category" },
        },
      },
    }
  )
  .patch(
    "/subSubcategories/:id/restore",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: subSubcategories.id, archivedAt: subSubcategories.archivedAt })
        .from(subSubcategories).where(eq(subSubcategories.id, id));
      if (!row) { set.status = 404; return { error: "Sub-sub-category not found" }; }
      if (!row.archivedAt) { set.status = 409; return { error: "Not archived" }; }
      await db.update(subSubcategories).set({ archivedAt: null }).where(eq(subSubcategories.id, id));
      return { ok: true };
    },
    {
      params: PositiveIdParam,
      detail: {
        tags: ["subSubcategories"],
        summary: "Restore an archived sub-sub-category",
        description: "Clears the archived timestamp and makes the sub-sub-category active again.",
        responses: {
          200: { ...OkResp, description: "Sub-sub-category restored" },
          404: { ...ErrorResp, description: "Sub-sub-category not found" },
          409: { ...ErrorResp, description: "Sub-sub-category is not archived" },
        },
      },
    }
  )
  .patch(
    "/subSubcategories/:id",
    async ({ params, body, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: subSubcategories.id })
        .from(subSubcategories).where(eq(subSubcategories.id, id));
      if (!row) { set.status = 404; return { error: "Sub-sub-category not found" }; }
      const name = body.name.trim();
      if (!name) { set.status = 400; return { error: "name is required" }; }
      const description = body.description !== undefined
        ? (body.description?.trim() || null)
        : undefined;
      const payload: Record<string, unknown> = { name };
      if (description !== undefined) payload.description = description;
      try {
        await db.update(subSubcategories).set(payload).where(eq(subSubcategories.id, id));
        return { ok: true, id, name, ...(description !== undefined ? { description } : {}) };
      } catch (err: unknown) {
        if (isDupEntry(err)) { set.status = 409; return { error: "Sub-sub-category name already exists in this sub-category" }; }
        throw err;
      }
    },
    {
      params: PositiveIdParam,
      body: t.Object({
        name: t.String({ description: "New sub-sub-category name. Must be non-empty after trimming." }),
        description: t.Optional(t.Nullable(t.String({ description: "Optional description. Pass null or empty string to clear." }))),
      }),
      detail: {
        tags: ["subSubcategories"],
        summary: "Rename a sub-sub-category",
        description: "Updates the display name and optional description for a sub-sub-category.",
        responses: {
          200: { ...OkResp, description: "Sub-sub-category updated" },
          400: { ...ErrorResp, description: "Validation error - name is blank after trimming" },
          404: { ...ErrorResp, description: "Sub-sub-category not found" },
          409: { ...ErrorResp, description: "Conflict - an active sub-sub-category with this name already exists in the same parent sub-category" },
        },
      },
    }
  )
  .patch(
    "/subSubcategories/:id/reorder",
    async ({ params, body, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: subSubcategories.id })
        .from(subSubcategories).where(eq(subSubcategories.id, id));
      if (!row) { set.status = 404; return { error: "Sub-sub-category not found" }; }
      await db.update(subSubcategories).set({ order: body.order }).where(eq(subSubcategories.id, id));
      return { ok: true };
    },
    {
      params: PositiveIdParam,
      body: t.Object({
        order: t.Number({ description: "New display sort order." }),
      }),
      detail: {
        tags: ["subSubcategories"],
        summary: "Set display order for a sub-sub-category",
        description: "Sets the display order field for a sub-sub-category.",
        responses: {
          200: { ...OkResp, description: "Order updated" },
          404: { ...ErrorResp, description: "Sub-sub-category not found" },
        },
      },
    }
  );
