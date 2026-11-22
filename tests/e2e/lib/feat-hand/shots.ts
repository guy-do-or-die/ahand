/**
 * Screenshots of feat-hand's screens for a person to look at (not a test): every state of the
 * Hand view and the pass, in English and Russian, at phone width (390) and desktop (1280).
 *
 *   bun tests/e2e/lib/feat-hand/shots.ts --slot 2 --out <folder>
 *
 * It seeds its own fixtures on the slot's chain, like the smoke does.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Page } from "@playwright/test";

import { flagValue } from "../../../../infra/stand/seed.ts";
import { readStand, seed } from "../stand";
import { craft, quietDevServer, type SeedRun } from "./helpers";

const argv = process.argv.slice(2);
const slot = Number(flagValue(argv, "--slot") ?? "2");
process.env.STAND_SLOT = String(slot);
const out = flagValue(argv, "--out") ?? "shots";
mkdirSync(out, { recursive: true });
const stand = readStand(slot);
const run = seed<SeedRun>(slot);
const f = (name: string) => run.fixtures[name]!;

const browser = await chromium.launch();

async function shot(name: string, address: string, act?: (page: Page) => Promise<void>, widths = [390, 1280]) {
  for (const lang of ["en", "ru"] as const) {
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 }, deviceScaleFactor: 1 });
      await quietDevServer(context, stand.site!);
      const page = await context.newPage();
      await page.goto(address);
      if (lang === "ru") {
        await page.getByTestId("shell-lang").click();
        await page.getByTestId("shell-lang-ru").click();
      }
      await page.waitForTimeout(1500);
      if (act) await act(page);
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      await page.screenshot({ path: join(out, `${name}-${lang}-${width}.png`), fullPage: true });
      console.log(`${name}-${lang}-${width}${overflow ? "  HORIZONTAL OVERFLOW" : ""}`);
      await context.close();
    }
  }
}

await shot("open", f("unlisted").address);
await shot("two-passes", f("twoPasses").address, undefined, [390]);
await shot("pass-0", f("unlisted").address, async (page) => {
  await page.getByTestId("hand-pass").click();
  await page.getByTestId("pass-slider").waitFor();
});
await shot("pass-10-land", f("dark").address, async (page) => {
  await page.getByTestId("hand-pass").click();
  await page.getByTestId("pass-slider").fill("1000");
  await page.getByTestId("land-sheet").getByRole("button").click();
  await page.locator('input[value="address"]').check();
  await page.locator(".ah-sheet__panel textarea").fill(run.core);
}, [390]);
await shot("pass-made", f("dark").address, async (page) => {
  await page.getByTestId("hand-pass").click();
  await page.getByTestId("pass-slider").fill("1000");
  await page.getByTestId("land-sheet").getByRole("button").click();
  await page.locator('input[value="address"]').check();
  await page.locator(".ah-sheet__panel textarea").fill("0x14dC79964da2C08b23698B3D3cc7Ca32193d9955");
  await page.locator(".ah-sheet__panel .ah-swipe").click();
  await page.getByTestId("pass-swipe").click();
  await page.getByTestId("pass-read-back").waitFor();
  await page.getByTestId("pass-qr").click();
});
await shot("lost", f("lost").address, undefined, [390]);
await shot("no-reward", f("noReward").address, undefined, [390]);
await shot("give-holder", (run.fixtures.give as unknown as { giveAddress: string }).giveAddress, undefined, [390]);
await shot("expired", f("expired").address);
await shot("refunded-newer", f("refunded").address, async (page) => {
  await page.getByTestId("hand-newer-look").click();
  await page.getByTestId("hand-newer-found").waitFor();
});
await shot("thanked", f("thanked").address, undefined, [390]);
await shot("public", `${stand.site}/${run.chainId}/${f("public").handId}`, undefined, [390]);
await shot("public-described", f("public").address.slice(0, f("public").address.indexOf("#")), undefined, [390]);
const { address: other } = craft<{ address: string }>(["tamper", f("unlisted").address, "--how", "other-core"]);
await shot("error-untrusted", other, undefined, [390]);
await shot("lens", f("twoPasses").address, async (page) => page.keyboard.press("?"), [390, 1280]);

await browser.close();
