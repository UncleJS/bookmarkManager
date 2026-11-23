import { createHash, randomBytes, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// Auth helpers shared by the global guard, the session routes and /backup.
//
// Model:
//   - API clients (the extension, scripts) send `Authorization: Bearer <API_TOKEN>`.
//   - Browser pages never see the token after login. The user pastes it once into
//     the login form, POST /session checks it and sets `bm_session=<random id>`.
//     The id is kept server-side (in memory, hashed) and is never the token.
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "bm_session";
const PLACEHOLDER_TOKEN = "change_me_please";
const MAX_SESSIONS = 1000;

/** Constant-time string comparison. Hashing first makes the lengths equal. */
export function safeEqual(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** The configured API token, or null when unset or still the placeholder. */
export function configuredApiToken(): string | null {
  const token = process.env.API_TOKEN ?? "";
  return token && token !== PLACEHOLDER_TOKEN ? token : null;
}

export function bearerToken(authorization: string | undefined): string | null {
  const match = (authorization ?? "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export function readCookie(header: string | undefined, name: string): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      return "";
    }
  }
  return "";
}

// --- server-side session store ---------------------------------------------

function sessionTtlMs(): number {
  const hours = Number(process.env.SESSION_TTL_HOURS ?? 168);
  return (Number.isFinite(hours) && hours > 0 ? hours : 168) * 3600 * 1000;
}

// Keyed by sha256(session id) so the raw id is never kept in memory.
const sessions = new Map<string, number>();

function hashId(id: string): string {
  return createHash("sha256").update(id, "utf8").digest("hex");
}

function pruneSessions(now: number) {
  for (const [key, expires] of sessions) {
    if (expires <= now) sessions.delete(key);
  }
  // Drop the oldest entries if the store is still too large.
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

export function createSession(): { id: string; maxAgeSeconds: number } {
  const now = Date.now();
  pruneSessions(now);
  const id = randomBytes(32).toString("base64url");
  const ttl = sessionTtlMs();
  sessions.set(hashId(id), now + ttl);
  return { id, maxAgeSeconds: Math.floor(ttl / 1000) };
}

export function isValidSession(id: string): boolean {
  if (!id) return false;
  const key = hashId(id);
  const expires = sessions.get(key);
  if (expires === undefined) return false;
  if (expires <= Date.now()) {
    sessions.delete(key);
    return false;
  }
  return true;
}

export function destroySession(id: string) {
  if (id) sessions.delete(hashId(id));
}

/** Test hook: forget every session. */
export function clearSessions() {
  sessions.clear();
}

export function sessionFromCookieHeader(cookieHeader: string | undefined): string {
  return readCookie(cookieHeader, SESSION_COOKIE);
}

// --- cookies -----------------------------------------------------------------

/** Secure is added when the request came in over https (directly or via a proxy). */
export function isHttpsRequest(request: Request): boolean {
  const mode = (process.env.COOKIE_SECURE ?? "auto").toLowerCase();
  if (mode === "true") return true;
  if (mode === "false") return false;
  try {
    if (new URL(request.url).protocol === "https:") return true;
  } catch {
    // fall through
  }
  return (request.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase() === "https";
}

export function sessionCookie(id: string, maxAgeSeconds: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
}

// --- CSRF: origin check for cookie-authenticated writes ----------------------

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

function allowedOrigins(): Set<string> {
  return new Set(
    (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  );
}

/**
 * True when a state-changing request carrying the session cookie comes from
 * this app's own pages. Browsers send `Sec-Fetch-Site` and `Origin` on
 * fetch() POST/PATCH/DELETE; a missing Origin is rejected.
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;

  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  if (allowedOrigins().has(origin.replace(/\/+$/, ""))) return true;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = request.headers.get("host") ?? (() => {
    try {
      return new URL(request.url).host;
    } catch {
      return "";
    }
  })();
  return originHost !== "" && originHost === host;
}
