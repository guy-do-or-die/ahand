/**
 * The clock test (care-print). On its own fresh
 * stand, whose chain already runs 40 days ahead of this machine:
 *
 *   bun infra/stand/stand.ts up --slot 8 [--dev]
 *   STAND_SLOT=8 bunx playwright test tests/e2e/clock.spec.ts
 *
 * seed; jump the chain 40 more days with infra/stand/time.ts; raise through /raise with the
 * 30-day chip and again with the 180-day chip; extend the first through /care "up to 180 days
 * from today". None may revert, and each expiry on chain must equal the chain's time plus the
 * chosen span within the ten-minute margin. A Hand seeded before the jump with 30 days reads
 * "Time's up". The app reads no device clock: a device-clock slip of 80 days would show at once.
 */
import { expect, test, type Page } from "@playwright/test";

import { account } from "./lib/accounts";
import { DAY, MARGIN, capOf, connectAs, phone, standArgs } from "./lib/care-print/care";
import { compose, swipe } from "./lib/feat-raise/raise";
import { chainNow, hands, rpc, type Rpc } from "./lib/rpc";
import { readStand, runProgram, seed, type StandInfo } from "./lib/stand";

test.describe.configure({ mode: "serial" });

let stand: StandInfo;
let chain: Rpc;
let cap: number;
let before: { address: string; handId: string; expiry: number };

test.beforeAll(async () => {
  stand = readStand();
  chain = rpc(stand.rpc);
  cap = await capOf(chain, stand.core);
  const run = seed<{ fixtures: { unlisted: { address: string; handId: string; expiry: number } } }>(undefined, ["unlisted"]);
  before = run.fixtures.unlisted;
  const ahead = (await chainNow(chain)).timestamp;
  // The seeded Hand has 30 days; the jump takes the chain 40 days further.
  expect(before.expiry - ahead).toBeGreaterThan(29 * DAY);
  runProgram("infra/stand/time.ts", [...standArgs(), String(40 * DAY), "--json"]);
  expect((await chainNow(chain)).timestamp).toBeGreaterThan(before.expiry);
});

/** The Hand's number on the share step, and the receipt's block: no raise reverted. */
async function raised(page: Page): Promise<bigint> {
  const up = page.getByTestId("raise-up");
  await expect(up).toBeVisible({ timeout: 40_000 });
  return BigInt((await up.getAttribute("data-hand-id"))!);
}

test("after a 40-day jump: raise for 30 and for 180 days, extend the first to 180 days from today; every expiry is the chain's time plus the span", async ({ browser }) => {
  const asker = account(1);
  const { context, page } = await phone(browser);
  await page.goto("/raise");
  await expect(page.getByTestId("raise-what")).toBeVisible({ timeout: 20_000 });

  // 30 days.
  await compose(page, { title: "Clock test: a 30-day hand after the jump", reward: "5", days: 30 });
  await swipe(page, 1);
  const first = await raised(page);
  const one = await hands(chain, stand.core, first);
  expect(one.raiser).toBe(asker.address);
  expect(one.expiry).toBeLessThanOrEqual(one.openedAt + 30 * DAY);
  expect(one.expiry).toBeGreaterThanOrEqual(one.openedAt + 30 * DAY - MARGIN);

  // 180 days: the cap less ten minutes, never refused as too late.
  await page.getByRole("button", { name: /Raise another hand/ }).click();
  await compose(page, { title: "Clock test: a 180-day hand after the jump", reward: "5", days: 180 });
  await swipe(page, 1);
  const second = await raised(page);
  const two = await hands(chain, stand.core, second);
  expect(two.expiry).toBeLessThanOrEqual(two.openedAt + cap - MARGIN);
  expect(two.expiry).toBeGreaterThanOrEqual(two.openedAt + cap - MARGIN - 60);

  // Extend the first on /care with "up to 180 days from today".
  await page.goto(`/care/${stand.chainId}/${first}`);
  const max = page.locator('[data-testid="care-extend-chip"][data-value="max"]');
  await expect(max).toBeVisible({ timeout: 20_000 });
  await connectAs(page, 1, asker.address);
  await max.click();
  await expect(page.getByTestId("kit-cost-line").first()).toBeVisible({ timeout: 15_000 });
  const from = await chainNow(chain);
  await page.getByTestId("care-extend-swipe").click();
  await expect.poll(async () => (await hands(chain, stand.core, first)).expiry, { timeout: 30_000 }).not.toBe(one.expiry);
  await expect(page.getByTestId("care-tx-rail-extend-done")).toBeVisible({ timeout: 30_000 });
  const to = await chainNow(chain);
  const extended = await hands(chain, stand.core, first);
  expect(extended.expiry).toBeLessThanOrEqual(to.timestamp + cap - MARGIN);
  expect(extended.expiry).toBeGreaterThanOrEqual(from.timestamp + cap - MARGIN - 60);
  await expect(page.locator('[data-testid="care-error"]')).toHaveCount(0);
  await context.close();
});

test("the Hand seeded before the jump with 30 days reads Time's up", async ({ browser }) => {
  const { context, page } = await phone(browser);
  await page.goto(before.address);
  const card = page.getByTestId("hand-deal-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("Time's up", { timeout: 20_000 });
  const row = await hands(chain, stand.core, BigInt(before.handId));
  expect(row.closedAt).toBe(0);
  expect((await chainNow(chain)).timestamp).toBeGreaterThanOrEqual(row.expiry);
  await context.close();
});
