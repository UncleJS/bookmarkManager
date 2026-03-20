/**
 * API smoke tests — no extension, no browser UI.
 *
 * These tests use Playwright's `page.request` (or `request.newContext()`)
 * to exercise the REST API directly. They serve as a fast pre-flight check
 * before the heavier extension tests run.
 *
 * Prerequisites:
 *   - API running at http://localhost:11650 (or API_BASE_URL env var)
 *   - API_TOKEN env var set to the configured token
 */
import { test, expect } from "@playwright/test";

const BASE = process.env.API_BASE_URL ?? "http://localhost:11650";
const TOKEN = process.env.API_TOKEN ?? "";

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  return headers;
}

// ── Health ──────────────────────────────────────────────────────────────────

test.describe("Health endpoints", () => {
  test("GET /health returns {status:ok}", async ({ request }) => {
    const res = await request.get(`${BASE}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("GET /ready returns {status:ok}", async ({ request }) => {
    const res = await request.get(`${BASE}/ready`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});

// ── Auth guard ───────────────────────────────────────────────────────────────

test.describe("Auth guard", () => {
  test("GET /bookmarks without token returns 401", async ({ request }) => {
    const res = await request.get(`${BASE}/bookmarks`);
    expect(res.status()).toBe(401);
  });

  test("GET /bookmarks with wrong token returns 401", async ({ request }) => {
    const res = await request.get(`${BASE}/bookmarks`, {
      headers: { Authorization: "Bearer wrong-token-value" },
    });
    expect(res.status()).toBe(401);
  });
});

// ── Bookmarks CRUD ───────────────────────────────────────────────────────────

test.describe("Bookmarks CRUD", () => {
  test.skip(!TOKEN, "Skipped — API_TOKEN env var not set");

  let createdId: number;
  const testUrl = `https://e2e-test.example.com/${Date.now()}`;

  test("POST /bookmarks creates a bookmark", async ({ request }) => {
    const res = await request.post(`${BASE}/bookmarks`, {
      headers: authHeaders(),
      data: {
        url: testUrl,
        title: "E2E Test Bookmark",
        description: "Created by Playwright E2E test",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.url).toBe(testUrl);
    createdId = body.id;
  });

  test("POST /bookmarks same URL returns 409 duplicate", async ({ request }) => {
    const res = await request.post(`${BASE}/bookmarks`, {
      headers: authHeaders(),
      data: { url: testUrl, title: "Duplicate" },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(Array.isArray(body.duplicates)).toBe(true);
    expect(body.duplicates.length).toBeGreaterThan(0);
  });

  test("GET /bookmarks returns the created bookmark", async ({ request }) => {
    const res = await request.get(`${BASE}/bookmarks`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    const found = body.items.find(
      (b: { url: string }) => b.url === testUrl
    );
    expect(found).toBeDefined();
  });

  test("PATCH /bookmarks/:id updates title", async ({ request }) => {
    const res = await request.patch(`${BASE}/bookmarks/${createdId}`, {
      headers: authHeaders(),
      data: { title: "E2E Test Bookmark — Updated" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("PATCH /bookmarks/:id/archive soft-deletes bookmark", async ({ request }) => {
    const res = await request.patch(
      `${BASE}/bookmarks/${createdId}/archive`,
      { headers: authHeaders() }
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("PATCH /bookmarks/:id/restore un-archives bookmark", async ({ request }) => {
    const res = await request.patch(
      `${BASE}/bookmarks/${createdId}/restore`,
      { headers: authHeaders() }
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("Archive again then confirm it is in archived list", async ({
    request,
  }) => {
    await request.patch(`${BASE}/bookmarks/${createdId}/archive`, {
      headers: authHeaders(),
    });
    const res = await request.get(`${BASE}/bookmarks?archived=true`, {
      headers: authHeaders(),
    });
    const body = await res.json();
    const found = body.items.find(
      (b: { id: number }) => b.id === createdId
    );
    expect(found).toBeDefined();
  });
});

// ── Tags ─────────────────────────────────────────────────────────────────────

test.describe("Tags", () => {
  test.skip(!TOKEN, "Skipped — API_TOKEN env var not set");

  let tagId: number;
  const tagName = `e2e-tag-${Date.now()}`;

  test("POST /tags creates a tag", async ({ request }) => {
    const res = await request.post(`${BASE}/tags`, {
      headers: authHeaders(),
      data: { name: tagName },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.id).toBeGreaterThan(0);
    tagId = body.id;
  });

  test("GET /tags?query= returns the new tag", async ({ request }) => {
    const res = await request.get(
      `${BASE}/tags?query=${encodeURIComponent(tagName)}`,
      { headers: authHeaders() }
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    const found = body.items.find(
      (t: { name: string }) => t.name === tagName
    );
    expect(found).toBeDefined();
  });

  test("PATCH /tags/:id/archive soft-deletes tag", async ({ request }) => {
    const res = await request.patch(`${BASE}/tags/${tagId}/archive`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });

  test("PATCH /tags/:id/restore restores tag", async ({ request }) => {
    const res = await request.patch(`${BASE}/tags/${tagId}/restore`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });
});

// ── Categories & Sub-categories ───────────────────────────────────────────────

test.describe("Categories and Subcategories", () => {
  test.skip(!TOKEN, "Skipped — API_TOKEN env var not set");

  let categoryId: number;
  let subcategoryId: number;
  const catName = `e2e-cat-${Date.now()}`;
  const subName = `e2e-sub-${Date.now()}`;

  test("POST /categories creates a category", async ({ request }) => {
    const res = await request.post(`${BASE}/categories`, {
      headers: authHeaders(),
      data: { name: catName, description: "E2E test category" },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    categoryId = body.id;
    expect(categoryId).toBeGreaterThan(0);
  });

  test("POST /subcategories creates a sub-category", async ({ request }) => {
    const res = await request.post(`${BASE}/subcategories`, {
      headers: authHeaders(),
      data: { name: subName, categoryId },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    subcategoryId = body.id;
    expect(subcategoryId).toBeGreaterThan(0);
  });

  test("GET /subcategories returns new sub-category nested under category", async ({
    request,
  }) => {
    const res = await request.get(`${BASE}/subcategories`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const cat = (body.categories as Array<{ id: number; subcategories: Array<{ id: number }> }>)
      .find((c) => c.id === categoryId);
    expect(cat).toBeDefined();
    const sub = cat?.subcategories.find((s) => s.id === subcategoryId);
    expect(sub).toBeDefined();
  });

  test("PATCH /subcategories/:id archives sub-category", async ({ request }) => {
    const res = await request.patch(
      `${BASE}/subcategories/${subcategoryId}/archive`,
      { headers: authHeaders() }
    );
    expect(res.status()).toBe(200);
  });

  test("PATCH /categories/:id archives category", async ({ request }) => {
    const res = await request.patch(
      `${BASE}/categories/${categoryId}/archive`,
      { headers: authHeaders() }
    );
    expect(res.status()).toBe(200);
  });
});

// ── Flag counts ───────────────────────────────────────────────────────────────

test.describe("Flag counts", () => {
  test.skip(!TOKEN, "Skipped — API_TOKEN env var not set");

  test("GET /flag-counts returns numeric counts", async ({ request }) => {
    const res = await request.get(`${BASE}/flag-counts`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.readLater).toBe("number");
    expect(typeof body.hotTopic).toBe("number");
    expect(typeof body.cheatsheets).toBe("number");
    expect(typeof body.forReview).toBe("number");
  });
});
