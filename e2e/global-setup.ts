/**
 * Global setup — runs once before all tests.
 *
 * 1. Verifies the API is reachable at /ready.
 * 2. Saves the extension path to env so fixtures can read it.
 */
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:11650";
const MAX_WAIT_MS = 15_000;
const POLL_MS = 500;

async function waitForApi(): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/ready`);
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body.status === "ok") {
          console.log(`\n✓ API is ready at ${API_BASE}`);
          return;
        }
      }
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  throw new Error(
    `API at ${API_BASE}/ready did not become ready within ${MAX_WAIT_MS}ms.\n` +
      `Last error: ${lastError}\n` +
      `Ensure the pod is running:  ./scripts/start.sh`
  );
}

export default async function globalSetup(): Promise<void> {
  await waitForApi();

  // Pre-flight: discover the extension ID by launching a throw-away context.
  // The extension ID is deterministic once the extension is loaded from the same
  // directory, but we store it in process.env so test fixtures can reuse it.
  const EXTENSION_PATH = path.resolve(__dirname, "../extension");
  const userDataDir = path.resolve(__dirname, ".tmp-chrome-profile");

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-sandbox",
    ],
  });

  // Wait for the service worker page to appear — it carries the extension ID
  let extensionId = "";
  for (let i = 0; i < 20; i++) {
    const swTargets = context.serviceWorkers();
    const sw = swTargets.find((w) => w.url().startsWith("chrome-extension://"));
    if (sw) {
      // chrome-extension://<id>/background/background.js
      extensionId = sw.url().split("/")[2];
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  await context.close();

  if (!extensionId) {
    throw new Error(
      "Could not determine extension ID. " +
        "Make sure the extension loads correctly from: " +
        EXTENSION_PATH
    );
  }

  process.env.EXTENSION_ID = extensionId;
  process.env.EXTENSION_PATH = EXTENSION_PATH;
  console.log(`✓ Extension loaded — ID: ${extensionId}`);
}
