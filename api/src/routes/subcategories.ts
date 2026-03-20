import { Elysia, t } from "elysia";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  bookmarkSubcategories,
  bookmarkSubSubcategories,
  bookmarks,
  categories,
  subcategories,
  subSubcategories,
} from "../db/schema.ts";
import { ErrorResp, OkResp, S, isDupEntry } from "./shared.ts";

export const subcategoryRoutes = new Elysia()
  .get(
    "/subcategories",
    async () => {
      const [categoryRows, subcategoryRows, subSubcategoryRows, directLinkRows, childLinkRows] = await Promise.all([
        db
          .select({
            id: categories.id,
            name: categories.name,
          })
          .from(categories)
          .where(isNull(categories.archivedAt))
          .orderBy(categories.name),
        db
          .select({
            id: subcategories.id,
            name: subcategories.name,
            description: subcategories.description,
            categoryId: subcategories.categoryId,
          })
          .from(subcategories)
          .where(isNull(subcategories.archivedAt))
          .orderBy(subcategories.name),
        db
          .select({
            id: subSubcategories.id,
            name: subSubcategories.name,
            description: subSubcategories.description,
            subcategoryId: subSubcategories.subcategoryId,
          })
          .from(subSubcategories)
          .where(isNull(subSubcategories.archivedAt))
          .orderBy(subSubcategories.name),
        db
          .select({
            subcategoryId: bookmarkSubcategories.subcategoryId,
            bookmarkId: bookmarkSubcategories.bookmarkId,
          })
          .from(bookmarkSubcategories)
          .innerJoin(bookmarks, and(
            eq(bookmarkSubcategories.bookmarkId, bookmarks.id),
            isNull(bookmarks.archivedAt),
          ))
          .where(isNull(bookmarkSubcategories.archivedAt))
          .orderBy(bookmarkSubcategories.subcategoryId, bookmarkSubcategories.bookmarkId),
        db
          .select({
            subSubcategoryId: bookmarkSubSubcategories.subSubcategoryId,
            subcategoryId: subSubcategories.subcategoryId,
            bookmarkId: bookmarkSubSubcategories.bookmarkId,
          })
          .from(bookmarkSubSubcategories)
          .innerJoin(subSubcategories, eq(bookmarkSubSubcategories.subSubcategoryId, subSubcategories.id))
          .innerJoin(bookmarks, and(
            eq(bookmarkSubSubcategories.bookmarkId, bookmarks.id),
            isNull(bookmarks.archivedAt),
          ))
          .where(and(
            isNull(bookmarkSubSubcategories.archivedAt),
            isNull(subSubcategories.archivedAt),
          ))
          .orderBy(bookmarkSubSubcategories.subSubcategoryId, bookmarkSubSubcategories.bookmarkId),
      ]);

      const directBookmarkIdsBySubcategory = new Map<number, Set<number>>();
      const branchBookmarkIdsBySubcategory = new Map<number, Set<number>>();
      const childBookmarkIdsBySubSubcategory = new Map<number, Set<number>>();

      for (const row of directLinkRows) {
        const directBucket = directBookmarkIdsBySubcategory.get(row.subcategoryId) ?? new Set<number>();
        directBucket.add(row.bookmarkId);
        directBookmarkIdsBySubcategory.set(row.subcategoryId, directBucket);

        const branchBucket = branchBookmarkIdsBySubcategory.get(row.subcategoryId) ?? new Set<number>();
        branchBucket.add(row.bookmarkId);
        branchBookmarkIdsBySubcategory.set(row.subcategoryId, branchBucket);
      }

      for (const row of childLinkRows) {
        const childBucket = childBookmarkIdsBySubSubcategory.get(row.subSubcategoryId) ?? new Set<number>();
        childBucket.add(row.bookmarkId);
        childBookmarkIdsBySubSubcategory.set(row.subSubcategoryId, childBucket);

        const branchBucket = branchBookmarkIdsBySubcategory.get(row.subcategoryId) ?? new Set<number>();
        branchBucket.add(row.bookmarkId);
        branchBookmarkIdsBySubcategory.set(row.subcategoryId, branchBucket);
      }

      const subSubcategoriesBySubcategory = new Map<number, Array<typeof subSubcategoryRows[number]>>();
      for (const item of subSubcategoryRows) {
        const bucket = subSubcategoriesBySubcategory.get(item.subcategoryId);
        const enriched = { ...item, bookmarkCount: childBookmarkIdsBySubSubcategory.get(item.id)?.size ?? 0 };
        if (bucket) bucket.push(enriched);
        else subSubcategoriesBySubcategory.set(item.subcategoryId, [enriched]);
      }

      const grouped = categoryRows.map((category) => ({
        ...category,
        subcategories: subcategoryRows
          .filter((subcategory) => subcategory.categoryId === category.id)
          .map((subcategory) => ({
            ...subcategory,
            bookmarkCount: branchBookmarkIdsBySubcategory.get(subcategory.id)?.size ?? 0,
            directBookmarkCount: directBookmarkIdsBySubcategory.get(subcategory.id)?.size ?? 0,
            subSubcategories: subSubcategoriesBySubcategory.get(subcategory.id) ?? [],
          })),
      }));

      const uncategorized = subcategoryRows
        .filter((subcategory) => subcategory.categoryId === null)
        .map((subcategory) => ({
          ...subcategory,
          bookmarkCount: branchBookmarkIdsBySubcategory.get(subcategory.id)?.size ?? 0,
          directBookmarkCount: directBookmarkIdsBySubcategory.get(subcategory.id)?.size ?? 0,
          subSubcategories: subSubcategoriesBySubcategory.get(subcategory.id) ?? [],
        }));

      if (uncategorized.length > 0) {
        grouped.push({
          id: 0,
          name: "Uncategorized",
          subcategories: uncategorized,
        });
      }

      return { categories: grouped };
    },
    {
      detail: {
        tags: ["subcategories"],
        summary: "List all active sub-categories, grouped by category",
        description:
          "Returns all active (non-archived) sub-categories nested inside their parent categories, with optional nested sub-sub-categories.\n\n" +
          "Categories, sub-categories, and nested sub-sub-categories are sorted alphabetically by name.\n\n" +
          "Sub-categories that have no category appear under a synthetic **Uncategorized** entry " +
          "(`id: 0`) appended at the end of the list.\n\n" +
          "Each sub-category includes a `bookmarkCount` reflecting the distinct active (non-archived) bookmarks anywhere in that branch. " +
          "This endpoint is intended for filtering/navigation UI - use `GET /categories` " +
          "for the management view that also includes archived records.",
        responses: {
          200: {
            description: "Grouped sub-category list",
            content: {
              "application/json": {
                schema: S.obj("Sub-category categories response", {
                  categories: S.arr("List of active categories (plus synthetic Uncategorized entry if needed)", S.obj("Category", {
                    id: S.num("Category ID (0 = synthetic Uncategorized entry)"),
                    name: S.str("Category name"),
                    subcategories: S.arr("Sub-categories in this category", S.obj("Sub-category", {
                      id: S.num("Sub-category ID"),
                      name: S.str("Sub-category name"),
                      description: S.nullable(S.str("Optional description for this sub-category")),
                      categoryId: S.nullable(S.num("Parent category ID, or null if uncategorized")),
                      bookmarkCount: S.num("Distinct active bookmarks using this sub-category directly or any nested sub-sub-category in the same branch"),
                      directBookmarkCount: S.num("Number of active bookmarks linked directly to this sub-category"),
                      subSubcategories: S.arr("Nested sub-sub-categories under this sub-category", S.obj("Sub-sub-category", {
                        id: S.num("Sub-sub-category ID"),
                        name: S.str("Sub-sub-category name"),
                        description: S.nullable(S.str("Optional description for this sub-sub-category")),
                        subcategoryId: S.num("Parent sub-category ID"),
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
  .post(
    "/subcategories",
    async ({ body, set }) => {
      const name = body.name.trim();
      if (!name) {
        set.status = 400;
        return { error: "name is required" };
      }

      const description = body.description?.trim() || null;
      let categoryId: number | null = body.categoryId ?? null;

      if (body.categoryName && !categoryId) {
        const categoryName = body.categoryName.trim();
        if (categoryName) {
          const [category] = await db
            .insert(categories)
            .values({ name: categoryName })
            .$returningId();
          categoryId = category.id;
        }
      }

      try {
        const [result] = await db
          .insert(subcategories)
          .values({ name, description, categoryId })
          .$returningId();
        set.status = 201;
        return { id: result.id, name, description, categoryId };
      } catch (err: unknown) {
        if (isDupEntry(err)) {
          set.status = 409;
          return { error: "Sub-category already exists in this category" };
        }
        throw err;
      }
    },
    {
      body: t.Object({
        name: t.String({ description: "Sub-category name. Must be unique within the target category. Whitespace is trimmed." }),
        description: t.Optional(t.Nullable(t.String({ description: "Optional description for the sub-category. Whitespace is trimmed; empty string is stored as null." }))),
        categoryId: t.Optional(t.Nullable(t.Number({ description: "ID of an existing category to assign this sub-category to. Omit or pass null to leave uncategorized." }))),
        categoryName: t.Optional(t.Nullable(t.String({ description: "If provided (and `categoryId` is absent), a new category with this name is created and the sub-category is placed inside it." }))),
      }),
      detail: {
        tags: ["subcategories"],
        summary: "Create a sub-category",
        description:
          "Creates a new active sub-category.\n\n" +
          "**Category assignment (pick one):**\n" +
          "- `categoryId` - assign to an existing category by ID\n" +
          "- `categoryName` - create a brand-new category and place the sub-category inside it (only used when `categoryId` is absent)\n" +
          "- Neither - the sub-category is created uncategorized\n\n" +
          "Sub-category names must be unique **within their category** among active records. " +
          "A sub-category named `TypeScript` can exist in both `Languages` and `Frameworks` simultaneously. " +
          "Archived sub-categories with the same name/category do not block creation.",
        responses: {
          201: {
            description: "Sub-category created",
            content: {
              "application/json": {
                schema: S.obj("Created sub-category", {
                  id: S.num("New sub-category ID"),
                  name: S.str("Trimmed name as stored"),
                  description: S.nullable(S.str("Description as stored, or null")),
                  categoryId: S.nullable(S.num("Assigned category ID, or null if uncategorized")),
                }),
              },
            },
          },
          400: { ...ErrorResp, description: "Validation error - name is blank after trimming" },
          409: { ...ErrorResp, description: "Conflict - an active sub-category with this name already exists in the same category" },
        },
      },
    }
  )
  .patch(
    "/subcategories/:id/archive",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: subcategories.id, archivedAt: subcategories.archivedAt })
        .from(subcategories).where(eq(subcategories.id, id));
      if (!row) { set.status = 404; return { error: "Sub-category not found" }; }
      if (row.archivedAt) { set.status = 409; return { error: "Already archived" }; }

      const [[{ count: directCount }], [{ count: childCount }]] = await Promise.all([
        db
        .select({ count: sql<number>`COUNT(*)` })
        .from(bookmarkSubcategories)
        .innerJoin(bookmarks, and(
          eq(bookmarkSubcategories.bookmarkId, bookmarks.id),
          isNull(bookmarks.archivedAt),
        ))
        .where(and(
          eq(bookmarkSubcategories.subcategoryId, id),
          isNull(bookmarkSubcategories.archivedAt),
        )),
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
            eq(subSubcategories.subcategoryId, id),
          ))
          .where(isNull(bookmarkSubSubcategories.archivedAt)),
      ]);
      const total = Number(directCount) + Number(childCount);
      if (total > 0) {
        set.status = 409;
        return { error: `Cannot archive: ${total} active bookmark${total === 1 ? "" : "s"} linked to this sub-category` };
      }

      await db.update(subcategories).set({ archivedAt: sql`NOW()` }).where(eq(subcategories.id, id));
      return { ok: true };
    },
    {
      detail: {
        tags: ["subcategories"],
        summary: "Archive a sub-category",
        description:
          "Soft-deletes a sub-category by setting its `archivedAt` timestamp.\n\n" +
          "**Safety check:** archiving is blocked if any **active** (non-archived) bookmarks are currently " +
          "assigned to this sub-category. The error message reports the exact count. " +
          "Reassign or archive those bookmarks first, then retry.\n\n" +
          "Archived sub-categories no longer appear in `GET /subcategories` " +
          "but remain visible in `GET /categories` for management purposes.",
        responses: {
          200: { ...OkResp, description: "Sub-category archived" },
          404: { ...ErrorResp, description: "Sub-category not found" },
          409: { ...ErrorResp, description: "Already archived, or active bookmarks are linked to this sub-category" },
        },
      },
    }
  )
  .patch(
    "/subcategories/:id/restore",
    async ({ params, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: subcategories.id, archivedAt: subcategories.archivedAt })
        .from(subcategories).where(eq(subcategories.id, id));
      if (!row) { set.status = 404; return { error: "Sub-category not found" }; }
      if (!row.archivedAt) { set.status = 409; return { error: "Not archived" }; }
      await db.update(subcategories).set({ archivedAt: null }).where(eq(subcategories.id, id));
      return { ok: true };
    },
    {
      detail: {
        tags: ["subcategories"],
        summary: "Restore an archived sub-category",
        description:
          "Clears the `archivedAt` timestamp on a sub-category, making it active again. " +
          "The sub-category reappears in `GET /subcategories` and can be assigned to new bookmarks.\n\n" +
          "Note: if the parent category is also archived, the sub-category will be restored but its category " +
          "will still be hidden from the active view until the category is also restored.",
        responses: {
          200: { ...OkResp, description: "Sub-category restored to active" },
          404: { ...ErrorResp, description: "Sub-category not found" },
          409: { ...ErrorResp, description: "Sub-category is not archived" },
        },
      },
    }
  )
  .patch(
    "/subcategories/:id",
    async ({ params, body, set }) => {
      const id = Number(params.id);
      const [row] = await db.select({ id: subcategories.id })
        .from(subcategories).where(eq(subcategories.id, id));
      if (!row) { set.status = 404; return { error: "Sub-category not found" }; }
      const name = body.name.trim();
      if (!name) { set.status = 400; return { error: "name is required" }; }
      const description = body.description !== undefined
        ? (body.description?.trim() || null)
        : undefined;
      const updatePayload: Record<string, unknown> = { name };
      if (description !== undefined) updatePayload.description = description;
      try {
        await db.update(subcategories).set(updatePayload).where(eq(subcategories.id, id));
        return { ok: true, id, name, ...(description !== undefined ? { description } : {}) };
      } catch (err: unknown) {
        if (isDupEntry(err)) { set.status = 409; return { error: "Sub-category name already exists in this category" }; }
        throw err;
      }
    },
    {
      body: t.Object({
        name: t.String({ description: "New sub-category name. Must be non-empty after trimming. Must be unique within the same category among active sub-categories." }),
        description: t.Optional(t.Nullable(t.String({ description: "New description. Pass null or empty string to clear. Omit to leave unchanged." }))),
      }),
      detail: {
        tags: ["subcategories"],
        summary: "Rename a sub-category",
        description:
          "Updates the display name and optionally the description of a sub-category. " +
          "The name is trimmed of whitespace before saving.\n\n" +
          "Uniqueness is enforced within the sub-category's parent category - the same name can exist in different categories. " +
          "Archived sub-categories with the same name in the same category do not cause a conflict.\n\n" +
          "To update only the description without renaming, send the current name unchanged alongside the new description.",
        responses: {
          200: {
            description: "Sub-category updated",
            content: {
              "application/json": {
                schema: S.obj("Updated sub-category", {
                  ok: { type: "boolean" as const, enum: [true], description: "Always true" },
                  id: S.num("Sub-category ID"),
                  name: S.str("New name as stored"),
                }),
              },
            },
          },
          400: { ...ErrorResp, description: "Validation error - name is blank after trimming" },
          404: { ...ErrorResp, description: "Sub-category not found" },
          409: { ...ErrorResp, description: "Conflict - an active sub-category with this name already exists in the same category" },
        },
      },
    }
  );
