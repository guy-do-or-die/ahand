/**
 * Review round 1, feat-raise: the four visible findings as pictures and measurements, for looking
 * at by eye before and after the fix (not a test; the smoke holds the assertions).
 *
 *   node tests/e2e/lib/feat-raise/round1.ts <site> <out-dir> <prefix>
 *
 * Shoots, at 390 px in Russian and English: the preview with no account connected, the top of the
 * compose state (the heading and the counters), the keys card with its disclosure opened, and the
 * compose state with details at their cap. Prints what it measured as one JSON line per picture.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Page } from "@playwright/test";

const [site, out, prefix = "after"] = process.argv.slice(2);
if (!site || !out) throw new Error("usage: round1.ts <site> <out-dir> <prefix>");
mkdirSync(out, { recursive: true });

const TITLE = { en: "Who can recommend a quiet room in Tbilisi for a week?", ru: "Кто посоветует тихую комнату в Тбилиси на неделю?" };

async function measure(page: Page) {
  return page.evaluate(() => {
    const disclose = Array.from(document.querySelectorAll("[data-testid='raise-keys-card'] button.ah-disclose")).map((el) => Math.round(el.getBoundingClientRect().right));
    return {
      h1: Array.from(document.querySelectorAll("h1")).map((el) => el.textContent),
      scrollWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      keysDiscloseRight: disclose,
      preview: document.querySelector("[data-testid='raise-preview']")?.textContent?.replace(/\s+/g, " ").slice(-160),
    };
  });
}

const browser = await chromium.launch();
try {
  for (const lang of ["ru", "en"] as const) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: lang === "ru" ? "ru-RU" : "en-GB", deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const shoot = async (name: string, locator?: ReturnType<Page["locator"]>) => {
      const path = join(out, `${prefix}-${name}-${lang}.png`);
      if (locator) await locator.screenshot({ path });
      else await page.screenshot({ path });
      console.log(JSON.stringify({ shot: `${prefix}-${name}-${lang}.png`, ...(await measure(page)) }));
    };

    await page.goto(`${site}/raise`);
    await page.getByTestId("raise-what").waitFor();
    await page.getByTestId("raise-what").fill(TITLE[lang]);
    await page.waitForTimeout(1500);
    await shoot("top");
    await page.getByTestId("raise-preview").scrollIntoViewIfNeeded();
    await shoot("preview-no-account", page.getByTestId("raise-preview"));

    // Details at their cap, and one character more typed by hand.
    await page.getByTestId("raise-details-toggle").click();
    await page.getByTestId("raise-details").fill("щ".repeat(1200));
    await page.getByTestId("raise-details").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shoot("details-long");
    console.log(JSON.stringify({ lang, detailsLength: (await page.getByTestId("raise-details").inputValue()).length }));
    await page.getByTestId("raise-details").fill(lang === "ru" ? "С 3 по 10 июня, до $40 за ночь." : "June 3 to 10, up to $40 a night.");

    // The keys card, its disclosure opened.
    await page.getByTestId("raise-swipe").click();
    await page.getByTestId("dev-account-2").click();
    await page.getByTestId("raise-keys-card").waitFor();
    await page.getByTestId("raise-keys-card").locator("button.ah-disclose").first().click();
    await page.waitForTimeout(400);
    await shoot("keys-card");
    await context.close();
  }
} finally {
  await browser.close();
}
