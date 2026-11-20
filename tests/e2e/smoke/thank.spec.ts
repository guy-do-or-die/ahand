/**
 * /thank in a real browser against the stand's chain (PLAN wave 4, feat-thank; UX-SPEC §7.5).
 *
 *   STAND_SLOT=4 bunx playwright test tests/e2e/smoke/thank.spec.ts
 *
 * Fixtures, made in beforeAll and used by this file only: the seed's `give`, `resigned`,
 * `undeployed` and `noReward` Hands (dev account 1 raised them all), and this file's own made
 * with the craft tool (tests/e2e/lib/feat-thank/fixtures.ts): a Hand in the BlacklistToken whose
 * holder is blocked before the thank, a fresh Give for the not-the-raiser test, and a Give whose
 * giver signature was altered. Every amount the screen shows after a thank is compared with what
 * the chain says: token balances before and after, Core's `pending`, `hands` and `thanks`, code.
 */
import { expect, test, type Page } from "@playwright/test";
import { getAddress, isAddressEqual, zeroHash, type Address } from "viem";

import { account, pickDevAccount } from "../lib/accounts";
import { craft, passedAndGiven, setBlocked } from "../lib/feat-thank/fixtures";
import { balanceOf, code, hands, pending, rpc, thanks, type Rpc } from "../lib/rpc";
import { readStand, seed, standSlot, tokenOf, type StandInfo } from "../lib/stand";

test.describe.configure({ mode: "serial" });

interface SeedRun {
  accounts: Record<string, Address>;
  fixtures: {
    give: { handId: string; giveAddress: string; giver: Address };
    resigned: { handId: string; firstGiveAddress: string; secondGiveAddress: string; dropped: { position: number; key: Address; payee: Address | null }[] };
    undeployed: { handId: string; giveAddress: string; account: Address };
    noReward: { handId: string; giveAddress: string };
  };
}

let stand: StandInfo;
let chain: Rpc;
let run: SeedRun;
let usd: Address;
let blacklist: Address;
const BLOCKED = account(7).address;

test.beforeAll(() => {
  stand = readStand();
  chain = rpc(stand.rpc);
  usd = tokenOf(stand, "usd").address;
  blacklist = tokenOf(stand, "blacklist").address;
  run = seed<SeedRun>(standSlot(), ["give", "resigned", "undeployed", "noReward"]);
});

test.afterAll(async () => {
  // Leave the token as the seed expects to find it.
  await setBlocked(chain, blacklist, BLOCKED, false).catch(() => undefined);
});

async function paste(page: Page, address: string): Promise<void> {
  await page.goto("/thank");
  await page.getByTestId("thank-input").fill(address);
  await page.getByTestId("thank-open").click();
}

/** Waits for Core's answer, connects the raiser (dev account 1) and waits for the cost line. */
async function readyToThank(page: Page): Promise<void> {
  await expect(page.getByTestId("thank-predicted")).toBeVisible({ timeout: 20_000 });
  await pickDevAccount(page, 1);
  await expect(page.getByTestId("wallet-connected")).toHaveAttribute("data-value", account(1).address);
  await expect(page.getByTestId("thank-cost")).toContainText(/costs about/, { timeout: 20_000 });
  await expect(page.getByTestId("thank-swipe")).toBeEnabled();
}

async function thankAndWait(page: Page): Promise<void> {
  await page.getByTestId("thank-swipe").click();
  await expect(page.getByTestId("thank-done")).toBeVisible({ timeout: 45_000 });
  // Every receipt row found again in the chain's logs.
  await expect(page.getByTestId("thank-receipt")).not.toHaveAttribute("data-landed", /false|^$/, { timeout: 10_000 });
}

async function payouts(page: Page) {
  return page.getByTestId("thank-payout").evaluateAll((items) =>
    items.map((item) => ({
      kind: item.getAttribute("data-kind")!,
      payee: item.getAttribute("data-payee")! as Address,
      amount: BigInt(item.getAttribute("data-amount")!),
      text: item.textContent ?? "",
    })),
  );
}

test("the give fixture: Core's check, the predicted table, the thanks, and a receipt equal to the balances", async ({ page }) => {
  const { give } = run.fixtures;
  const handId = BigInt(give.handId);
  const holder = run.accounts.holderA!;
  const before = { holder: await balanceOf(chain, usd, holder), giver: await balanceOf(chain, usd, give.giver) };

  await paste(page, give.giveAddress);
  await expect(page.getByTestId("thank-checking")).toBeHidden({ timeout: 20_000 });
  await readyToThank(page);

  const predicted = await page.getByTestId("thank-predicted-row").evaluateAll((rows) => rows.map((row) => [row.getAttribute("data-kind"), row.getAttribute("data-payee"), row.getAttribute("data-amount")]));
  expect(predicted).toEqual([
    ["passed", getAddress(holder), "1500000"],
    ["helped", getAddress(give.giver), "28500000"],
  ]);
  await expect(page.getByTestId("thank-warning")).toHaveText("Saying thanks pays everyone on this route. It can't be undone.");
  // Each row opens its formula.
  await page.getByTestId("thank-predicted-row").first().getByRole("button", { name: /how it's counted/ }).click();
  await expect(page.getByTestId("thank-predicted-row").first()).toContainText("30000000 × 500 ÷ 10 000 = 1500000");

  await thankAndWait(page);
  await expect(page.getByTestId("thank-done")).toContainText("Thanked. Here's who got what — straight from the chain.");

  const rows = await payouts(page);
  expect(rows).toHaveLength(2);
  const after = { holder: await balanceOf(chain, usd, holder), giver: await balanceOf(chain, usd, give.giver) };
  for (const row of rows) {
    expect(row.kind).toBe("paid");
    expect(row.text).toContain("left the contract for");
    expect(row.text).not.toMatch(/received/i);
    const delta = isAddressEqual(row.payee, holder) ? after.holder - before.holder : after.giver - before.giver;
    expect(row.amount).toBe(delta);
  }
  const closed = await hands(chain, stand.core, handId);
  expect(closed.closedAt).toBeGreaterThan(0);
  expect((await thanks(chain, stand.core, handId)).giveHash).not.toBe(zeroHash);
});

test("the undeployed account: the set-up band, two steps, then code, a thanked hand and the helper's money", async ({ page }) => {
  const { undeployed } = run.fixtures;
  const handId = BigInt(undeployed.handId);
  expect(await code(chain, undeployed.account)).toBe("0x");
  const before = await balanceOf(chain, usd, undeployed.account);

  await paste(page, undeployed.giveAddress);
  await expect(page.getByTestId("thank-setup-band")).toContainText("The helper's account isn't set up on this network yet. Saying thanks sets it up first.", { timeout: 20_000 });
  await readyToThank(page);
  await expect(page.getByTestId("thank-two-steps")).toHaveText(
    "Two steps: the first sets up the helper's account, the second says thanks. If you stop after the first, only its cost is spent.",
  );

  await thankAndWait(page);
  const rows = await payouts(page);
  const helper = rows.find((row) => isAddressEqual(row.payee, undeployed.account));
  expect(helper).toBeDefined();
  expect(await code(chain, undeployed.account)).not.toBe("0x");
  const closed = await hands(chain, stand.core, handId);
  expect(closed.closedAt).toBeGreaterThan(0);
  expect((await thanks(chain, stand.core, handId)).giveHash).not.toBe(zeroHash);
  expect((await balanceOf(chain, usd, undeployed.account)) - before).toBe(helper!.amount);
});

test("a hand with no reward: Thanked and Given land, no money row is paid, and no $0 anywhere", async ({ page }) => {
  const { noReward } = run.fixtures;
  await paste(page, noReward.giveAddress);
  await expect(page.getByTestId("thank-no-reward")).toBeVisible({ timeout: 20_000 });
  await pickDevAccount(page, 1);
  await expect(page.getByTestId("thank-cost")).toContainText(/costs about/, { timeout: 20_000 });
  await expect(page.getByTestId("thank-warning")).toHaveText("Saying thanks closes this hand for good. It can't be undone.");
  await thankAndWait(page);

  await page.getByRole("button", { name: /What the chain recorded/ }).click();
  const events = await page.getByTestId("thank-receipt-event").evaluateAll((items) => items.map((item) => item.getAttribute("data-value")));
  expect(events).toEqual(["Thanked", "Given"]);
  expect(await page.getByTestId("thank-payout").count()).toBe(0);
  await expect(page.getByTestId("thank-no-money")).toBeVisible();
  await expect(page.getByTestId("shell-main")).not.toContainText("$0");
  expect((await hands(chain, stand.core, BigInt(noReward.handId))).closedAt).toBeGreaterThan(0);
});

test("the re-signed pair: the second shows the dropped holder and its share, and only ticking it unlocks the thanks", async ({ page }) => {
  const { resigned } = run.fixtures;
  const dropped = resigned.dropped[0]!;
  expect(dropped.payee).not.toBeNull();

  await paste(page, resigned.firstGiveAddress);
  await expect(page.getByTestId("thank-predicted")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("thank-resigned")).toHaveCount(0);

  await paste(page, resigned.secondGiveAddress);
  const band = page.getByTestId("thank-resigned");
  await expect(band).toBeVisible({ timeout: 20_000 });
  await expect(band).toContainText("This answer came by a shorter route than one you already saw.");
  const row = page.getByTestId("thank-dropped");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-payee", dropped.payee!);
  await expect(row.locator("s")).toContainText(dropped.payee!);
  await expect(row.locator("s")).toContainText("kept 5%");
  await expect(page.getByTestId("thank-first-seen")).toContainText("First seen on this device");

  await pickDevAccount(page, 1);
  await expect(page.getByTestId("wallet-connected")).toHaveAttribute("data-value", account(1).address);
  await expect(page.getByTestId("thank-swipe")).toBeDisabled();
  await expect(page.getByTestId("thank-anyway")).toBeDisabled();
  await page.getByTestId("thank-dropped-tick").check();
  await expect(page.getByTestId("thank-anyway")).toBeEnabled();
  await expect(page.getByTestId("thank-swipe")).toBeDisabled();
  await page.getByTestId("thank-anyway").click();
  await expect(page.getByTestId("thank-swipe")).toBeEnabled({ timeout: 20_000 });
  // Nothing was sent: the Hand is still open.
  expect((await hands(chain, stand.core, BigInt(resigned.handId))).closedAt).toBe(0);
});

test("a giver signature that was altered: the refusal's sentence, and never the word answer", async ({ page }) => {
  const fresh = passedAndGiven({ reward: "12" });
  const tampered = craft<{ address: string }>("tamper", fresh.given.address, "--how", "giver-sig");
  await paste(page, tampered.address);
  const error = page.getByTestId("thank-error");
  await expect(error).toContainText("The helper's confirmation doesn't check out.", { timeout: 20_000 });
  await expect(error).toHaveAttribute("data-value", "InvalidGiverSig");
  await expect(page.getByTestId("shell-main")).not.toContainText(/answer/i);
  await expect(page.getByTestId("thank-swipe")).toHaveCount(0);
  await expect(page.getByTestId("thank-predicted")).toHaveCount(0);
});

test("the BlacklistToken fixture: the blocked payee's row reads waiting for, equal to pending on chain", async ({ page }) => {
  const fixture = passedAndGiven({ token: "blacklist", reward: "50", keepBps: 1_000, payeeAccount: 7, title: "Who can find me a used cargo bike?" });
  await setBlocked(chain, blacklist, BLOCKED, true);
  const before = await pending(chain, stand.core, blacklist, BLOCKED);

  await paste(page, fixture.given.address);
  await readyToThank(page);
  await thankAndWait(page);

  const rows = await payouts(page);
  const waiting = rows.find((row) => isAddressEqual(row.payee, BLOCKED));
  expect(waiting?.kind).toBe("waiting");
  expect(waiting?.text).toContain("is waiting for");
  expect(waiting?.text).not.toMatch(/received/i);
  const after = await pending(chain, stand.core, blacklist, BLOCKED);
  expect(after - before).toBe(waiting!.amount);
  expect(waiting!.amount).toBe(5_000_000n);
});

test("a second account connected, not the raiser: stopped before sending with the NotRaiser sentence", async ({ page }) => {
  const fresh = passedAndGiven({ reward: "9" });
  await paste(page, fresh.given.address);
  await expect(page.getByTestId("thank-predicted")).toBeVisible({ timeout: 20_000 });
  await pickDevAccount(page, 2);
  await expect(page.getByTestId("wallet-connected")).toHaveAttribute("data-value", account(2).address);
  const error = page.getByTestId("thank-error");
  await expect(error).toHaveAttribute("data-value", "NotRaiser");
  await expect(error).toContainText("Only the account that raised this hand can do that.");
  await expect(page.getByTestId("thank-swipe")).toBeDisabled();
  expect((await hands(chain, stand.core, fresh.handId)).closedAt).toBe(0);
});
