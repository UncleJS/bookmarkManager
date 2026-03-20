// =============================================================================
// Full end-to-end smoke test — hits the live API at http://localhost:API_PORT
// Requires: API running, API_TOKEN and BACKUP_TOKEN set in environment.
// Usage: bun run src/smoke/full.ts
// =============================================================================

const PORT = process.env.API_PORT ?? "11650";
const BASE = `http://localhost:${PORT}`;
const API_TOKEN = process.env.API_TOKEN ?? "";
const BACKUP_TOKEN = process.env.BACKUP_TOKEN ?? "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function pass(label: string) {
  console.log(`  ✓  ${label}`);
  passed++;
}

function fail(label: string, detail: string) {
  console.error(`  ✗  ${label}`);
  console.error(`       ${detail}`);
  failed++;
  failures.push(`${label}: ${detail}`);
}

async function req(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {}
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token !== undefined) headers["Authorization"] = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let body: unknown;
  const ct = res.headers.get("content-type") ?? "";
  try {
    body = ct.includes("application/json") ? await res.json() : await res.text();
  } catch {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}

function check(label: string, actual: number, expected: number, body?: unknown) {
  if (actual === expected) {
    pass(label);
  } else {
    fail(label, `expected HTTP ${expected}, got ${actual} — body: ${JSON.stringify(body)}`);
  }
}

function checkField(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass(label);
  } else {
    fail(label, `expected ${e}, got ${a}`);
  }
}

function section(title: string) {
  console.log(`\n── ${title}`);
}

// ---------------------------------------------------------------------------
// Pre-flight: verify token is configured
// ---------------------------------------------------------------------------

if (!API_TOKEN || API_TOKEN === "change_me_please") {
  console.error("FATAL: API_TOKEN is not set or is the default placeholder. Set it in api/.env.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log(`\nBookmark Manager — Full Smoke Test`);
console.log(`Target: ${BASE}\n`);

// ── 1. Health ────────────────────────────────────────────────────────────────
section("Health");

{
  const r = await req("GET", "/health");
  check("/health → 200", r.status, 200, r.body);
  checkField("/health body.status", (r.body as any)?.status, "ok");
  checkField("/health body.check", (r.body as any)?.check, "liveness");
}

{
  const r = await req("GET", "/ready");
  check("/ready → 200", r.status, 200, r.body);
  checkField("/ready body.status", (r.body as any)?.status, "ok");
  checkField("/ready body.check", (r.body as any)?.check, "readiness");
}

// ── 2. UI pages ──────────────────────────────────────────────────────────────
section("UI Pages");

{
  const r = await req("GET", "/app");
  check("GET /app → 200", r.status, 200, r.body);
}

{
  const r = await req("GET", "/manage-categories");
  check("GET /manage-categories → 200", r.status, 200, r.body);
}

{
  const r = await req("GET", "/docs");
  check("GET /docs → 200", r.status, 200, r.body);
}

{
  const r = await req("GET", "/openapi.json");
  // /openapi.json redirects to /docs/json; fetch follows redirects
  if (r.status === 200 || r.status === 301) {
    pass("GET /openapi.json → 200/301");
  } else {
    fail("GET /openapi.json → 200/301", `got ${r.status}`);
  }
}

// ── 3. Auth enforcement ───────────────────────────────────────────────────────
section("Auth Enforcement");

{
  const r = await req("GET", "/bookmarks"); // no token
  check("GET /bookmarks (no token) → 401", r.status, 401, r.body);
}

{
  const r = await req("GET", "/bookmarks", { token: "wrong-token" });
  check("GET /bookmarks (wrong token) → 401", r.status, 401, r.body);
}

// ── 4. Categories ──────────────────────────────────────────────────
section("Categories");

let categoryId: number;

{
  const r = await req("POST", "/categories", {
    token: API_TOKEN,
    body: { name: "Smoke Test Category" },
  });
  check("POST /categories → 201", r.status, 201, r.body);
  categoryId = (r.body as any)?.id;
  if (!categoryId) fail("category id in response", `got: ${JSON.stringify(r.body)}`);
  else pass("category id returned");
}

{
  // GET /categories returns { items: [...] }
  const r = await req("GET", "/categories", { token: API_TOKEN });
  check("GET /categories → 200", r.status, 200, r.body);
  const items = (r.body as any)?.items;
  const found = Array.isArray(items) && items.some((g: any) => g.id === categoryId);
  found ? pass("new category present in list") : fail("new category present in list", `id ${categoryId} not in items`);
}

{
  const r = await req("PATCH", `/categories/${categoryId}`, {
    token: API_TOKEN,
    body: { name: "Smoke Test Category (renamed)" },
  });
  check(`PATCH /categories/${categoryId} (rename) → 200`, r.status, 200, r.body);
}

{
  const r = await req("PATCH", `/categories/${categoryId}/reorder`, {
    token: API_TOKEN,
    body: { order: 99 },
  });
  check(`PATCH /categories/${categoryId}/reorder → 200`, r.status, 200, r.body);
}

// ── 5. Sub-categories ────────────────────────────────────────────────────────
section("Sub-categories");

let subcategoryId: number;

{
  const r = await req("POST", "/subcategories", {
    token: API_TOKEN,
    body: { name: "Smoke Test Sub-category", categoryId },
  });
  check("POST /subcategories → 201", r.status, 201, r.body);
  subcategoryId = (r.body as any)?.id;
  if (!subcategoryId) fail("sub-category id in response", `got: ${JSON.stringify(r.body)}`);
  else pass("sub-category id returned");
}

{
  // GET /subcategories returns { categories: [...] } — each category has subcategories[]
  const r = await req("GET", "/subcategories", { token: API_TOKEN });
  check("GET /subcategories → 200", r.status, 200, r.body);
  const categories = (r.body as any)?.categories;
  const found =
    Array.isArray(categories) &&
    categories.some((g: any) =>
      Array.isArray(g.subcategories) && g.subcategories.some((c: any) => c.id === subcategoryId)
    );
  found
    ? pass("new sub-category present in list")
    : fail("new sub-category present in list", `id ${subcategoryId} not found in any category`);
}

{
  const r = await req("PATCH", `/subcategories/${subcategoryId}`, {
    token: API_TOKEN,
    body: { name: "Smoke Test Sub-category (renamed)" },
  });
  check(`PATCH /subcategories/${subcategoryId} (rename) → 200`, r.status, 200, r.body);
}

{
  const r = await req("PATCH", `/subcategories/${subcategoryId}/reorder`, {
    token: API_TOKEN,
    body: { order: 99 },
  });
  check(`PATCH /subcategories/${subcategoryId}/reorder → 200`, r.status, 200, r.body);
}

// ── 6. Tags ───────────────────────────────────────────────────────────────────
section("Tags");

let tagId: number;
const tagName = `smoke-tag-${Date.now()}`;

{
  const r = await req("POST", "/tags", {
    token: API_TOKEN,
    body: { name: tagName },
  });
  check("POST /tags → 201", r.status, 201, r.body);
  tagId = (r.body as any)?.id;
  if (!tagId) fail("tag id in response", `got: ${JSON.stringify(r.body)}`);
  else pass("tag id returned");
}

{
  // GET /tags returns { items: [...], total: N } — default sort by count, limit 20
  // Use exact search to reliably find our new tag
  const r = await req("GET", `/tags?exact=true&query=${encodeURIComponent(tagName)}`, { token: API_TOKEN });
  check("GET /tags?exact=true → 200", r.status, 200, r.body);
  const items = (r.body as any)?.items ?? [];
  const found = Array.isArray(items) && items.some((t: any) => t.id === tagId);
  found ? pass("exact tag match found") : fail("exact tag match found", `id ${tagId} not in: ${JSON.stringify(items)}`);
}

{
  // Verify general list also contains the tag (use limit=100 to avoid pagination miss)
  const r = await req("GET", "/tags?limit=100", { token: API_TOKEN });
  check("GET /tags → 200", r.status, 200, r.body);
  const items = (r.body as any)?.items ?? [];
  const found = Array.isArray(items) && items.some((t: any) => t.id === tagId);
  found ? pass("new tag present in full list") : fail("new tag present in full list", `id ${tagId} not found`);
}

// ── 7. Bookmarks ──────────────────────────────────────────────────────────────
section("Bookmarks — Create");

let bookmarkId: number;
const bookmarkUrl = `https://smoke-test.example.com/${Date.now()}`;
const bookmarkTitle = "Smoke Test Bookmark";

{
  const r = await req("POST", "/bookmarks", {
    token: API_TOKEN,
    body: { url: bookmarkUrl, title: bookmarkTitle },
  });
  check("POST /bookmarks → 201", r.status, 201, r.body);
  bookmarkId = (r.body as any)?.id;
  if (!bookmarkId) fail("bookmark id in response", `got: ${JSON.stringify(r.body)}`);
  else pass("bookmark id returned");
}

{
  // Same active URL → 409
  const r = await req("POST", "/bookmarks", {
    token: API_TOKEN,
    body: { url: bookmarkUrl, title: bookmarkTitle },
  });
  check("POST /bookmarks (duplicate URL) → 409", r.status, 409, r.body);
}

{
  // allowDuplicate:true bypasses the preflight check but DB constraint still applies
  // to truly active duplicates — so we use a different URL to test allowDuplicate path
  const dupUrl = `${bookmarkUrl}-allow-dup`;
  // First create normally
  await req("POST", "/bookmarks", { token: API_TOKEN, body: { url: dupUrl, title: "Dup A" } });
  // Then archive so it's no longer active
  const firstRes = await req("GET", `/bookmarks?q=${encodeURIComponent("Dup A")}`, { token: API_TOKEN });
  const firstId = ((firstRes.body as any)?.items ?? []).find((b: any) => b.url === dupUrl)?.id;
  if (firstId) await req("PATCH", `/bookmarks/${firstId}/archive`, { token: API_TOKEN });
  // Now allowDuplicate:true should let us re-create it (archived URL is no longer active)
  const r = await req("POST", "/bookmarks", {
    token: API_TOKEN,
    body: { url: dupUrl, title: "Dup B", allowDuplicate: true },
  });
  check("POST /bookmarks (allowDuplicate:true on archived URL) → 201", r.status, 201, r.body);
  // Clean up
  const dupBId = (r.body as any)?.id;
  if (dupBId) await req("PATCH", `/bookmarks/${dupBId}/archive`, { token: API_TOKEN });
}

// ── 8. Bookmarks — Read & Filter ──────────────────────────────────────────────
section("Bookmarks — Read & Filter");

{
  // GET /bookmarks returns { items: [...], total: N }
  // Use limit=100 to ensure our bookmark is on the first page
  const r = await req("GET", "/bookmarks?limit=100", { token: API_TOKEN });
  check("GET /bookmarks → 200", r.status, 200, r.body);
  const items = (r.body as any)?.items ?? [];
  const found = Array.isArray(items) && items.some((b: any) => b.id === bookmarkId);
  found ? pass("new bookmark present in list") : fail("new bookmark present in list", `id ${bookmarkId} not found, total=${((r.body as any)?.total)}`);
}

{
  const r = await req("GET", `/bookmarks?q=${encodeURIComponent("Smoke Test")}`, { token: API_TOKEN });
  check("GET /bookmarks?q= → 200", r.status, 200, r.body);
  const items = (r.body as any)?.items ?? [];
  const found = Array.isArray(items) && items.some((b: any) => b.id === bookmarkId);
  found ? pass("search by title found bookmark") : fail("search by title found bookmark", `id ${bookmarkId} not in results`);
}

// ── 9. Bookmarks — Edit (flags, tag, sub-category) ─────────────────────────
section("Bookmarks — Edit");

{
  // PATCH /bookmarks/:id returns { ok: true } — read back the bookmark separately
  const r = await req("PATCH", `/bookmarks/${bookmarkId}`, {
    token: API_TOKEN,
    body: {
      title: "Smoke Test Bookmark (edited)",
      flags: { readLater: true },
      tagIds: [tagId],
      subcategoryIds: [subcategoryId],
    },
  });
  check(`PATCH /bookmarks/${bookmarkId} (edit title+flags+tag+class) → 200`, r.status, 200, r.body);
  checkField("PATCH response is {ok:true}", (r.body as any)?.ok, true);
}

{
  // Read back the bookmark to verify the edit applied
  const r = await req("GET", `/bookmarks?q=${encodeURIComponent("Smoke Test Bookmark (edited)")}`, { token: API_TOKEN });
  const items = (r.body as any)?.items ?? [];
  const b = items.find((x: any) => x.id === bookmarkId);
  if (!b) {
    fail("edited bookmark readable after PATCH", `id ${bookmarkId} not found in search results`);
  } else {
    pass("edited bookmark readable after PATCH");
    b.readLater === 1 ? pass("readLater flag set") : fail("readLater flag set", `readLater=${b.readLater}`);
    const hasTag = Array.isArray(b.tags) && b.tags.some((t: any) => t.id === tagId);
    hasTag ? pass("tag attached to bookmark") : fail("tag attached to bookmark", JSON.stringify(b.tags));
    const hasClass = Array.isArray(b.subcategories) && b.subcategories.some((c: any) => c.id === subcategoryId);
    hasClass ? pass("sub-category attached to bookmark") : fail("sub-category attached to bookmark", JSON.stringify(b.subcategories));
  }
}

{
  const r = await req("GET", `/bookmarks?tagId=${tagId}`, { token: API_TOKEN });
  check("GET /bookmarks?tagId= → 200", r.status, 200, r.body);
  const items = (r.body as any)?.items ?? [];
  const found = Array.isArray(items) && items.some((b: any) => b.id === bookmarkId);
  found ? pass("filter by tagId finds bookmark") : fail("filter by tagId finds bookmark", `id ${bookmarkId} not found`);
}

{
  const r = await req("GET", `/bookmarks?subcategoryId=${subcategoryId}`, { token: API_TOKEN });
  check("GET /bookmarks?subcategoryId= → 200", r.status, 200, r.body);
  const items = (r.body as any)?.items ?? [];
  const found = Array.isArray(items) && items.some((b: any) => b.id === bookmarkId);
  found ? pass("filter by subcategoryId finds bookmark") : fail("filter by subcategoryId finds bookmark", `id ${bookmarkId} not found`);
}

{
  const r = await req("GET", "/bookmarks?flag=readLater", { token: API_TOKEN });
  check("GET /bookmarks?flag=readLater → 200", r.status, 200, r.body);
  const items = (r.body as any)?.items ?? [];
  const found = Array.isArray(items) && items.some((b: any) => b.id === bookmarkId);
  found ? pass("filter by flag=readLater finds bookmark") : fail("filter by flag=readLater finds bookmark", `id ${bookmarkId} not found`);
}

// ── 10. Flag Counts ───────────────────────────────────────────────────────────
section("Flag Counts");

{
  const r = await req("GET", "/flag-counts", { token: API_TOKEN });
  check("GET /flag-counts → 200", r.status, 200, r.body);
  const counts = r.body as any;
  const valid =
    typeof counts?.readLater === "number" &&
    typeof counts?.hotTopic === "number" &&
    typeof counts?.cheatsheets === "number" &&
    typeof counts?.forReview === "number";
  valid ? pass("flag-counts has numeric fields") : fail("flag-counts has numeric fields", JSON.stringify(counts));
  counts?.readLater >= 1 ? pass("readLater count ≥ 1") : fail("readLater count ≥ 1", `readLater=${counts?.readLater}`);
}

// ── 11. Bookmarks — Archive & Restore ────────────────────────────────────────
section("Bookmarks — Archive & Restore");

{
  // Detach tag and sub-category before archive/restore cycle (so they can be archived later)
  await req("PATCH", `/bookmarks/${bookmarkId}`, {
    token: API_TOKEN,
    body: { tagIds: [], subcategoryIds: [] },
  });

  const r = await req("PATCH", `/bookmarks/${bookmarkId}/archive`, { token: API_TOKEN });
  check(`PATCH /bookmarks/${bookmarkId}/archive → 200`, r.status, 200, r.body);
}

{
  // Default list (active only) — bookmark must be absent
  const r = await req("GET", `/bookmarks?limit=100`, { token: API_TOKEN });
  check("GET /bookmarks (active) → 200", r.status, 200, r.body);
  const items = (r.body as any)?.items ?? [];
  const absent = !items.some((b: any) => b.id === bookmarkId);
  absent ? pass("archived bookmark absent from active list") : fail("archived bookmark absent from active list", "still present");
}

{
  // Archived list — bookmark must be present
  const r = await req("GET", "/bookmarks?archived=true", { token: API_TOKEN });
  check("GET /bookmarks?archived=true → 200", r.status, 200, r.body);
  const items = (r.body as any)?.items ?? [];
  const found = items.some((b: any) => b.id === bookmarkId);
  found ? pass("archived bookmark present in archived list") : fail("archived bookmark present in archived list", `id ${bookmarkId} not found`);
}

{
  const r = await req("PATCH", `/bookmarks/${bookmarkId}/restore`, { token: API_TOKEN });
  check(`PATCH /bookmarks/${bookmarkId}/restore → 200`, r.status, 200, r.body);
}

{
  const r = await req("GET", "/bookmarks?limit=100", { token: API_TOKEN });
  const items = (r.body as any)?.items ?? [];
  const found = items.some((b: any) => b.id === bookmarkId);
  found ? pass("restored bookmark back in active list") : fail("restored bookmark back in active list", `id ${bookmarkId} not found`);
}

// ── 12. Tags — Archive & Restore ─────────────────────────────────────────────
section("Tags — Archive & Restore");

{
  const r = await req("PATCH", `/tags/${tagId}/archive`, { token: API_TOKEN });
  check(`PATCH /tags/${tagId}/archive → 200`, r.status, 200, r.body);
}

{
  const r = await req("PATCH", `/tags/${tagId}/restore`, { token: API_TOKEN });
  check(`PATCH /tags/${tagId}/restore → 200`, r.status, 200, r.body);
}

// ── 13. Sub-categories — Archive & Restore ───────────────────────────────────
section("Sub-categories — Archive & Restore");

{
  // No active bookmarks linked — should archive cleanly
  const r = await req("PATCH", `/subcategories/${subcategoryId}/archive`, { token: API_TOKEN });
  check(`PATCH /subcategories/${subcategoryId}/archive → 200`, r.status, 200, r.body);
}

{
  const r = await req("PATCH", `/subcategories/${subcategoryId}/restore`, { token: API_TOKEN });
  check(`PATCH /subcategories/${subcategoryId}/restore → 200`, r.status, 200, r.body);
}

// ── 14. Categories — Archive & Restore ────────────────────────────────────────
section("Categories — Archive & Restore");

{
  // Archive sub-category first so category can be archived (no active subcategories with active bookmarks)
  await req("PATCH", `/subcategories/${subcategoryId}/archive`, { token: API_TOKEN });

  const r = await req("PATCH", `/categories/${categoryId}/archive`, { token: API_TOKEN });
  check(`PATCH /categories/${categoryId}/archive → 200`, r.status, 200, r.body);
}

{
  const r = await req("PATCH", `/categories/${categoryId}/restore`, { token: API_TOKEN });
  check(`PATCH /categories/${categoryId}/restore → 200`, r.status, 200, r.body);
}

// ── 15. Backup ────────────────────────────────────────────────────────────────
section("Backup");

{
  // No token at all → 401
  const r = await req("GET", "/backup");
  check("GET /backup (no token) → 401", r.status, 401, r.body);
}

{
  // Wrong token → 401
  const r = await req("GET", "/backup", { token: "wrong-backup-token" });
  check("GET /backup (wrong token) → 401", r.status, 401, r.body);
}

if (BACKUP_TOKEN && BACKUP_TOKEN !== "change_me_please") {
  const res = await fetch(`${BASE}/backup`, {
    headers: { Authorization: `Bearer ${BACKUP_TOKEN}` },
  });
  check("GET /backup (correct token) → 200", res.status, 200);
  if (res.status === 200) {
    const ct = res.headers.get("content-type") ?? "";
    ct.includes("application/gzip")
      ? pass("backup content-type: application/gzip")
      : fail("backup content-type: application/gzip", `got: ${ct}`);
    const cd = res.headers.get("content-disposition") ?? "";
    /^attachment; filename="bookmark_.+\.sql\.gz"$/.test(cd)
      ? pass("backup content-disposition filename matches pattern")
      : fail("backup content-disposition filename matches pattern", `got: ${cd}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    bytes.byteLength > 0
      ? pass("backup response body is non-empty")
      : fail("backup response body is non-empty", "0 bytes");
  }
} else {
  console.log("  –  BACKUP_TOKEN not configured; skipping live backup download");
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`${"─".repeat(50)}`);

if (failed > 0) {
  console.error("\nFailed checks:");
  for (const f of failures) console.error(`  • ${f}`);
  console.error("");
  process.exit(1);
} else {
  console.log("\n  All checks passed.\n");
}
