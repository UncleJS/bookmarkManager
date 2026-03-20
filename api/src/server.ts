import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";

import { pool } from "./db/client.ts";
import { backupRoutes } from "./routes/backup.ts";
import { bookmarkRoutes } from "./routes/bookmarks.ts";
import { categoryRoutes } from "./routes/categories.ts";
import { createHealthRoutes } from "./routes/health.ts";
import { getValidationErrorMessage } from "./routes/shared.ts";
import { subcategoryRoutes } from "./routes/subcategories.ts";
import { tagRoutes } from "./routes/tags.ts";

const PORT = Number(process.env.API_PORT ?? 11650);

// Returns true for paths that do not require API_TOKEN authentication:
// infrastructure probes, static HTML pages, the API docs, and the backup
// endpoint (which uses its own independent BACKUP_TOKEN guard).
function isAuthExempt(path: string): boolean {
  return (
    path === "/" ||
    path === "/health" ||
    path === "/ready" ||
    path === "/app" ||
    path === "/manage-categories" ||
    path === "/config" ||
    path === "/openapi.json" ||
    path === "/backup" ||
    path.startsWith("/docs")
  );
}

type BuildAppOptions = {
  checkReadiness?: () => Promise<void>;
};

export function buildApp({ checkReadiness }: BuildAppOptions = {}) {
  return new Elysia()
    .onError(({ code, error, set }) => {
      if (code === "VALIDATION") {
        set.status = 400;
        return { error: getValidationErrorMessage(error) };
      }
    })
    // ---------------------------------------------------------------------------
    // Global authentication guard
    // All routes except the exempt paths above require a valid API_TOKEN.
    // Set API_TOKEN in api/.env to a strong random value (e.g. openssl rand -hex 32).
    // The extension sends it as:  Authorization: Bearer <API_TOKEN>
    // ---------------------------------------------------------------------------
    .onBeforeHandle(({ path, headers, set }) => {
      if (isAuthExempt(path)) return;

      const configuredToken = process.env.API_TOKEN ?? "";
      if (!configuredToken || configuredToken === "change_me_please") {
        set.status = 503;
        return {
          error:
            "API is not configured. Set API_TOKEN to a strong random value in api/.env and restart the service.",
        };
      }

      const authHeader = headers["authorization"] ?? "";
      const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      const providedToken = bearerMatch ? bearerMatch[1] : "";

      if (!providedToken || providedToken !== configuredToken) {
        set.status = 401;
        return { error: "Invalid or missing API token. Send header: Authorization: Bearer <API_TOKEN>" };
      }
    })
    .use(
      swagger({
        path: "/docs",
        documentation: {
          info: {
              title: "Bookmark Manager API",
              version: "0.1.0",
              description:
                "REST API for the Bookmark Manager Chrome extension.\n\n" +
               "Manages bookmarks, tags, categories, and sub-categories.\n\n" +
               "**Auth model:** all bookmark-management routes require `Authorization: Bearer <API_TOKEN>` " +
               "(set `API_TOKEN` in `api/.env`). " +
               "Health probes (`/health`, `/ready`), static UI pages (`/app`, `/manage-categories`), " +
               "and the API docs (`/docs`) are exempt. " +
               "The `GET /backup` endpoint additionally requires its own `Authorization: Bearer <BACKUP_TOKEN>`.\n\n" +
               "**Data lifecycle:** records are never hard-deleted. Entity rows and bookmark association rows " +
               "use `archivedAt` for archive-only lifecycle, and archived associations are reactivated when re-attached.\n\n" +
              "**Timestamps:** stored and returned as UTC. The `archivedAt` field is `null` " +
              "while a record is active and set to a UTC datetime when archived.",
          },
          tags: [
            { name: "health", description: "Health check and UI entry points" },
            { name: "bookmarks", description: "Create, read, update, archive, and restore bookmarks" },
            { name: "tags", description: "Manage tags and attach them to bookmarks" },
            { name: "categories", description: "Manage categories that organise sub-categories" },
            { name: "subcategories", description: "Manage sub-categories and assign them to bookmarks" },
            { name: "backup", description: "Generate authenticated MariaDB backup downloads" },
          ],
        },
      })
    )
    .use(
      createHealthRoutes({
        checkReadiness: checkReadiness ?? (async () => {
          await pool.query("select 1");
        }),
      })
    )
    .use(tagRoutes)
    .use(subcategoryRoutes)
    .use(bookmarkRoutes)
    .use(categoryRoutes)
    .use(backupRoutes);
}

export const app = buildApp();

if (import.meta.main) {
  app.listen(PORT);

  console.log(
    `Bookmark Manager API running at http://localhost:${PORT}\n` +
      `   Viewer UI  -> http://localhost:${PORT}/app\n` +
      `   Swagger UI -> http://localhost:${PORT}/docs\n` +
      `   OpenAPI    -> http://localhost:${PORT}/openapi.json`
  );
}

export type App = typeof app;
