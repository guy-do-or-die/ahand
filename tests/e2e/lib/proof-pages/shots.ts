/**
 * Screenshots of the verifier's pages for the build note (not a test):
 *
 *   bun tests/e2e/lib/proof-pages/shots.ts --site URL --out DIR name=path [name=path …]
 *
 * Each path is shot in English and Russian at 390 and 1280 px, full page, after the page settles
 * (the passport's lines have ticked in, /check has Core's answer or says why it has none). A path
 * may carry options after it, each starting with `!`:
 *   !paste=TEXT   the text is pasted into /check's box and checked first
 *   !offline      the browser goes offline once the page has loaded, before the paste
 *   !lens         the lens is switched on, so every piece of evidence stands open
 *   !dark         the dark theme
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Page } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  if (at < 0 || !args[at + 1]) throw new Error(`${name} is required`);
  return args.splice(at, 2)[1]!;
};
const site = flag("--site");
const out = flag("--out");
mkdirSync(out, { recursive: true });

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  const tally = page.getByTestId("proof-tally");
  if (await tally.count()) await page.waitForSelector('[data-testid="proof-tally"][data-done="true"]', { timeout: 20_000 });
  if (await page.getByTestId("check-core-answer").count()) {
    await page.waitForSelector('[data-testid="check-core-answer"]:is([data-state="done"], [data-state="offline"], [data-state="skipped"])', { timeout: 30_000 });
  }
  if (await page.getByTestId("check-step").count()) await page.waitForSelector('[data-testid="check-agree"], [data-testid="check-finding"]', { timeout: 20_000 });
  await page.waitForTimeout(300);
}

const browser = await chromium.launch();
for (const spec of args) {
  const [name, rest] = spec.split(/=(.*)/s) as [string, string];
  const [path, ...options] = rest.split("!");
  const paste = options.find((option) => option.startsWith("paste="))?.slice("paste=".length);
  const offline = options.includes("offline");
  const lens = options.includes("lens");
  const dark = options.includes("dark");
  for (const lang of ["en", "ru"] as const) {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, locale: lang === "ru" ? "ru-RU" : "en-GB", colorScheme: dark ? "dark" : "light" });
      const page = await context.newPage();
      await page.goto(`${site}${path}`);
      await page.getByTestId(lang === "ru" ? "shell-lang-ru" : "shell-lang-en").click();
      if (lens) await page.getByTestId("shell-lens").click();
      if (offline) {
        await page.waitForLoadState("networkidle");
        await context.setOffline(true);
      }
      if (paste) {
        await page.getByTestId("check-input").fill(paste);
        await page.getByTestId("check-run").click();
      }
      if (offline) await page.waitForSelector('[data-testid="check-core-answer"][data-state="offline"]', { timeout: 30_000 });
      else await settle(page);
      const file = join(out, `${name}-${lang}-${width}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      console.log(`${file}${overflow ? "  HORIZONTAL OVERFLOW" : ""}`);
      await context.close();
    }
  }
}
await browser.close();
