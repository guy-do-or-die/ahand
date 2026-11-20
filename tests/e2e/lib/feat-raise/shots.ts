/**
 * Screenshots of /raise for looking at by eye (not a test): phone width 390 and desk 1280, English
 * and Russian, light and dark, into the experiment's shots folder.
 *
 *   node tests/e2e/lib/feat-raise/shots.ts <site> <out-dir> [compose|filled|up]
 *
 * "up" raises a real hand on the stand's chain with dev account 2 (or 5 in dark mode, to show the
 * locked-copy band) and shoots the share step.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "@playwright/test";

const [site, out, what = "compose"] = process.argv.slice(2);
if (!site || !out) throw new Error("usage: shots.ts <site> <out-dir> [compose|filled]");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
try {
  for (const lang of ["en", "ru"] as const) {
    for (const [name, viewport] of [
      ["phone", { width: 390, height: 844 }],
      ["desk", { width: 1280, height: 900 }],
    ] as const) {
      for (const scheme of ["light", "dark"] as const) {
        if (scheme === "dark" && name === "desk") continue;
        const context = await browser.newContext({ viewport, locale: lang === "ru" ? "ru-RU" : "en-GB", colorScheme: scheme, deviceScaleFactor: 1 });
        const page = await context.newPage();
        await page.goto(`${site}/raise`);
        await page.getByTestId("raise-what").waitFor();
        if (what === "up") {
          await page.getByTestId("raise-what").fill(lang === "ru" ? "Кто посоветует тихую комнату в Тбилиси на неделю?" : "Who can recommend a quiet room in Tbilisi for a week?");
          await page.getByTestId("raise-swipe").click();
          const who = scheme === "dark" ? 5 : 2;
          await page.getByTestId(`dev-account-${who}`).click();
          await page.getByTestId("raise-keys-confirm").click();
          await page.getByTestId("raise-up").waitFor({ timeout: 30_000 });
          await page.getByTestId("raise-qr").click();
        }
        if (what === "filled") {
          await page.getByTestId("raise-what").fill(lang === "ru" ? "Кто посоветует тихую комнату в Тбилиси на неделю?" : "Who can recommend a quiet room in Tbilisi for a week?");
          await page.getByTestId("raise-details-toggle").click();
          await page.getByTestId("raise-details").fill(lang === "ru" ? "С 3 по 10 июня, до $40 за ночь." : "June 3 to 10, up to $40 a night.");
          await page.locator('[data-testid="raise-reward-chip"][data-value="50"]').click();
          await page.getByTestId("raise-fine-tune").click();
        }
        await page.waitForTimeout(1500);
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        await page.screenshot({ path: join(out, `raise-${what}-${lang}-${name}-${scheme}.png`), fullPage: true });
        console.log(`${lang} ${name} ${scheme}: scrollWidth ${scrollWidth} (viewport ${viewport.width})`);
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
