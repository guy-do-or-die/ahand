/**
 * /waiting in a real browser against the stand's chain (PLAN wave 4, feat-waiting; UX-SPEC §9).
 *
 *   STAND_SLOT=6 bunx playwright test tests/e2e/smoke/waiting.spec.ts
 *   STAND_FILE=<a helper chain's --write-stand file> STAND_BASE_URL=http://127.0.0.1:<port> bunx playwright test …
 *
 * Fixtures, made in beforeAll and used by this file only:
 *  - the seed's `blocked` Hand: its holder (account 7) is blocked by the BlacklistToken, so the
 *    holder's share waits in Core; the seed prints the command that unblocks the holder;
 *  - this package's own (tests/e2e/lib/feat-waiting/pending.ts): money waiting for dev account 2,
 *    already unblocked, so the payee can connect and take it out.
 * Every amount is compared with Core's `pending(token, payee)` and the token's `balanceOf`, read
 * here from the chain. Every `eth_getLogs` the page makes is checked for a handId topic.
 */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test, type Page, type Request } from "@playwright/test";
import { getAddress, type Address, type Hex } from "viem";

import { account, pickDevAccount } from "../lib/accounts";
import { balanceOf, pending, rpc, type Rpc } from "../lib/rpc";
import { readStand, runProgram, seed, standSlot, type StandInfo } from "../lib/stand";

test.describe.configure({ mode: "serial" });

interface BlockedFixture {
  handId: string;
  pending: { token: Address; payee: Address; amount: string };
  unblock: { to: Address; data: Hex; cast: string };
}
interface SeedRun {
  fixtures: { blocked: BlockedFixture };
}
interface OwnPending {
  token: Address;
  payee: Address;
  amount: string;
  handId: string;
}

let stand: StandInfo;
let chain: Rpc;
let blocked: BlockedFixture;
let own: OwnPending;
/** Every eth_getLogs filter the pages of this file sent, for the last test. */
const logFilters: { topics?: unknown[] }[] = [];

test.beforeAll(() => {
  stand = readStand();
  chain = rpc(stand.rpc);
  blocked = seed<SeedRun>(standSlot(), ["blocked"]).fixtures.blocked;
  // The same chain the seed used: a helper chain's stand file when STAND_FILE names one, else the slot's.
  const where = process.env.STAND_FILE ? ["--stand", resolve(process.env.STAND_FILE)] : ["--slot", String(standSlot())];
  const made = runProgram("tests/e2e/lib/feat-waiting/pending.ts", ["--payee-account", "2", ...where]);
  own = JSON.parse(made.stdout) as OwnPending;
});

/** Watches the page's JSON-RPC calls for eth_getLogs and keeps their filters. */
function watchLogs(page: Page): void {
  page.on("request", (request: Request) => {
    if (request.method() !== "POST" || !request.url().startsWith(stand.rpc)) return;
    let body: unknown;
    try {
      body = request.postDataJSON();
    } catch {
      return;
    }
    for (const call of Array.isArray(body) ? body : [body]) {
      const { method, params } = call as { method?: string; params?: { topics?: unknown[] }[] };
      if (method === "eth_getLogs") logFilters.push(params?.[0] ?? {});
    }
  });
}

/** Tells this device it passed the `blocked` Hand on (the `passed` store), as /pass would. */
async function rememberPassed(page: Page, handId: string): Promise<void> {
  await page.evaluate(
    async ({ core, handId, chainId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open("ahand");
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      if (!db.objectStoreNames.contains("passed")) throw new Error("the app has not made its stores yet");
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("passed", "readwrite");
        tx.objectStore("passed").put({ id: `smoke:${handId}`, hand: `${chainId}:${core.toLowerCase()}:${handId}`, chainId, core, handId, position: 0 });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { core: stand.core, handId, chainId: stand.chainId },
  );
}

function row(page: Page, token: Address) {
  return page.getByTestId("waiting-row").and(page.locator(`[data-value="${token}"]`));
}

/**
 * With nobody connected, presses the row's Deliver: it sends nothing and opens "Connect a wallet";
 * picks dev account `which` there. The sheet closes, the focus is back in the row, and the page
 * goes on with that account.
 */
async function deliverAsVisitor(page: Page, token: Address, which: number): Promise<void> {
  await expect(page.getByTestId("wallet-connected")).toHaveCount(0);
  const deliver = row(page, token).getByTestId("waiting-deliver");
  await expect(deliver).toBeEnabled();
  await deliver.click();
  const sheet = page.getByTestId("kit-connect-sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByTestId(`dev-account-${which}`).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("wallet-connected")).toHaveAttribute("data-value", account(which).address);
  // The person is put back on the row they pressed in (its button, or its actions while the button is off).
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('[data-testid="waiting-row"]')?.getAttribute("data-value") ?? null))
    .toBe(token);
}

/** Runs a `cast send …` line the seed printed, with Foundry's cast (bare `cast` may be another program). */
function runCast(line: string): void {
  const words = line.trim().split(/\s+/);
  if (words[0] !== "cast") throw new Error(`not a cast line: ${line}`);
  const cast = join(process.env.FOUNDRY_BIN ?? join(homedir(), ".foundry/bin"), "cast");
  execFileSync(cast, words.slice(1), { encoding: "utf8", timeout: 60_000 });
}

test("a pasted address shows what waits for it, read only, with the sentence for a friend", async ({ page }) => {
  watchLogs(page);
  const { token, payee } = blocked.pending;
  const onChain = await pending(chain, stand.core, token, payee);
  expect(onChain).toBeGreaterThan(0n);

  await page.goto("/waiting");
  await expect(page.locator('[data-screen="waiting"]')).toBeVisible();
  await rememberPassed(page, blocked.handId);
  await page.reload();

  await page.getByTestId("waiting-address-input").fill(payee);
  await page.getByTestId("waiting-look").click();
  await expect(page).toHaveURL(new RegExp(`/waiting\\?for=${payee}$`));

  await expect(row(page, token)).toHaveAttribute("data-amount", onChain.toString());
  await expect(row(page, token)).toContainText("$");
  // Nobody connected: the Deliver the page talks about is on the row and can be pressed, the line
  // beside it says what pressing asks for, and the same call stands ready for a terminal.
  await expect(row(page, token).getByTestId("waiting-deliver")).toBeEnabled();
  await expect(row(page, token)).toContainText("You'll be asked to Connect a wallet first");
  await expect(row(page, token).getByTestId("kit-without-us")).toBeVisible();
  await expect(page.getByTestId("waiting-take-out")).toHaveCount(0);
  // Pressed and then left with Escape: nothing is connected, nothing was sent, and the focus is back on Deliver.
  await row(page, token).getByTestId("waiting-deliver").click();
  await expect(page.getByTestId("kit-connect-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("kit-connect-sheet")).toHaveCount(0);
  await expect(page.getByTestId("wallet-connected")).toHaveCount(0);
  await expect(row(page, token).getByTestId("waiting-deliver")).toBeFocused();
  expect(await pending(chain, stand.core, token, payee)).toBe(onChain);
  // The money-is-safe sentence and a link that opens this page for the payee.
  await expect(page.getByTestId("waiting-safe")).toContainText("Your money is safe where it is.");
  const friend = await page.getByTestId("waiting-friend-link").getAttribute("data-value");
  expect(friend).toBe(`${new URL(page.url()).origin}/waiting?for=${payee}`);

  // The Hand this device passed on shows its Pending event, read by its own number.
  const events = page.getByTestId("waiting-events");
  await expect(events).toHaveAttribute("data-hands", "1");
  await expect(events.locator(`[data-event="Pending"][data-hand="${blocked.handId}"]`)).toHaveAttribute("data-amount", blocked.pending.amount);
});

test("another account may Deliver but not take it out; while the payee is blocked it is stopped and nothing moves", async ({ page }) => {
  watchLogs(page);
  const { token, payee } = blocked.pending;
  const before = await pending(chain, stand.core, token, payee);

  await page.goto(`/waiting?for=${payee}`);
  // A visitor's press on Deliver sends nothing: it asks for an account and goes on from there.
  await deliverAsVisitor(page, token, 5);

  const deliver = page.getByTestId("waiting-deliver");
  await expect(deliver).toBeVisible();
  await expect(page.getByTestId("waiting-take-out")).toHaveCount(0);
  // The simulation already says no: the plain sentence, the money still waits, the button stays off.
  const error = row(page, token).getByTestId("waiting-error");
  await expect(error).toHaveAttribute("data-value", "token");
  await expect(error).toContainText("The token won't move this money to this address right now.");
  await expect(error).toContainText("The money stays waiting; nothing was lost.");
  await expect(row(page, token).getByTestId("waiting-issuer")).toHaveAttribute("href", "/limits");
  await expect(deliver).toBeDisabled();
  // The token's own answer is exact data: not on the human layer, one tap away, and open under the lens.
  await expect(error).not.toContainText(/BLACKLISTED|reverted/i);
  const said = error.getByRole("button", { name: "What the token said" });
  await expect(said).toHaveAttribute("aria-expanded", "false");
  await said.click();
  await expect(said).toHaveAttribute("aria-expanded", "true");
  await expect(error).toContainText("BLACKLISTED");
  await said.click();
  await expect(error).not.toContainText("BLACKLISTED");
  await page.locator("h1").click();
  await page.keyboard.press("?");
  await expect(error).toContainText("BLACKLISTED");
  expect(await pending(chain, stand.core, token, payee)).toBe(before);
});

test("after the unblock command, account 5 presses Deliver and the money lands at the payee", async ({ page }) => {
  watchLogs(page);
  const { token, payee } = blocked.pending;
  runCast(blocked.unblock.cast);
  const amount = await pending(chain, stand.core, token, payee);
  const balance = await balanceOf(chain, token, payee);
  expect(amount).toBeGreaterThan(0n);

  await page.goto(`/waiting?for=${payee}`);
  // A visitor again: the first press asks for an account and stops at the cost, with nothing sent.
  await deliverAsVisitor(page, token, 5);
  await expect(row(page, token).getByTestId("kit-cost-line")).toContainText("costs about");
  await expect(row(page, token).getByTestId("kit-without-us")).toBeVisible();
  await expect(row(page, token).getByTestId("waiting-error")).toHaveCount(0);
  expect(await pending(chain, stand.core, token, payee)).toBe(amount);
  const deliver = page.getByTestId("waiting-deliver");
  await expect(deliver).toBeEnabled();
  await deliver.click();

  const withdrawn = page.getByTestId("waiting-withdrawn");
  await expect(withdrawn).toHaveAttribute("data-amount", amount.toString(), { timeout: 20_000 });
  await expect(withdrawn).toHaveAttribute("data-to", payee);
  await expect(withdrawn.getByText("On chain")).toBeVisible();
  await expect(page.getByTestId("waiting-nothing")).toBeVisible();
  expect(await pending(chain, stand.core, token, payee)).toBe(0n);
  expect(await balanceOf(chain, token, payee)).toBe(balance + amount);
});

test("a visitor who turns out to be the payee is offered Take it out after connecting", async ({ page }) => {
  watchLogs(page);
  const { token, payee } = own;
  const amount = await pending(chain, stand.core, token, payee);
  expect(amount).toBeGreaterThan(0n);

  await page.goto(`/waiting?for=${payee}`);
  await deliverAsVisitor(page, token, 2);
  await expect(row(page, token).getByTestId("waiting-take-out")).toBeEnabled();
  await expect(page.getByTestId("waiting-deliver")).toHaveCount(0);
  await expect(row(page, token).getByTestId("kit-cost-line")).toContainText("costs about");
  expect(await pending(chain, stand.core, token, payee)).toBe(amount);
});

test("the payee connected takes it out to another address; the money lands there", async ({ page }) => {
  watchLogs(page);
  const { token, payee } = own;
  const elsewhere = getAddress(account(9).address);
  const amount = await pending(chain, stand.core, token, payee);
  expect(amount).toBeGreaterThan(0n);
  const balance = await balanceOf(chain, token, elsewhere);
  const payeeBalance = await balanceOf(chain, token, payee);

  await page.goto("/waiting");
  await pickDevAccount(page, 2);
  await expect(page.getByTestId("wallet-connected")).toHaveAttribute("data-value", payee);
  await expect(row(page, token)).toHaveAttribute("data-amount", amount.toString());
  await expect(page.getByTestId("waiting-deliver")).toHaveCount(0);

  await page.getByRole("radio", { name: "To another address" }).click();
  const to = page.getByTestId("waiting-take-out-to").locator("textarea");
  await to.fill("0x0000000000000000000000000000000000000000");
  await expect(page.getByTestId("waiting-take-out")).toBeDisabled(); // the zero address is refused
  await to.fill(elsewhere);
  const takeOut = page.getByTestId("waiting-take-out");
  await expect(row(page, token).getByTestId("kit-cost-line")).toContainText("costs about");
  await expect(takeOut).toBeEnabled();
  // The cast line opens under "Do it without us" and never pushes the phone page sideways.
  await row(page, token).getByTestId("kit-without-us").getByRole("button").click();
  await expect(row(page, token).getByTestId("kit-without-us")).toContainText("cast send");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await takeOut.click();

  const withdrawn = page.getByTestId("waiting-withdrawn");
  await expect(withdrawn).toHaveAttribute("data-amount", amount.toString(), { timeout: 20_000 });
  await expect(withdrawn).toHaveAttribute("data-to", elsewhere);
  expect(await pending(chain, stand.core, token, payee)).toBe(0n);
  expect(await balanceOf(chain, token, elsewhere)).toBe(balance + amount);
  expect(await balanceOf(chain, token, payee)).toBe(payeeBalance);
});

test("the page read logs only by a Hand's number", () => {
  expect(logFilters.length).toBeGreaterThan(0);
  const unbounded = logFilters.filter((filter) => !Array.isArray(filter.topics) || filter.topics[1] === null || filter.topics[1] === undefined);
  expect(unbounded).toEqual([]);
});
