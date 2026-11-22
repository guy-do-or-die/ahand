/**
 * The one clock is the network's: with the browser's own
 * clock moved two years back and then two years ahead (Playwright's page.clock, which fixes
 * Date.now and new Date() and leaves timers running), an open Hand still reads open, an expired
 * one still reads "Time's up", and the expiry chips on /raise still lead to a raise that lands
 * with the expiry counted from the chain's latest block. The stand's chain already runs 40 days
 * ahead of this machine, so the browser's clock is wrong in every run, by days or by years.
 *
 *   STAND_SLOT=2 bunx playwright test tests/e2e/guards/wallclock.spec.ts
 */
import { expect, test, type Page } from "@playwright/test";

import { answerPrompts, compose } from "../lib/feat-raise/raise";
import { chainNow, hands, rpc } from "../lib/rpc";
import { readStand } from "../lib/stand";
import { fixtureOf, quiet, seedFixtures, visit, type SeedRun } from "./lib/guard";

const stand = readStand();
const chain = rpc(stand.rpc);
const DAY = 86_400;
const YEARS_2 = 2 * 365 * DAY * 1000;
const CAP_ABI = [{ type: "function", name: "MAX_EXPIRY_PERIOD", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const;

let run: SeedRun;
let cap: number;

test.beforeAll(async () => {
  run = seedFixtures(["unlisted", "expired"]);
  cap = Number(await chain.client.readContract({ address: stand.core, abi: CAP_ABI, functionName: "MAX_EXPIRY_PERIOD" }));
});

test.beforeEach(async ({ context }) => {
  await quiet(context, stand.site!);
});

/** Raises a Hand on /raise with the chip of `days`, as dev account 1; returns its number. */
async function raiseWithChip(page: Page, days: 7 | 180): Promise<bigint> {
  await page.goto("/raise");
  await expect(page.getByTestId("raise-what")).toBeVisible({ timeout: 20_000 });
  await compose(page, { title: `The clock guard, ${days} days`, reward: "5", days, mode: "dark" });
  await expect(page.getByTestId("raise-swipe")).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId("raise-swipe").click();
  await answerPrompts(page, 1);
  const up = page.getByTestId("raise-up");
  await expect(up).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId("raise-error")).toHaveCount(0);
  return BigInt((await up.getAttribute("data-hand-id"))!);
}

for (const [direction, shift] of [
  ["two years behind", -YEARS_2],
  ["two years ahead", YEARS_2],
] as const) {
  test.describe(`the browser's clock ${direction}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(new Date(Date.now() + shift));
    });

    test("an open hand reads open; an expired hand reads Time's up", async ({ page }) => {
      // The page's clock really is moved.
      await page.goto("/");
      const pageYear = await page.evaluate(() => new Date().getFullYear());
      expect(Math.abs(pageYear - new Date().getFullYear())).toBeGreaterThanOrEqual(1);

      await visit(page, fixtureOf(run, "unlisted").address);
      await expect(page.getByTestId("hand-deal-card")).toHaveAttribute("data-state", "open", { timeout: 20_000 });
      await expect(page.getByTestId("hand-times-up")).toHaveCount(0);
      await expect(page.getByTestId("hand-pass")).toBeVisible();

      await visit(page, fixtureOf(run, "expired").address);
      await expect(page.getByTestId("hand-deal-card")).toHaveAttribute("data-state", "expired", { timeout: 20_000 });
      await expect(page.getByTestId("hand-deal-card")).toContainText("Time's up.");
      await expect(page.getByTestId("hand-times-up")).toContainText("Send the reward back");
      await expect(page.getByTestId("hand-pass")).toHaveCount(0);
    });

    test("the 7-day and 180-day chips lead to raises that land, counted from the chain's clock", async ({ page }) => {
      test.setTimeout(150_000);
      for (const days of [7, 180] as const) {
        const before = await chainNow(chain);
        const handId = await raiseWithChip(page, days);
        const row = await hands(chain, stand.core, handId);
        expect(row.openedAt).toBeGreaterThanOrEqual(before.timestamp);
        const span = days === 7 ? 7 * DAY : cap - 600;
        // The chip was counted from a block at most a couple of minutes before the raise landed.
        expect(row.expiry).toBeLessThanOrEqual(row.openedAt + span);
        expect(row.expiry).toBeGreaterThan(row.openedAt + span - 120);
      }
    });
  });
}
