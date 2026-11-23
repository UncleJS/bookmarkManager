import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type mysql from "mysql2/promise";

import { clearSessions, safeEqual, SESSION_COOKIE } from "../auth.ts";
import { openAdminConnection, resetTestDatabase } from "./testDb.ts";

const TOKEN = process.env.API_TOKEN ?? "test-api-token";
const BASE = "http://localhost";
const ORIGIN = "http://localhost";

type AppModule = typeof import("../server.ts");
let app: ReturnType<AppModule["buildApp"]>;
let adminConnection: mysql.Connection;

beforeAll(async () => {
  process.env.API_TOKEN = TOKEN;
  adminConnection = await openAdminConnection();
  await resetTestDatabase(adminConnection);
  // Import after DB_NAME is pinned to the test database.
  const { buildApp } = await import("../server.ts");
  app = buildApp({ checkReadiness: async () => {} });
});

afterAll(async () => {
  await adminConnection?.end();
});

afterEach(() => {
  clearSessions();
});

function cookieValue(setCookie: string | null): string {
  const match = (setCookie ?? "").match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  return match ? match[1] : "";
}

async function login(token = TOKEN, headers: Record<string, string> = { Origin: ORIGIN }): Promise<Response> {
  return app.handle(new Request(`${BASE}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ token }),
  }));
}

async function sessionId(): Promise<string> {
  const res = await login();
  expect(res.status).toBe(200);
  const id = cookieValue(res.headers.get("set-cookie"));
  expect(id).not.toBe("");
  return id;
}

describe("safeEqual", () => {
  it("compares strings of any length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcdef")).toBe(false);
    expect(safeEqual("", "abc")).toBe(false);
  });
});

describe("UI pages without a session", () => {
  for (const path of ["/app", "/manage-categories", "/manage-tags"]) {
    it(`${path} serves the login form and sets no credential cookie`, async () => {
      const res = await app.handle(new Request(`${BASE}${path}`));
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toBeNull();
      const html = await res.text();
      expect(html).toContain('id="login-form"');
      expect(html).not.toContain(TOKEN);
    });
  }

  it("clears a legacy cookie that held the API token", async () => {
    const res = await app.handle(new Request(`${BASE}/app`, {
      headers: { Cookie: `${SESSION_COOKIE}=${TOKEN}` },
    }));
    const html = await res.text();
    expect(html).toContain('id="login-form"');
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("Max-Age=0");
    expect(cookieValue(setCookie)).toBe("");
  });

  it("does not accept the raw API token as a session cookie", async () => {
    const res = await app.handle(new Request(`${BASE}/tags`, {
      headers: { Cookie: `${SESSION_COOKIE}=${TOKEN}` },
    }));
    expect(res.status).toBe(401);
  });
});

describe("POST /session", () => {
  it("rejects a wrong token with 401 and sets no cookie", async () => {
    const res = await login("wrong-token");
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a cross-origin login with 403", async () => {
    const res = await login(TOKEN, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a login with Sec-Fetch-Site: cross-site", async () => {
    const res = await login(TOKEN, { Origin: ORIGIN, "Sec-Fetch-Site": "cross-site" });
    expect(res.status).toBe(403);
  });

  it("sets an HttpOnly, SameSite=Lax, Path=/ cookie holding a random id, not the token", async () => {
    const res = await login();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Secure");
    const id = cookieValue(setCookie);
    expect(id.length).toBeGreaterThanOrEqual(40);
    expect(id).not.toBe(TOKEN);
    expect(setCookie).not.toContain(TOKEN);
  });

  it("adds Secure when the request came over https", async () => {
    const res = await login(TOKEN, { Origin: ORIGIN, "X-Forwarded-Proto": "https" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("Secure");
  });

  it("serves the app page once signed in", async () => {
    const id = await sessionId();
    const res = await app.handle(new Request(`${BASE}/app`, {
      headers: { Cookie: `${SESSION_COOKIE}=${id}` },
    }));
    const html = await res.text();
    expect(html).not.toContain('id="login-form"');
    expect(html).toContain('src="/ui/app.js"');
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("cookie-authenticated API requests", () => {
  it("serves the app on a cross-site link (Lax) but still blocks a cross-site write", async () => {
    const id = await sessionId();
    const page = await app.handle(new Request(`${BASE}/app`, {
      headers: { Cookie: `${SESSION_COOKIE}=${id}`, "Sec-Fetch-Site": "cross-site" },
    }));
    expect(await page.text()).not.toContain('id="login-form"');
    const write = await app.handle(new Request(`${BASE}/tags`, {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE}=${id}`,
        "Content-Type": "application/json",
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({ name: `lax-${Date.now()}` }),
    }));
    expect(write.status).toBe(403);
  });

  it("allows GET with a session cookie", async () => {
    const id = await sessionId();
    const res = await app.handle(new Request(`${BASE}/tags`, {
      headers: { Cookie: `${SESSION_COOKIE}=${id}` },
    }));
    expect(res.status).toBe(200);
  });

  it("blocks a write without an Origin header (CSRF)", async () => {
    const id = await sessionId();
    const res = await app.handle(new Request(`${BASE}/tags`, {
      method: "POST",
      headers: { Cookie: `${SESSION_COOKIE}=${id}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `csrf-${Date.now()}` }),
    }));
    expect(res.status).toBe(403);
  });

  it("blocks a cross-origin write", async () => {
    const id = await sessionId();
    const res = await app.handle(new Request(`${BASE}/tags`, {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE}=${id}`,
        "Content-Type": "application/json",
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({ name: `csrf-${Date.now()}` }),
    }));
    expect(res.status).toBe(403);
  });

  it("allows a same-origin write", async () => {
    const id = await sessionId();
    const res = await app.handle(new Request(`${BASE}/tags`, {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE}=${id}`,
        "Content-Type": "application/json",
        Origin: ORIGIN,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ name: `same-origin-${Date.now()}-${Math.random().toString(36).slice(2)}` }),
    }));
    expect(res.status).toBe(201);
  });

  it("still accepts Bearer auth without an Origin header", async () => {
    const res = await app.handle(new Request(`${BASE}/tags`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `bearer-${Date.now()}-${Math.random().toString(36).slice(2)}` }),
    }));
    expect(res.status).toBe(201);
  });

  it("rejects a wrong Bearer token even with a valid session cookie", async () => {
    const id = await sessionId();
    const res = await app.handle(new Request(`${BASE}/tags`, {
      headers: { Authorization: "Bearer nope", Cookie: `${SESSION_COOKIE}=${id}` },
    }));
    expect(res.status).toBe(401);
  });
});

describe("DELETE /session (logout)", () => {
  it("ends the session and clears the cookie", async () => {
    const id = await sessionId();
    const out = await app.handle(new Request(`${BASE}/session`, {
      method: "DELETE",
      headers: { Cookie: `${SESSION_COOKIE}=${id}`, Origin: ORIGIN },
    }));
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie") ?? "").toContain("Max-Age=0");

    const after = await app.handle(new Request(`${BASE}/tags`, {
      headers: { Cookie: `${SESSION_COOKIE}=${id}` },
    }));
    expect(after.status).toBe(401);

    const page = await app.handle(new Request(`${BASE}/app`, {
      headers: { Cookie: `${SESSION_COOKIE}=${id}` },
    }));
    expect(await page.text()).toContain('id="login-form"');
  });

  it("refuses a cross-origin logout", async () => {
    const id = await sessionId();
    const res = await app.handle(new Request(`${BASE}/session`, {
      method: "DELETE",
      headers: { Cookie: `${SESSION_COOKIE}=${id}`, Origin: "https://evil.example" },
    }));
    expect(res.status).toBe(403);
  });
});

describe("UI assets and CSP", () => {
  it("serves whitelisted assets with the right type", async () => {
    const js = await app.handle(new Request(`${BASE}/ui/common.js`));
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    expect(js.headers.get("x-content-type-options")).toBe("nosniff");
    const css = await app.handle(new Request(`${BASE}/ui/app.css`));
    expect(css.headers.get("content-type")).toContain("text/css");
  });

  it("404s for anything else under /ui/", async () => {
    for (const file of ["app.html", "..%2Fserver.ts", "nope.js"]) {
      const res = await app.handle(new Request(`${BASE}/ui/${file}`));
      expect(res.status).toBe(404);
    }
  });

  it("sends a CSP without unsafe-inline, and pages have no inline handlers or styles", async () => {
    const id = await sessionId();
    for (const path of ["/app", "/manage-categories", "/manage-tags"]) {
      const res = await app.handle(new Request(`${BASE}${path}`, {
        headers: { Cookie: `${SESSION_COOKIE}=${id}` },
      }));
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain("unsafe-inline");
      const html = await res.text();
      expect(html).not.toMatch(/\son[a-z]+\s*=/i);
      expect(html).not.toMatch(/\sstyle\s*=/i);
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
      expect(html).not.toMatch(/<style[\s>]/i);
    }
  });

  it("page scripts build no inline handlers", async () => {
    for (const file of ["app.js", "categories.js", "tags.js", "common.js", "login.js"]) {
      const res = await app.handle(new Request(`${BASE}/ui/${file}`));
      const js = await res.text();
      expect(js).not.toMatch(/\son(click|change|input|keydown|keyup|submit|error|load)\s*=\s*\\?["']/i);
    }
  });
});
