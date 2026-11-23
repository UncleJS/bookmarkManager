import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";

import {
  bearerToken,
  configuredApiToken,
  isSafeMethod,
  isSameOriginRequest,
  isValidSession,
  safeEqual,
  sessionFromCookieHeader,
} from "./auth.ts";
import { pool } from "./db/client.ts";
import { backupRoutes } from "./routes/backup.ts";
import { bookmarkRoutes } from "./routes/bookmarks.ts";
import { categoryRoutes } from "./routes/categories.ts";
import { createHealthRoutes } from "./routes/health.ts";
import { getValidationErrorMessage } from "./routes/shared.ts";
import { subSubcategoryRoutes } from "./routes/subSubcategories.ts";
import { subcategoryRoutes } from "./routes/subcategories.ts";
import { tagRoutes } from "./routes/tags.ts";
import { createUiRoutes } from "./routes/ui.ts";

const PORT = Number(process.env.API_PORT ?? 11650);
const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

function resolveLogLevel(): LogLevel {
  const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if ((LOG_LEVELS as readonly string[]).includes(configured)) return configured as LogLevel;
  console.warn(`Unknown LOG_LEVEL "${process.env.LOG_LEVEL}", using info`);
  return "info";
}

const logLevel = resolveLogLevel();
const logRank: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function logAt(level: LogLevel, message: string) {
  if (logRank[logLevel] >= logRank[level]) console.log(message);
}

// Returns true for paths that do not require API authentication:
// infrastructure probes, the UI pages (they serve the login form when there is
// no session), static UI assets, the session routes, the API docs, and the
// backup endpoint (which uses its own independent BACKUP_TOKEN guard).
function isAuthExempt(path: string): boolean {
  return (
    path === "/" ||
    path === "/health" ||
    path === "/ready" ||
    path === "/app" ||
    path === "/manage-categories" ||
    path === "/manage-tags" ||
    path === "/session" ||
    path === "/openapi.json" ||
    path === "/backup" ||
    path.startsWith("/ui/") ||
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
    .onAfterResponse(({ request, set, path }) => {
      const pathname = typeof path === "string" ? path : "";
      if (!pathname || pathname === "/health" || pathname === "/ready") return;
      const status = typeof set.status === "number" ? set.status : 200;
      let target = pathname;
      if (logLevel === "debug" && request.url) {
        try {
          const url = new URL(request.url);
          target = `${url.pathname}${url.search}`;
        } catch {
          target = pathname;
        }
      }
      if (status >= 500) logAt("error", `${request.method} ${target} ${status}`);
      else if (status >= 400) logAt("warn", `${request.method} ${target} ${status}`);
      else logAt("info", `${request.method} ${target} ${status}`);
    })
    // ---------------------------------------------------------------------------
    // Global authentication guard
    // All routes except the exempt paths above need one of:
    //   - Authorization: Bearer <API_TOKEN>   (extension, scripts)
    //   - the bm_session cookie from POST /session (browser UI). Cookie-authenticated
    //     writes must also come from this app's own origin (CSRF guard).
    // Set API_TOKEN to a strong random value (e.g. openssl rand -hex 32).
    // ---------------------------------------------------------------------------
    .onBeforeHandle(({ path, request, set }) => {
      if (isAuthExempt(path)) return;

      const configuredToken = configuredApiToken();
      if (!configuredToken) {
        set.status = 503;
        return {
          error:
            "API is not configured. Set API_TOKEN to a strong random value in api/.env and restart the service.",
        };
      }

      const bearer = bearerToken(request.headers.get("authorization") ?? undefined);
      if (bearer !== null) {
        if (safeEqual(bearer, configuredToken)) return;
        set.status = 401;
        return { error: "Invalid or missing API token. Send header: Authorization: Bearer <API_TOKEN>" };
      }

      if (isValidSession(sessionFromCookieHeader(request.headers.get("cookie") ?? undefined))) {
        if (!isSafeMethod(request.method) && !isSameOriginRequest(request)) {
          set.status = 403;
          return { error: "Cross-origin request blocked" };
        }
        return;
      }

      set.status = 401;
      return { error: "Invalid or missing API token. Send header: Authorization: Bearer <API_TOKEN>" };
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
                "Manages bookmarks, tags, categories, sub-categories, and nested sub-sub-categories.\n\n" +
               "**Auth model:** bookmark-management routes accept `Authorization: Bearer <API_TOKEN>` " +
               "or the HttpOnly `bm_session` cookie. The browser UI pages show a login form; " +
               "`POST /session` checks the pasted token and sets the cookie to a random server-side session id " +
               "(never the token). `DELETE /session` logs out. Cookie-authenticated writes must be same-origin. " +
                "Health probes (`/health`, `/ready`), the UI pages and assets, `/session` " +
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
            { name: "subSubcategories", description: "Manage nested sub-sub-categories and assign them to bookmarks" },
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
    .use(createUiRoutes())
    .use(tagRoutes)
    .use(subSubcategoryRoutes)
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
