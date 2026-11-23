import { readFile } from "fs/promises";
import mysql from "mysql2/promise";

/** Refuses to touch the live database; returns the test DB name. */
export function testDatabaseName(): string {
  const dbName = process.env.DB_NAME ?? "bookmarks_test";
  if (dbName === "bookmarks") {
    throw new Error(
      "SAFETY: integration tests must not run against the live 'bookmarks' database. " +
      "Set DB_NAME=bookmarks_test or leave DB_NAME unset."
    );
  }
  process.env.DB_NAME = dbName;
  return dbName;
}

export async function openAdminConnection(): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: testDatabaseName(),
    multipleStatements: true,
  });
}

/** Drops every app table and re-applies all migrations in order. */
export async function resetTestDatabase(adminConnection: mysql.Connection): Promise<void> {
  testDatabaseName();
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

}
