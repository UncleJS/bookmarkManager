// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 UncleJS

import { Elysia } from "elysia";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { bearerToken, safeEqual } from "../auth.ts";
import { ErrorResp } from "./shared.ts";

type SpawnedProcess = {
  stdout: ReadableStream | null;
  stderr: ReadableStream | null;
  exited: Promise<number>;
  kill?: () => void;
};

// Up to this many gzip bytes are buffered so a fast failure still returns 500.
// Larger dumps are streamed; a failure after that point aborts the download.
const BUFFER_LIMIT = 1024 * 1024;

/** Reads a stream to the end so the child never blocks on a full pipe. Keeps the tail. */
async function drain(stream: ReadableStream | null, keep = 4096): Promise<string> {
  if (!stream) return "";
  const decoder = new TextDecoder();
  let text = "";
  try {
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      text = (text + decoder.decode(chunk, { stream: true })).slice(-keep);
    }
  } catch {
    // ignore read errors; the exit code decides success
  }
  return text;
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

type SpawnProcess = (cmd: string[], options: {
  stdin?: ReadableStream;
  stdout: "pipe";
  stderr: "pipe";
}) => SpawnedProcess;

const bunSpawn: SpawnProcess = (cmd, options) => Bun.spawn({ cmd, ...options }) as SpawnedProcess;

export function createBackupRoutes({ spawn = bunSpawn }: { spawn?: SpawnProcess } = {}) {
  return new Elysia().get(
    "/backup",
    async ({ headers, set }) => {
      const configuredToken = process.env.BACKUP_TOKEN ?? "";

      if (!configuredToken || configuredToken === "change_me_please") {
        set.status = 503;
        return {
          error:
            "Backup is not configured. Set BACKUP_TOKEN to a strong random value in api/.env and restart the service.",
        };
      }

      const providedToken = bearerToken(headers["authorization"]);

      if (!providedToken || !safeEqual(providedToken, configuredToken)) {
        set.status = 401;
        return { error: "Invalid or missing backup token. Send header: Authorization: Bearer <BACKUP_TOKEN>" };
      }

      const dbHost = process.env.DB_HOST ?? "127.0.0.1";
      const dbPort = process.env.DB_PORT ?? "3306";
      const dbUser = process.env.DB_USER ?? "bookmark";
      const dbPassword = process.env.DB_PASSWORD ?? "";
      const dbName = process.env.DB_NAME ?? "bookmarks";
      const timestamp = new Date()
        .toISOString()
        .replace(/T/, "_")
        .replace(/:/g, "")
        .slice(0, 15);
      const filename = `bookmark_${timestamp}.sql.gz`;
      const defaultsDir = mkdtempSync(join(tmpdir(), "bm-backup-"));
      const defaultsFile = join(defaultsDir, "client.cnf");
      writeFileSync(
        defaultsFile,
        [
          "[client]",
          `host=${quoteDefaults(dbHost)}`,
          `port=${quoteDefaults(dbPort)}`,
          `user=${quoteDefaults(dbUser)}`,
          `password=${quoteDefaults(dbPassword)}`,
          "",
        ].join("\n"),
      );
      chmodSync(defaultsFile, 0o600);

      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        rmSync(defaultsDir, { recursive: true, force: true });
      };
      let streaming = false;

      try {
        const dump = spawn(
          [
            "mariadb-dump",
            `--defaults-extra-file=${defaultsFile}`,
            "--single-transaction",
            "--routines",
            "--triggers",
            dbName,
          ],
          { stdout: "pipe", stderr: "pipe" }
        );

        if (!dump.stdout) {
          set.status = 500;
          return { error: "Backup failed" };
        }

        const gz = spawn(["gzip", "-9"], {
          stdin: dump.stdout,
          stdout: "pipe",
          stderr: "pipe",
        });

        if (!gz.stdout) {
          set.status = 500;
          return { error: "Backup failed" };
        }

        // Drain both stderr pipes concurrently so neither process can block on them.
        const dumpErr = drain(dump.stderr);
        const gzErr = drain(gz.stderr);
        const succeeded = async () => {
          const [dumpExit, gzExit, dumpStderr, gzStderr] = await Promise.all([
            dump.exited, gz.exited, dumpErr, gzErr,
          ]);
          if (dumpExit === 0 && gzExit === 0) return true;
          console.error(
            `backup failed: mariadb-dump exit ${dumpExit}, gzip exit ${gzExit}` +
              (dumpStderr ? `\nmariadb-dump: ${dumpStderr.trim()}` : "") +
              (gzStderr ? `\ngzip: ${gzStderr.trim()}` : ""),
          );
          return false;
        };

        const reader = (gz.stdout as ReadableStream<Uint8Array>).getReader();
        const head: Uint8Array[] = [];
        let headBytes = 0;
        let ended = false;
        while (headBytes < BUFFER_LIMIT) {
          const { done, value } = await reader.read();
          if (done) {
            ended = true;
            break;
          }
          head.push(value);
          headBytes += value.byteLength;
        }

        const responseHeaders = {
          "Content-Type": "application/gzip",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        };

        if (ended) {
          if (!(await succeeded())) {
            set.status = 500;
            return { error: "Backup failed" };
          }
          return new Response(concatBytes(head, headBytes), { headers: responseHeaders });
        }

        // Large dump: stream the rest. The defaults file is removed once both
        // processes are done (or the client goes away).
        streaming = true;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of head) controller.enqueue(chunk);
          },
          async pull(controller) {
            try {
              const { done, value } = await reader.read();
              if (!done) {
                controller.enqueue(value);
                return;
              }
              const ok = await succeeded();
              cleanup();
              if (ok) controller.close();
              else controller.error(new Error("Backup failed"));
            } catch (err) {
              cleanup();
              controller.error(err);
            }
          },
          cancel() {
            dump.kill?.();
            gz.kill?.();
            cleanup();
          },
        });
        return new Response(body, { headers: responseHeaders });
      } finally {
        if (!streaming) cleanup();
      }
    },
    {
      detail: {
        tags: ["backup"],
        summary: "Download a database backup",
        description:
          "Generates a gzip-compressed `mariadb-dump` of the full bookmarks database and returns it as a file download.\n\n" +
          "**Authentication:** send the token in the `Authorization` header as a Bearer token:\n" +
          "```\nAuthorization: Bearer <BACKUP_TOKEN>\n```\n" +
          "where `BACKUP_TOKEN` is set in `api/.env`.\n\n" +
          "The endpoint returns `503` if the token is unset or still the default placeholder, " +
          "`401` if the token is missing or does not match, and `500` if the dump command fails.\n\n" +
          "The response is a `.sql.gz` file attachment named `bookmark_YYYY-MM-DD_HHMMSS.sql.gz`.",
        responses: {
          200: { description: "SQL dump (gzip-compressed) file download" },
          401: { ...ErrorResp, description: "Missing or invalid Authorization header" },
          500: { ...ErrorResp, description: "Backup generation failed" },
          503: { ...ErrorResp, description: "Backup not configured - set BACKUP_TOKEN in api/.env" },
        },
      },
    }
  );
}

export const backupRoutes = createBackupRoutes();

function quoteDefaults(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "")}"`;
}
