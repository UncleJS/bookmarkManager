// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 UncleJS

/**
 * Web UI theme and date-format tests.
 *
 * Runs in a non-UTC zone with the en-US locale, so a locale-formatted date
 * (M/d/yyyy, AM/PM) or a UTC time shown as local would fail.
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.API_BASE_URL ?? "http://localhost:11650";
const TOKEN = process.env.API_TOKEN ?? "";
const ZONE = "America/New_York";

test.use({ timezoneId: ZONE, locale: "en-US" });

async function signIn(page: Page): Promise<void> {
  const res = await page.request.post(`${BASE}/session`, {
    data: { token: TOKEN },
    headers: { Origin: new URL(BASE).origin },
  });
  expect(res.status()).toBe(200);
}

const LOCALE_DATE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/;
const AM_PM = /\b\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM)\b/i;

test.describe("Theme", () => {
  test("login page is dark by default and has a toggle", async ({ page }) => {
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("[data-theme-toggle]")).toBeVisible();
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(10, 10, 10)");
  });

  test("the toggle switches to light, persists, and applies before first paint", async ({ page }) => {
    test.skip(!TOKEN, "Skipped — API_TOKEN env var not set");
    await signIn(page);
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const toggle = page.locator("#topbar [data-theme-toggle]");
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate(() => localStorage.getItem("bm-theme"))).toBe("light");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe("rgb(244, 245, 247)");

    // On the next page, the theme must already be set when <body> is parsed
    // (theme-init.js runs blocking in <head>), so there is no dark flash.
    await page.addInitScript(() => {
      new MutationObserver((_, obs) => {
        if (document.body) {
          (window as unknown as { __themeAtBody: string | null }).__themeAtBody =
            document.documentElement.getAttribute("data-theme");
          obs.disconnect();
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(`${BASE}/manage-tags`, { waitUntil: "domcontentloaded" });
    expect(await page.evaluate(() => (window as unknown as { __themeAtBody: string }).__themeAtBody))
      .toBe("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // Toggle back to dark from another page.
    await page.locator("#topbar [data-theme-toggle]").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("bm-theme"))).toBe("dark");
  });

  test("every page has a theme toggle in its header", async ({ page }) => {
    test.skip(!TOKEN, "Skipped — API_TOKEN env var not set");
    await signIn(page);
    for (const path of ["/app", "/manage-categories", "/manage-tags"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#topbar [data-theme-toggle]"), path).toBeVisible();
    }
  });

  test("primary button hover text stays readable in both themes", async ({ page }) => {
    test.skip(!TOKEN, "Skipped — API_TOKEN env var not set");
    await signIn(page);
    await page.goto(`${BASE}/manage-categories`, { waitUntil: "domcontentloaded" });
    const btn = page.locator("#btn-add-category");
    for (const theme of ["dark", "light"]) {
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await btn.hover();
      const { color, background } = await btn.evaluate((el) => {
        const s = getComputedStyle(el);
        return { color: s.color, background: s.backgroundColor };
      });
      expect(color, theme).toBe("rgb(255, 255, 255)");
      expect(background, theme).not.toBe(color);
    }
  });
});

test.describe("Dates", () => {
  test("bookmark cards show yyyy-MM-dd HH:mm:ss in local time", async ({ page }) => {
    test.skip(!TOKEN, "Skipped — API_TOKEN env var not set");
    const created = await page.request.post(`${BASE}/bookmarks`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { url: `https://example.com/date-format-${Date.now()}`, title: "Date format check" },
    });
    expect(created.ok()).toBeTruthy();
    const body = await created.json();
    const createdAt: string = body.createdAt ?? body.bookmark?.createdAt ?? body.data?.createdAt;
    expect(createdAt).toBeTruthy();
    try {
      await signIn(page);
      await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
      const date = page.locator(".card-meta-date").first();
      await expect(date).toBeVisible({ timeout: 10_000 });
      const text = (await date.textContent())?.trim() ?? "";
      expect(text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

      // The newest card is the one just created; it must show New York time.
      const expected = await page.evaluate((raw) => {
        const d = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(raw) ? raw : raw.replace(" ", "T") + "Z");
        const p = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
          `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      }, createdAt);
      expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(ZONE);
      expect(text).toBe(expected);

      // Only date-bearing UI, not bookmark titles or URLs from the database.
      const pageText = (await page.locator(".card-meta-date, #topbar, .license-footer").allInnerTexts()).join("\n");
      expect(pageText).not.toMatch(LOCALE_DATE);
      expect(pageText).not.toMatch(AM_PM);
    } finally {
      // The API has no hard delete; archive the check bookmark so it leaves the active list.
      await page.request.patch(`${BASE}/bookmarks/${body.id}/archive`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
    }
  });

  test("no page uses a native date/time input", async ({ page }) => {
    test.skip(!TOKEN, "Skipped — API_TOKEN env var not set");
    await signIn(page);
    for (const path of ["/app", "/manage-categories", "/manage-tags"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      const count = await page.locator(
        'input[type="date"], input[type="time"], input[type="datetime-local"], input[type="month"], input[type="week"]'
      ).count();
      expect(count, path).toBe(0);
    }
  });
});
