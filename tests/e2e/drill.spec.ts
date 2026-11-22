/**
 * The survival drill, browser half. Three
 * people, each in a fresh browser context, while the stand's servers are switched off one at a
 * time with the stand's own commands; after each step Core's state is read back by RPC.
 *
 *   bun infra/stand/stand.ts up --slot 7          # built, not --dev: the drill needs real files
 *   STAND_SLOT=7 bunx playwright test tests/e2e/drill.spec.ts
 *
 * 1. The view server off, static.ts on: a holder with no wallet opens a dark link and passes it on at 0%.
 * 2. The relay off too: the helper answers that passed link and sees the fallback sentence; the
 *    asker pastes the give address on /thank and thanks. The money is read back from the chain.
 * 3. The site off too, nothing listens on the site or relay port: dist/exit.html, opened from
 *    disk with the test-injected provider, refunds an expired Hand and delivers a pending payout.
 *
 * afterAll starts again what was switched off (relay; the site as the view server or static.ts, as it was).
 * A rehearsal on a local chain: no real browser wallet took part.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { isAddressEqual, zeroHash, type Address, type Hex } from "viem";

import { account, pickDevAccount } from "./lib/accounts";
import { listening } from "./lib/drill/ports";
import { injectWallet, rpcCall } from "./lib/exit-page/provider";
import { balanceOf, hands, pending, rpc, thanks, type Rpc } from "./lib/rpc";
import { readStand, REPO_ROOT, runProgram, seed, standFile, standSlot, startService, stopService, tokenOf, type StandInfo } from "./lib/stand";

test.describe.configure({ mode: "serial" });

/** Screenshots go under AHAND_SHOTS_DIR, by default output/shots in the clone (ignored by git). */
const SHOTS = join(process.env.AHAND_SHOTS_DIR ?? join(REPO_ROOT, "output", "shots"), "build/drill");

interface Fixture {
  handId: string;
  address: string;
  reward: string;
  title: string;
}
interface Run {
  accounts: Record<string, Address>;
  fixtures: {
    dark: Fixture;
    expired: Fixture;
    blocked: Fixture & { pending: { token: Address; payee: Address; amount: string }; unblock: { to: Address; data: Hex } };
  };
}

const slot = standSlot();
const RAISER = account(1);
const HELPER = account(4);

let stand: StandInfo;
let chain: Rpc;
let run: Run;
let ports: { site: number; relay: number; chain: number };
let siteServer: "view" | "static";
/** The address the holder writes in step 1, answered in step 2. */
let passed: string | undefined;

function record(): { server: "view" | "static" | null; ports: { site: number; relay: number; chain: number } } {
  return JSON.parse(readFileSync(standFile(slot), "utf8"));
}

async function person(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  return { context, page };
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

test.beforeAll(() => {
  stand = readStand(slot);
  if (stand.mode !== "built") throw new Error(`slot ${slot} runs in ${stand.mode} mode: the drill needs the built files (bun infra/stand/stand.ts up --slot ${slot})`);
  const at = record();
  ports = at.ports;
  siteServer = at.server ?? "static";
  chain = rpc(stand.rpc);
  run = seed<Run>(slot, ["dark", "expired", "blocked"]);
});

test.afterAll(async () => {
  // Put the slot back as it was found, whatever happened above.
  if (!(await listening(ports.relay))) startService(slot, "relay");
  if ((await listening(ports.site)) && record().server !== siteServer) stopService(slot, "site");
  if (!(await listening(ports.site))) startService(slot, siteServer);
});

test("the view server off, static.ts on: a holder opens a dark link and passes it on at 0%", async ({ browser }) => {
  test.setTimeout(120_000);
  stopService(slot, "site");
  expect(await listening(ports.site)).toBe(false);
  startService(slot, "static");
  expect(record().server).toBe("static");

  const dark = run.fixtures.dark;
  const handId = BigInt(dark.handId);
  const before = await hands(chain, stand.core, handId);
  const holder = await person(browser);
  await holder.page.goto(dark.address);
  await expect(holder.page.getByTestId("hand-deal-card")).toContainText(dark.title, { timeout: 20_000 });
  await expect(holder.page.getByTestId("hand-rail")).toHaveAttribute("data-value", "1");
  // The secret left the address bar as soon as the app read it.
  expect(holder.page.url()).not.toContain("#");
  await shot(holder.page, "1-static-dark-hand-390-en");
  await holder.page.getByTestId("hand-pass").click();
  await expect(holder.page).toHaveURL(/\/pass$/);
  await holder.page.getByTestId("pass-swipe").click();
  await expect(holder.page.getByTestId("pass-read-back")).toHaveAttribute("data-bps", "0", { timeout: 20_000 });
  passed = ((await holder.page.getByTestId("pass-copy").locator(".ah-linkrow__value").textContent()) ?? "").trim();
  expect(passed.startsWith(`${stand.site}/`)).toBe(true);
  expect(passed).toContain("#");
  expect(passed).not.toBe(dark.address);
  await shot(holder.page, "1-static-passed-390-en");
  await holder.context.close();

  // Passing writes nothing on chain: the Hand is as it was.
  const after = await hands(chain, stand.core, handId);
  expect(after.closedAt).toBe(0);
  expect(after.reward).toBe(before.reward);
  // The new address reads back through the SDK as one pass that keeps nothing.
  const { stdout } = runProgram("tests/e2e/lib/craft.ts", ["open", passed, "--slot", String(slot)]);
  const opened = JSON.parse(stdout) as { handId: string; route: { payee: Address | null; keptBps: number }[] };
  expect(String(opened.handId)).toBe(dark.handId);
  expect(opened.route).toEqual([expect.objectContaining({ payee: null, keptBps: 0 })]);
});

test("relay off: the helper sees the fallback sentence, and the asker thanks from the pasted give address", async ({ browser }) => {
  test.setTimeout(150_000);
  expect(passed, "step 1 wrote no passed address").toBeTruthy();
  stopService(slot, "relay");
  expect(await listening(ports.relay)).toBe(false);

  const dark = run.fixtures.dark;
  const handId = BigInt(dark.handId);
  const usd = tokenOf(stand, "usd").address;
  const helperBefore = await balanceOf(chain, usd, HELPER.address);

  // The helper opens the passed address and answers with dev account 4.
  const helper = await person(browser);
  await helper.page.goto(passed!);
  await expect(helper.page.getByTestId("hand-deal-card")).toContainText(dark.title, { timeout: 20_000 });
  await expect(helper.page.getByTestId("hand-rail")).toHaveAttribute("data-value", "2");
  await helper.page.getByTestId("hand-help").click();
  await expect(helper.page).toHaveURL(/\/give$/);
  await helper.page.getByTestId("give-words").fill("I renewed exactly this permit in March; one call and I'll walk you through it.");
  await helper.page.getByRole("button", { name: "Connect a wallet" }).click();
  await pickDevAccount(helper.page, 4);
  await expect(helper.page.getByTestId("give-agree").locator("[data-payee]")).toHaveAttribute("data-payee", HELPER.address);
  await helper.page.getByTestId("give-swipe").click();
  await expect(helper.page.getByTestId("give-fallback")).toContainText(
    "We couldn't reach them directly. Send this back to whoever sent you the link — each person knows the one before.",
    { timeout: 30_000 },
  );
  const copy = helper.page.getByTestId("give-copy");
  const giveAddress = (await copy.getAttribute("data-value"))!;
  expect(giveAddress.startsWith(`${stand.site}/#`)).toBe(true);
  await shot(helper.page, "2-relay-off-fallback-390-en");
  await helper.page.getByTestId("shell-lang-ru").click();
  await expect(helper.page.getByTestId("give-fallback")).not.toContainText("We couldn't reach them");
  await shot(helper.page, "2-relay-off-fallback-390-ru");
  await helper.context.close();

  // The asker gets the address by hand (any messenger) and pastes it on /thank.
  const asker = await person(browser);
  await asker.page.goto("/thank");
  await asker.page.getByTestId("thank-input").fill(giveAddress);
  await asker.page.getByTestId("thank-open").click();
  await expect(asker.page.getByTestId("thank-predicted")).toBeVisible({ timeout: 20_000 });
  await pickDevAccount(asker.page, 1);
  await expect(asker.page.getByTestId("wallet-connected").first()).toHaveAttribute("data-value", RAISER.address);
  await expect(asker.page.getByTestId("thank-cost")).toContainText(/costs about/, { timeout: 20_000 });
  await asker.page.getByTestId("thank-swipe").click();
  await expect(asker.page.getByTestId("thank-done")).toBeVisible({ timeout: 45_000 });
  await shot(asker.page, "2-relay-off-thanked-390-en");
  await asker.context.close();

  // Core: closed as thanked, and the whole reward reached the helper (the one pass kept 0%).
  const closed = await hands(chain, stand.core, handId);
  expect(closed.closedAt).toBeGreaterThan(0);
  expect((await thanks(chain, stand.core, handId)).giveHash).not.toBe(zeroHash);
  expect((await balanceOf(chain, usd, HELPER.address)) - helperBefore).toBe(BigInt(dark.reward));
  expect(await listening(ports.relay)).toBe(false);
});

test("site off too: exit.html opened from disk refunds an expired Hand and delivers a pending payout", async ({ page }) => {
  test.setTimeout(120_000);
  stopService(slot, "site");
  expect(await listening(ports.site)).toBe(false);
  expect(await listening(ports.relay)).toBe(false);
  expect(await listening(ports.chain)).toBe(true);

  const file = join(REPO_ROOT, "infra/stand/.run", String(slot), "dist/exit.html");
  expect(existsSync(file)).toBe(true);
  const elsewhere: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("file://") && !url.startsWith("data:") && !url.startsWith(stand.rpc)) elsewhere.push(url);
  });
  await injectWallet(page, stand.rpc, RAISER.address);
  await page.goto(pathToFileURL(file).href);
  expect(page.url().startsWith("file://")).toBe(true);
  await expect(page.getByTestId("exit-rpc")).toHaveValue(stand.rpc);
  await page.getByTestId("exit-wallet-connect").first().click();
  await expect(page.getByTestId("exit-wallet-account")).toHaveAttribute("data-value", RAISER.address);

  // Refund: the expired fixture goes back to its raiser.
  const expired = run.fixtures.expired;
  const handId = BigInt(expired.handId);
  const usd = tokenOf(stand, "usd").address;
  const raiserBefore = await balanceOf(chain, usd, RAISER.address);
  await page.getByTestId("exit-hand-number").fill(expired.handId);
  await page.getByTestId("exit-hand-read").click();
  await expect(page.getByTestId("exit-hand-state")).toHaveAttribute("data-value", "expired");
  await page.getByTestId("exit-refund-send").click();
  await expect(page.getByTestId("exit-refund-done")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("exit-hand-state")).toHaveAttribute("data-value", "refunded");
  expect((await hands(chain, stand.core, handId)).closedAt).toBeGreaterThan(0);
  expect((await thanks(chain, stand.core, handId)).giveHash).toBe(zeroHash);
  // The raiser sent the refund itself, so its gas is in ETH; the token balance moves by the reward exactly.
  expect((await balanceOf(chain, usd, RAISER.address)) - raiserBefore).toBe(BigInt(expired.reward));
  await shot(page, "3-site-off-exit-refunded-390-en");

  // Withdraw: the token lets the blocked payee receive again; then the whole pending amount moves.
  const { token, payee, amount } = run.fixtures.blocked.pending;
  const waiting = await pending(chain, stand.core, token, payee);
  expect(waiting >= BigInt(amount)).toBe(true);
  const unblock = run.fixtures.blocked.unblock;
  const hash = (await rpcCall(stand.rpc, "eth_sendTransaction", [{ from: run.accounts.anyone, to: unblock.to, data: unblock.data }])) as Hex;
  await chain.client.waitForTransactionReceipt({ hash });
  const payeeBefore = await balanceOf(chain, token, payee);
  await page.getByTestId("exit-wait-token").fill(token);
  await page.getByTestId("exit-wait-payee").fill(payee);
  await page.getByTestId("exit-wait-read").click();
  await expect(page.getByTestId("exit-wait-amount")).toHaveAttribute("data-value", String(waiting));
  await page.getByTestId("exit-withdraw-send").click();
  await expect(page.getByTestId("exit-withdraw-done")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("exit-wait-amount")).toHaveAttribute("data-value", "0");
  expect(await pending(chain, stand.core, token, payee)).toBe(0n);
  expect((await balanceOf(chain, token, payee)) - payeeBefore).toBe(waiting);
  expect(isAddressEqual(payee, run.accounts.blockedPayee!)).toBe(true);
  await shot(page, "3-site-off-exit-withdrawn-390-en");
  await page.getByTestId("exit-lang").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await shot(page, "3-site-off-exit-withdrawn-390-ru");

  // Nothing but the file and the RPC was asked for, and still nothing listens for the app.
  expect(elsewhere).toEqual([]);
  expect(await listening(ports.site)).toBe(false);
  expect(await listening(ports.relay)).toBe(false);
});
