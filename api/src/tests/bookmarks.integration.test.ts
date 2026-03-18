import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import mysql from "mysql2/promise";
import { eq } from "drizzle-orm";

const FAILING_TAG_ID = 900001;
const FAILING_CLASSIFICATION_ID = 900002;

type AppModule = typeof import("../server.ts");
type DbModule = typeof import("../db/client.ts");
type SchemaModule = typeof import("../db/schema.ts");

let adminConnection: mysql.Connection;
let app: AppModule["app"];
let db: DbModule["db"];
let pool: DbModule["pool"];
let schema: SchemaModule;

beforeAll(async () => {
  adminConnection = await mysql.createConnection({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "bookmarks",
    multipleStatements: true,
  });

  const journal = JSON.parse(await readFile(
    new URL("../db/migrations/meta/_journal.json", import.meta.url),
    "utf-8"
  )) as {
    entries: Array<{ tag: string }>;
  };

  await adminConnection.query("DROP TRIGGER IF EXISTS fail_bookmark_tags_insert");
  await adminConnection.query("DROP TRIGGER IF EXISTS fail_bookmark_classifications_insert");
  await adminConnection.query("DROP TABLE IF EXISTS bookmark_classifications");
  await adminConnection.query("DROP TABLE IF EXISTS bookmark_tags");
  await adminConnection.query("DROP TABLE IF EXISTS bookmarks");
  await adminConnection.query("DROP TABLE IF EXISTS classifications");
  await adminConnection.query("DROP TABLE IF EXISTS classification_groups");
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
    CREATE TRIGGER fail_bookmark_classifications_insert
    BEFORE INSERT ON bookmark_classifications
    FOR EACH ROW
    BEGIN
      IF NEW.classification_id = ${FAILING_CLASSIFICATION_ID} THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced classification failure';
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

  it("returns 201 for classification creation", async () => {
    const name = uniqueName("classification-created");

    const res = await app.handle(jsonRequest("/classifications", "POST", { name }));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ name, groupId: null });
  });

  it("returns 201 for classification group creation", async () => {
    const name = uniqueName("group-created");

    const res = await app.handle(jsonRequest("/classifications/groups", "POST", { name, order: 7 }));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ name, order: 7 });
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

  it("rejects bookmark-classification links that reference missing classifications", async () => {
    const [{ id: bookmarkId }] = await db
      .insert(schema.bookmarks)
      .values({ url: uniqueUrl("fk-classification"), title: "FK classification" })
      .$returningId();

    await expect((async () => {
      await db.insert(schema.bookmarkClassifications).values({ bookmarkId, classificationId: 999999 });
    })()).rejects.toMatchObject({ cause: { code: "ER_NO_REFERENCED_ROW_2" } });

    const links = await db
      .select()
      .from(schema.bookmarkClassifications)
      .where(eq(schema.bookmarkClassifications.bookmarkId, bookmarkId));

    expect(links).toHaveLength(0);
  });

  it("creates bookmark, tags, and classifications atomically on success", async () => {
    const [{ id: tagId }] = await db.insert(schema.tags).values({ name: uniqueName("tag") }).$returningId();
    const [{ id: classificationId }] = await db
      .insert(schema.classifications)
      .values({ name: uniqueName("classification"), groupId: null })
      .$returningId();

    const res = await app.handle(jsonRequest("/bookmarks", "POST", {
      url: uniqueUrl("create-success"),
      title: "Atomic create",
      tags: [tagId],
      classificationIds: [classificationId],
    }));

    expect(res.status).toBe(201);

    const created = await res.json();
    const [bookmarkTag] = await db
      .select()
      .from(schema.bookmarkTags)
      .where(eq(schema.bookmarkTags.bookmarkId, created.id));
    const [bookmarkClassification] = await db
      .select()
      .from(schema.bookmarkClassifications)
      .where(eq(schema.bookmarkClassifications.bookmarkId, created.id));

    expect(bookmarkTag?.tagId).toBe(tagId);
    expect(bookmarkClassification?.classificationId).toBe(classificationId);
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

  it("rolls back bookmark updates when classification replacement fails", async () => {
    const [{ id: originalTagId }] = await db.insert(schema.tags).values({ name: uniqueName("tag-old") }).$returningId();
    const [{ id: replacementTagId }] = await db.insert(schema.tags).values({ name: uniqueName("tag-new") }).$returningId();
    const [{ id: originalClassificationId }] = await db
      .insert(schema.classifications)
      .values({ name: uniqueName("classification-old"), groupId: null })
      .$returningId();
    const [{ id: bookmarkId }] = await db
      .insert(schema.bookmarks)
      .values({ url: uniqueUrl("patch-rollback"), title: "Before rollback" })
      .$returningId();

    await db.insert(schema.bookmarkTags).values({ bookmarkId, tagId: originalTagId });
    await db.insert(schema.bookmarkClassifications).values({
      bookmarkId,
      classificationId: originalClassificationId,
    });

    const res = await app.handle(jsonRequest(`/bookmarks/${bookmarkId}`, "PATCH", {
      title: "After rollback",
      tagIds: [replacementTagId],
      classificationIds: [FAILING_CLASSIFICATION_ID],
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
    const bookmarkClassifications = await db
      .select()
      .from(schema.bookmarkClassifications)
      .where(eq(schema.bookmarkClassifications.bookmarkId, bookmarkId));

    expect(bookmark?.title).toBe("Before rollback");
    expect(bookmarkTags.map((row) => row.tagId)).toEqual([originalTagId]);
    expect(bookmarkClassifications.map((row) => row.classificationId)).toEqual([originalClassificationId]);
  });

  it("archives removed associations and restores them when re-added", async () => {
    const [{ id: originalTagId }] = await db.insert(schema.tags).values({ name: uniqueName("tag-archive-old") }).$returningId();
    const [{ id: replacementTagId }] = await db.insert(schema.tags).values({ name: uniqueName("tag-archive-new") }).$returningId();
    const [{ id: originalClassificationId }] = await db
      .insert(schema.classifications)
      .values({ name: uniqueName("classification-archive-old"), groupId: null })
      .$returningId();
    const [{ id: replacementClassificationId }] = await db
      .insert(schema.classifications)
      .values({ name: uniqueName("classification-archive-new"), groupId: null })
      .$returningId();
    const [{ id: bookmarkId }] = await db
      .insert(schema.bookmarks)
      .values({ url: uniqueUrl("archive-links"), title: "Archive links" })
      .$returningId();

    await db.insert(schema.bookmarkTags).values({ bookmarkId, tagId: originalTagId });
    await db.insert(schema.bookmarkClassifications).values({
      bookmarkId,
      classificationId: originalClassificationId,
    });

    const replaceRes = await app.handle(jsonRequest(`/bookmarks/${bookmarkId}`, "PATCH", {
      tagIds: [replacementTagId],
      classificationIds: [replacementClassificationId],
    }));

    expect(replaceRes.status).toBe(200);

    const tagLinksAfterReplace = await db
      .select()
      .from(schema.bookmarkTags)
      .where(eq(schema.bookmarkTags.bookmarkId, bookmarkId));
    const classificationLinksAfterReplace = await db
      .select()
      .from(schema.bookmarkClassifications)
      .where(eq(schema.bookmarkClassifications.bookmarkId, bookmarkId));

    expect(tagLinksAfterReplace).toHaveLength(2);
    expect(tagLinksAfterReplace.find((row) => row.tagId === originalTagId)?.archivedAt).not.toBeNull();
    expect(tagLinksAfterReplace.find((row) => row.tagId === replacementTagId)?.archivedAt).toBeNull();
    expect(classificationLinksAfterReplace).toHaveLength(2);
    expect(classificationLinksAfterReplace.find((row) => row.classificationId === originalClassificationId)?.archivedAt).not.toBeNull();
    expect(classificationLinksAfterReplace.find((row) => row.classificationId === replacementClassificationId)?.archivedAt).toBeNull();

    const restoreRes = await app.handle(jsonRequest(`/bookmarks/${bookmarkId}`, "PATCH", {
      tagIds: [originalTagId, replacementTagId],
      classificationIds: [originalClassificationId, replacementClassificationId],
    }));

    expect(restoreRes.status).toBe(200);

    const tagLinksAfterRestore = await db
      .select()
      .from(schema.bookmarkTags)
      .where(eq(schema.bookmarkTags.bookmarkId, bookmarkId));
    const classificationLinksAfterRestore = await db
      .select()
      .from(schema.bookmarkClassifications)
      .where(eq(schema.bookmarkClassifications.bookmarkId, bookmarkId));

    expect(tagLinksAfterRestore).toHaveLength(2);
    expect(tagLinksAfterRestore.every((row) => row.archivedAt === null)).toBe(true);
    expect(classificationLinksAfterRestore).toHaveLength(2);
    expect(classificationLinksAfterRestore.every((row) => row.archivedAt === null)).toBe(true);
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

describe("classification group listing", () => {
  it("returns only active classifications for active groups by default", async () => {
    const archivedAt = new Date();
    const [{ id: activeGroupId }] = await db
      .insert(schema.classificationGroups)
      .values({ name: uniqueName("group-active-default"), order: 10 })
      .$returningId();
    const [{ id: otherGroupId }] = await db
      .insert(schema.classificationGroups)
      .values({ name: uniqueName("group-other-default"), order: 20 })
      .$returningId();
    const [{ id: archivedGroupId }] = await db
      .insert(schema.classificationGroups)
      .values({ name: uniqueName("group-archived-default"), order: 30, archivedAt })
      .$returningId();

    const activeClassificationName = uniqueName("classification-active-default");
    const archivedClassificationName = uniqueName("classification-archived-default");
    const otherClassificationName = uniqueName("classification-other-default");
    const archivedGroupClassificationName = uniqueName("classification-archived-group-default");

    await db.insert(schema.classifications).values([
      { name: activeClassificationName, groupId: activeGroupId, order: 1 },
      { name: archivedClassificationName, groupId: activeGroupId, order: 2, archivedAt },
      { name: otherClassificationName, groupId: otherGroupId, order: 1 },
      { name: archivedGroupClassificationName, groupId: archivedGroupId, order: 1 },
    ]);

    const res = await app.handle(request("/classifications/groups"));

    expect(res.status).toBe(200);
    const body = await res.json() as {
      items: Array<{
        id: number;
        classifications: Array<{ name: string }>;
      }>;
    };

    const activeGroup = body.items.find((group) => group.id === activeGroupId);
    const otherGroup = body.items.find((group) => group.id === otherGroupId);

    expect(body.items.some((group) => group.id === archivedGroupId)).toBe(false);
    expect(activeGroup?.classifications.map((classification) => classification.name)).toEqual([activeClassificationName]);
    expect(otherGroup?.classifications.map((classification) => classification.name)).toEqual([otherClassificationName]);
  });

  it("includes archived groups and classifications when archived=true", async () => {
    const archivedAt = new Date();
    const [{ id: activeGroupId }] = await db
      .insert(schema.classificationGroups)
      .values({ name: uniqueName("group-active-archived-view"), order: 40 })
      .$returningId();
    const [{ id: archivedGroupId }] = await db
      .insert(schema.classificationGroups)
      .values({ name: uniqueName("group-archived-archived-view"), order: 50, archivedAt })
      .$returningId();

    const activeClassificationName = uniqueName("classification-active-archived-view");
    const archivedClassificationName = uniqueName("classification-archived-archived-view");
    const archivedGroupClassificationName = uniqueName("classification-archived-group-archived-view");

    await db.insert(schema.classifications).values([
      { name: activeClassificationName, groupId: activeGroupId, order: 1 },
      { name: archivedClassificationName, groupId: activeGroupId, order: 2, archivedAt },
      { name: archivedGroupClassificationName, groupId: archivedGroupId, order: 1, archivedAt },
    ]);

    const res = await app.handle(request("/classifications/groups?archived=true"));

    expect(res.status).toBe(200);
    const body = await res.json() as {
      items: Array<{
        id: number;
        classifications: Array<{ name: string }>;
      }>;
    };

    const activeGroup = body.items.find((group) => group.id === activeGroupId);
    const archivedGroup = body.items.find((group) => group.id === archivedGroupId);

    expect(activeGroup?.classifications.map((classification) => classification.name)).toEqual([
      activeClassificationName,
      archivedClassificationName,
    ]);
    expect(archivedGroup?.classifications.map((classification) => classification.name)).toEqual([
      archivedGroupClassificationName,
    ]);
  });
});

describe("bookmark request validation", () => {
  it.each([
    ["/bookmarks?limit=0", "limit must be an integer between 1 and 100"],
    ["/bookmarks?limit=101", "limit must be an integer between 1 and 100"],
    ["/bookmarks?limit=abc", "limit must be an integer between 1 and 100"],
    ["/bookmarks?offset=-1", "offset must be a non-negative integer"],
    ["/bookmarks?offset=abc", "offset must be a non-negative integer"],
    ["/bookmarks?classificationId=0", "classificationId must be a positive integer"],
    ["/bookmarks?classificationId=abc", "classificationId must be a positive integer"],
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
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function request(path: string, method = "GET"): Request {
  return new Request(`http://localhost${path}`, { method });
}

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueUrl(prefix: string): string {
  return `https://example.com/${uniqueName(prefix)}`;
}
