/**
 * Shared Playwright fixtures for extension-based tests.
 *
 * `extensionContext` — a persistent BrowserContext with the unpacked extension loaded.
 * `extensionId`     — the resolved chrome-extension:// ID string.
 * `optionsPage`     — a Page pointing at the extension's options.html.
 * `popupPage`       — a Page pointing at the extension's popup.html (opened as a tab).
 *
 * Usage:
 *   import { test, expect } from '../fixtures';
 */
import {
  test as base,
  expect,
  chromium,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

export { expect };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type ExtensionFixtures = {
  extensionContext: BrowserContext;
  extensionId: string;
  optionsPage: Page;
  popupPage: Page;
};

export const test = base.extend<ExtensionFixtures>({
  // eslint-disable-next-line no-empty-pattern
  extensionContext: async ({}, use) => {
    const extensionPath =
      process.env.EXTENSION_PATH ??
      path.resolve(__dirname, "../extension");

    // Use a fresh temp profile per test worker to keep tests isolated.
    const userDataDir = path.resolve(
      __dirname,
      `.tmp-chrome-${process.env.TEST_WORKER_INDEX ?? "0"}`
    );

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ],
    });

    await use(context);
    await context.close();
  },

  extensionId: async ({ extensionContext }, use) => {
    // Wait for the service worker to register so we can read its URL
    let id = process.env.EXTENSION_ID ?? "";

    if (!id) {
      for (let i = 0; i < 20; i++) {
        const sw = extensionContext
          .serviceWorkers()
          .find((w) => w.url().startsWith("chrome-extension://"));
        if (sw) {
          id = sw.url().split("/")[2];
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    if (!id) throw new Error("Could not resolve extension ID");
    await use(id);
  },

  optionsPage: async ({ extensionContext, extensionId }, use) => {
    const page = await extensionContext.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/options/options.html`,
      { waitUntil: "domcontentloaded" }
    );
    await use(page);
    await page.close();
  },

  popupPage: async ({ extensionContext, extensionId }, use) => {
    // Open the popup HTML directly as a tab (same as Playwright extension testing docs)
    const page = await extensionContext.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/popup/popup.html`,
      { waitUntil: "domcontentloaded" }
    );
    await use(page);
    await page.close();
  },
});
