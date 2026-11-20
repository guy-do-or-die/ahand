/**
 * /raise in a real browser against the stand's chain (PLAN wave 4, feat-raise; UX-SPEC §7.2).
 *
 *   STAND_SLOT=1 bunx playwright test tests/e2e/smoke/raise.spec.ts
 *
 * Each test raises its own Hands through the screen with the dev wallet and checks them on the
 * chain afterwards: hands(id), handsCount, the raiser's nonce, the address opened by the craft tool
 * and by a second browser context. Time is read from the chain only.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createWalletClient, erc20Abi, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { account } from "../lib/accounts";
import { chainNow, handsCount, hands, pauseBlocks, resumeBlocks, rpc, type Rpc } from "../lib/rpc";
import { readStand, tokenOf, type StandInfo } from "../lib/stand";
import { BATCH_WALLET_NAME, injectBatchWallet } from "../lib/feat-raise/batch-wallet";
import { answerPrompts, compose, copied, craft, dumpDb, escrowKeys, keptHands, swipe, swipeWith } from "../lib/feat-raise/raise";

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

/** With RAISE_SHOTS_DIR set, the states this file reaches are also kept as pictures there. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.RAISE_SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

async function fresh(browser: Browser, prepare?: (context: BrowserContext) => Promise<void>): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await prepare?.(context);
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

test("the compose state: one level-one heading bound to its field, the asker in words before an account is connected, and the caps hold", async ({ browser }) => {
  const { context, page } = await fresh(browser);

  // The page's question is its heading, and still the field's label.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What are you looking for?");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByLabel("What are you looking for?")).toHaveAttribute("data-testid", "raise-what");

  // No account yet: the preview names no address, least of all the zero one.
  await page.getByTestId("raise-what").fill("A quiet room in Tbilisi for a week");
  const preview = page.getByTestId("raise-preview");
  // The card's own "Asked by" row says the address comes once an account is connected (the fix round's F5).
  await expect(preview.locator('.ah-deal__foot[data-raiser="later"]')).toHaveText(/Asked by\s*your address, once you connect/);
  await expect(preview).toHaveAttribute("data-raiser", "none");
  expect(await preview.innerText()).not.toMatch(/0x[0-9a-fA-F]/);
  await shot(page, "smoke-compose-no-account");

  // The title: 160 characters fit, the 161st stops the swipe and says why.
  await expect(page.getByTestId("raise-title-count")).toHaveText("Title: 34 of 160 characters");
  await expect(page.getByTestId("raise-swipe")).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId("raise-what").fill("t".repeat(161));
  await expect(page.getByTestId("raise-title-count")).toHaveText("Title: 161 of 160 characters");
  await expect(page.getByTestId("raise-title-count")).toHaveAttribute("data-over", "true");
  await expect(page.getByTestId("raise-too-long")).toHaveText("The title is too long: 161 of 160 characters. Move the rest to the details.");
  await expect(page.getByTestId("raise-swipe")).toBeDisabled();
  await shot(page, "smoke-title-too-long");
  await page.getByTestId("raise-what").fill("t".repeat(160));
  await expect(page.getByTestId("raise-too-long")).toHaveCount(0);
  await expect(page.getByTestId("raise-swipe")).toBeEnabled();

  // The details: the field stops at 1000 characters.
  await page.getByTestId("raise-details-toggle").click();
  await page.getByTestId("raise-details").fill("d".repeat(1200));
  expect((await page.getByTestId("raise-details").inputValue()).length).toBe(1000);
  await expect(page.getByTestId("raise-details-count")).toHaveText("Details: 1000 of 1000 characters");
  await expect(page.getByTestId("raise-swipe")).toBeEnabled();
  // Lines after the first are details too: with them the details are over, and the swipe waits.
  await page.getByTestId("raise-what").fill(`A quiet room\n${"x".repeat(9)}`);
  await expect(page.getByTestId("raise-details-count")).toHaveText("Details: 1011 of 1000 characters");
  await expect(page.getByTestId("raise-too-long")).toHaveAttribute("data-value", "details");
  await expect(page.getByTestId("raise-swipe")).toBeDisabled();
  await page.getByTestId("raise-what").fill("A quiet room in Tbilisi for a week");
  await page.getByTestId("raise-details").fill("June 3 to 10.");
  await expect(page.getByTestId("raise-swipe")).toBeEnabled();

  // The keys card: its toggle is a short sentence that fits the phone; the exact message is inside, wrapped.
  await page.getByTestId("raise-swipe").click();
  await page.getByTestId("dev-account-2").click();
  const card = page.getByTestId("raise-keys-card");
  await expect(card).toBeVisible();
  const toggle = card.getByRole("button", { name: "What exactly you are confirming" });
  const width = page.viewportSize()!.width;
  const box = (await toggle.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  await toggle.click();
  const message = page.getByTestId("raise-keys-what");
  await expect(message).toContainText("Keys(string purpose, address raiser)");
  const inside = (await message.boundingBox())!;
  expect(inside.x + inside.width).toBeLessThanOrEqual(width);
  await shot(page, "smoke-keys-card");

  // "Not now": nothing was asked of the account, nothing is kept.
  const count = await handsCount(chain, stand.core);
  await card.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByTestId("raise-error")).toHaveAttribute("data-value", "common.error.refused");
  expect(await keptHands(page)).toEqual([]);
  expect(await handsCount(chain, stand.core)).toBe(count);
  await context.close();
});

test("a public hand with its words at the caps: what stands before # stays under 8 KB, is served, and opens", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  // Three-byte characters: the heaviest words the fields take, counted in the address.
  const title = "手".repeat(160);
  const details = "助".repeat(1000);
  await compose(page, { title, details, reward: "5", mode: "public" });
  await expect(page.getByTestId("raise-title-count")).toHaveText("Title: 160 of 160 characters");
  await expect(page.getByTestId("raise-details-count")).toHaveText("Details: 1000 of 1000 characters");
  await expect(page.getByTestId("raise-too-long")).toHaveCount(0);
  await swipe(page, 1);
  const { handId } = await upOf(page);

  const address = await copied(page);
  const before = address.slice(0, address.indexOf("#"));
  expect(before.length).toBeGreaterThan(4000);
  expect(before.length).toBeLessThanOrEqual(8000);
  expect((await fetch(before)).status).toBe(200);
  const opened = craft<{ handId: string; shape: string; description: { status: string; title: string; content: string } }>("open", address);
  expect(opened.handId).toBe(handId.toString());
  expect(opened.shape).toBe("faced");
  expect(opened.description).toMatchObject({ status: "attached", title, content: details });
  await context.close();
});

test("a wallet that takes approve and raise as one batch: a reload before the batch's hash is known keeps the record and the locked seed, and the account that sent it finds the hand", async ({ browser }) => {
  // Account 3 has never let Core spend for it here, so the raise is two calls and goes as a batch.
  let wallet!: Awaited<ReturnType<typeof injectBatchWallet>>;
  const { context, page } = await fresh(browser, async (ctx) => {
    wallet = await injectBatchWallet(ctx, stand.rpc, account(3).privateKey, { differs: true });
  });
  const usd = tokenOf(stand, "usd").address;
  const balanceOf = (who: Address) => chain.client.readContract({ address: usd, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  // Whatever an earlier run left: no allowance, so the approve is needed again.
  const reset = createWalletClient({ account: privateKeyToAccount(account(3).privateKey), chain: foundry, transport: http(stand.rpc) });
  await chain.client.waitForTransactionReceipt({ hash: await reset.writeContract({ address: usd, abi: erc20Abi, functionName: "approve", args: [stand.core, 0n] }) });

  const title = `One batch ${Date.now() % 100000}`;
  await compose(page, { title, details: "Approve and raise, in the wallet's hands as one.", reward: "5" });
  const count = await handsCount(chain, stand.core);
  const nonce = await chain.client.getTransactionCount({ address: wallet.address });
  const held = await balanceOf(wallet.address);
  await swipeWith(page, BATCH_WALLET_NAME);

  // The wallet took the batch (one ask, two calls) and still calls it pending; the chain has the hand.
  await expect.poll(() => wallet.batches().length, { timeout: 20_000 }).toBe(1);
  expect(wallet.batches()[0]!.hashes.length).toBe(2);
  await expect.poll(() => handsCount(chain, stand.core), { timeout: 20_000 }).toBe(count + 1n);
  expect(held - (await balanceOf(wallet.address))).toBe(5n * USD);
  const batchId = wallet.batches()[0]!.id;

  // The device kept the record under the batch's id before any hash was known, and the locked seed.
  await expect.poll(async () => (await keptHands(page)).map((h) => [h.status, h.batchId, h.txHash ?? null]), { timeout: 20_000 }).toEqual([["sent", batchId, null]]);
  expect(await escrowKeys(page)).toHaveLength(1);
  await expect(page.getByTestId("raise-tx-rail")).toHaveAttribute("data-value", "sent");

  // The reload: the follow is gone, the wallet is no longer connected.
  await page.reload();
  const pending = page.getByTestId("raise-pending");
  await expect(pending).toBeVisible({ timeout: 20_000 });
  await expect(pending).toContainText("Your last raise is still on its way.");
  await expect(pending).toHaveAttribute("data-batch", batchId);
  await expect(page.getByTestId("raise-error")).toHaveAttribute("data-value", "raise.error.connectToLook");
  await shot(page, "smoke-batch-pending-connect");

  // Another account cannot know this batch, and is told so.
  await page.getByTestId("raise-pending-connect").click();
  await page.getByTestId("dev-account-2").click();
  await expect(page.getByTestId("raise-error")).toHaveAttribute("data-value", "raise.error.otherAccount");
  await expect(page.getByTestId("raise-error")).toContainText(wallet.address);
  await shot(page, "smoke-batch-pending-other-account");

  // The account that sent it: the screen asks the wallet for the batch, and sends nothing.
  const statusAsks = wallet.asked("wallet_getCallsStatus");
  await page.getByTestId("raise-pending-connect").click();
  await page.getByTestId("kit-connect-option").filter({ hasText: BATCH_WALLET_NAME }).click();
  await expect.poll(() => wallet.asked("wallet_getCallsStatus"), { timeout: 20_000 }).toBeGreaterThan(statusAsks);
  await expect(pending).toBeVisible();
  await expect(page.getByTestId("raise-error")).toHaveCount(0);

  // The wallet names the batch's hash: the hand is up, with its link from the locked copy.
  wallet.report("landed");
  const { handId } = await upOf(page);
  await expect(page.getByTestId("raise-locked-copy")).toContainText("Your account can't rebuild this link later.");
  await shot(page, "smoke-batch-up");
  const row = await hands(chain, stand.core, handId);
  expect(row.raiser).toBe(wallet.address);
  expect(row.reward).toBe(5n * USD);
  const address = await copied(page);
  const opened = craft<{ handId: string; description: { status: string; title: string } }>("open", address);
  expect(opened.handId).toBe(handId.toString());
  expect(opened.description).toMatchObject({ status: "attached", title });

  // Nothing was sent twice: one batch, two actions from the account, one hand.
  expect(wallet.asked("wallet_sendCalls")).toBe(1);
  expect(wallet.asked("eth_sendTransaction")).toBe(0);
  expect(await chain.client.getTransactionCount({ address: wallet.address })).toBe(nonce + 2);
  expect(await handsCount(chain, stand.core)).toBe(count + 1n);
  const [kept] = await keptHands(page);
  expect(kept).toMatchObject({ status: "up", batchId, handId: handId.toString(), txHash: wallet.batches()[0]!.hashes[1] });
  await context.close();
});
