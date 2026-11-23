// Migration 0013 renames the *_at columns to *_UTC (TIMESTAMP -> DATETIME).
// This applies 0000-0012 to a throwaway database, seeds every table, runs
// 0013 from a session in a non-UTC zone (and re-runs it, as after a failure)
// and checks that no data was lost or shifted and that the generated
// *_active columns still work.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import mysql from "mysql2/promise";

const UTC_MIGRATION = "0013_utc_timestamp_columns";
const CREATED = "2026-01-02 03:04:05";
const UPDATED = "2026-01-02 13:14:15";
const ARCHIVED = "2026-01-03 04:05:06";

const TABLES = [
  "categories", "subcategories", "sub_subcategories", "tags", "bookmarks",
  "bookmark_tags", "bookmark_categories", "bookmark_subcategories", "bookmark_sub_subcategories",
];

const tempDb = `migration_utc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
let admin: mysql.Connection;
let conn: mysql.Connection;

function connect(database?: string): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.MARIADB_ROOT_USER ?? process.env.DB_USER ?? "root",
    password: process.env.MARIADB_ROOT_PASSWORD ?? process.env.DB_PASSWORD ?? "",
    database,
    multipleStatements: true,
    dateStrings: true,
  });
}

async function migrationStatements(tag: string): Promise<string[]> {
  const text = await readFile(new URL(`../db/migrations/${tag}.sql`, import.meta.url), "utf-8");
  return text.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
}

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [result] = await conn.query(sql, params);
  return result as T[];
}

beforeAll(async () => {
  admin = await connect();
  await admin.query(`CREATE DATABASE \`${tempDb}\``);
  conn = await connect(tempDb);

  const journal = JSON.parse(await readFile(
    new URL("../db/migrations/meta/_journal.json", import.meta.url), "utf-8"
  )) as { entries: Array<{ tag: string }> };
  const tags = journal.entries.map((e) => e.tag);
  expect(tags).toContain(UTC_MIGRATION);

  // Schema as it was before 0013.
  await conn.query("SET time_zone = '+00:00'");
  for (const tag of tags.slice(0, tags.indexOf(UTC_MIGRATION))) {
    for (const statement of await migrationStatements(tag)) await conn.query(statement);
  }

  // Seed every table; TIMESTAMP literals are read in the +00:00 session above.
  await conn.query(`
    INSERT INTO categories (id, name, created_at, archived_at) VALUES
      (1, 'cat-active', '${CREATED}', NULL), (2, 'cat-archived', '${CREATED}', '${ARCHIVED}');
    INSERT INTO subcategories (id, category_id, name, created_at, archived_at) VALUES
      (1, 1, 'sub-active', '${CREATED}', NULL), (2, 1, 'sub-archived', '${CREATED}', '${ARCHIVED}');
    INSERT INTO sub_subcategories (id, subcategory_id, name, created_at, archived_at) VALUES
      (1, 1, 'ssc-active', '${CREATED}', NULL), (2, 1, 'ssc-archived', '${CREATED}', '${ARCHIVED}');
    INSERT INTO tags (id, name, created_at, archived_at) VALUES
      (1, 'tag-active', '${CREATED}', NULL), (2, 'tag-archived', '${CREATED}', '${ARCHIVED}');
    INSERT INTO bookmarks (id, url, title, created_at, updated_at, archived_at) VALUES
      (1, 'https://example.com/a', 'A', '${CREATED}', '${UPDATED}', NULL),
      (2, 'https://example.com/b', 'B', '${CREATED}', '${UPDATED}', '${ARCHIVED}');
    INSERT INTO bookmark_tags (id, bookmark_id, tag_id, created_at, archived_at) VALUES
      (1, 1, 1, '${CREATED}', NULL), (2, 1, 2, '${CREATED}', '${ARCHIVED}');
    INSERT INTO bookmark_categories (id, bookmark_id, category_id, created_at, archived_at) VALUES
      (1, 1, 1, '${CREATED}', NULL), (2, 1, 2, '${CREATED}', '${ARCHIVED}');
    INSERT INTO bookmark_subcategories (id, bookmark_id, subcategory_id, created_at, archived_at) VALUES
      (1, 1, 1, '${CREATED}', NULL), (2, 1, 2, '${CREATED}', '${ARCHIVED}');
    INSERT INTO bookmark_sub_subcategories (id, bookmark_id, sub_subcategory_id, created_at, archived_at) VALUES
      (1, 1, 1, '${CREATED}', NULL), (2, 1, 2, '${CREATED}', '${ARCHIVED}');
  `);

  // Run 0013 from a non-UTC session: the migration must pin UTC itself.
  // Then run it again: each ALTER commits on its own, so a half-finished
  // migration has to be safe to re-run without touching the data.
  const utcStatements = await migrationStatements(UTC_MIGRATION);
  await conn.query("SET time_zone = '+05:00'");
  for (const statement of utcStatements) await conn.query(statement);
  await conn.query("SET time_zone = '+05:00'");
  for (const statement of utcStatements) await conn.query(statement);
  // A run that stopped half-way through a table: column renamed, *_active gone.
  await conn.query("ALTER TABLE `tags` DROP INDEX `uniq_active_tag_name`, DROP COLUMN `name_active`");
  for (const statement of utcStatements) await conn.query(statement);
  await conn.query("SET time_zone = '+00:00'");
});

afterAll(async () => {
  await conn?.end();
  await admin?.query(`DROP DATABASE IF EXISTS \`${tempDb}\``);
  await admin?.end();
});

describe(`migration ${UTC_MIGRATION}`, () => {
  it("renames every timestamp column to *_UTC as DATETIME", async () => {
    const cols = await rows<{ t: string; c: string; dt: string }>(
      `SELECT table_name AS t, column_name AS c, data_type AS dt FROM information_schema.columns
        WHERE table_schema = ? AND data_type IN ('datetime', 'timestamp', 'date', 'time')
        ORDER BY table_name, column_name`,
      [tempDb]
    );
    const expected = TABLES.flatMap((t) =>
      t === "bookmarks"
        ? [`${t}.archived_UTC`, `${t}.created_UTC`, `${t}.updated_UTC`]
        : [`${t}.archived_UTC`, `${t}.created_UTC`]
    ).sort();
    expect(cols.map((c) => `${c.t}.${c.c}`).sort()).toEqual(expected);
    for (const c of cols) expect(c.dt).toBe("datetime");
  });

  it("keeps every row and every timestamp value unchanged", async () => {
    for (const table of TABLES) {
      const data = await rows<{ id: number; created_UTC: string; archived_UTC: string | null }>(
        `SELECT id, created_UTC, archived_UTC FROM \`${table}\` ORDER BY id`
      );
      expect({ table, data }).toEqual({
        table,
        data: [
          { id: 1, created_UTC: CREATED, archived_UTC: null },
          { id: 2, created_UTC: CREATED, archived_UTC: ARCHIVED },
        ],
      });
    }
    const updated = await rows<{ updated_UTC: string }>("SELECT updated_UTC FROM bookmarks ORDER BY id");
    expect(updated.map((r) => r.updated_UTC)).toEqual([UPDATED, UPDATED]);
  });

  it("rebuilds the generated *_active columns on archived_UTC", async () => {
    const tagRows = await rows<{ id: number; name_active: string | null }>("SELECT id, name_active FROM tags ORDER BY id");
    expect(tagRows).toEqual([{ id: 1, name_active: "tag-active" }, { id: 2, name_active: null }]);

    const bookmarkRows = await rows<{ id: number; active: number }>(
      "SELECT id, url_hash_active IS NOT NULL AS active FROM bookmarks ORDER BY id"
    );
    expect(bookmarkRows.map((r) => Number(r.active))).toEqual([1, 0]);

    const junction = await rows<{ id: number; b: number | null; t: number | null }>(
      "SELECT id, bookmark_id_active AS b, tag_id_active AS t FROM bookmark_tags ORDER BY id"
    );
    expect(junction).toEqual([{ id: 1, b: 1, t: 1 }, { id: 2, b: null, t: null }]);
  });

  it("still enforces uniqueness among active rows only", async () => {
    await expect(conn.query("INSERT INTO tags (name) VALUES ('tag-active')")).rejects.toThrow(/Duplicate/);
    await expect(conn.query("INSERT INTO categories (name) VALUES ('cat-active')")).rejects.toThrow(/Duplicate/);
    await expect(conn.query("INSERT INTO bookmarks (url, title) VALUES ('https://example.com/a', 'dup')")).rejects.toThrow(/Duplicate/);
    // An archived name can be reused by a new active row.
    await conn.query("INSERT INTO tags (name) VALUES ('tag-archived')");
  });

  it("defaults new rows to UTC_TIMESTAMP()", async () => {
    await conn.query("SET time_zone = '+05:00'");
    try {
      await conn.query("INSERT INTO bookmarks (url, title) VALUES ('https://example.com/new', 'New')");
      const [row] = await rows<{ c: number; u: number }>(
        `SELECT TIMESTAMPDIFF(SECOND, created_UTC, UTC_TIMESTAMP()) AS c,
                TIMESTAMPDIFF(SECOND, updated_UTC, UTC_TIMESTAMP()) AS u
           FROM bookmarks WHERE url = 'https://example.com/new'`
      );
      expect(Math.abs(Number(row.c))).toBeLessThan(60);
      expect(Math.abs(Number(row.u))).toBeLessThan(60);
    } finally {
      await conn.query("SET time_zone = '+00:00'");
    }
  });
});
