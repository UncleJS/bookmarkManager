/**
 * Extension Options page tests.
 *
 * Opens chrome-extension://<id>/options/options.html, sets the API base URL
 * and token, saves, and confirms the values are persisted correctly.
 *
 * Prerequisites:
 *   - API running at http://localhost:11650 (or API_BASE_URL env var)
 *   - API_TOKEN env var set to the configured token
 */
import { test, expect } from "../fixtures.js";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:11650";
const TOKEN = process.env.API_TOKEN ?? "";

test.describe("Options page", () => {
  test("page loads with the correct title", async ({ optionsPage }) => {
    await expect(optionsPage).toHaveTitle(/Bookmark Manager Options/i);
  });

  test("shows API base URL and token fields", async ({ optionsPage }) => {
    await expect(optionsPage.locator("#apiBaseUrl")).toBeVisible();
    await expect(optionsPage.locator("#apiToken")).toBeVisible();
    await expect(optionsPage.locator("#save")).toBeVisible();
  });

  test("saves API base URL and shows success status", async ({
    optionsPage,
  }) => {
    const urlInput = optionsPage.locator("#apiBaseUrl");
    await urlInput.fill(API_BASE);

    const saveBtn = optionsPage.locator("#save");
    await saveBtn.click();

    const status = optionsPage.locator("#status");
    await expect(status).toHaveText(/saved/i, { timeout: 5_000 });
  });

  test("saves API token and shows success status", async ({ optionsPage }) => {
    if (!TOKEN) {
      test.skip(true, "API_TOKEN not set — skipping token save test");
      return;
    }

    const tokenInput = optionsPage.locator("#apiToken");
    await tokenInput.fill(TOKEN);

    const saveBtn = optionsPage.locator("#save");
    await saveBtn.click();

    const status = optionsPage.locator("#status");
    await expect(status).toHaveText(/saved/i, { timeout: 5_000 });
  });

  test("saves both URL and token, then reopening shows persisted values", async ({
    extensionContext,
    extensionId,
  }) => {
    if (!TOKEN) {
      test.skip(true, "API_TOKEN not set — skipping persistence test");
      return;
    }

    // Write
    const page1 = await extensionContext.newPage();
    await page1.goto(
      `chrome-extension://${extensionId}/options/options.html`,
      { waitUntil: "domcontentloaded" }
    );
    await page1.locator("#apiBaseUrl").fill(API_BASE);
    await page1.locator("#apiToken").fill(TOKEN);
    await page1.locator("#save").click();
    await expect(page1.locator("#status")).toHaveText(/saved/i, {
      timeout: 5_000,
    });
    await page1.close();

    // Read back
    const page2 = await extensionContext.newPage();
    await page2.goto(
      `chrome-extension://${extensionId}/options/options.html`,
      { waitUntil: "domcontentloaded" }
    );
    // Allow storage to propagate
    await page2.waitForTimeout(300);
    const savedUrl = await page2.locator("#apiBaseUrl").inputValue();
    const savedToken = await page2.locator("#apiToken").inputValue();

    expect(savedUrl).toBe(API_BASE);
    expect(savedToken).toBe(TOKEN);
    await page2.close();
  });
});
