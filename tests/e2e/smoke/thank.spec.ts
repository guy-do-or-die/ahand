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
 * the chain says: token balances before and after, Core's `pending`, `hands` and `thanks`, code;
 * what the thanks cost is compared with the transaction's own receipt and with the ETH that left
 * the asker's account.
 */
import { expect, test, type Page } from "@playwright/test";
import { formatEther, getAddress, isAddressEqual, zeroHash, type Address, type Hex } from "viem";

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

const FINE_PRINT = {
  en: "If a payout can't move, it waits in the contract until whoever it belongs to takes it out — or anyone delivers it to that address.",
  ru: "Если выплата не сможет пройти, она подождёт в контракте, пока её не заберёт тот, кому она причитается, — или кто угодно не доставит её на этот адрес.",
};

/** The fine print under "who gets what": the human voice (sentence case, not mono), and no owner in it. */
async function expectFinePrint(page: Page, lang: "en" | "ru"): Promise<void> {
  const line = page.getByTestId("thank-predicted").getByText(FINE_PRINT[lang], { exact: true });
  await expect(line).toBeVisible();
  await expect(line).toHaveClass(/(^|\s)ah-label(\s|$)/);
  const style = await line.evaluate((node) => {
    const computed = getComputedStyle(node);
    return { transform: computed.textTransform, family: computed.fontFamily };
  });
  expect(style.transform).toBe("none");
  expect(style.family).not.toMatch(/mono/i);
  await expect(page.getByTestId("thank-predicted")).not.toContainText(/owner|владел/i);
}

interface SpentRow {
  hash: Hex;
  from: Address;
  block: bigint;
  gasUsed: bigint;
  fee: bigint;
  text: string;
}

/** What the done state says the thanks cost: the block's totals, and each transaction's line read with its disclosure open. */
async function spent(page: Page): Promise<{ count: number; gasUsed: bigint; fee: bigint; sentence: string; rows: SpentRow[] }> {
  const block = page.getByTestId("thank-spent");
  await expect(block).toHaveAttribute("data-status", "read", { timeout: 15_000 });
  const toggle = block.getByRole("button", { name: /The transaction/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const rows = await block.getByTestId("thank-spent-tx").evaluateAll((items) =>
    items.map((item) => ({
      hash: item.getAttribute("data-hash")!,
      from: item.getAttribute("data-from")!,
      block: item.getAttribute("data-block")!,
      gasUsed: item.getAttribute("data-gas-used")!,
      fee: item.getAttribute("data-fee")!,
      text: item.textContent ?? "",
    })),
  );
  return {
    count: Number(await block.getAttribute("data-count")),
    gasUsed: BigInt((await block.getAttribute("data-gas-used"))!),
    fee: BigInt((await block.getAttribute("data-fee"))!),
    sentence: (await block.getByTestId("thank-spent-sentence").textContent()) ?? "",
    rows: rows.map((row) => ({ hash: row.hash as Hex, from: row.from as Address, block: BigInt(row.block), gasUsed: BigInt(row.gasUsed), fee: BigInt(row.fee), text: row.text })),
  };
}

/** Digits in threes with a no-break space, as the lens writes whole numbers. */
const grouped = (value: bigint) => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");

/** Each transaction line against its own receipt on the chain: the sender, the block, the gas used and the fee. */
async function expectRowsMatchReceipts(rows: SpentRow[]): Promise<bigint> {
  let total = 0n;
  for (const row of rows) {
    const receipt = await chain.client.getTransactionReceipt({ hash: row.hash });
    const fee = receipt.gasUsed * receipt.effectiveGasPrice;
    expect(isAddressEqual(row.from, receipt.from)).toBe(true);
    expect(row.block).toBe(receipt.blockNumber);
    expect(row.gasUsed).toBe(receipt.gasUsed);
    expect(row.fee).toBe(fee);
    expect(row.text).toContain(row.hash);
    expect(row.text).toContain(getAddress(receipt.from));
    expect(row.text).toContain(`gas used ${grouped(receipt.gasUsed)}`);
    expect(row.text).toContain(`fee ${formatEther(fee)} ETH`);
    expect(row.text).toContain(`block ${grouped(receipt.blockNumber)}`);
    total += fee;
  }
  return total;
}

test("the give fixture: Core's check, the predicted table, the thanks, and a receipt equal to the balances", async ({ page }) => {
  const { give } = run.fixtures;
  const handId = BigInt(give.handId);
  const holder = run.accounts.holderA!;
  const before = { holder: await balanceOf(chain, usd, holder), giver: await balanceOf(chain, usd, give.giver) };

  await paste(page, give.giveAddress);
  await expect(page.getByTestId("thank-checking")).toBeHidden({ timeout: 20_000 });
  await readyToThank(page);
  await expectFinePrint(page, "en");
  const ethBefore = await chain.client.getBalance({ address: account(1).address });

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
  await expect(page.getByTestId("thank-done")).toContainText("Thanked. Here's every payout — straight from the chain.");

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

  // What it cost: one transaction, its line equal to its receipt, and the fee equal to the ETH that left the asker.
  const cost = await spent(page);
  expect(cost.count).toBe(1);
  expect(cost.rows).toHaveLength(1);
  expect(cost.rows[0]!.hash).toBe((await page.getByTestId("thank-done").getAttribute("data-hash")) as Hex);
  expect(isAddressEqual(cost.rows[0]!.from, account(1).address)).toBe(true);
  expect(await expectRowsMatchReceipts(cost.rows)).toBe(cost.fee);
  expect(cost.gasUsed).toBe(cost.rows[0]!.gasUsed);
  expect(ethBefore - (await chain.client.getBalance({ address: account(1).address }))).toBe(cost.fee);
  expect(cost.sentence).toMatch(/^Saying thanks cost about \$\d[\d.]* · prices of \d+ \w+$/);
  // The estimate shown before sending is gone; what stands now is what was used.
  await expect(page.getByTestId("thank-cost")).toHaveCount(0);
});

test("the same answer opened again after the thanks: the receipt and what it cost are read back from the chain", async ({ page }) => {
  // The give fixture was thanked by the test above; this page sent nothing and holds no receipt.
  const { give } = run.fixtures;
  await paste(page, give.giveAddress);
  const done = page.getByTestId("thank-done");
  await expect(done).toContainText("This hand was thanked for this answer.", { timeout: 20_000 });
  await expect(page.getByTestId("thank-swipe")).toHaveCount(0);

  const cost = await spent(page);
  expect(cost.count).toBe(1);
  expect(cost.rows[0]!.hash).toBe((await done.getAttribute("data-hash")) as Hex);
  expect(isAddressEqual(cost.rows[0]!.from, account(1).address)).toBe(true);
  expect(await expectRowsMatchReceipts(cost.rows)).toBe(cost.fee);
  // The block's time is the chain's: the line names the block the receipt names, with a time after it.
  expect(cost.rows[0]!.text).toMatch(new RegExp(`block ${grouped(cost.rows[0]!.block)} · \\d+ \\w+ \\d\\d:\\d\\d`));
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
  const ethBefore = await chain.client.getBalance({ address: account(1).address });

  await thankAndWait(page);
  const rows = await payouts(page);
  const helper = rows.find((row) => isAddressEqual(row.payee, undeployed.account));
  expect(helper).toBeDefined();
  expect(await code(chain, undeployed.account)).not.toBe("0x");
  const closed = await hands(chain, stand.core, handId);
  expect(closed.closedAt).toBeGreaterThan(0);
  expect((await thanks(chain, stand.core, handId)).giveHash).not.toBe(zeroHash);
  expect((await balanceOf(chain, usd, undeployed.account)) - before).toBe(helper!.amount);

  // What it cost: both steps, each line equal to its own receipt, together the ETH that left the asker.
  const cost = await spent(page);
  expect(cost.count).toBe(2);
  expect(cost.rows).toHaveLength(2);
  expect(cost.rows[1]!.hash).toBe((await page.getByTestId("thank-done").getAttribute("data-hash")) as Hex);
  expect(cost.rows[0]!.text).toContain("Setting up the helper's account");
  expect(cost.rows[1]!.text).toContain("Saying thanks");
  expect(await expectRowsMatchReceipts(cost.rows)).toBe(cost.fee);
  expect(cost.gasUsed).toBe(cost.rows[0]!.gasUsed + cost.rows[1]!.gasUsed);
  expect(ethBefore - (await chain.client.getBalance({ address: account(1).address }))).toBe(cost.fee);
  expect(cost.sentence).toMatch(/^Both steps together cost about \$\d[\d.]* · prices of \d+ \w+$/);
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
  // No amount of nothing anywhere ("$0", "$0.00"); what the thanks cost ("$0.43") is not one.
  await expect(page.getByTestId("shell-main")).not.toContainText(/\$0(?:[.,]0+)?(?![.,]?\d)/);
  expect((await spent(page)).count).toBe(1);
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
  // The rail puts the dropped holder back at its place, crossed out with its share (UX-SPEC §7.5.2).
  const left = page.locator('.ah-rail [data-dropped="true"]');
  await expect(left).toHaveCount(1);
  await expect(left.locator("s").first()).toContainText(`${dropped.payee!.slice(0, 6)}`);
  await expect(left).toContainText("5%");
  await expect(left).toContainText("left out of this route");
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

test("in Russian: the fine print names no owner in the human voice, and the done state says what was spent", async ({ page }) => {
  const fresh = passedAndGiven({ reward: "15" });
  await page.goto("/thank");
  await page.getByTestId("shell-lang-ru").click();
  await page.getByTestId("thank-input").fill(fresh.given.address);
  await page.getByTestId("thank-open").click();
  await expect(page.getByTestId("thank-predicted")).toBeVisible({ timeout: 20_000 });
  await expectFinePrint(page, "ru");

  await pickDevAccount(page, 1);
  await expect(page.getByTestId("thank-cost")).toContainText(/стоит около/, { timeout: 20_000 });
  await thankAndWait(page);

  const block = page.getByTestId("thank-spent");
  await expect(block).toHaveAttribute("data-status", "read", { timeout: 15_000 });
  await expect(block.getByTestId("thank-spent-sentence")).toHaveText(/^Спасибо стоило около \$\d[\d,]* · цены на \d+ \S+$/);
  await block.getByRole("button", { name: /Транзакция/ }).click();
  const receipt = await chain.client.getTransactionReceipt({ hash: (await page.getByTestId("thank-done").getAttribute("data-hash")) as Hex });
  await expect(block.getByTestId("thank-spent-tx")).toContainText(`потрачено gas ${grouped(receipt.gasUsed)}`);
  await expect(block.getByTestId("thank-spent-tx")).toContainText(`от ${getAddress(receipt.from)}`);
  await expect(block.getByTestId("thank-spent-tx")).toContainText(`плата ${formatEther(receipt.gasUsed * receipt.effectiveGasPrice)} ETH`);
  await expect(page.getByTestId("thank-done")).not.toContainText(/владел/i);
});
