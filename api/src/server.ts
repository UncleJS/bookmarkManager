import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";

import { backupRoutes } from "./routes/backup.ts";
import { bookmarkRoutes } from "./routes/bookmarks.ts";
import { classificationRoutes } from "./routes/classifications.ts";
import { groupRoutes } from "./routes/groups.ts";
import { healthRoutes } from "./routes/health.ts";
import { getValidationErrorMessage } from "./routes/shared.ts";
import { tagRoutes } from "./routes/tags.ts";

const PORT = Number(process.env.API_PORT ?? 11650);

export function buildApp() {
  return new Elysia()
    .onError(({ code, error, set }) => {
      if (code === "VALIDATION") {
        set.status = 400;
        return { error: getValidationErrorMessage(error) };
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
              "Manages bookmarks, tags, classifications, and classification groups.\n\n" +
              "**Data lifecycle:** records are never hard-deleted. Entity rows and bookmark association rows " +
              "use `archivedAt` for archive-only lifecycle, and archived associations are reactivated when re-attached.\n\n" +
              "**Timestamps:** stored and returned as UTC. The `archivedAt` field is `null` " +
              "while a record is active and set to a UTC datetime when archived.",
          },
          tags: [
            { name: "health", description: "Health check and UI entry points" },
            { name: "bookmarks", description: "Create, read, update, archive, and restore bookmarks" },
            { name: "tags", description: "Manage tags and attach them to bookmarks" },
            { name: "classifications", description: "Manage classifications (categories) and assign them to bookmarks" },
            { name: "groups", description: "Manage classification groups that organise classifications" },
          ],
        },
      })
    )
    .use(healthRoutes)
    .use(tagRoutes)
    .use(classificationRoutes)
    .use(bookmarkRoutes)
    .use(groupRoutes)
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
