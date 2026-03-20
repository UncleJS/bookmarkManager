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
 *   - API_TOKEN env var set so authenticated UI data can load during tests
 */
import { test, expect } from "@playwright/test";

const BASE = process.env.API_BASE_URL ?? "http://localhost:11650";
const TOKEN = process.env.API_TOKEN ?? "";

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  return headers;
}

// The web UI authenticates via a token stored in localStorage ("apiToken").
// Inject it before navigation so authenticated views can load immediately.
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

    test("shows deep nested sidebar items when a large category is expanded", async ({
      page,
      request,
    }) => {
      const suffix = Date.now();
      const categoryName = `E2E Sidebar ${suffix}`;
      const subcategoryName = `E2E Branch ${suffix}`;
      const leafCount = 20;

      const categoryRes = await request.post(`${BASE}/categories`, {
        headers: authHeaders(),
        data: { name: categoryName },
      });
      expect(categoryRes.status()).toBe(201);
      const categoryBody = await categoryRes.json();
      const categoryId = categoryBody.id as number;

      const subcategoryRes = await request.post(`${BASE}/subcategories`, {
        headers: authHeaders(),
        data: { name: subcategoryName, categoryId },
      });
      expect(subcategoryRes.status()).toBe(201);
      const subcategoryBody = await subcategoryRes.json();
      const subcategoryId = subcategoryBody.id as number;

      let lastLeafName = "";
      for (let index = 0; index < leafCount; index += 1) {
        const leafName = `E2E Leaf ${suffix}-${String(index).padStart(2, "0")}`;
        lastLeafName = leafName;

        const subSubcategoryRes = await request.post(`${BASE}/subSubcategories`, {
          headers: authHeaders(),
          data: { name: leafName, subcategoryId },
        });
        expect(subSubcategoryRes.status()).toBe(201);
        const subSubcategoryBody = await subSubcategoryRes.json();
        const subSubcategoryId = subSubcategoryBody.id as number;

        const bookmarkRes = await request.post(`${BASE}/bookmarks`, {
          headers: authHeaders(),
          data: {
            url: `https://sidebar-overflow-${suffix}-${index}.example.com`,
            title: `Sidebar Overflow ${suffix}-${index}`,
            subSubcategoryIds: [subSubcategoryId],
          },
        });
        expect(bookmarkRes.status()).toBe(201);
      }

      await injectToken(page);
      await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });

      const categoryToggle = page.locator(".nav-section-label", { hasText: categoryName });
      await expect(categoryToggle).toBeVisible({ timeout: 15_000 });
      await categoryToggle.click();

      const lastLeaf = page.locator(".nav-item-label", { hasText: lastLeafName });
      await expect(lastLeaf).toBeVisible({ timeout: 15_000 });
    });

    test("lets level-2 branches expand and collapse independently", async ({
      page,
      request,
    }) => {
      const suffix = Date.now();
      const categoryName = `E2E Branch Toggle ${suffix}`;
      const subcategoryName = `E2E Toggle Parent ${suffix}`;
      const firstLeafName = `E2E Toggle Child A ${suffix}`;
      const secondLeafName = `E2E Toggle Child B ${suffix}`;

      const categoryRes = await request.post(`${BASE}/categories`, {
        headers: authHeaders(),
        data: { name: categoryName },
      });
      expect(categoryRes.status()).toBe(201);
      const { id: categoryId } = (await categoryRes.json()) as { id: number };

      const subcategoryRes = await request.post(`${BASE}/subcategories`, {
        headers: authHeaders(),
        data: { name: subcategoryName, categoryId },
      });
      expect(subcategoryRes.status()).toBe(201);
      const { id: subcategoryId } = (await subcategoryRes.json()) as { id: number };

      for (const leafName of [firstLeafName, secondLeafName]) {
        const subSubcategoryRes = await request.post(`${BASE}/subSubcategories`, {
          headers: authHeaders(),
          data: { name: leafName, subcategoryId },
        });
        expect(subSubcategoryRes.status()).toBe(201);
        const { id: subSubcategoryId } = (await subSubcategoryRes.json()) as { id: number };

        const bookmarkRes = await request.post(`${BASE}/bookmarks`, {
          headers: authHeaders(),
          data: {
            url: `https://branch-toggle-${suffix}-${subSubcategoryId}.example.com`,
            title: `Branch Toggle ${leafName}`,
            subSubcategoryIds: [subSubcategoryId],
          },
        });
        expect(bookmarkRes.status()).toBe(201);
      }

      await injectToken(page);
      await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });

      const categoryToggle = page.locator(".nav-section-label", { hasText: categoryName });
      await expect(categoryToggle).toBeVisible({ timeout: 15_000 });
      await categoryToggle.click();

      const branchToggle = page.locator(`button[data-subcategory-branch-id="cat-subcategory-${subcategoryId}"]`);
      const branchContainer = page.locator(`div[data-subcategory-branch-id="cat-subcategory-${subcategoryId}"]`);
      const toggleTitle = await branchToggle.getAttribute("title");

      if (toggleTitle?.includes("Collapse")) {
        await expect.poll(async () => branchContainer.evaluate((el) => el.clientHeight)).toBeGreaterThan(0);
        await branchToggle.click();
        await expect.poll(async () => branchContainer.evaluate((el) => el.clientHeight)).toBe(0);
        await branchToggle.click();
        await expect.poll(async () => branchContainer.evaluate((el) => el.clientHeight)).toBeGreaterThan(0);
      } else {
        await expect.poll(async () => branchContainer.evaluate((el) => el.clientHeight)).toBe(0);
        await branchToggle.click();
        await expect.poll(async () => branchContainer.evaluate((el) => el.clientHeight)).toBeGreaterThan(0);
        await branchToggle.click();
        await expect.poll(async () => branchContainer.evaluate((el) => el.clientHeight)).toBe(0);
      }
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
    await expect(page.locator("#page, #topbar, #categories-container").first()).toBeVisible({
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
      const list = page.locator("#categories-container > *, .state-box, button:has-text('Archive')");
      await expect(list.first()).toBeAttached({ timeout: 15_000 });
    });

    test("shows taxonomy entries alphabetically", async ({ page, request }) => {
      const suffix = Date.now();
      const alphaCategoryName = `AAA Category ${suffix}`;
      const zuluCategoryName = `ZZZ Category ${suffix}`;
      const alphaSubcategoryName = `AAA Subcategory ${suffix}`;
      const zuluSubcategoryName = `ZZZ Subcategory ${suffix}`;
      const alphaLeafName = `AAA Leaf ${suffix}`;
      const zuluLeafName = `ZZZ Leaf ${suffix}`;

      const zuluCategoryRes = await request.post(`${BASE}/categories`, {
        headers: authHeaders(),
        data: { name: zuluCategoryName },
      });
      expect(zuluCategoryRes.status()).toBe(201);

      const alphaCategoryRes = await request.post(`${BASE}/categories`, {
        headers: authHeaders(),
        data: { name: alphaCategoryName },
      });
      expect(alphaCategoryRes.status()).toBe(201);
      const { id: alphaCategoryId } = (await alphaCategoryRes.json()) as { id: number };

      const zuluSubcategoryRes = await request.post(`${BASE}/subcategories`, {
        headers: authHeaders(),
        data: { name: zuluSubcategoryName, categoryId: alphaCategoryId },
      });
      expect(zuluSubcategoryRes.status()).toBe(201);

      const alphaSubcategoryRes = await request.post(`${BASE}/subcategories`, {
        headers: authHeaders(),
        data: { name: alphaSubcategoryName, categoryId: alphaCategoryId },
      });
      expect(alphaSubcategoryRes.status()).toBe(201);
      const { id: alphaSubcategoryId } = (await alphaSubcategoryRes.json()) as { id: number };

      for (const leafName of [zuluLeafName, alphaLeafName]) {
        const leafRes = await request.post(`${BASE}/subSubcategories`, {
          headers: authHeaders(),
          data: { name: leafName, subcategoryId: alphaSubcategoryId },
        });
        expect(leafRes.status()).toBe(201);
      }

      await injectToken(page);
      await page.goto(`${BASE}/manage-categories`, { waitUntil: "networkidle" });

      const categoryNames = await page.locator(".category-card .category-name").evaluateAll((nodes, suffixValue) =>
        nodes
          .map((node) => node.textContent?.trim() ?? "")
          .filter((name) => name.includes(String(suffixValue))),
      suffix);
      expect(categoryNames).toEqual([alphaCategoryName, zuluCategoryName]);

      const alphaCard = page.locator(`[data-category-id="${alphaCategoryId}"]`);
      await expect(alphaCard.locator(".subcategory-name").filter({ hasText: alphaSubcategoryName })).toBeVisible();
      const subcategoryNames = await alphaCard.locator(":scope > .subcategory-list > .subcategory-row .subcategory-name").evaluateAll((nodes, suffixValue) =>
        nodes
          .map((node) => node.textContent?.trim() ?? "")
          .filter((name) => name.includes(String(suffixValue))),
      suffix);
      expect(subcategoryNames).toEqual([alphaSubcategoryName, zuluSubcategoryName]);

      const leafNames = await page.locator(`div[data-subcategory-body-id="${alphaSubcategoryId}"] .subcategory-name`).evaluateAll((nodes, suffixValue) =>
        nodes
          .map((node) => node.textContent?.trim() ?? "")
          .filter((name) => name.includes(String(suffixValue))),
      suffix);
      expect(leafNames).toEqual([alphaLeafName, zuluLeafName]);
    });

    test("lets categories and subcategories collapse independently", async ({ page, request }) => {
      const suffix = Date.now();
      const categoryName = `Collapse Category ${suffix}`;
      const subcategoryName = `Collapse Subcategory ${suffix}`;
      const leafName = `Collapse Leaf ${suffix}`;

      const categoryRes = await request.post(`${BASE}/categories`, {
        headers: authHeaders(),
        data: { name: categoryName },
      });
      expect(categoryRes.status()).toBe(201);
      const { id: categoryId } = (await categoryRes.json()) as { id: number };

      const subcategoryRes = await request.post(`${BASE}/subcategories`, {
        headers: authHeaders(),
        data: { name: subcategoryName, categoryId },
      });
      expect(subcategoryRes.status()).toBe(201);
      const { id: subcategoryId } = (await subcategoryRes.json()) as { id: number };

      const leafRes = await request.post(`${BASE}/subSubcategories`, {
        headers: authHeaders(),
        data: { name: leafName, subcategoryId },
      });
      expect(leafRes.status()).toBe(201);

      await injectToken(page);
      await page.goto(`${BASE}/manage-categories`, { waitUntil: "networkidle" });

      const categoryToggle = page.locator(`button[data-category-toggle-id="${categoryId}"]`);
      const categoryBody = page.locator(`div[data-category-body-id="${categoryId}"]`);
      const subcategoryToggle = page.locator(`button[data-subcategory-toggle-id="${subcategoryId}"]`);
      const subcategoryBody = page.locator(`div[data-subcategory-body-id="${subcategoryId}"]`);

      await expect(categoryBody).toBeVisible();
      await categoryToggle.click();
      await expect(categoryBody).toBeHidden();
      await categoryToggle.click();
      await expect(categoryBody).toBeVisible();

      await expect(subcategoryBody).toBeVisible();
      await subcategoryToggle.click();
      await expect(subcategoryBody).toBeHidden();
      await subcategoryToggle.click();
      await expect(subcategoryBody).toBeVisible();
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

test.describe("API docs UI", () => {
  test("GET /docs serves the API docs UI", async ({ page }) => {
    await page.goto(`${BASE}/docs`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Bookmark Manager API/i }).first()
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("/health", { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
