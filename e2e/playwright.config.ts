import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the unpacked Chrome extension
const EXTENSION_PATH = path.resolve(__dirname, "../extension");

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 0,
  workers: 1, // Extension tests must run serially — one context owns the extension

  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],

  globalSetup: "./global-setup.ts",

  use: {
    // Extension tests need a persistent context; each project handles that via fixtures
    baseURL: process.env.API_BASE_URL ?? "http://localhost:11650",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    // ── API smoke tests: plain Chromium, no extension needed ────────────────
    {
      name: "api-smoke",
      testMatch: ["**/api.spec.ts"],
      use: {
        browserName: "chromium",
      },
    },

    // ── Web UI tests: plain Chromium, no extension needed ───────────────────
    {
      name: "webapp",
      testMatch: ["**/webapp.spec.ts"],
      use: {
        browserName: "chromium",
      },
    },

    // ── Extension tests: persistent Chromium context with extension loaded ──
    {
      name: "extension",
      testMatch: ["**/options.spec.ts", "**/popup.spec.ts"],
      use: {
        // These tests use the extensionContext fixture from fixtures.ts;
        // the `browserName` is irrelevant here as the fixture launches its own
        // chromium instance via chromium.launchPersistentContext().
        browserName: "chromium",
        _extensionPath: EXTENSION_PATH,
      } as object,
    },
  ],
});
