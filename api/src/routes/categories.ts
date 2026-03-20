import { Elysia, t } from "elysia";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  bookmarkSubcategories,
  bookmarks,
  categories,
  subcategories,
} from "../db/schema.ts";
import { ErrorResp, OkResp, S, isDupEntry } from "./shared.ts";

export const categoryRoutes = new Elysia()
  .post(
    "/categories",
    async ({ body, set }) => {
      const name = body.name.trim();
      if (!name) { set.status = 400; return { error: "name is required" }; }
      const description = body.description?.trim() || null;
      try {
        const [result] = await db
          .insert(categories)
          .values({ name, description, order: body.order ?? 0 })
          .$returningId();
        set.status = 201;
        return { id: result.id, name, description, order: body.order ?? 0 };
      } catch (err: unknown) {
        if (isDupEntry(err)) { set.status = 409; return { error: "Category already exists" }; }
        throw err;
      }
    },
    {
      body: t.Object({
        name: t.String({ description: "Category name. Must be unique among active categories. Whitespace is trimmed." }),
        description: t.Optional(t.String({ description: "Optional description for the category." })),
        order: t.Optional(t.Number({ description: "Display sort order. Lower numbers appear first. Defaults to 0." })),
      }),
      detail: {
        tags: ["categories"],
        summary: "Create a category",
        description:
          "Creates a new category used to organise related sub-categories.\n\n" +
          "Category names must be unique among **active** categories. Archived categories with the same name " +
          "do not block creation.\n\n" +
          "The `order` field controls the display position in the UI (lower = higher up the list). " +
          "Use `PATCH /categories/:id/reorder` to change order after creation.",
        responses: {
          201: {
            description: "Category created",
            content: {
              "application/json": {
                schema: S.obj("Created category", {
                  id: S.num("New category ID"),
                  name: S.str("Trimmed name as stored"),
                  order: S.num("Display sort order"),
                }),
              },
            },
          },
          400: { ...ErrorResp, description: "Validation error - name is blank after trimming" },
          409: { ...ErrorResp, description: "Conflict - an active category with this name already exists" },
        },
      },
    }
  )
  .get(
    "/categories",
    async ({ query }) => {
      const includeArchived = query.archived === "true";
      const categoryWhere = includeArchived ? undefined : isNull(categories.archivedAt);
      const subcategoryArchivedWhere = includeArchived ? undefined : isNull(subcategories.archivedAt);

      const [rows, countRows] = await Promise.all([
        db
          .select({
            id: categories.id,
            name: categories.name,
            description: categories.description,
            order: categories.order,
            archivedAt: categories.archivedAt,
          })
          .from(categories)
          .where(categoryWhere)
          .orderBy(categories.order, categories.name),
        db
          .select({
            subcategoryId: bookmarkSubcategories.subcategoryId,
            count: sql<number>`COUNT(*)`,
          })
          .from(bookmarkSubcategories)
          .innerJoin(bookmarks, and(
            eq(bookmarkSubcategories.bookmarkId, bookmarks.id),
            isNull(bookmarks.archivedAt),
          ))
          .where(isNull(bookmarkSubcategories.archivedAt))
          .groupBy(bookmarkSubcategories.subcategoryId),
      ]);

      const categoryIds = rows.map((category) => category.id);
      const subcategoryRows = categoryIds.length === 0
        ? []
        : await db
          .select({
            id: subcategories.id,
            name: subcategories.name,
            description: subcategories.description,
            order: subcategories.order,
            categoryId: subcategories.categoryId,
            archivedAt: subcategories.archivedAt,
          })
          .from(subcategories)
          .where(
            subcategoryArchivedWhere
              ? and(inArray(subcategories.categoryId, categoryIds), subcategoryArchivedWhere)
              : inArray(subcategories.categoryId, categoryIds)
          )
          .orderBy(subcategories.order, subcategories.name);

      const countMap = new Map<number, number>(
        countRows.map((row) => [row.subcategoryId, Number(row.count)])
      );

      const subcategoriesByCategory = new Map<number | null, Array<typeof subcategoryRows[number]>>();
      for (const subcategory of subcategoryRows) {
        const bucket = subcategoriesByCategory.get(subcategory.categoryId);
        if (bucket) {
          bucket.push(subcategory);
          continue;
        }

        subcategoriesByCategory.set(subcategory.categoryId, [subcategory]);
      }

      const items = rows.map((category) => ({
        ...category,
        subcategories: (subcategoriesByCategory.get(category.id) ?? [])
          .map((subcategory) => ({ ...subcategory, bookmarkCount: countMap.get(subcategory.id) ?? 0 })),
      }));

      return { items };
    },
    {
      query: t.Object({
        archived: t.Optional(t.String({ description: "Pass `true` to include archived categories in the response. By default only active categories are returned." })),
      }),
      detail: {
        tags: ["categories"],
        summary: "List categories",
        description:
          "Returns categories with their nested sub-categories. " +
          "This is the **management view** and exposes the `archivedAt` field on both categories and " +
          "sub-categories so the UI can show archived state.\n\n" +
          "**Default:** active categories with active sub-categories only. Pass `archived=true` to include archived categories " +
          "and archived sub-categories in the response.\n\n" +
          "Each sub-category includes `bookmarkCount` reflecting only active (non-archived) bookmarks. " +
          "Categories are ordered by `order` then `name`; sub-categories within each category are ordered the same way.",
        responses: {
          200: {
            description: "Category list with nested sub-categories",
            content: {
              "application/json": {
                schema: S.obj("Categories management response", {
                  items: S.arr("List of categories", S.obj("Category with sub-categories", {
                    id: S.num("Category ID"),
                    name: S.str("Category name"),
                    order: S.num("Display sort order"),
                    archivedAt: S.nullable(S.any("Archive timestamp (UTC), null when active")),
                    subcategories: S.arr("Sub-categories in this category", S.obj("Sub-category", {
                      id: S.num("Sub-category ID"),
                      name: S.str("Sub-category name"),
                      description: S.nullable(S.str("Optional description for this sub-category")),
                      order: S.num("Display sort order"),
                      categoryId: S.nullable(S.num("Parent category ID")),
                      archivedAt: S.nullable(S.any("Archive timestamp (UTC), null when active")),
                      bookmarkCount: S.num("Number of active bookmarks using this sub-category"),
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
    "/categories/:id",
    async ({ params, body, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: categories.id })
        .from(categories).where(eq(categories.id, id));
      if (!row) { set.status = 404; return { error: "Category not found" }; }
      const name = body.name.trim();
      if (!name) { set.status = 400; return { error: "name is required" }; }
      const description = body.description !== undefined
        ? (body.description?.trim() || null)
        : undefined;
      const updateValues: Record<string, unknown> = { name };
      if (description !== undefined) updateValues.description = description;
      await db.update(categories).set(updateValues).where(eq(categories.id, id));
      return { ok: true, id, name, description: description ?? null };
    },
    {
      body: t.Object({
        name: t.String({ description: "New category name. Must be non-empty after trimming." }),
        description: t.Optional(t.Union([t.String(), t.Null()], { description: "Optional description. Pass null or empty string to clear." })),
      }),
      detail: {
        tags: ["categories"],
        summary: "Rename a category",
        description:
          "Updates the display name and optionally the description of a category. " +
          "The name is trimmed of leading/trailing whitespace before saving. " +
          "Works on both active and archived categories.",
        responses: {
          200: {
            description: "Category updated",
            content: {
              "application/json": {
                schema: S.obj("Updated category", {
                  ok: { type: "boolean" as const, enum: [true], description: "Always true" },
                  id: S.num("Category ID"),
                  name: S.str("New name as stored"),
                }),
              },
            },
          },
          400: { ...ErrorResp, description: "Validation error - name is blank after trimming" },
          404: { ...ErrorResp, description: "Category not found" },
        },
      },
    }
  )
  .patch(
    "/categories/:id/reorder",
    async ({ params, body, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: categories.id })
        .from(categories).where(eq(categories.id, id));
      if (!row) { set.status = 404; return { error: "Category not found" }; }
      await db.update(categories).set({ order: body.order }).where(eq(categories.id, id));
      return { ok: true };
    },
    {
      body: t.Object({
        order: t.Number({ description: "New display sort order value. Lower numbers appear first. Values do not need to be contiguous." }),
      }),
      detail: {
        tags: ["categories"],
        summary: "Set display order for a category",
        description:
          "Sets the `order` field on a category, controlling its position in the UI. " +
          "Categories with lower `order` values appear first; ties are broken alphabetically by name.\n\n" +
          "Order values are arbitrary integers - you can use sparse values (e.g. 10, 20, 30) " +
          "to leave room for future insertions without having to reorder everything.",
        responses: {
          200: { ...OkResp, description: "Order updated" },
          404: { ...ErrorResp, description: "Category not found" },
        },
      },
    }
  )
  .patch(
    "/categories/:id/archive",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: categories.id, archivedAt: categories.archivedAt })
        .from(categories).where(eq(categories.id, id));
      if (!row) { set.status = 404; return { error: "Category not found" }; }
      if (row.archivedAt) { set.status = 409; return { error: "Already archived" }; }

      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(bookmarkSubcategories)
        .innerJoin(bookmarks, and(
          eq(bookmarkSubcategories.bookmarkId, bookmarks.id),
          isNull(bookmarks.archivedAt),
        ))
        .innerJoin(subcategories, and(
          eq(bookmarkSubcategories.subcategoryId, subcategories.id),
          isNull(subcategories.archivedAt),
          eq(subcategories.categoryId, id),
        ))
        .where(isNull(bookmarkSubcategories.archivedAt));
      const total = Number(count);
      if (total > 0) {
        set.status = 409;
        return { error: `Cannot archive: ${total} active bookmark${total === 1 ? "" : "s"} linked to sub-categories in this category` };
      }

      await db.update(categories).set({ archivedAt: sql`NOW()` }).where(eq(categories.id, id));
      return { ok: true };
    },
    {
      detail: {
        tags: ["categories"],
        summary: "Archive a category",
        description:
          "Soft-deletes a category by setting its `archivedAt` timestamp.\n\n" +
          "**Safety check:** archiving is blocked if any active (non-archived) sub-categories inside " +
          "this category have active bookmarks assigned to them. " +
          "The error message reports the total active bookmark count across all affected sub-categories.\n\n" +
          "To proceed: archive or reassign the bookmarks linked to this category's sub-categories first. " +
          "The category and all its sub-categories can be restored at any time.",
        responses: {
          200: { ...OkResp, description: "Category archived" },
          404: { ...ErrorResp, description: "Category not found" },
          409: { ...ErrorResp, description: "Already archived, or active bookmarks are linked to sub-categories in this category" },
        },
      },
    }
  )
  .patch(
    "/categories/:id/restore",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: categories.id, archivedAt: categories.archivedAt })
        .from(categories).where(eq(categories.id, id));
      if (!row) { set.status = 404; return { error: "Category not found" }; }
      if (!row.archivedAt) { set.status = 409; return { error: "Not archived" }; }
      await db.update(categories).set({ archivedAt: null }).where(eq(categories.id, id));
      return { ok: true };
    },
    {
      detail: {
        tags: ["categories"],
        summary: "Restore an archived category",
        description:
          "Clears the `archivedAt` timestamp on a category, making it active again.\n\n" +
          "Restoring a category does **not** automatically restore its archived sub-categories - " +
          "each sub-category must be restored individually via `PATCH /subcategories/:id/restore` if needed.",
        responses: {
          200: { ...OkResp, description: "Category restored to active" },
          404: { ...ErrorResp, description: "Category not found" },
          409: { ...ErrorResp, description: "Category is not archived" },
        },
      },
    }
  );
