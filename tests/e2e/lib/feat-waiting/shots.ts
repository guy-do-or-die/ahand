/**
 * Screenshots of /waiting for people to look at (not a test): English and Russian, at phone
 * width 390 px and at 1280 px, in the states the smoke drives. Needs fresh fixtures first:
 *
 *   bun infra/stand/seed.ts --slot 6 --json --only blocked > /tmp/seed.json
 *   bun tests/e2e/lib/feat-waiting/pending.ts --payee-account 2 --slot 6
 *   bun tests/e2e/lib/feat-waiting/shots.ts --slot 6 --payee 0x… --out DIR
 *
 * `--payee` is the blocked payee (still blocked). Account 2's own pending is shown connected.
 * Nothing is sent: the shots stop before any button that moves money.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Page } from "@playwright/test";

import { flagValue } from "../../../../infra/stand/seed.ts";
import { readStand } from "../stand";

async function connect(page: Page, which: number): Promise<void> {
  await page.getByTestId("connect-wallet").first().click();
  await page.getByTestId(`dev-account-${which}`).click();
  await page.getByTestId("wallet-connected").waitFor();
}

async function main(argv: string[]): Promise<void> {
  const slot = Number(flagValue(argv, "--slot") ?? "6");
  const payee = flagValue(argv, "--payee");
  const out = flagValue(argv, "--out");
  if (!payee || !out) throw new Error("--payee and --out are needed");
  mkdirSync(out, { recursive: true });
  const site = readStand(slot).site!;
  const browser = await chromium.launch();
  try {
    for (const [lang, locale] of [["en", "en-GB"], ["ru", "ru-RU"]] as const) {
      for (const width of [390, 1280]) {
        const context = await browser.newContext({ locale, viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: width === 390 ? 2 : 1 });
        const page = await context.newPage();
        const shot = async (name: string) => {
          await page.waitForTimeout(1500);
          await page.screenshot({ path: join(out, `${name}-${lang}-${width}.png`), fullPage: true });
          const wide = await page.evaluate(() => {
            const over = Array.from(document.querySelectorAll("body *")).filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5);
            return { by: document.documentElement.scrollWidth - window.innerWidth, what: over.slice(-4).map((el) => `${el.tagName}.${el.className}: ${(el.textContent ?? "").slice(0, 40)}`) };
          });
          if (wide.by > 0) throw new Error(`${name}-${lang}-${width}: the page is ${wide.by} px wider than the window (${wide.what.join(" | ")})`);
        };
        await page.goto(`${site}/waiting`);
        await page.locator('[data-screen="waiting"]').waitFor();
        await shot("1-start");
        await page.goto(`${site}/waiting?for=${payee}`);
        await page.getByTestId("waiting-safe").waitFor();
        await shot("2-pasted-nobody-connected");
        await connect(page, 5);
        await page.getByTestId("waiting-error").first().waitFor();
        await shot("3-blocked-account-5");
        await page.goto(`${site}/waiting`);
        await connect(page, 2);
        await page.getByTestId("waiting-take-out").waitFor();
        await page.getByRole("radio").nth(1).click();
        await page.getByTestId("waiting-take-out-to").locator("textarea").fill("0xa0Ee7A142d267C1f36714E4a8F75612F20a79720");
        await page.getByTestId("kit-cost-line").waitFor();
        await shot("4-payee-take-out-elsewhere");
        await page.locator("h1").click(); // out of the field, so "?" opens the lens instead of being typed
        await page.keyboard.press("?");
        await shot("5-payee-lens");
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main(process.argv.slice(2)).then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`shots: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
