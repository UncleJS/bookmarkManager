import { Elysia, t } from "elysia";
import { readFileSync } from "fs";
import { join } from "path";

import {
  clearedSessionCookie,
  configuredApiToken,
  createSession,
  destroySession,
  isHttpsRequest,
  isSameOriginRequest,
  isValidSession,
  safeEqual,
  sessionCookie,
  sessionFromCookieHeader,
} from "../auth.ts";
import { ErrorResp, OkResp } from "./shared.ts";

const UI_DIR = join(import.meta.dir, "..", "ui");

// No inline scripts, styles or handlers: everything loads from /ui/*.
// img-src stays open to http(s) because bookmark favicons are remote images.
export const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: http: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const ASSET_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

// Only these files are served under /ui/. They hold no secrets.
const ASSETS = [
  "common.js",
  "login.js",
  "login.css",
  "app.js",
  "app.css",
  "categories.js",
  "categories.css",
  "tags.js",
  "tags.css",
] as const;

const PAGES = {
  "/app": "app.html",
  "/manage-categories": "categories.html",
  "/manage-tags": "tags.html",
} as const;

function readUI(name: string): string {
  return readFileSync(join(UI_DIR, name), "utf-8");
}

function htmlHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": HTML_CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  };
}

function hasValidSession(request: Request): boolean {
  if (!configuredApiToken()) return false;
  return isValidSession(sessionFromCookieHeader(request.headers.get("cookie") ?? undefined));
}

/**
 * Serves a UI page to a signed-in browser, or the login form otherwise.
 * Never sets a credential cookie: only POST /session does that.
 */
function pageResponse(request: Request, name: string): Response {
  const headers = htmlHeaders();
  if (hasValidSession(request)) return new Response(readUI(name), { headers });

  // Clear a stale or legacy cookie (older builds stored the API token in it).
  if (sessionFromCookieHeader(request.headers.get("cookie") ?? undefined)) {
    headers["Set-Cookie"] = clearedSessionCookie(isHttpsRequest(request));
  }
  return new Response(readUI("login.html"), { headers });
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}

function pageDetail(summary: string, description: string) {
  return {
    detail: {
      tags: ["health"],
      summary,
      description:
        `${description} Without a valid browser session the login form is served instead; ` +
        "no credential cookie is ever set by this route.",
      responses: { 200: { description: "HTML page (the app page or the login form)" } },
    },
  };
}

export function createUiRoutes() {
  const app = new Elysia()
    .get("/app", ({ request }) => pageResponse(request, PAGES["/app"]),
      pageDetail("Bookmark viewer web UI", "Serves the bookmark viewer."))
    .get("/manage-categories", ({ request }) => pageResponse(request, PAGES["/manage-categories"]),
      pageDetail("Category management web UI", "Serves the category and sub-category management page."))
    .get("/manage-tags", ({ request }) => pageResponse(request, PAGES["/manage-tags"]),
      pageDetail("Tag management web UI", "Serves the tag management page."))
    .get("/ui/:file", ({ params, set }) => {
      const file = params.file;
      if (!(ASSETS as readonly string[]).includes(file)) {
        set.status = 404;
        return { error: "Not found" };
      }
      const ext = file.slice(file.lastIndexOf("."));
      return new Response(readUI(file), {
        headers: {
          "Content-Type": ASSET_TYPES[ext] ?? "application/octet-stream",
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }, {
      detail: { hide: true },
    })
    .post("/session", ({ body, request }) => {
      const configured = configuredApiToken();
      if (!configured) {
        return json(503, {
          error: "API is not configured. Set API_TOKEN to a strong random value and restart the service.",
        });
      }
      // Blocks login CSRF: only this app's own login form may start a session.
      if (!isSameOriginRequest(request)) {
        return json(403, { error: "Cross-origin request blocked" });
      }
      if (!safeEqual(body.token.trim(), configured)) {
        return json(401, { error: "Invalid API token" });
      }
      const session = createSession();
      return json(200, { ok: true }, {
        "Set-Cookie": sessionCookie(session.id, session.maxAgeSeconds, isHttpsRequest(request)),
      });
    }, {
      body: t.Object({
        token: t.String({ minLength: 1, maxLength: 1024, description: "The API_TOKEN, pasted into the login form." }),
      }),
      detail: {
        tags: ["health"],
        summary: "Start a browser session",
        description:
          "Exchanges the API token for a browser session. On success the response sets " +
          "`bm_session=<random id>` (HttpOnly, SameSite=Lax, Path=/, Secure over https). " +
          "The cookie holds a random server-side session id, never the token. " +
          "Only same-origin requests are accepted. API clients keep using `Authorization: Bearer <API_TOKEN>`.",
        responses: {
          200: { ...OkResp, description: "Session started" },
          401: { ...ErrorResp, description: "Wrong token" },
          403: { ...ErrorResp, description: "Cross-origin request" },
          503: { ...ErrorResp, description: "API_TOKEN is not configured" },
        },
      },
    })
    .delete("/session", ({ request }) => {
      const id = sessionFromCookieHeader(request.headers.get("cookie") ?? undefined);
      if (id && !isSameOriginRequest(request)) {
        return json(403, { error: "Cross-origin request blocked" });
      }
      destroySession(id);
      return json(200, { ok: true }, { "Set-Cookie": clearedSessionCookie(isHttpsRequest(request)) });
    }, {
      detail: {
        tags: ["health"],
        summary: "End the browser session (log out)",
        description: "Forgets the session server-side and clears the `bm_session` cookie.",
        responses: {
          200: { ...OkResp, description: "Logged out" },
          403: { ...ErrorResp, description: "Cross-origin request" },
        },
      },
    });
  return app;
}
