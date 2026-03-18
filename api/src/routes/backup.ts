import { Elysia } from "elysia";

import { ErrorResp } from "./shared.ts";

export const backupRoutes = new Elysia()
  .get(
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

      const authHeader = headers["authorization"] ?? "";
      const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      const providedToken = bearerMatch ? bearerMatch[1] : "";

      if (!providedToken || providedToken !== configuredToken) {
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

      const dump = Bun.spawn(
        [
          "mariadb-dump",
          `--host=${dbHost}`,
          `--port=${dbPort}`,
          `--user=${dbUser}`,
          `--password=${dbPassword}`,
          "--single-transaction",
          "--routines",
          "--triggers",
          dbName,
        ],
        { stdout: "pipe", stderr: "pipe" }
      );

      const gz = Bun.spawn(["gzip", "-9"], {
        stdin: dump.stdout,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await dump.exited;
      if (exitCode !== 0) {
        const errText = await new Response(dump.stderr).text();
        set.status = 500;
        return { error: `mysqldump failed (exit ${exitCode}): ${errText.trim()}` };
      }

      const gzBuffer = await new Response(gz.stdout).arrayBuffer();

      return new Response(gzBuffer, {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    },
    {
      detail: {
        tags: ["backup"],
        summary: "Download a database backup",
        description:
          "Streams a gzip-compressed `mariadb-dump` of the full bookmarks database.\n\n" +
          "**Authentication:** send the token in the `Authorization` header as a Bearer token:\n" +
          "```\nAuthorization: Bearer <BACKUP_TOKEN>\n```\n" +
          "where `BACKUP_TOKEN` is set in `api/.env`.\n\n" +
          "The endpoint returns `503` if the token is unset or still the default placeholder, " +
          "and `401` if the token is missing or does not match.\n\n" +
          "The response is a `.sql.gz` file attachment named `bookmark_YYYY-MM-DD_HHMMSS.sql.gz`.",
        responses: {
          200: { description: "SQL dump (gzip-compressed) file download" },
          401: { ...ErrorResp, description: "Missing or invalid Authorization header" },
          503: { ...ErrorResp, description: "Backup not configured - set BACKUP_TOKEN in api/.env" },
        },
      },
    }
  );
