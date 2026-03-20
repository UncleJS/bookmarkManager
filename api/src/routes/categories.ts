import { Elysia, t } from "elysia";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  bookmarkCategories,
  bookmarkSubcategories,
  bookmarkSubSubcategories,
  bookmarks,
  categories,
  subcategories,
  subSubcategories,
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
          .values({ name, description })
          .$returningId();
        set.status = 201;
        return { id: result.id, name, description };
      } catch (err: unknown) {
        if (isDupEntry(err)) { set.status = 409; return { error: "Category already exists" }; }
        throw err;
      }
    },
    {
      body: t.Object({
        name: t.String({ description: "Category name. Must be unique among active categories. Whitespace is trimmed." }),
        description: t.Optional(t.String({ description: "Optional description for the category." })),
      }),
      detail: {
        tags: ["categories"],
        summary: "Create a category",
        description:
          "Creates a new category used to organise related sub-categories.\n\n" +
          "Category names must be unique among **active** categories. Archived categories with the same name " +
          "do not block creation.",
        responses: {
          201: {
            description: "Category created",
            content: {
              "application/json": {
                schema: S.obj("Created category", {
                  id: S.num("New category ID"),
                  name: S.str("Trimmed name as stored"),
                  description: S.nullable(S.str("Description as stored, or null")),
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

      const [rows, countRows, childCountRows] = await Promise.all([
        db
          .select({
            id: categories.id,
            name: categories.name,
            description: categories.description,
            archivedAt: categories.archivedAt,
          })
          .from(categories)
          .where(categoryWhere)
          .orderBy(categories.name),
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

      const categoryIds = rows.map((category) => category.id);
      const [subcategoryRows, subSubcategoryRows] = await Promise.all([
        categoryIds.length === 0
          ? Promise.resolve([])
          : db
            .select({
              id: subcategories.id,
              name: subcategories.name,
              description: subcategories.description,
              categoryId: subcategories.categoryId,
              archivedAt: subcategories.archivedAt,
            })
            .from(subcategories)
            .where(
              subcategoryArchivedWhere
                ? and(inArray(subcategories.categoryId, categoryIds), subcategoryArchivedWhere)
                : inArray(subcategories.categoryId, categoryIds)
            )
            .orderBy(subcategories.name),
        categoryIds.length === 0
          ? Promise.resolve([])
          : db
            .select({
              id: subSubcategories.id,
              name: subSubcategories.name,
              description: subSubcategories.description,
              subcategoryId: subSubcategories.subcategoryId,
              archivedAt: subSubcategories.archivedAt,
            })
            .from(subSubcategories)
            .innerJoin(subcategories, eq(subSubcategories.subcategoryId, subcategories.id))
            .where(
              includeArchived
                ? inArray(subcategories.categoryId, categoryIds)
                : and(inArray(subcategories.categoryId, categoryIds), isNull(subSubcategories.archivedAt), isNull(subcategories.archivedAt))
            )
            .orderBy(subSubcategories.name),
      ]);

      const directCountMap = new Map<number, number>(
        countRows.map((row) => [row.subcategoryId, Number(row.count)])
      );
      const childCountMap = new Map<number, number>(
        childCountRows.map((row) => [row.subSubcategoryId, Number(row.count)])
      );

      const subSubcategoriesBySubcategory = new Map<number, Array<typeof subSubcategoryRows[number]>>();
      const nestedCountBySubcategory = new Map<number, number>();
      for (const item of subSubcategoryRows) {
        const bucket = subSubcategoriesBySubcategory.get(item.subcategoryId);
        const enriched = { ...item, bookmarkCount: childCountMap.get(item.id) ?? 0 };
        if (bucket) bucket.push(enriched);
        else subSubcategoriesBySubcategory.set(item.subcategoryId, [enriched]);
        nestedCountBySubcategory.set(item.subcategoryId, (nestedCountBySubcategory.get(item.subcategoryId) ?? 0) + enriched.bookmarkCount);
      }

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
          .map((subcategory) => ({
            ...subcategory,
            bookmarkCount: (directCountMap.get(subcategory.id) ?? 0) + (nestedCountBySubcategory.get(subcategory.id) ?? 0),
            directBookmarkCount: directCountMap.get(subcategory.id) ?? 0,
            subSubcategories: subSubcategoriesBySubcategory.get(subcategory.id) ?? [],
          })),
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
          "Returns categories with their nested sub-categories and sub-sub-categories. " +
          "This is the **management view** and exposes the `archivedAt` field on both categories and " +
          "sub-categories so the UI can show archived state.\n\n" +
          "**Default:** active categories with active sub-categories only. Pass `archived=true` to include archived categories " +
          "and archived sub-categories in the response.\n\n" +
          "Each sub-category includes `bookmarkCount` reflecting only active (non-archived) bookmarks. " +
          "Categories, sub-categories, and sub-sub-categories are ordered alphabetically by name.",
        responses: {
          200: {
            description: "Category list with nested sub-categories",
            content: {
              "application/json": {
                schema: S.obj("Categories management response", {
                  items: S.arr("List of categories", S.obj("Category with sub-categories", {
                    id: S.num("Category ID"),
                    name: S.str("Category name"),
                    archivedAt: S.nullable(S.any("Archive timestamp (UTC), null when active")),
                    subcategories: S.arr("Sub-categories in this category", S.obj("Sub-category", {
                      id: S.num("Sub-category ID"),
                      name: S.str("Sub-category name"),
                      description: S.nullable(S.str("Optional description for this sub-category")),
                      categoryId: S.nullable(S.num("Parent category ID")),
                      archivedAt: S.nullable(S.any("Archive timestamp (UTC), null when active")),
                      bookmarkCount: S.num("Total active bookmarks using this sub-category directly or any nested sub-sub-category"),
                      directBookmarkCount: S.num("Number of active bookmarks linked directly to this sub-category"),
                      subSubcategories: S.arr("Sub-sub-categories in this sub-category", S.obj("Sub-sub-category", {
                        id: S.num("Sub-sub-category ID"),
                        name: S.str("Sub-sub-category name"),
                        description: S.nullable(S.str("Optional description for this sub-sub-category")),
                        subcategoryId: S.num("Parent sub-category ID"),
                        archivedAt: S.nullable(S.any("Archive timestamp (UTC), null when active")),
                        bookmarkCount: S.num("Number of active bookmarks using this sub-sub-category"),
                      })),
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
    "/categories/:id/archive",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: categories.id, archivedAt: categories.archivedAt })
        .from(categories).where(eq(categories.id, id));
      if (!row) { set.status = 404; return { error: "Category not found" }; }
      if (row.archivedAt) { set.status = 409; return { error: "Already archived" }; }

      const [[{ count: categoryCount }], [{ count: directCount }], [{ count: childCount }]] = await Promise.all([
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(bookmarkCategories)
          .innerJoin(bookmarks, and(
            eq(bookmarkCategories.bookmarkId, bookmarks.id),
            isNull(bookmarks.archivedAt),
          ))
          .where(and(
            eq(bookmarkCategories.categoryId, id),
            isNull(bookmarkCategories.archivedAt),
          )),
        db
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
          .where(isNull(bookmarkSubcategories.archivedAt)),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(bookmarkSubSubcategories)
          .innerJoin(bookmarks, and(
            eq(bookmarkSubSubcategories.bookmarkId, bookmarks.id),
            isNull(bookmarks.archivedAt),
          ))
          .innerJoin(subSubcategories, and(
            eq(bookmarkSubSubcategories.subSubcategoryId, subSubcategories.id),
            isNull(subSubcategories.archivedAt),
          ))
          .innerJoin(subcategories, and(
            eq(subSubcategories.subcategoryId, subcategories.id),
            isNull(subcategories.archivedAt),
            eq(subcategories.categoryId, id),
          ))
          .where(isNull(bookmarkSubSubcategories.archivedAt)),
      ]);
      const total = Number(categoryCount) + Number(directCount) + Number(childCount);
      if (total > 0) {
        set.status = 409;
        return { error: `Cannot archive: ${total} active bookmark${total === 1 ? "" : "s"} linked to this category branch` };
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
          "**Safety check:** archiving is blocked if any active bookmarks are linked directly to this category, " +
          "to sub-categories inside it, or to nested sub-sub-categories in the same branch. " +
          "The error message reports the total active bookmark count across the whole category branch.\n\n" +
          "To proceed: archive or reassign the bookmarks linked to this category branch first. " +
          "The category and all its sub-categories can be restored at any time.",
        responses: {
          200: { ...OkResp, description: "Category archived" },
          404: { ...ErrorResp, description: "Category not found" },
          409: { ...ErrorResp, description: "Already archived, or active bookmarks are linked somewhere in this category branch" },
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
