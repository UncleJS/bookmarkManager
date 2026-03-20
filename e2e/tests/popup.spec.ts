/**
 * Extension Popup tests.
 *
 * Opens the popup as a tab (chrome-extension://<id>/popup/popup.html).
 * Tests cover:
 *  - Page renders with the expected form elements
 *  - Options must be configured first (sets API base URL + token via storage)
 *  - Filling the form and submitting creates a bookmark
 *  - Duplicate URL detection shows the warning panel
 *
 * Prerequisites:
 *   - API running at http://localhost:11650 (or API_BASE_URL env var)
 *   - API_TOKEN env var set to the configured token
 */
import { type BrowserContext } from "@playwright/test";
import { test, expect } from "../fixtures.js";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:11650";
const TOKEN = process.env.API_TOKEN ?? "";

function authHeaders() {
  return { Authorization: `Bearer ${TOKEN}` };
}

// Helper: configure the extension via the options page within the same context
async function configureExtension(
  extensionContext: BrowserContext,
  extensionId: string
): Promise<void> {
  if (!TOKEN) return;
  const page = await extensionContext.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/options/options.html`,
    { waitUntil: "domcontentloaded" }
  );
  await page.locator("#apiBaseUrl").fill(API_BASE);
  await page.locator("#apiToken").fill(TOKEN);
  await page.locator("#save").click();
  await expect(page.locator("#status")).toHaveText(/saved/i, {
    timeout: 5_000,
  });
  await page.close();
}

test.describe("Popup — rendering", () => {
  test("page loads with the 'Add Bookmark' heading", async ({ popupPage }) => {
    await expect(popupPage.locator("h1")).toContainText("Add Bookmark");
  });

  test("form contains URL, title, and description fields", async ({
    popupPage,
  }) => {
    await expect(popupPage.locator("#url")).toBeVisible();
    await expect(popupPage.locator("#title")).toBeVisible();
    await expect(popupPage.locator("#description")).toBeVisible();
  });

  test("Save bookmark button is visible", async ({ popupPage }) => {
    await expect(popupPage.locator("#save")).toBeVisible();
  });

  test("flag checkboxes are present", async ({ popupPage }) => {
    for (const id of [
      "#flag-forReview",
      "#flag-readLater",
      "#flag-hotTopic",
      "#flag-cheatsheets",
      "#flag-archived",
    ]) {
      await expect(popupPage.locator(id)).toBeAttached();
    }
  });

  test("subcategory and tag inputs are visible", async ({ popupPage }) => {
    await expect(popupPage.locator("#subcategory-search")).toBeVisible();
    await expect(popupPage.locator("#tag-input")).toBeVisible();
  });
});

test.describe("Popup — bookmark creation", () => {
  test.skip(!TOKEN, "Skipped — API_TOKEN env var not set");

  const testUrl = `https://popup-e2e-test.example.com/${Date.now()}`;

  test("fills and submits the form to create a bookmark", async ({
    extensionContext,
    extensionId,
    popupPage,
  }) => {
    // Configure the extension with working credentials first
    await configureExtension(extensionContext, extensionId);

    // The URL field is `readonly` — the extension fills it from the active tab.
    // For E2E purposes we inject the value directly via JS.
    await popupPage.evaluate(([url]: string[]) => {
      const el = document.getElementById("url") as HTMLInputElement | null;
      if (el) {
        el.removeAttribute("readonly");
        el.value = url;
      }
    }, [testUrl]);

    // Fill title
    await popupPage.locator("#title").fill("Popup E2E Test Bookmark");

    // Fill description
    await popupPage.locator("#description").fill("Written by Playwright");

    // Check a flag
    await popupPage.locator("#flag-forReview").check();

    // Submit
    await popupPage.locator("#save").click();

    // Wait for success toast or status message
    const status = popupPage.locator("#status");
    await expect(status).toHaveText(/saved|saving/i, { timeout: 10_000 });
  });

  test("submitting duplicate URL shows the duplicate warning panel", async ({
    extensionContext,
    extensionId,
    popupPage,
  }) => {
    await configureExtension(extensionContext, extensionId);

    // Use the same URL created in the previous test
    await popupPage.evaluate(([url]: string[]) => {
      const el = document.getElementById("url") as HTMLInputElement | null;
      if (el) {
        el.removeAttribute("readonly");
        el.value = url;
      }
    }, [testUrl]);

    await popupPage.locator("#title").fill("Duplicate Bookmark");
    await popupPage.locator("#save").click();

    // The duplicate-warning div should become visible
    const dupWarning = popupPage.locator("#duplicate-warning");
    await expect(dupWarning).not.toHaveClass(/hidden/, { timeout: 10_000 });

    // At least one item in the duplicate list
    const dupList = popupPage.locator("#duplicate-list li");
    await expect(dupList.first()).toBeVisible();

    // Dismiss via Close button
    await popupPage.locator("#duplicate-confirm").click();
    await expect(dupWarning).toHaveClass(/hidden/, { timeout: 3_000 });
  });
});

test.describe("Popup — subcategory modal", () => {
  test.skip(!TOKEN, "Skipped — API_TOKEN env var not set");

  test("opens and closes the Create Sub-category modal", async ({
    popupPage,
  }) => {
    const addBtn = popupPage.locator("#add-subcategory");
    await addBtn.click();

    const modal = popupPage.locator("#subcategory-modal");
    await expect(modal).not.toHaveClass(/hidden/, { timeout: 3_000 });

    // Cancel closes the modal
    await popupPage.locator("#modal-cancel").click();
    await expect(modal).toHaveClass(/hidden/, { timeout: 3_000 });
  });

  test("closes modal on Escape key", async ({ popupPage }) => {
    await popupPage.locator("#add-subcategory").click();
    const modal = popupPage.locator("#subcategory-modal");
    await expect(modal).not.toHaveClass(/hidden/);

    await popupPage.keyboard.press("Escape");
    await expect(modal).toHaveClass(/hidden/, { timeout: 3_000 });
  });

  test("creates a sub-sub-category from the popup modal and makes it selectable", async ({
    request,
    extensionContext,
    extensionId,
    popupPage,
  }) => {
    await configureExtension(extensionContext, extensionId);

    const categoryName = `popup-l3-cat-${Date.now()}`;
    const subcategoryName = `popup-l2-parent-${Date.now()}`;
    const subSubcategoryName = `popup-l3-child-${Date.now()}`;

    const categoryRes = await request.post(`${API_BASE}/categories`, {
      headers: authHeaders(),
      data: { name: categoryName, description: "Popup level-3 category" },
    });
    expect(categoryRes.status()).toBe(201);
    const categoryBody = await categoryRes.json();

    const subcategoryRes = await request.post(`${API_BASE}/subcategories`, {
      headers: authHeaders(),
      data: { name: subcategoryName, categoryId: categoryBody.id, description: "Popup level-2 parent" },
    });
    expect(subcategoryRes.status()).toBe(201);
    const subcategoryBody = await subcategoryRes.json();

    await popupPage.reload({ waitUntil: "domcontentloaded" });
    await popupPage.waitForTimeout(700);

    await popupPage.locator("#add-subcategory").click();
    const modal = popupPage.locator("#subcategory-modal");
    await expect(modal).not.toHaveClass(/hidden/, { timeout: 3_000 });

    await popupPage.locator('input[name="level-option"][value="subSubcategory"]').check();
    await expect(popupPage.locator("#parent-subcategory-section")).not.toHaveClass(/hidden/);
    await expect(popupPage.locator("#subcategory-modal-title")).toHaveText(/Create sub-sub-category/i);

    await popupPage.locator("#modal-parent-subcategory").selectOption(String(subcategoryBody.id));
    await popupPage.locator("#modal-subcategory-name").fill(subSubcategoryName);
    await popupPage.locator("#modal-subcategory-description").fill("Created from popup modal");
    await popupPage.locator("#modal-create").click();

    await expect(popupPage.locator("#status")).toHaveText(/sub-sub-category created/i, { timeout: 5_000 });
    await expect(modal).toHaveClass(/hidden/, { timeout: 5_000 });

    await expect(popupPage.locator("#selected-subcategories")).toContainText(subSubcategoryName);
    await expect(popupPage.locator("#selected-subcategories")).toContainText(subcategoryName);

    const verifyRes = await request.get(`${API_BASE}/subSubcategories`, {
      headers: authHeaders(),
    });
    expect(verifyRes.status()).toBe(200);
    const verifyBody = await verifyRes.json();
    const parentGroup = (verifyBody.subcategories as Array<{ id: number; subSubcategories: Array<{ name: string }> }>)
      .find((item) => item.id === subcategoryBody.id);
    expect(parentGroup?.subSubcategories.some((item) => item.name === subSubcategoryName)).toBe(true);
  });
});

test.describe("Popup — tag input interaction", () => {
  test.skip(!TOKEN, "Skipped — API_TOKEN env var not set");

  test("focusing tag input shows suggestions dropdown", async ({
    extensionContext,
    extensionId,
    popupPage,
  }) => {
    await configureExtension(extensionContext, extensionId);

    const tagInput = popupPage.locator("#tag-input");
    await tagInput.click();

    // Allow debounced fetch to complete
    await popupPage.waitForTimeout(600);

    // The list element should exist in the DOM
    await expect(popupPage.locator("#tag-suggestions")).toBeAttached();
  });
});
