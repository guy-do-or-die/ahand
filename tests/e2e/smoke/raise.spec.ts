/**
 * /raise in a real browser against the stand's chain (PLAN wave 4, feat-raise; UX-SPEC §7.2).
 *
 *   STAND_SLOT=1 bunx playwright test tests/e2e/smoke/raise.spec.ts
 *
 * Each test raises its own Hands through the screen with the dev wallet and checks them on the
 * chain afterwards: hands(id), handsCount, the raiser's nonce, the address opened by the craft tool
 * and by a second browser context. Time is read from the chain only.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createWalletClient, erc20Abi, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { account } from "../lib/accounts";
import { chainNow, handsCount, hands, pauseBlocks, resumeBlocks, rpc, type Rpc } from "../lib/rpc";
import { readStand, tokenOf, type StandInfo } from "../lib/stand";
import { answerPrompts, compose, copied, craft, dumpDb, escrowKeys, swipe } from "../lib/feat-raise/raise";

const DAY = 86_400;
const USD = 1_000_000n;

test.describe.configure({ mode: "serial" });

let stand: StandInfo;
let chain: Rpc;

test.beforeAll(() => {
  stand = readStand();
  chain = rpc(stand.rpc);
});

test.afterEach(async () => {
  // A failed pause test must not leave the stand without blocks.
  await resumeBlocks(chain);
});

async function fresh(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/raise");
  await expect(page.getByTestId("raise-what")).toBeVisible({ timeout: 20_000 });
  return { context, page };
}

interface Seen {
  handId: bigint;
  dataHash: Hex;
}

async function upOf(page: Page): Promise<Seen> {
  const up = page.getByTestId("raise-up");
  await expect(up).toBeVisible({ timeout: 30_000 });
  await expect(up).toContainText(/Your hand is up\.|Рука поднята\./);
  return { handId: BigInt((await up.getAttribute("data-hand-id"))!), dataHash: (await up.getAttribute("data-data-hash")) as Hex };
}

async function openedTitle(browser: Browser, address: string): Promise<string> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(address);
  const card = page.getByTestId("hand-deal-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  const text = await card.innerText();
  await context.close();
  return text;
}

test("an unlisted hand of 50 test dollars: up, on chain with the network's 30 days, and the copied address opens elsewhere", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  const title = `A quiet room in Tbilisi for a week ${Date.now() % 100000}`;
  await compose(page, { title, details: "June 3 to 10, up to $40 a night.", reward: "50" });
  const before = await chainNow(chain);
  await swipe(page, 1);
  const { handId, dataHash } = await upOf(page);

  const row = await hands(chain, stand.core, handId);
  expect(row.raiser).toBe(account(1).address);
  expect(row.reward).toBe(50n * USD);
  expect(row.dataHash).toBe(dataHash);
  expect(row.expiry).toBeGreaterThanOrEqual(before.timestamp + 30 * DAY);
  expect(row.expiry).toBeLessThanOrEqual(row.openedAt + 30 * DAY);

  const address = await copied(page);
  expect(address).toMatch(new RegExp(`/31337/${handId}\\?d=[A-Za-z0-9_-]+#[A-Za-z0-9_-]+$`));
  const opened = craft<{ ok: boolean; handId: string; shape: string; description: { status: string; title: string; content: string } }>("open", address);
  expect(opened.shape).toBe("faced");
  expect(opened.description.status).toBe("attached");
  expect(opened.description.title).toBe(title);

  const shown = await openedTitle(browser, address);
  expect(shown).toContain(title);
  expect(shown).toContain("$50");
  await context.close();
});

test("dark at 180 days, public, and one with no reward (no approve); each holds describeHand's dataHash; root keys differ", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  const raiser = account(1).address;
  const rootKeys: Address[] = [];

  // Dark, the 180-day chip: the contract's cap less ten minutes, never refused as too late.
  await compose(page, { title: "Someone who repairs film cameras", details: "A Zenit E, the shutter sticks.", reward: "5", days: 180, mode: "dark" });
  await swipe(page, 1);
  let seen = await upOf(page);
  let row = await hands(chain, stand.core, seen.handId);
  expect(row.dataHash).toBe(seen.dataHash);
  const cap = Number(await chain.client.readContract({ address: stand.core, abi: [{ type: "function", name: "MAX_EXPIRY_PERIOD", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }], functionName: "MAX_EXPIRY_PERIOD" }));
  expect(row.expiry).toBeLessThanOrEqual(row.openedAt + cap - 600);
  expect(row.expiry).toBeGreaterThan(row.openedAt + cap - 700);
  rootKeys.push(row.rootKey);
  const dark = await copied(page);
  expect(dark).toMatch(/\/#[A-Za-z0-9_-]+$/);
  expect(craft<{ description: { title: string } }>("open", dark).description.title).toBe("Someone who repairs film cameras");

  // Public.
  await page.getByRole("button", { name: /Raise another hand/ }).click();
  await compose(page, { title: "A bass player for Saturday", details: "Jazz standards, two sets.", reward: "20", mode: "public" });
  await swipe(page, 1);
  seen = await upOf(page);
  row = await hands(chain, stand.core, seen.handId);
  expect(row.dataHash).toBe(seen.dataHash);
  rootKeys.push(row.rootKey);
  const pub = craft<{ shape: string; description: { content: string } }>("open", await copied(page));
  expect(pub.shape).toBe("faced");
  expect(pub.description.content).toBe("Jazz standards, two sets.");

  // No reward: "your call" at zero; exactly one action leaves the account (no approve).
  await page.getByRole("button", { name: /Raise another hand/ }).click();
  await compose(page, { title: "A thank-you for a good book tip", reward: { custom: "0" } });
  await expect(page.getByTestId("raise-no-reward")).toBeVisible();
  await expect(page.getByTestId("raise-preview")).toContainText("No reward: a thank-you only");
  const nonce = await chain.client.getTransactionCount({ address: raiser });
  await swipe(page, 1);
  seen = await upOf(page);
  row = await hands(chain, stand.core, seen.handId);
  expect(row.reward).toBe(0n);
  expect(row.dataHash).toBe(seen.dataHash);
  expect(await chain.client.getTransactionCount({ address: raiser })).toBe(nonce + 1);
  rootKeys.push(row.rootKey);

  expect(new Set(rootKeys.map((key) => key.toLowerCase())).size).toBe(3);
  await context.close();
});

/** Lets the raiser's account spend `amount` for Core from the test side, so a paused chain holds only the raise. */
async function preApprove(index: number, amount: bigint): Promise<void> {
  const wallet = createWalletClient({ account: privateKeyToAccount(account(index).privateKey), chain: foundry, transport: http(stand.rpc) });
  const hash = await wallet.writeContract({ address: tokenOf(stand, "usd").address, abi: erc20Abi, functionName: "approve", args: [stand.core, amount] });
  await chain.client.waitForTransactionReceipt({ hash });
}

async function pausedRaise(page: Page, index: number): Promise<bigint> {
  await compose(page, { title: `Paused raise ${index} ${Date.now() % 100000}`, details: "Sent while no blocks are made.", reward: "5" });
  await expect(page.getByTestId("raise-swipe")).toBeEnabled({ timeout: 15_000 });
  const count = await handsCount(chain, stand.core);
  await pauseBlocks(chain);
  await page.getByTestId("raise-swipe").click();
  await answerPrompts(page, index);
  // The raise is in the pool and its hash is on the device before the reload.
  await expect.poll(async () => JSON.parse(await dumpDb(page)).hands.some((h: { status?: string }) => h.status === "sent"), { timeout: 20_000 }).toBe(true);
  await page.reload();
  await expect(page.getByTestId("raise-pending")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("raise-pending")).toContainText("Your last raise is still on its way.");
  await resumeBlocks(chain);
  return count;
}

test("a reload while the raise waits for a block sends nothing again, and the screen resumes", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  await preApprove(1, 5n * USD);
  const count = await pausedRaise(page, 1);
  const { handId } = await upOf(page);
  expect(await handsCount(chain, stand.core)).toBe(count + 1n);
  // Some blocks later still exactly one more.
  await chain.test.mine({ blocks: 3 });
  expect(await handsCount(chain, stand.core)).toBe(count + 1n);

  // An account that repeats gets its link back after one confirmation.
  await page.getByTestId("raise-copy-show").click();
  await answerPrompts(page, 1);
  const address = await copied(page);
  expect(craft<{ handId: string }>("open", address).handId).toBe(handId.toString());
  await context.close();
});

test("an account that answers differently: the link survives the reload from the locked copy; no seed in clear storage; the tick empties escrow", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  await preApprove(5, 5n * USD);
  const count = await pausedRaise(page, 5);
  const { handId } = await upOf(page);
  expect(await handsCount(chain, stand.core)).toBe(count + 1n);
  await expect(page.getByTestId("raise-locked-copy")).toContainText("Your account can't rebuild this link later.");

  const address = await copied(page);
  const opened = craft<{ handId: string; description: { status: string } }>("open", address);
  expect(opened.handId).toBe(handId.toString());
  expect(opened.description.status).toBe("attached");
  const shown = await openedTitle(browser, address);
  expect(shown).toContain("Paused raise 5");

  const forms = craft<{ hex: string; base64url: string; digits: string }>("secrets", address);
  const search = (dump: string) => [forms.hex, forms.base64url, forms.digits].filter((form) => dump.toLowerCase().includes(form.toLowerCase()));
  const before = await dumpDb(page);
  expect(JSON.parse(before).escrow.length).toBe(1);
  expect(search(before)).toEqual([]);

  await page.getByTestId("raise-saved-tick").check();
  await expect(page.getByTestId("raise-copy-gone")).toBeVisible();
  expect(await escrowKeys(page)).toEqual([]);
  expect(search(await dumpDb(page))).toEqual([]);
  await context.close();
});
