import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import mysql from "mysql2/promise";
import { eq } from "drizzle-orm";

const FAILING_TAG_ID = 900001;
const FAILING_CLASSIFICATION_ID = 900002;
const FAILING_SUB_SUBCATEGORY_ID = 900003;

type AppModule = typeof import("../server.ts");
type DbModule = typeof import("../db/client.ts");
type SchemaModule = typeof import("../db/schema.ts");

let adminConnection: mysql.Connection;
let app: AppModule["app"];
let db: DbModule["db"];
let pool: DbModule["pool"];
let schema: SchemaModule;

beforeAll(async () => {
  process.env.API_TOKEN ||= "test-api-token";

  // Always use the test database — NEVER the live 'bookmarks' database.
  // DB_NAME must be explicitly overridden to anything other than 'bookmarks_test'
  // before this guard will allow the tests to run against a different database.
  const dbName = process.env.DB_NAME ?? "bookmarks_test";
  if (dbName === "bookmarks") {
    throw new Error(
      "SAFETY: integration tests must not run against the live 'bookmarks' database. " +
      "Set DB_NAME=bookmarks_test or leave DB_NAME unset."
    );
  }

  // Point the app's db client at the test database before importing the server.
  process.env.DB_NAME = dbName;

  adminConnection = await mysql.createConnection({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: dbName,
    multipleStatements: true,
  });

  const journal = JSON.parse(await readFile(
    new URL("../db/migrations/meta/_journal.json", import.meta.url),
    "utf-8"
  )) as {
    entries: Array<{ tag: string }>;
  };

  await adminConnection.query("DROP TRIGGER IF EXISTS fail_bookmark_tags_insert");
  await adminConnection.query("DROP TRIGGER IF EXISTS fail_bookmark_subcategories_insert");
  await adminConnection.query("DROP TRIGGER IF EXISTS fail_bookmark_sub_subcategories_insert");
  await adminConnection.query("DROP TABLE IF EXISTS bookmark_sub_subcategories");
  await adminConnection.query("DROP TABLE IF EXISTS bookmark_subcategories");
  await adminConnection.query("DROP TABLE IF EXISTS bookmark_categories");
  await adminConnection.query("DROP TABLE IF EXISTS sub_subcategories");
  await adminConnection.query("DROP TABLE IF EXISTS bookmark_tags");
  await adminConnection.query("DROP TABLE IF EXISTS bookmarks");
  await adminConnection.query("DROP TABLE IF EXISTS subcategories");
  await adminConnection.query("DROP TABLE IF EXISTS categories");
  await adminConnection.query("DROP TABLE IF EXISTS tags");

  for (const entry of journal.entries) {
    const migration = await readFile(
      new URL(`../db/migrations/${entry.tag}.sql`, import.meta.url),
      "utf-8"
    );

    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await adminConnection.query(statement);
    }
  }

  await adminConnection.query(`
    CREATE TRIGGER fail_bookmark_tags_insert
    BEFORE INSERT ON bookmark_tags
    FOR EACH ROW
    BEGIN
      IF NEW.tag_id = ${FAILING_TAG_ID} THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced tag failure';
      END IF;
    END
  `);

  await adminConnection.query(`
    CREATE TRIGGER fail_bookmark_subcategories_insert
    BEFORE INSERT ON bookmark_subcategories
    FOR EACH ROW
    BEGIN
      IF NEW.subcategory_id = ${FAILING_CLASSIFICATION_ID} THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced subcategory failure';
      END IF;
    END
  `);

  await adminConnection.query(`
    CREATE TRIGGER fail_bookmark_sub_subcategories_insert
    BEFORE INSERT ON bookmark_sub_subcategories
    FOR EACH ROW
    BEGIN
      IF NEW.sub_subcategory_id = ${FAILING_SUB_SUBCATEGORY_ID} THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced sub-sub-category failure';
      END IF;
    END
  `);

  ({ app } = await import("../server.ts"));
  ({ db, pool } = await import("../db/client.ts"));
  schema = await import("../db/schema.ts");
});

afterAll(async () => {
  await pool?.end();
  await adminConnection?.end();
});

describe("create endpoint status codes", () => {
  it("returns 201 for tag creation", async () => {
    const name = uniqueName("tag-created");

    const res = await app.handle(jsonRequest("/tags", "POST", { name }));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ name });
  });

  it("returns 201 for sub-category creation", async () => {
    const name = uniqueName("subcategory-created");

    const res = await app.handle(jsonRequest("/subcategories", "POST", { name }));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ name, categoryId: null });
  });

  it("returns 201 for category creation", async () => {
    const name = uniqueName("category-created");

    const res = await app.handle(jsonRequest("/categories", "POST", { name }));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ name, description: null });
  });

  it("returns 201 for sub-sub-category creation", async () => {
    const [{ id: subcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: uniqueName("subsubcategory-parent"), categoryId: null })
      .$returningId();
    const name = uniqueName("subsubcategory-created");

    const res = await app.handle(jsonRequest("/subSubcategories", "POST", { name, subcategoryId }));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ name, subcategoryId });
  });
});

describe("sub-sub-category lifecycle", () => {
  it("rejects duplicate active sub-sub-category names within the same parent sub-category", async () => {
    const [{ id: subcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: uniqueName("subsubcategory-duplicate-parent"), categoryId: null })
      .$returningId();
    const name = uniqueName("subsubcategory-duplicate");

    const first = await app.handle(jsonRequest("/subSubcategories", "POST", { name, subcategoryId }));
    const second = await app.handle(jsonRequest("/subSubcategories", "POST", { name, subcategoryId }));

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
  });

  it("blocks archiving sub-sub-categories that still have active bookmarks", async () => {
    const [{ id: subcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: uniqueName("subsubcategory-archive-parent"), categoryId: null })
      .$returningId();
    const [{ id: subSubcategoryId }] = await db
      .insert(schema.subSubcategories)
      .values({ name: uniqueName("subsubcategory-archive-blocked"), subcategoryId })
      .$returningId();
    const [{ id: bookmarkId }] = await db
      .insert(schema.bookmarks)
      .values({ url: uniqueUrl("subsubcategory-archive-blocked"), title: "Sub-sub-category archive blocked" })
      .$returningId();

    await db.insert(schema.bookmarkSubSubcategories).values({ bookmarkId, subSubcategoryId });

    const res = await app.handle(request(`/subSubcategories/${subSubcategoryId}/archive`, "PATCH"));

    expect(res.status).toBe(409);
  });
});

describe("tag lifecycle", () => {
  it("rejects duplicate active tag names", async () => {
    const name = uniqueName("tag-duplicate");

    const first = await app.handle(jsonRequest("/tags", "POST", { name }));
    const second = await app.handle(jsonRequest("/tags", "POST", { name }));

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ error: "Tag already exists" });
  });

  it("supports case-insensitive exact tag lookup", async () => {
    const name = uniqueName("tag-exact-match");

    const createRes = await app.handle(jsonRequest("/tags", "POST", { name }));
    expect(createRes.status).toBe(201);

    const lookupRes = await app.handle(
      request(`/tags?query=${encodeURIComponent(name.toUpperCase())}&exact=true&limit=1`)
    );
    const lookupBody = await lookupRes.json() as { items: Array<{ name: string }> };

    expect(lookupRes.status).toBe(200);
    expect(lookupBody.items).toHaveLength(1);
    expect(lookupBody.items[0]).toMatchObject({ name });
  });

  it("renames tags through the API", async () => {
    const originalName = uniqueName("tag-rename-old");
    const renamedName = uniqueName("tag-rename-new");

    const createRes = await app.handle(jsonRequest("/tags", "POST", { name: originalName }));
    const created = await createRes.json() as { id: number };

    const renameRes = await app.handle(jsonRequest(`/tags/${created.id}`, "PATCH", { name: `  ${renamedName}  ` }));
    expect(renameRes.status).toBe(200);
    await expect(renameRes.json()).resolves.toMatchObject({ ok: true, id: created.id, name: renamedName });

    const lookupRes = await app.handle(
      request(`/tags?query=${encodeURIComponent(renamedName)}&exact=true&limit=1`)
    );
    const lookupBody = await lookupRes.json() as { items: Array<{ id: number; name: string }> };

    expect(lookupBody.items).toEqual([expect.objectContaining({ id: created.id, name: renamedName })]);
  });

  it("blocks archiving tags that still have active bookmarks", async () => {
    const [{ id: tagId }] = await db
      .insert(schema.tags)
      .values({ name: uniqueName("tag-guarded") })
      .$returningId();
    const [{ id: bookmarkId }] = await db
      .insert(schema.bookmarks)
      .values({ url: uniqueUrl("tag-guarded"), title: "Tag Guard" })
      .$returningId();

    await db.insert(schema.bookmarkTags).values({ bookmarkId, tagId });

    const archiveRes = await app.handle(request(`/tags/${tagId}/archive`, "PATCH"));
    expect(archiveRes.status).toBe(409);
    await expect(archiveRes.json()).resolves.toMatchObject({
      error: "Cannot archive: 1 active bookmark linked to this tag",
    });
  });

  it("archives and restores tags through the API", async () => {
    const name = uniqueName("tag-lifecycle");
    const createRes = await app.handle(jsonRequest("/tags", "POST", { name }));
    const created = await createRes.json() as { id: number };

    const archiveRes = await app.handle(request(`/tags/${created.id}/archive`, "PATCH"));
    expect(archiveRes.status).toBe(200);

    const hiddenRes = await app.handle(request(`/tags?query=${encodeURIComponent(name)}`));
    const hiddenBody = await hiddenRes.json() as { items: Array<{ name: string }> };
    expect(hiddenBody.items).toHaveLength(0);

    const archivedRes = await app.handle(request(`/tags?query=${encodeURIComponent(name)}&archived=true`));
    const archivedBody = await archivedRes.json() as { items: Array<{ name: string; archivedAt: string | null }> };
    expect(archivedRes.status).toBe(200);
    expect(archivedBody.items).toEqual([expect.objectContaining({ name, archivedAt: expect.any(String) })]);

    const duplicateArchiveRes = await app.handle(request(`/tags/${created.id}/archive`, "PATCH"));
    expect(duplicateArchiveRes.status).toBe(409);
    await expect(duplicateArchiveRes.json()).resolves.toMatchObject({ error: "Already archived" });

    const restoreRes = await app.handle(request(`/tags/${created.id}/restore`, "PATCH"));
    expect(restoreRes.status).toBe(200);

    const visibleRes = await app.handle(request(`/tags?query=${encodeURIComponent(name)}`));
    const visibleBody = await visibleRes.json() as { items: Array<{ name: string }> };
    expect(visibleBody.items).toEqual([expect.objectContaining({ name })]);

    const duplicateRestoreRes = await app.handle(request(`/tags/${created.id}/restore`, "PATCH"));
    expect(duplicateRestoreRes.status).toBe(409);
    await expect(duplicateRestoreRes.json()).resolves.toMatchObject({ error: "Not archived" });
  });
});

describe("sub-category lifecycle", () => {
  it("rejects duplicate active sub-category names within the same category", async () => {
    const [{ id: categoryId }] = await db
      .insert(schema.categories)
      .values({ name: uniqueName("subcategory-duplicate-category") })
      .$returningId();
    const name = uniqueName("subcategory-duplicate");

    const first = await app.handle(jsonRequest("/subcategories", "POST", { name, categoryId }));
    const second = await app.handle(jsonRequest("/subcategories", "POST", { name, categoryId }));

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ error: "Sub-category already exists in this category" });
  });

  it("blocks archiving subcategories that still have active bookmarks", async () => {
    const [{ id: subcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: uniqueName("subcategory-archive-blocked"), categoryId: null })
      .$returningId();
    const [{ id: bookmarkId }] = await db
      .insert(schema.bookmarks)
      .values({ url: uniqueUrl("subcategory-archive-blocked"), title: "Sub-category archive blocked" })
      .$returningId();

    await db.insert(schema.bookmarkSubcategories).values({ bookmarkId, subcategoryId });

    const res = await app.handle(request(`/subcategories/${subcategoryId}/archive`, "PATCH"));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "Cannot archive: 1 active bookmark linked to this sub-category",
    });
  });

  it("archives and restores subcategories through the API", async () => {
    const name = uniqueName("subcategory-lifecycle");
    const createRes = await app.handle(jsonRequest("/subcategories", "POST", { name }));
    const created = await createRes.json() as { id: number };

    const archiveRes = await app.handle(request(`/subcategories/${created.id}/archive`, "PATCH"));
    expect(archiveRes.status).toBe(200);

    const hiddenRes = await app.handle(request("/subcategories"));
    const hiddenBody = await hiddenRes.json() as {
      categories: Array<{ subcategories: Array<{ id: number }> }>;
    };
    expect(hiddenBody.categories.flatMap((category) => category.subcategories).some((item) => item.id === created.id)).toBe(false);

    const duplicateArchiveRes = await app.handle(request(`/subcategories/${created.id}/archive`, "PATCH"));
    expect(duplicateArchiveRes.status).toBe(409);
    await expect(duplicateArchiveRes.json()).resolves.toMatchObject({ error: "Already archived" });

    const restoreRes = await app.handle(request(`/subcategories/${created.id}/restore`, "PATCH"));
    expect(restoreRes.status).toBe(200);

    const visibleRes = await app.handle(request("/subcategories"));
    const visibleBody = await visibleRes.json() as {
      categories: Array<{ subcategories: Array<{ id: number }> }>;
    };
    expect(visibleBody.categories.flatMap((category) => category.subcategories).some((item) => item.id === created.id)).toBe(true);

    const duplicateRestoreRes = await app.handle(request(`/subcategories/${created.id}/restore`, "PATCH"));
    expect(duplicateRestoreRes.status).toBe(409);
    await expect(duplicateRestoreRes.json()).resolves.toMatchObject({ error: "Not archived" });
  });
});

describe("category lifecycle", () => {
  it("blocks archiving categories that still have active bookmarked subcategories", async () => {
    const [{ id: categoryId }] = await db
      .insert(schema.categories)
      .values({ name: uniqueName("category-archive-blocked") })
      .$returningId();
    const [{ id: subcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: uniqueName("category-archive-blocked-subcategory"), categoryId })
      .$returningId();
    const [{ id: bookmarkId }] = await db
      .insert(schema.bookmarks)
      .values({ url: uniqueUrl("category-archive-blocked"), title: "Category archive blocked" })
      .$returningId();

    await db.insert(schema.bookmarkSubcategories).values({ bookmarkId, subcategoryId });

    const res = await app.handle(request(`/categories/${categoryId}/archive`, "PATCH"));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "Cannot archive: 1 active bookmark linked to this category branch",
    });
  });

  it("blocks archiving categories that still have active direct category bookmarks", async () => {
    const [{ id: categoryId }] = await db
      .insert(schema.categories)
      .values({ name: uniqueName("category-direct-archive-blocked") })
      .$returningId();
    const [{ id: bookmarkId }] = await db
      .insert(schema.bookmarks)
      .values({ url: uniqueUrl("category-direct-archive-blocked"), title: "Category direct archive blocked" })
      .$returningId();

    await db.insert(schema.bookmarkCategories).values({ bookmarkId, categoryId });

    const res = await app.handle(request(`/categories/${categoryId}/archive`, "PATCH"));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "Cannot archive: 1 active bookmark linked to this category branch",
    });
  });

  it("archives and restores categories through the API", async () => {
    const name = uniqueName("category-lifecycle");
    const createRes = await app.handle(jsonRequest("/categories", "POST", { name }));
    const created = await createRes.json() as { id: number };

    const archiveRes = await app.handle(request(`/categories/${created.id}/archive`, "PATCH"));
    expect(archiveRes.status).toBe(200);

    const hiddenRes = await app.handle(request("/categories"));
    const hiddenBody = await hiddenRes.json() as { items: Array<{ id: number }> };
    expect(hiddenBody.items.some((item) => item.id === created.id)).toBe(false);

    const duplicateArchiveRes = await app.handle(request(`/categories/${created.id}/archive`, "PATCH"));
    expect(duplicateArchiveRes.status).toBe(409);
    await expect(duplicateArchiveRes.json()).resolves.toMatchObject({ error: "Already archived" });

    const restoreRes = await app.handle(request(`/categories/${created.id}/restore`, "PATCH"));
    expect(restoreRes.status).toBe(200);

    const visibleRes = await app.handle(request("/categories"));
    const visibleBody = await visibleRes.json() as { items: Array<{ id: number }> };
    expect(visibleBody.items.some((item) => item.id === created.id)).toBe(true);

    const duplicateRestoreRes = await app.handle(request(`/categories/${created.id}/restore`, "PATCH"));
    expect(duplicateRestoreRes.status).toBe(409);
    await expect(duplicateRestoreRes.json()).resolves.toMatchObject({ error: "Not archived" });
  });
});

describe("bookmark write transactions", () => {
  it("rejects bookmark-tag links that reference missing tags", async () => {
    const [{ id: bookmarkId }] = await db
      .insert(schema.bookmarks)
      .values({ url: uniqueUrl("fk-tag"), title: "FK tag" })
      .$returningId();

    await expect((async () => {
      await db.insert(schema.bookmarkTags).values({ bookmarkId, tagId: 999999 });
    })()).rejects.toMatchObject({ cause: { code: "ER_NO_REFERENCED_ROW_2" } });

    const links = await db
      .select()
      .from(schema.bookmarkTags)
      .where(eq(schema.bookmarkTags.bookmarkId, bookmarkId));

    expect(links).toHaveLength(0);
  });

  it("rejects bookmark/sub-category links that reference missing subcategories", async () => {
    const [{ id: bookmarkId }] = await db
      .insert(schema.bookmarks)
      .values({ url: uniqueUrl("fk-subcategory"), title: "FK sub-category" })
      .$returningId();

    await expect((async () => {
      await db.insert(schema.bookmarkSubcategories).values({ bookmarkId, subcategoryId: 999999 });
    })()).rejects.toMatchObject({ cause: { code: "ER_NO_REFERENCED_ROW_2" } });

    const links = await db
      .select()
      .from(schema.bookmarkSubcategories)
      .where(eq(schema.bookmarkSubcategories.bookmarkId, bookmarkId));

    expect(links).toHaveLength(0);
  });

  it("creates bookmark, tags, and subcategories atomically on success", async () => {
    const [{ id: tagId }] = await db.insert(schema.tags).values({ name: uniqueName("tag") }).$returningId();
    const [{ id: subcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: uniqueName("subcategory"), categoryId: null })
      .$returningId();

    const res = await app.handle(jsonRequest("/bookmarks", "POST", {
      url: uniqueUrl("create-success"),
      title: "Atomic create",
      tags: [tagId],
      subcategoryIds: [subcategoryId],
    }));

    expect(res.status).toBe(201);

    const created = await res.json();
    const [bookmarkTag] = await db
      .select()
      .from(schema.bookmarkTags)
      .where(eq(schema.bookmarkTags.bookmarkId, created.id));
    const [bookmarkSubcategory] = await db
      .select()
      .from(schema.bookmarkSubcategories)
      .where(eq(schema.bookmarkSubcategories.bookmarkId, created.id));

    expect(bookmarkTag?.tagId).toBe(tagId);
    expect(bookmarkSubcategory?.subcategoryId).toBe(subcategoryId);
  });

  it("accepts null faviconUrl for bookmark creation and stores null", async () => {
    const res = await app.handle(jsonRequest("/bookmarks", "POST", {
      url: uniqueUrl("create-null-favicon"),
      title: "Null favicon create",
      faviconUrl: null,
    }));

    expect(res.status).toBe(201);
    const created = await res.json() as { id: number };

    const [bookmark] = await db
      .select({ faviconUrl: schema.bookmarks.faviconUrl })
      .from(schema.bookmarks)
      .where(eq(schema.bookmarks.id, created.id));

    expect(bookmark?.faviconUrl).toBeNull();
  });

  it("trims faviconUrl before storing bookmark", async () => {
    const res = await app.handle(jsonRequest("/bookmarks", "POST", {
      url: uniqueUrl("create-trimmed-favicon"),
      title: "Trim favicon create",
      faviconUrl: "   https://example.com/favicon.ico   ",
    }));

    expect(res.status).toBe(201);
    const created = await res.json() as { id: number };

    const [bookmark] = await db
      .select({ faviconUrl: schema.bookmarks.faviconUrl })
      .from(schema.bookmarks)
      .where(eq(schema.bookmarks.id, created.id));

    expect(bookmark?.faviconUrl).toBe("https://example.com/favicon.ico");
  });

  it("rejects bookmark creation when a parent and child classification overlap", async () => {
    const [{ id: subcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: uniqueName("subcategory-overlap-create"), categoryId: null })
      .$returningId();
    const [{ id: subSubcategoryId }] = await db
      .insert(schema.subSubcategories)
      .values({ name: uniqueName("subsubcategory-overlap-create"), subcategoryId })
      .$returningId();

    const res = await app.handle(jsonRequest("/bookmarks", "POST", {
      url: uniqueUrl("overlap-create"),
      title: "Overlap create",
      subcategoryIds: [subcategoryId],
      subSubcategoryIds: [subSubcategoryId],
    }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "Cannot assign a bookmark to both a sub-category and one of its nested sub-sub-categories in the same branch",
    });
  });

  it("rolls back bookmark creation when tag association insert fails", async () => {
    const url = uniqueUrl("create-rollback");

    const res = await app.handle(jsonRequest("/bookmarks", "POST", {
      url,
      title: "Rollback create",
      tags: [FAILING_TAG_ID],
    }));

    expect(res.status).toBeGreaterThanOrEqual(500);

    const createdBookmarks = await db
      .select({ id: schema.bookmarks.id })
      .from(schema.bookmarks)
      .where(eq(schema.bookmarks.url, url));

    expect(createdBookmarks).toHaveLength(0);
  });

  it("rolls back bookmark updates when sub-category replacement fails", async () => {
    const [{ id: originalTagId }] = await db.insert(schema.tags).values({ name: uniqueName("tag-old") }).$returningId();
    const [{ id: replacementTagId }] = await db.insert(schema.tags).values({ name: uniqueName("tag-new") }).$returningId();
    const [{ id: originalSubcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: uniqueName("subcategory-old"), categoryId: null })
      .$returningId();
    const [{ id: bookmarkId }] = await db
      .insert(schema.bookmarks)
      .values({ url: uniqueUrl("patch-rollback"), title: "Before rollback" })
      .$returningId();

    await db.insert(schema.bookmarkTags).values({ bookmarkId, tagId: originalTagId });
    await db.insert(schema.bookmarkSubcategories).values({
      bookmarkId,
      subcategoryId: originalSubcategoryId,
    });

    const res = await app.handle(jsonRequest(`/bookmarks/${bookmarkId}`, "PATCH", {
      title: "After rollback",
      tagIds: [replacementTagId],
      subcategoryIds: [FAILING_CLASSIFICATION_ID],
    }));

    expect(res.status).toBeGreaterThanOrEqual(500);

    const [bookmark] = await db
      .select({ title: schema.bookmarks.title })
      .from(schema.bookmarks)
      .where(eq(schema.bookmarks.id, bookmarkId));
    const bookmarkTags = await db
      .select()
      .from(schema.bookmarkTags)
      .where(eq(schema.bookmarkTags.bookmarkId, bookmarkId));
    const bookmarkSubcategories = await db
      .select()
      .from(schema.bookmarkSubcategories)
      .where(eq(schema.bookmarkSubcategories.bookmarkId, bookmarkId));

    expect(bookmark?.title).toBe("Before rollback");
    expect(bookmarkTags.map((row) => row.tagId)).toEqual([originalTagId]);
    expect(bookmarkSubcategories.map((row) => row.subcategoryId)).toEqual([originalSubcategoryId]);
  });

  it("archives removed associations and restores them when re-added", async () => {
    const [{ id: originalTagId }] = await db.insert(schema.tags).values({ name: uniqueName("tag-archive-old") }).$returningId();
    const [{ id: replacementTagId }] = await db.insert(schema.tags).values({ name: uniqueName("tag-archive-new") }).$returningId();
    const [{ id: originalSubcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: uniqueName("subcategory-archive-old"), categoryId: null })
      .$returningId();
    const [{ id: replacementSubcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: uniqueName("subcategory-archive-new"), categoryId: null })
      .$returningId();
    const [{ id: bookmarkId }] = await db
      .insert(schema.bookmarks)
      .values({ url: uniqueUrl("archive-links"), title: "Archive links" })
      .$returningId();

    await db.insert(schema.bookmarkTags).values({ bookmarkId, tagId: originalTagId });
    await db.insert(schema.bookmarkSubcategories).values({
      bookmarkId,
      subcategoryId: originalSubcategoryId,
    });

    const replaceRes = await app.handle(jsonRequest(`/bookmarks/${bookmarkId}`, "PATCH", {
      tagIds: [replacementTagId],
      subcategoryIds: [replacementSubcategoryId],
    }));

    expect(replaceRes.status).toBe(200);

    const tagLinksAfterReplace = await db
      .select({ tagId: schema.bookmarkTags.tagId, archivedAt: schema.bookmarkTags.archivedAt })
      .from(schema.bookmarkTags)
      .where(eq(schema.bookmarkTags.bookmarkId, bookmarkId));
    const subcategoryLinksAfterReplace = await db
      .select({
        subcategoryId: schema.bookmarkSubcategories.subcategoryId,
        archivedAt: schema.bookmarkSubcategories.archivedAt,
      })
      .from(schema.bookmarkSubcategories)
      .where(eq(schema.bookmarkSubcategories.bookmarkId, bookmarkId));

    expect(tagLinksAfterReplace).toHaveLength(2);
    expect(tagLinksAfterReplace.find((row) => row.tagId === originalTagId)?.archivedAt).not.toBeNull();
    expect(tagLinksAfterReplace.find((row) => row.tagId === replacementTagId)?.archivedAt).toBeNull();
    expect(subcategoryLinksAfterReplace).toHaveLength(2);
    expect(subcategoryLinksAfterReplace.find((row) => row.subcategoryId === originalSubcategoryId)?.archivedAt).not.toBeNull();
    expect(subcategoryLinksAfterReplace.find((row) => row.subcategoryId === replacementSubcategoryId)?.archivedAt).toBeNull();

    const restoreRes = await app.handle(jsonRequest(`/bookmarks/${bookmarkId}`, "PATCH", {
      tagIds: [originalTagId, replacementTagId],
      subcategoryIds: [originalSubcategoryId, replacementSubcategoryId],
    }));

    expect(restoreRes.status).toBe(200);

    const tagLinksAfterRestore = await db
      .select({ archivedAt: schema.bookmarkTags.archivedAt })
      .from(schema.bookmarkTags)
      .where(eq(schema.bookmarkTags.bookmarkId, bookmarkId));
    const subcategoryLinksAfterRestore = await db
      .select({ archivedAt: schema.bookmarkSubcategories.archivedAt })
      .from(schema.bookmarkSubcategories)
      .where(eq(schema.bookmarkSubcategories.bookmarkId, bookmarkId));

    expect(tagLinksAfterRestore).toHaveLength(2);
    expect(tagLinksAfterRestore.every((row) => row.archivedAt === null)).toBe(true);
    expect(subcategoryLinksAfterRestore).toHaveLength(2);
    expect(subcategoryLinksAfterRestore.every((row) => row.archivedAt === null)).toBe(true);
  });

  it("does not keep removed subcategories in bookmark filters or payloads", async () => {
    const [{ id: originalSubcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: uniqueName("subcategory-filter-old"), categoryId: null })
      .$returningId();
    const [{ id: remainingSubcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: uniqueName("subcategory-filter-remaining"), categoryId: null })
      .$returningId();

    const createRes = await app.handle(jsonRequest("/bookmarks", "POST", {
      url: uniqueUrl("subcategory-filter-removal"),
      title: "Sub-category filter removal",
      subcategoryIds: [originalSubcategoryId, remainingSubcategoryId],
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { id: number };

    const patchRes = await app.handle(jsonRequest(`/bookmarks/${created.id}`, "PATCH", {
      subcategoryIds: [remainingSubcategoryId],
    }));
    expect(patchRes.status).toBe(200);

    const listRes = await app.handle(request(`/bookmarks?subcategoryId=${originalSubcategoryId}`));
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as {
      items: Array<{ id: number; subcategories: Array<{ id: number }> }>;
    };

    expect(listBody.items.some((bookmark) => bookmark.id === created.id)).toBe(false);

    const remainingRes = await app.handle(request(`/bookmarks?subcategoryId=${remainingSubcategoryId}`));
    expect(remainingRes.status).toBe(200);
    const remainingBody = await remainingRes.json() as {
      items: Array<{ id: number; subcategories: Array<{ id: number }> }>;
    };

    expect(remainingBody.items).toEqual([
      expect.objectContaining({
        id: created.id,
        subcategories: [expect.objectContaining({ id: remainingSubcategoryId })],
      }),
    ]);
  });

  it("rejects bookmark updates when a parent and child classification overlap", async () => {
    const [{ id: subcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: uniqueName("subcategory-overlap-patch"), categoryId: null })
      .$returningId();
    const [{ id: subSubcategoryId }] = await db
      .insert(schema.subSubcategories)
      .values({ name: uniqueName("subsubcategory-overlap-patch"), subcategoryId })
      .$returningId();

    const createRes = await app.handle(jsonRequest("/bookmarks", "POST", {
      url: uniqueUrl("overlap-patch"),
      title: "Overlap patch",
      subcategoryIds: [subcategoryId],
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { id: number };

    const patchRes = await app.handle(jsonRequest(`/bookmarks/${created.id}`, "PATCH", {
      subSubcategoryIds: [subSubcategoryId],
    }));

    expect(patchRes.status).toBe(409);
    await expect(patchRes.json()).resolves.toMatchObject({
      error: "Cannot assign a bookmark to both a sub-category and one of its nested sub-sub-categories in the same branch",
    });
  });

  it("allows saving a bookmark with only a direct category link", async () => {
    const [{ id: categoryId }] = await db
      .insert(schema.categories)
      .values({ name: uniqueName("bookmark-direct-category") })
      .$returningId();

    const createRes = await app.handle(jsonRequest("/bookmarks", "POST", {
      url: uniqueUrl("direct-category-only"),
      title: "Direct category only",
      categoryIds: [categoryId],
    }));

    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { id: number };

    const listRes = await app.handle(request("/bookmarks"));
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as {
      items: Array<{ id: number; categories: Array<{ id: number; name: string }>; subcategories: Array<unknown>; subSubcategories: Array<unknown> }>;
    };

    expect(listBody.items).toContainEqual(expect.objectContaining({
      id: created.id,
      categories: [expect.objectContaining({ id: categoryId })],
      subcategories: [],
      subSubcategories: [],
    }));
  });

  it("rejects bookmark creation when a direct category and deeper link use the same category branch", async () => {
    const [{ id: categoryId }] = await db
      .insert(schema.categories)
      .values({ name: uniqueName("bookmark-category-conflict") })
      .$returningId();
    const [{ id: subcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: uniqueName("bookmark-category-conflict-sub"), categoryId })
      .$returningId();

    const res = await app.handle(jsonRequest("/bookmarks", "POST", {
      url: uniqueUrl("category-branch-conflict"),
      title: "Category branch conflict",
      categoryIds: [categoryId],
      subcategoryIds: [subcategoryId],
    }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "Cannot assign a bookmark to both a category and a deeper taxonomy link in the same category branch",
    });
  });

  it("rejects bookmark updates when a direct category and deeper link use the same category branch", async () => {
    const [{ id: categoryId }] = await db
      .insert(schema.categories)
      .values({ name: uniqueName("bookmark-category-patch-conflict") })
      .$returningId();
    const [{ id: subcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: uniqueName("bookmark-category-patch-conflict-sub"), categoryId })
      .$returningId();

    const createRes = await app.handle(jsonRequest("/bookmarks", "POST", {
      url: uniqueUrl("category-patch-conflict"),
      title: "Category patch conflict",
      categoryIds: [categoryId],
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { id: number };

    const patchRes = await app.handle(jsonRequest(`/bookmarks/${created.id}`, "PATCH", {
      categoryIds: [categoryId],
      subcategoryIds: [subcategoryId],
    }));

    expect(patchRes.status).toBe(409);
    await expect(patchRes.json()).resolves.toMatchObject({
      error: "Cannot assign a bookmark to both a category and a deeper taxonomy link in the same category branch",
    });
  });

  it("refreshes updatedAt when only associations change", async () => {
    const [{ id: originalTagId }] = await db.insert(schema.tags).values({ name: uniqueName("tag-updated-at-old") }).$returningId();
    const [{ id: replacementTagId }] = await db.insert(schema.tags).values({ name: uniqueName("tag-updated-at-new") }).$returningId();
    const [{ id: bookmarkId }] = await db
      .insert(schema.bookmarks)
      .values({ url: uniqueUrl("updated-at-association"), title: "UpdatedAt association" })
      .$returningId();

    await db.insert(schema.bookmarkTags).values({ bookmarkId, tagId: originalTagId });

    const [before] = await db
      .select({ updatedAt: schema.bookmarks.updatedAt })
      .from(schema.bookmarks)
      .where(eq(schema.bookmarks.id, bookmarkId));

    await Bun.sleep(1100);

    const res = await app.handle(jsonRequest(`/bookmarks/${bookmarkId}`, "PATCH", {
      tagIds: [replacementTagId],
    }));

    expect(res.status).toBe(200);

    const [after] = await db
      .select({ updatedAt: schema.bookmarks.updatedAt })
      .from(schema.bookmarks)
      .where(eq(schema.bookmarks.id, bookmarkId));

    expect(after?.updatedAt).not.toBeNull();
    expect(before?.updatedAt).not.toBeNull();
    expect(new Date(after!.updatedAt as Date).getTime()).toBeGreaterThan(new Date(before!.updatedAt as Date).getTime());
  });

  it("preserves duplicate detection after transactional create", async () => {
    const url = uniqueUrl("duplicate");

    const first = await app.handle(jsonRequest("/bookmarks", "POST", {
      url,
      title: "Original bookmark",
    }));

    expect(first.status).toBe(201);

    const second = await app.handle(jsonRequest("/bookmarks", "POST", {
      url,
      title: "Duplicate bookmark",
    }));

    expect(second.status).toBe(409);

    const rows = await db
      .select({ id: schema.bookmarks.id })
      .from(schema.bookmarks)
      .where(eq(schema.bookmarks.url, url));

    expect(rows).toHaveLength(1);
  });

  it("allows an active bookmark when the matching URL is only archived", async () => {
    const url = uniqueUrl("archived-duplicate");

    const archived = await app.handle(jsonRequest("/bookmarks", "POST", {
      url,
      title: "Archived duplicate",
      flags: { archived: true },
    }));

    expect(archived.status).toBe(201);

    const active = await app.handle(jsonRequest("/bookmarks", "POST", {
      url,
      title: "Active bookmark",
    }));

    expect(active.status).toBe(201);

    const rows = await db
      .select({
        id: schema.bookmarks.id,
        archivedAt: schema.bookmarks.archivedAt,
      })
      .from(schema.bookmarks)
      .where(eq(schema.bookmarks.url, url));

    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.archivedAt === null)).toHaveLength(1);
    expect(rows.filter((row) => row.archivedAt !== null)).toHaveLength(1);
  });

  it("returns one 201 and one 409 for concurrent duplicate creates", async () => {
    const url = uniqueUrl("concurrent-duplicate");

    const [first, second] = await Promise.all([
      app.handle(jsonRequest("/bookmarks", "POST", {
        url,
        title: "Concurrent bookmark A",
      })),
      app.handle(jsonRequest("/bookmarks", "POST", {
        url,
        title: "Concurrent bookmark B",
      })),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);

    const duplicateRes = first.status === 409 ? first : second;
    await expect(duplicateRes.json()).resolves.toMatchObject({
      error: "Duplicate URL",
      duplicates: [expect.objectContaining({ url })],
    });

    const rows = await db
      .select({ id: schema.bookmarks.id })
      .from(schema.bookmarks)
      .where(eq(schema.bookmarks.url, url));

    expect(rows).toHaveLength(1);
  });
});

describe("category listing", () => {
  it("returns only active subcategories for active categories by default", async () => {
    const archivedAt = new Date();
    const [{ id: activeCategoryId }] = await db
      .insert(schema.categories)
      .values({ name: uniqueName("category-active-default") })
      .$returningId();
    const [{ id: otherCategoryId }] = await db
      .insert(schema.categories)
      .values({ name: uniqueName("category-other-default") })
      .$returningId();
    const [{ id: archivedCategoryId }] = await db
      .insert(schema.categories)
      .values({ name: uniqueName("category-archived-default"), archivedAt })
      .$returningId();

    const activeSubcategoryName = uniqueName("subcategory-active-default");
    const archivedSubcategoryName = uniqueName("subcategory-archived-default");
    const otherSubcategoryName = uniqueName("subcategory-other-default");
    const archivedCategorySubcategoryName = uniqueName("subcategory-archived-category-default");

    await db.insert(schema.subcategories).values([
      { name: activeSubcategoryName, categoryId: activeCategoryId },
      { name: archivedSubcategoryName, categoryId: activeCategoryId, archivedAt },
      { name: otherSubcategoryName, categoryId: otherCategoryId },
      { name: archivedCategorySubcategoryName, categoryId: archivedCategoryId },
    ]);

    const res = await app.handle(request("/categories"));

    expect(res.status).toBe(200);
    const body = await res.json() as {
      items: Array<{
        id: number;
        subcategories: Array<{ name: string }>;
      }>;
    };

    const activeCategory = body.items.find((category) => category.id === activeCategoryId);
    const otherCategory = body.items.find((category) => category.id === otherCategoryId);

    expect(body.items.some((category) => category.id === archivedCategoryId)).toBe(false);
    expect(activeCategory?.subcategories.map((subcategory) => subcategory.name)).toEqual([activeSubcategoryName]);
    expect(otherCategory?.subcategories.map((subcategory) => subcategory.name)).toEqual([otherSubcategoryName]);
  });

  it("orders categories, subcategories, and sub-sub-categories alphabetically", async () => {
    const categoryNames = [
      uniqueName("category-zulu-alpha"),
      uniqueName("category-alpha-alpha"),
    ];
    const [{ id: zuluCategoryId }] = await db.insert(schema.categories).values({ name: categoryNames[0] }).$returningId();
    const [{ id: alphaCategoryId }] = await db.insert(schema.categories).values({ name: categoryNames[1] }).$returningId();

    const subcategoryNames = [
      uniqueName("subcategory-zulu-alpha"),
      uniqueName("subcategory-alpha-alpha"),
    ];
    const [{ id: parentSubcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: subcategoryNames[0], categoryId: alphaCategoryId })
      .$returningId();
    await db.insert(schema.subcategories).values({ name: subcategoryNames[1], categoryId: alphaCategoryId });

    const leafNames = [
      uniqueName("subsubcategory-zulu-alpha"),
      uniqueName("subsubcategory-alpha-alpha"),
    ];
    await db.insert(schema.subSubcategories).values([
      { name: leafNames[0], subcategoryId: parentSubcategoryId },
      { name: leafNames[1], subcategoryId: parentSubcategoryId },
    ]);

    const categoriesRes = await app.handle(request("/categories"));
    expect(categoriesRes.status).toBe(200);
    const categoriesBody = await categoriesRes.json() as {
      items: Array<{
        id: number;
        name: string;
        subcategories: Array<{
          name: string;
          subSubcategories: Array<{ name: string }>;
        }>;
      }>;
    };

    expect(categoriesBody.items
      .filter((category) => categoryNames.includes(category.name))
      .map((category) => category.name)).toEqual([
      categoryNames[1],
      categoryNames[0],
    ]);

    const alphaCategory = categoriesBody.items.find((category) => category.id === alphaCategoryId);
    expect(alphaCategory?.subcategories.map((subcategory) => subcategory.name)).toEqual([
      subcategoryNames[1],
      subcategoryNames[0],
    ]);
    expect(alphaCategory?.subcategories.find((subcategory) => subcategory.name === subcategoryNames[0])?.subSubcategories.map((leaf) => leaf.name)).toEqual([
      leafNames[1],
      leafNames[0],
    ]);

    const sidebarRes = await app.handle(request("/subcategories"));
    expect(sidebarRes.status).toBe(200);
    const sidebarBody = await sidebarRes.json() as {
      categories: Array<{
        id: number;
        name: string;
        subcategories: Array<{
          name: string;
          subSubcategories: Array<{ name: string }>;
        }>;
      }>;
    };

    expect(sidebarBody.categories
      .filter((category) => categoryNames.includes(category.name))
      .map((category) => category.name)).toEqual([
      categoryNames[1],
      categoryNames[0],
    ]);
    expect(sidebarBody.categories.find((category) => category.id === alphaCategoryId)?.subcategories.map((subcategory) => subcategory.name)).toEqual([
      subcategoryNames[1],
      subcategoryNames[0],
    ]);

    const leavesRes = await app.handle(request("/subSubcategories"));
    expect(leavesRes.status).toBe(200);
    const leavesBody = await leavesRes.json() as {
      subcategories: Array<{
        id: number;
        subSubcategories: Array<{ name: string }>;
      }>;
    };

    expect(leavesBody.subcategories.find((subcategory) => subcategory.id === parentSubcategoryId)?.subSubcategories.map((leaf) => leaf.name)).toEqual([
      leafNames[1],
      leafNames[0],
    ]);
    expect(categoriesBody.items.some((category) => category.id === zuluCategoryId)).toBe(true);
  });

  it("counts distinct bookmarks across a sub-category branch", async () => {
    const [{ id: categoryId }] = await db
      .insert(schema.categories)
      .values({ name: uniqueName("category-branch-count") })
      .$returningId();
    const [{ id: subcategoryId }] = await db
      .insert(schema.subcategories)
      .values({ name: uniqueName("subcategory-branch-count"), categoryId })
      .$returningId();
    const [{ id: firstLeafId }] = await db
      .insert(schema.subSubcategories)
      .values({ name: uniqueName("subsubcategory-branch-count-a"), subcategoryId })
      .$returningId();
    const [{ id: secondLeafId }] = await db
      .insert(schema.subSubcategories)
      .values({ name: uniqueName("subsubcategory-branch-count-b"), subcategoryId })
      .$returningId();

    const bookmarkRes = await app.handle(jsonRequest("/bookmarks", "POST", {
      url: uniqueUrl("branch-count"),
      title: "Distinct branch count",
      subSubcategoryIds: [firstLeafId, secondLeafId],
    }));
    expect(bookmarkRes.status).toBe(201);

    const res = await app.handle(request("/subcategories"));
    expect(res.status).toBe(200);
    const body = await res.json() as {
      categories: Array<{
        id: number;
        subcategories: Array<{
          id: number;
          bookmarkCount: number;
          subSubcategories: Array<{ id: number; bookmarkCount: number }>;
        }>;
      }>;
    };

    const listedCategory = body.categories.find((item) => item.id === categoryId);
    const listedSubcategory = listedCategory?.subcategories.find((item) => item.id === subcategoryId);

    expect(listedSubcategory?.bookmarkCount).toBe(1);
    expect(listedSubcategory?.subSubcategories).toEqual([
      expect.objectContaining({ id: firstLeafId, bookmarkCount: 1 }),
      expect.objectContaining({ id: secondLeafId, bookmarkCount: 1 }),
    ]);
  });

  it("includes archived categories and subcategories when archived=true", async () => {
    const archivedAt = new Date();
    const [{ id: activeCategoryId }] = await db
      .insert(schema.categories)
      .values({ name: uniqueName("category-active-archived-view") })
      .$returningId();
    const [{ id: archivedCategoryId }] = await db
      .insert(schema.categories)
      .values({ name: uniqueName("category-archived-archived-view"), archivedAt })
      .$returningId();

    const activeSubcategoryName = uniqueName("subcategory-active-archived-view");
    const archivedSubcategoryName = uniqueName("subcategory-archived-archived-view");
    const archivedCategorySubcategoryName = uniqueName("subcategory-archived-category-archived-view");

    await db.insert(schema.subcategories).values([
      { name: activeSubcategoryName, categoryId: activeCategoryId },
      { name: archivedSubcategoryName, categoryId: activeCategoryId, archivedAt },
      { name: archivedCategorySubcategoryName, categoryId: archivedCategoryId, archivedAt },
    ]);

    const res = await app.handle(request("/categories?archived=true"));

    expect(res.status).toBe(200);
    const body = await res.json() as {
      items: Array<{
        id: number;
        subcategories: Array<{ name: string }>;
      }>;
    };

    const activeCategory = body.items.find((category) => category.id === activeCategoryId);
    const archivedCategory = body.items.find((category) => category.id === archivedCategoryId);

    expect(activeCategory?.subcategories.map((subcategory) => subcategory.name)).toEqual([
      activeSubcategoryName,
      archivedSubcategoryName,
    ]);
    expect(archivedCategory?.subcategories.map((subcategory) => subcategory.name)).toEqual([
      archivedCategorySubcategoryName,
    ]);
  });
});

describe("backup auth", () => {
  it("returns 503 when backup token is not configured", async () => {
    await withBackupToken("", async () => {
      const res = await app.handle(request("/backup"));

      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toMatchObject({
        error: "Backup is not configured. Set BACKUP_TOKEN to a strong random value in api/.env and restart the service.",
      });
    });
  });

  it("returns 503 when backup token is still the placeholder value", async () => {
    await withBackupToken("change_me_please", async () => {
      const res = await app.handle(request("/backup"));

      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toMatchObject({
        error: "Backup is not configured. Set BACKUP_TOKEN to a strong random value in api/.env and restart the service.",
      });
    });
  });

  it("returns 401 when the backup token is missing or invalid", async () => {
    await withBackupToken("test-backup-token", async () => {
      const missingRes = await app.handle(request("/backup"));
      expect(missingRes.status).toBe(401);
      await expect(missingRes.json()).resolves.toMatchObject({
        error: "Invalid or missing backup token. Send header: Authorization: Bearer <BACKUP_TOKEN>",
      });

      const invalidRes = await app.handle(new Request("http://localhost/backup", {
        headers: { authorization: "Bearer wrong-token" },
      }));
      expect(invalidRes.status).toBe(401);
      await expect(invalidRes.json()).resolves.toMatchObject({
        error: "Invalid or missing backup token. Send header: Authorization: Bearer <BACKUP_TOKEN>",
      });
    });
  });
});

describe("bookmark request validation", () => {
  it.each([
    ["/bookmarks?limit=0", "limit must be an integer between 1 and 100"],
    ["/bookmarks?limit=101", "limit must be an integer between 1 and 100"],
    ["/bookmarks?limit=abc", "limit must be an integer between 1 and 100"],
    ["/bookmarks?offset=-1", "offset must be a non-negative integer"],
    ["/bookmarks?offset=abc", "offset must be a non-negative integer"],
    ["/bookmarks?subcategoryId=0", "subcategoryId must be a positive integer"],
    ["/bookmarks?subcategoryId=abc", "subcategoryId must be a positive integer"],
    ["/bookmarks?tagId=0", "tagId must be a positive integer"],
    ["/bookmarks?tagId=abc", "tagId must be a positive integer"],
    ["/bookmarks?flag=unknown", "flag must be one of: readLater, hotTopic, cheatsheets, forReview"],
    ["/bookmarks?sortBy=random", "sortBy must be one of: newest, oldest"],
    ["/bookmarks?archived=maybe", "archived must be true or false"],
  ])("returns 400 for invalid bookmark query %s", async (path, message) => {
    const res = await app.handle(request(path));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: message });
  });

  it.each([
    ["/bookmarks/abc", jsonRequest("/bookmarks/abc", "PATCH", { title: "Invalid id" })],
    ["/bookmarks/0", jsonRequest("/bookmarks/0", "PATCH", { title: "Invalid id" })],
    ["/bookmarks/-1", jsonRequest("/bookmarks/-1", "PATCH", { title: "Invalid id" })],
    ["/bookmarks/abc/archive", request("/bookmarks/abc/archive", "PATCH")],
    ["/bookmarks/0/archive", request("/bookmarks/0/archive", "PATCH")],
    ["/bookmarks/-1/archive", request("/bookmarks/-1/archive", "PATCH")],
    ["/bookmarks/abc/restore", request("/bookmarks/abc/restore", "PATCH")],
    ["/bookmarks/0/restore", request("/bookmarks/0/restore", "PATCH")],
    ["/bookmarks/-1/restore", request("/bookmarks/-1/restore", "PATCH")],
  ])("returns 400 for invalid bookmark id path %s", async (_path, req) => {
    const res = await app.handle(req);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "id must be a positive integer" });
  });

  it("keeps valid but missing bookmark ids as 404", async () => {
    const res = await app.handle(jsonRequest("/bookmarks/999999", "PATCH", { title: "Missing bookmark" }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "Bookmark not found" });
  });
});

function jsonRequest(path: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.API_TOKEN ?? "test-api-token"}`,
    },
    body: JSON.stringify(body),
  });
}

function request(path: string, method = "GET"): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.API_TOKEN ?? "test-api-token"}`,
    },
  });
}

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueUrl(prefix: string): string {
  return `https://example.com/${uniqueName(prefix)}`;
}

async function withBackupToken(token: string | undefined, run: () => Promise<void>): Promise<void> {
  const previousToken = process.env.BACKUP_TOKEN;

  if (token === undefined) {
    delete process.env.BACKUP_TOKEN;
  } else {
    process.env.BACKUP_TOKEN = token;
  }

  try {
    await run();
  } finally {
    if (previousToken === undefined) {
      delete process.env.BACKUP_TOKEN;
    } else {
      process.env.BACKUP_TOKEN = previousToken;
    }
  }
}
