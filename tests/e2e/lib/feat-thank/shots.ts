/**
 * Screenshots of /thank for the build's own review (not a test): each state in English and in
 * Russian at phone width (390 px), and the receipt at desk width.
 *
 *   STAND_SLOT=4 bun tests/e2e/lib/feat-thank/shots.ts <out-dir>
 *
 * It seeds its own fixtures on the slot's chain and thanks two of them, like the smoke does.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { chromium, type Page } from "@playwright/test";

import { devAccountTestId } from "../accounts";
import { readStand, seed, standSlot } from "../stand";
import { craft, passedAndGiven } from "./fixtures";

interface SeedRun {
  fixtures: {
    give: { giveAddress: string };
    resigned: { firstGiveAddress: string; secondGiveAddress: string };
    undeployed: { giveAddress: string };
    noReward: { giveAddress: string };
  };
}

const out = resolve(process.argv[2] ?? "shots");
mkdirSync(out, { recursive: true });
const stand = readStand();
const site = stand.site!;

async function connect(page: Page, who: number): Promise<void> {
  const entry = page.getByTestId(devAccountTestId(who));
  if (!(await entry.isVisible())) await page.getByTestId("connect-wallet").click();
  await entry.click();
  await page.getByTestId("wallet-connected").waitFor();
}

async function paste(page: Page, lang: "en" | "ru", address: string): Promise<void> {
  await page.goto(`${site}/thank`);
  await page.getByTestId(lang === "ru" ? "shell-lang-ru" : "shell-lang-en").click();
  await page.getByTestId("thank-input").fill(address);
  await page.getByTestId("thank-open").click();
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  console.log(`${name}.png${overflow ? "  HORIZONTAL OVERFLOW" : ""}`);
}

const browser = await chromium.launch();
try {
  for (const lang of ["en", "ru"] as const) {
    const run = seed<SeedRun>(standSlot(), ["give", "resigned", "undeployed", "noReward"]);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await context.newPage();

    await page.goto(`${site}/thank`);
    await page.getByTestId(lang === "ru" ? "shell-lang-ru" : "shell-lang-en").click();
    await shot(page, `${lang}-01-empty`);

    await paste(page, lang, run.fixtures.give.giveAddress);
    await page.getByTestId("thank-predicted").waitFor({ timeout: 20_000 });
    await connect(page, 1);
    await page.getByTestId("thank-cost").getByText(/costs about|стоит около/).waitFor({ timeout: 20_000 });
    await shot(page, `${lang}-02-predicted`);
    await page.getByTestId("thank-swipe").click();
    await page.getByTestId("thank-done").waitFor({ timeout: 45_000 });
    await page.waitForTimeout(1_500);
    await shot(page, `${lang}-03-thanked`);

    await paste(page, lang, run.fixtures.undeployed.giveAddress);
    await page.getByTestId("thank-setup-band").waitFor({ timeout: 20_000 });
    await connect(page, 1);
    await page.getByTestId("thank-cost").waitFor({ timeout: 20_000 });
    await shot(page, `${lang}-04-setup`);

    await paste(page, lang, run.fixtures.resigned.firstGiveAddress);
    await page.getByTestId("thank-predicted").waitFor({ timeout: 20_000 });
    await paste(page, lang, run.fixtures.resigned.secondGiveAddress);
    await page.getByTestId("thank-resigned").waitFor({ timeout: 20_000 });
    await connect(page, 1);
    await shot(page, `${lang}-05-resigned`);

    await paste(page, lang, run.fixtures.noReward.giveAddress);
    await page.getByTestId("thank-no-reward").waitFor({ timeout: 20_000 });
    await connect(page, 1);
    await page.getByTestId("thank-cost").getByText(/costs about|стоит около/).waitFor({ timeout: 20_000 });
    await page.getByTestId("thank-swipe").click();
    await page.getByTestId("thank-done").waitFor({ timeout: 45_000 });
    await shot(page, `${lang}-06-no-reward-thanked`);

    const fresh = passedAndGiven({ reward: "12" });
    const tampered = craft<{ address: string }>("tamper", fresh.given.address, "--how", "giver-sig");
    await paste(page, lang, tampered.address);
    await page.getByTestId("thank-error").waitFor({ timeout: 20_000 });
    await shot(page, `${lang}-07-refused`);

    await paste(page, lang, fresh.given.address);
    await page.getByTestId("thank-predicted").waitFor({ timeout: 20_000 });
    await connect(page, 2);
    await page.getByTestId("thank-error").waitFor({ timeout: 20_000 });
    await shot(page, `${lang}-08-not-raiser`);

    await context.close();
  }
} finally {
  await browser.close();
}
