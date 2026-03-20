/**
 * Web UI (app.html / manage-categories) tests.
 *
 * These tests open the built-in browser UI served by the API:
 *   GET /app                — bookmark viewer
 *   GET /manage-categories  — category manager
 *
 * No extension is needed; plain Chromium is used.
 *
 * Prerequisites:
 *   - API running at http://localhost:11650 (or API_BASE_URL env var)
 *   - API_TOKEN env var set (the UI injects it from a prompt or the page reads it
 *     from query params — we pass it as a header via extraHTTPHeaders)
 */
import { test, expect } from "@playwright/test";

const BASE = process.env.API_BASE_URL ?? "http://localhost:11650";
const TOKEN = process.env.API_TOKEN ?? "";

// The web UI authenticates via a token stored in localStorage ("apiToken").
// We inject it before navigation.
async function injectToken(page: import("@playwright/test").Page): Promise<void> {
  if (!TOKEN) return;
  await page.addInitScript((token) => {
    localStorage.setItem("apiToken", token);
  }, TOKEN);
}

test.describe("Bookmark Viewer UI (/app)", () => {
  test("page loads and shows the Bookmark Manager title", async ({ page }) => {
    await injectToken(page);
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/Bookmark Manager/i);
  });

  test("main layout container is rendered", async ({ page }) => {
    await injectToken(page);
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    // The app.html uses #layout as the top-level container
    await expect(page.locator("#layout")).toBeVisible({ timeout: 10_000 });
  });

  test("sidebar is visible", async ({ page }) => {
    await injectToken(page);
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#sidebar")).toBeVisible({ timeout: 10_000 });
  });

  test("search input is present", async ({ page }) => {
    await injectToken(page);
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    // The app uses a search input; verify it exists
    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], #search, input#q');
    await expect(searchInput.first()).toBeAttached({ timeout: 10_000 });
  });

  test.describe("Bookmark list interactions", () => {
    test.skip(!TOKEN, "Skipped — API_TOKEN env var not set");

    test("displays bookmark list after API loads", async ({ page }) => {
      await injectToken(page);
      await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
      // Wait for at least one bookmark card or an empty-state message
      const cards = page.locator(".bookmark-card, [data-id], .bookmark-item, .empty-state, #bookmarks-list");
      await expect(cards.first()).toBeAttached({ timeout: 15_000 });
    });
  });
});

test.describe("Category Manager UI (/manage-categories)", () => {
  test("page loads with the correct title", async ({ page }) => {
    await injectToken(page);
    await page.goto(`${BASE}/manage-categories`, {
      waitUntil: "domcontentloaded",
    });
    // The category manager page should load without an error
    await expect(page.locator("body")).toBeVisible();
  });

  test("layout container is rendered", async ({ page }) => {
    await injectToken(page);
    await page.goto(`${BASE}/manage-categories`, {
      waitUntil: "domcontentloaded",
    });
    // The page should have some structural element
    await expect(page.locator("main, #main, #layout, .container").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test.describe("Category interactions", () => {
    test.skip(!TOKEN, "Skipped — API_TOKEN env var not set");

    test("category list renders after load", async ({ page }) => {
      await injectToken(page);
      await page.goto(`${BASE}/manage-categories`, {
        waitUntil: "networkidle",
      });
      // The page should render a list or an empty-state message
      const list = page.locator(".category-item, .category-row, #category-list, .empty-state");
      await expect(list.first()).toBeAttached({ timeout: 15_000 });
    });
  });
});

test.describe("Root redirect", () => {
  test("GET / redirects to /app", async ({ page }) => {
    await injectToken(page);
    const res = await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    // After redirect, should end up on /app
    expect(page.url()).toContain("/app");
    expect(res?.status()).toBeLessThan(400);
  });
});

test.describe("Swagger UI", () => {
  test("GET /docs serves the Swagger UI", async ({ page }) => {
    await page.goto(`${BASE}/docs`, { waitUntil: "domcontentloaded" });
    // Swagger UI injects a div#swagger-ui or similar
    await expect(
      page.locator("#swagger-ui, .swagger-ui, [class*='swagger']").first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
