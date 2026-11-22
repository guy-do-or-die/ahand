/**
 * exit.html, opened from disk by a file:// address, moves money with no site: it refunds an expired Hand, delivers a pending payout once the token lets it
 * through, thanks a give address, and thanks an account that is not set up yet in two presses.
 * Each result is asserted from Core's own views. Without any wallet the page still shows the
 * Hand's status, the calldata, the cast lines and the file-page sentence, and the refund's cast
 * line, run in a shell, refunds a second Hand. Then the /without-us screen, in both languages,
 * on the slot's dev site.
 *
 *   bun infra/stand/stand.ts up --slot 7 --dev && bun infra/stand/stand.ts build --slot 7
 *   STAND_SLOT=7 bunx playwright test tests/e2e/smoke/exit.spec.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test, type Page } from "@playwright/test";
import { zeroHash, type Address, type Hex } from "viem";

import { account } from "../lib/accounts";
import { rpcCall, injectWallet } from "../lib/exit-page/provider";
import { code, hands, pending, rpc, thanks, type Rpc } from "../lib/rpc";
import { readStand, REPO_ROOT, seed, standSlot, type StandInfo } from "../lib/stand";

test.describe.configure({ mode: "serial" });

type Fixture = Record<string, unknown> & { handId: string; giveAddress?: string };
interface Run {
  accounts: Record<string, Address>;
  fixtures: Record<string, Fixture>;
}

const RAISER = account(1);
const STRANGER = account(7);

let stand: StandInfo;
let chain: Rpc;
let run: Run;
let fileUrl: string;

test.beforeAll(() => {
  stand = readStand();
  chain = rpc(stand.rpc);
  const file = join(REPO_ROOT, "infra/stand/.run", String(standSlot()), "dist/exit.html");
  if (!existsSync(file)) throw new Error(`no ${file}: bun infra/stand/stand.ts build --slot ${standSlot()}`);
  fileUrl = pathToFileURL(file).href;
  run = seed<Run>(standSlot(), ["expired", "give", "undeployed", "blocked"]);
});

async function openExit(page: Page, withWallet: boolean): Promise<void> {
  if (withWallet) await injectWallet(page, stand.rpc, RAISER.address);
  await page.goto(fileUrl);
  expect(page.url().startsWith("file://")).toBe(true);
  // The build's own RPC is the starting value; the stand's is the same address.
  await expect(page.getByTestId("exit-rpc")).toHaveValue(stand.rpc);
  await expect(page.getByTestId("exit-net-facts")).toHaveAttribute("data-chain", String(stand.chainId));
  if (withWallet) {
    await page.getByTestId("exit-wallet-connect").first().click();
    await expect(page.getByTestId("exit-wallet-account")).toHaveAttribute("data-value", RAISER.address);
  }
}

async function readHandOnPage(page: Page, handId: string): Promise<void> {
  await page.getByTestId("exit-hand-number").fill(handId);
  await page.getByTestId("exit-hand-read").click();
  await expect(page.getByTestId("exit-hand-field")).toHaveCount(10);
}

async function codeText(page: Page, testId: string): Promise<string> {
  return (await page.getByTestId(testId).textContent())!.trim();
}

test("with no wallet the file page shows status, calldata, cast lines and the file-page sentence", async ({ page }) => {
  const elsewhere: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("file://") && !url.startsWith("data:") && !url.startsWith(stand.rpc)) elsewhere.push(url);
  });
  await openExit(page, false);
  await expect(page.getByTestId("exit-file-note")).toContainText("Opened from a file, a browser wallet can't see this page.");
  await expect(page.getByTestId("exit-file-command")).toContainText("python3 -m http.server 8000 --bind 127.0.0.1");
  await expect(page.getByTestId("exit-wallet-none")).toBeVisible();

  const expired = run.fixtures.expired!;
  await readHandOnPage(page, expired.handId);
  await expect(page.getByTestId("exit-hand-state")).toHaveAttribute("data-value", "expired");
  await expect(page.locator("[data-testid=exit-hand-field][data-name=raiser]")).toContainText(RAISER.address);
  await expect(page.getByTestId("exit-hand-cast")).toContainText(`cast call ${stand.core} 'hands(uint256)`);
  await expect(page.getByTestId("exit-refund-send")).toBeDisabled();
  expect(await codeText(page, "exit-refund-cast")).toMatch(new RegExp(`^cast send ${stand.core} 0x[0-9a-f]+ --rpc-url ${stand.rpc.replaceAll(".", "\\.")}$`));
  expect(await codeText(page, "exit-refund-calldata")).toMatch(/^0x278ecde1[0-9a-f]{64}$/); // refund(uint256)
  await expect(page.getByTestId("exit-refund-field-handId")).toHaveText(expired.handId);

  // The thank card works without a wallet too: it opens, asks Core, and prints the cast line.
  await page.getByTestId("exit-thank-input").fill(run.fixtures.give!.giveAddress!);
  await page.getByTestId("exit-thank-open").click();
  await expect(page.getByTestId("exit-thank-core")).toContainText("accepted");
  expect(await codeText(page, "exit-thank-cast")).toMatch(/--gas-limit [0-9]+$/);
  // No request but to the RPC address in the first field.
  expect(elsewhere).toEqual([]);
});

test("the refund's cast line, run in a shell, refunds a second expired hand", async ({ page }) => {
  const second = seed<Run>(standSlot(), ["expired"]).fixtures.expired!;
  await openExit(page, false);
  await readHandOnPage(page, second.handId);
  await expect(page.getByTestId("exit-hand-state")).toHaveAttribute("data-value", "expired");
  const line = await codeText(page, "exit-refund-cast");
  const words = line.split(" ");
  expect(words[0]).toBe("cast");
  const cast = join(process.env.FOUNDRY_BIN || join(homedir(), ".foundry/bin"), "cast");
  // As shown, plus how cast signs (a stranger: anyone may refund).
  execFileSync(cast, [...words.slice(1), "--private-key", STRANGER.privateKey], { encoding: "utf8" });

  const row = await hands(chain, stand.core, BigInt(second.handId));
  expect(row.closedAt).toBeGreaterThan(0);
  expect((await thanks(chain, stand.core, BigInt(second.handId))).giveHash).toBe(zeroHash);
  await page.getByTestId("exit-hand-read").click();
  await expect(page.getByTestId("exit-hand-state")).toHaveAttribute("data-value", "refunded");
});

test("refund with the wallet: the expired fixture goes back to its raiser", async ({ page }) => {
  const expired = run.fixtures.expired!;
  await openExit(page, true);
  await readHandOnPage(page, expired.handId);
  await page.getByTestId("exit-refund-send").click();
  await expect(page.getByTestId("exit-refund-done")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("exit-hand-state")).toHaveAttribute("data-value", "refunded");
  const row = await hands(chain, stand.core, BigInt(expired.handId));
  expect(row.closedAt).toBeGreaterThan(0);
  expect((await thanks(chain, stand.core, BigInt(expired.handId))).giveHash).toBe(zeroHash);
});

test("withdraw: the blocked payee's pending amount is delivered once the token unblocks it", async ({ page }) => {
  const blocked = run.fixtures.blocked as Fixture & { pending: { token: Address; payee: Address; amount: string }; unblock: { to: Address; data: Hex } };
  const { token, payee, amount } = blocked.pending;
  // Waiting money is counted per token and payee, not per hand: earlier runs on this chain may
  // have left more for the same payee. The whole of it moves at once.
  const before = await pending(chain, stand.core, token, payee);
  expect(before >= BigInt(amount)).toBe(true);
  // The token lets the payee receive again (sent by anyone, as the seed blocked it).
  const hash = (await rpcCall(stand.rpc, "eth_sendTransaction", [{ from: run.accounts.anyone, to: blocked.unblock.to, data: blocked.unblock.data }])) as Hex;
  await chain.client.waitForTransactionReceipt({ hash });

  await openExit(page, true);
  await page.getByTestId("exit-wait-token").fill(token);
  await page.getByTestId("exit-wait-payee").fill(payee);
  await page.getByTestId("exit-wait-read").click();
  await expect(page.getByTestId("exit-wait-amount")).toHaveAttribute("data-value", String(before));
  await page.getByTestId("exit-withdraw-send").click();
  await expect(page.getByTestId("exit-withdraw-done")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("exit-wait-amount")).toHaveAttribute("data-value", "0");
  expect(await pending(chain, stand.core, token, payee)).toBe(0n);
});

test("thank from the give fixture: Core is asked, then the raiser thanks", async ({ page }) => {
  const give = run.fixtures.give!;
  await openExit(page, true);
  await page.getByTestId("exit-thank-input").fill(give.giveAddress!);
  await page.getByTestId("exit-thank-open").click();
  await expect(page.getByTestId("exit-thank-core")).toContainText("accepted");
  await expect(page.getByTestId("exit-thank-share")).toHaveCount(2);
  await expect(page.getByTestId("exit-setup-send")).toHaveCount(0);
  await page.getByTestId("exit-thank-send").click();
  await expect(page.getByTestId("exit-thank-done")).toBeVisible({ timeout: 30_000 });
  const row = await hands(chain, stand.core, BigInt(give.handId));
  expect(row.closedAt).toBeGreaterThan(0);
  expect((await thanks(chain, stand.core, BigInt(give.handId))).giveHash).toBe(give.giveHash);
});

test("thank an account not set up yet in two presses: setup through the forwarder, then thank", async ({ page }) => {
  const undeployed = run.fixtures.undeployed as Fixture & { account: Address };
  expect(await code(chain, undeployed.account)).toBe("0x");
  await openExit(page, true);
  await expect(page.getByTestId("exit-forwarder")).toHaveValue(stand.forwarder!);
  await page.getByTestId("exit-thank-input").fill(undeployed.giveAddress!);
  await page.getByTestId("exit-thank-open").click();
  await expect(page.getByTestId("exit-thank-core")).toContainText("through the forwarder");
  await expect(page.getByTestId("exit-thank-send")).toBeDisabled();
  expect(await codeText(page, "exit-setup-cast")).toContain(`cast send ${stand.forwarder}`);

  await page.getByTestId("exit-setup-send").click(); // press 1
  await expect(page.getByTestId("exit-setup-done")).toBeVisible({ timeout: 30_000 });
  expect(await code(chain, undeployed.account)).not.toBe("0x");
  await expect(page.getByTestId("exit-thank-core")).not.toContainText("through the forwarder");

  await page.getByTestId("exit-thank-send").click(); // press 2
  await expect(page.getByTestId("exit-thank-done")).toBeVisible({ timeout: 30_000 });
  const row = await hands(chain, stand.core, BigInt(undeployed.handId));
  expect(row.closedAt).toBeGreaterThan(0);
  expect((await thanks(chain, stand.core, BigInt(undeployed.handId))).giveHash).not.toBe(zeroHash);
});

test("/without-us renders in English and Russian, and its link to /exit.html answers 200", async ({ page, request }) => {
  await page.goto("/without-us");
  await page.getByTestId("shell-lang").click();
  await page.getByTestId("shell-lang-en").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Do it without us");
  await expect(page.getByTestId("without-us-exit")).toBeVisible();
  await expect(page.getByTestId("without-us-command")).toContainText("contracts/exit/ahand.sh");
  await expect(page.getByTestId("without-us-explorer")).toContainText("refund");
  await expect(page.getByTestId("without-us-core")).toContainText(stand.core);
  const href = await page.getByTestId("without-us-download").getAttribute("href");
  expect(href).toBe("/exit.html");
  const answer = await request.get(href!);
  expect(answer.status()).toBe(200);
  expect(await answer.text()).toContain('id="exit"');

  await page.getByTestId("shell-lang").click();
  await page.getByTestId("shell-lang-ru").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Сделать без нас");
  await expect(page.getByTestId("without-us-exit")).toContainText("exit.html");
});
