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

describe("bookmark write transactions", () => {
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
});

function jsonRequest(path: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueUrl(prefix: string): string {
  return `https://example.com/${uniqueName(prefix)}`;
}
