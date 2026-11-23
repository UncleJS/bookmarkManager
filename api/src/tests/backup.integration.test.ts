// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 UncleJS

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { gzipSync, gunzipSync } from "zlib";
import mysql from "mysql2/promise";
import { Elysia } from "elysia";

import { createBackupRoutes } from "../routes/backup.ts";

const SQL_DUMP = [
  "CREATE TABLE categories (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL);",
  "CREATE TABLE subcategories (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, category_id INT NULL);",
  "CREATE TABLE tags (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL);",
  "CREATE TABLE bookmarks (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, url TEXT NOT NULL, title VARCHAR(255) NOT NULL);",
  "CREATE TABLE bookmark_tags (bookmark_id INT NOT NULL, tag_id INT NOT NULL, PRIMARY KEY (bookmark_id, tag_id));",
  "CREATE TABLE bookmark_categories (bookmark_id INT NOT NULL, category_id INT NOT NULL, PRIMARY KEY (bookmark_id, category_id));",
  "CREATE TABLE bookmark_subcategories (bookmark_id INT NOT NULL, subcategory_id INT NOT NULL, PRIMARY KEY (bookmark_id, subcategory_id));",
  "INSERT INTO categories (id, name) VALUES (1, 'Reference');",
  "INSERT INTO subcategories (id, name, category_id) VALUES (1, 'Docs', 1);",
  "INSERT INTO tags (id, name) VALUES (1, 'bun');",
  "INSERT INTO bookmarks (id, url, title) VALUES (1, 'https://example.com', 'Example');",
  "INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (1, 1);",
  "INSERT INTO bookmark_categories (bookmark_id, category_id) VALUES (1, 1);",
  "INSERT INTO bookmark_subcategories (bookmark_id, subcategory_id) VALUES (1, 1);",
].join("\n");

let adminConnection: mysql.Connection;

beforeAll(async () => {
  adminConnection = await mysql.createConnection({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.MARIADB_ROOT_USER ?? "root",
    password: process.env.MARIADB_ROOT_PASSWORD ?? process.env.DB_PASSWORD ?? "",
    multipleStatements: true,
  });
});

afterAll(async () => {
  await adminConnection?.end();
});

describe("backup route", () => {
  it("returns a gzip dump that can be restored successfully", async () => {
    const app = new Elysia().use(createBackupRoutes({ spawn: fakeSpawn }));

    await withBackupToken("test-backup-token", async () => {
      const res = await app.handle(new Request("http://localhost/backup", {
        headers: { authorization: "Bearer test-backup-token" },
      }));

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/gzip");
      expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="bookmark_.+\.sql\.gz"$/);

      const gzBytes = new Uint8Array(await res.arrayBuffer());
      expect(gzBytes.byteLength).toBeGreaterThan(0);

      const sql = gunzipSync(gzBytes).toString("utf8");
      expect(sql).toContain("CREATE TABLE bookmarks");

      const tempDb = `backup_api_verify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      try {
        await adminConnection.query(`CREATE DATABASE ${quoteIdentifier(tempDb)}`);

        const restoreConnection = await mysql.createConnection({
          host: process.env.DB_HOST ?? "127.0.0.1",
          port: Number(process.env.DB_PORT ?? 3306),
          user: process.env.MARIADB_ROOT_USER ?? "root",
          password: process.env.MARIADB_ROOT_PASSWORD ?? process.env.DB_PASSWORD ?? "",
          database: tempDb,
          multipleStatements: true,
        });

        try {
          await restoreConnection.query(sql);

          const [tableRows] = await restoreConnection.query(
            `
              SELECT table_name AS name
              FROM information_schema.tables
              WHERE table_schema = ?
              ORDER BY table_name
            `,
            [tempDb]
          );

          const tables = tableRows as Array<{ name: string }>;

          expect(tables.map((table) => table.name)).toEqual([
            "bookmarks",
            "bookmark_categories",
            "bookmark_subcategories",
            "bookmark_tags",
            "categories",
            "subcategories",
            "tags",
          ]);

          const [countRows] = await restoreConnection.query(
            "SELECT COUNT(*) AS count FROM bookmarks"
          );
          const rows = countRows as Array<{ count: number }>;
          expect(rows[0]?.count).toBe(1);
        } finally {
          await restoreConnection.end();
        }
      } finally {
        await adminConnection.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(tempDb)}`);
      }
    });
  });
});

describe("backup streaming (S9)", () => {
  const MB = 1024 * 1024;

  // gzip emits `chunks` chunks of 256 KiB; the dump exits with dumpExit and writes stderr.
  function bigSpawn({ chunks, dumpExit, stderr = "" }: { chunks: number; dumpExit: number; stderr?: string }) {
    return (cmd: string[]) => {
      if (cmd[0] === "mariadb-dump") {
        return {
          stdout: streamFromString("-- dump"),
          stderr: streamFromString(stderr),
          exited: Promise.resolve(dumpExit),
        };
      }
      let sent = 0;
      return {
        stdout: new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent >= chunks) {
              controller.close();
              return;
            }
            sent += 1;
            controller.enqueue(new Uint8Array(256 * 1024).fill(sent % 256));
          },
        }),
        stderr: streamFromString(""),
        exited: Promise.resolve(0),
      };
    };
  }

  async function get(spawn: ReturnType<typeof bigSpawn>): Promise<Response> {
    const app = new Elysia().use(createBackupRoutes({ spawn }));
    let res!: Response;
    await withBackupToken("test-backup-token", async () => {
      res = await app.handle(new Request("http://localhost/backup", {
        headers: { authorization: "Bearer test-backup-token" },
      }));
    });
    return res;
  }

  it("streams a dump larger than the buffer limit in full", async () => {
    const res = await get(bigSpawn({ chunks: 12, dumpExit: 0 }));
    expect(res.status).toBe(200);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.byteLength).toBe(3 * MB);
  });

  it("returns 500 when a small dump fails, even with a lot of stderr", async () => {
    const res = await get(bigSpawn({ chunks: 1, dumpExit: 2, stderr: "x".repeat(200_000) }));
    expect(res.status).toBe(500);
  });

  it("aborts the download when a large dump fails after streaming started", async () => {
    const res = await get(bigSpawn({ chunks: 12, dumpExit: 2 }));
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow();
  });

  it("compares the backup token in constant time and rejects a wrong one", async () => {
    const res = await (async () => {
      const app = new Elysia().use(createBackupRoutes({ spawn: fakeSpawn }));
      let out!: Response;
      await withBackupToken("test-backup-token", async () => {
        out = await app.handle(new Request("http://localhost/backup", {
          headers: { authorization: "Bearer test-backup-tokem" },
        }));
      });
      return out;
    })();
    expect(res.status).toBe(401);
  });
});

function fakeSpawn(cmd: string[], _options: { stdin?: ReadableStream; stdout: "pipe"; stderr: "pipe" }) {
  if (cmd[0] === "mariadb-dump") {
    return {
      stdout: streamFromString(SQL_DUMP),
      stderr: streamFromString(""),
      exited: Promise.resolve(0),
    };
  }

  if (cmd[0] === "gzip") {
    return {
      stdout: streamFromBytes(gzipSync(SQL_DUMP)),
      stderr: streamFromString(""),
      exited: Promise.resolve(0),
    };
  }

  throw new Error(`Unexpected command: ${cmd.join(" ")}`);
}

function streamFromString(value: string): ReadableStream {
  return streamFromBytes(new TextEncoder().encode(value));
}

function streamFromBytes(value: Uint8Array): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(value);
      controller.close();
    },
  });
}

function quoteIdentifier(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
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
