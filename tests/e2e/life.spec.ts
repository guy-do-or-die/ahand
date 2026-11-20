/**
 * The whole life of a Hand in the browser (PLAN wave 5, e2e-life; UX-SPEC §7, §8, §9, §15):
 *
 *   STAND_SLOT=1 bunx playwright test tests/e2e/life.spec.ts
 *
 * Five people, each an isolated browser context at phone size, and no shortcut between them but
 * the addresses a person would copy and paste:
 *
 *   the Raiser  dev account 1, on the device that raises
 *   Alice       no wallet, passes at 0%
 *   Bob         no wallet, passes at 10% to an address he pastes
 *   Gina        no wallet, helps with an address she pastes, and writes a sentence
 *   a Visitor   dev account 5 (and dev account 3 as a stranger who delivers waiting money)
 *
 * Nine steps, in the order of the brief. Every step ends on Core's state, a transaction's own
 * receipt or a token balance read from the chain, never only on the page's text. Time is the
 * chain's: the third Hand ends because the chain is moved past its end with the stand's time.ts,
 * while the browsers keep this machine's clock, 40 days behind the chain.
 *
 * Every person's requests are intercepted: anything to a host other than 127.0.0.1 is aborted and
 * listed, and the list must be empty at the end. The spec moves the chain's clock by days, so the
 * gates run it on a freshly started stand.
 */
import { expect, test, type Page } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getAddress, isAddressEqual, zeroHash, type Address, type Hex } from "viem";

import { account, pickDevAccount } from "./lib/accounts";
import { answerPrompts, compose, copied, swipe } from "./lib/feat-raise/raise";
import { setBlocked } from "./lib/feat-thank/fixtures";
import { coreEventsOf, methodsSent, originsOf, payoutsOf, person, WALLET_METHODS, type Person } from "./lib/e2e-life/people";
import { balanceOf, chainNow, coreAbi, hands, pending, rpc, thanks, type Rpc } from "./lib/rpc";
import { readStand, runProgram, standSlot, tokenOf, type StandInfo } from "./lib/stand";

const USD = 1_000_000n;
const DAY = 86_400;

const stand: StandInfo = readStand();
const slot = standSlot();
const chain: Rpc = rpc(stand.rpc);
const usd = tokenOf(stand, "usd").address;
const blacklist = tokenOf(stand, "blacklist").address;
const site = new URL(stand.site!).origin;
const rpcOrigin = new URL(stand.rpc).origin;
const RAISER = getAddress(account(1).address);

/** A fresh address nobody has used: its balance starts at zero, so what lands there is exact. */
const freshAddress = (): Address => privateKeyToAccount(generatePrivateKey()).address;

/** The craft tool on this slot (an SDK child process; spec files never import a workspace package). */
function craft<T = Record<string, unknown>>(...args: string[]): T {
  return JSON.parse(runProgram("tests/e2e/lib/craft.ts", [...args, "--slot", String(slot)], { timeoutMs: 120_000 }).stdout) as T;
}

interface Opened {
  ok: boolean;
  handId: string;
  state: string;
  route: { position: number; payee: Address | null; keptBps: number }[];
  give?: { signer: Address; payee: Address; claimBps: number; giveHash: Hex; core: string };
}

/* ------------------------------------------------------------------ screen steps */

/** Opens an address as a person does: the fragment is taken into the tab and leaves the address bar. */
async function open(page: Page, address: string): Promise<void> {
  await page.goto(address);
  await expect(page.getByTestId("hand-deal-card")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => location.href)).not.toContain("#");
}

/** /pass at 0% (or the no-reward pass) from an opened Hand; returns the new address. */
async function passFree(page: Page): Promise<string> {
  await page.getByTestId("hand-pass").click();
  await expect(page).toHaveURL(/\/pass$/);
  await page.getByTestId("pass-swipe").click();
  await expect(page.getByTestId("pass-read-back")).toHaveAttribute("data-bps", "0");
  return newAddress(page);
}

async function newAddress(page: Page): Promise<string> {
  const text = ((await page.getByTestId("pass-copy").locator(".ah-linkrow__value").textContent()) ?? "").trim();
  expect(text).toContain("#");
  return text;
}

/** /pass keeping `bps` for an address pasted into "Where should your share land?". */
async function passKeeping(page: Page, bps: number, payee: Address): Promise<string> {
  await page.getByTestId("hand-pass").click();
  await expect(page).toHaveURL(/\/pass$/);
  await page.getByTestId("pass-slider").fill(String(bps));
  await expect(page.getByTestId("pass-share-money")).toHaveAttribute("data-value", String(bps));
  await page.getByRole("button", { name: "Choose where it lands" }).click();
  await page.getByText("An address I have").click();
  await page.getByRole("textbox", { name: "The address" }).fill(payee);
  await expect(page.locator('[data-reading="ok"]')).toBeVisible();
  await page.getByRole("button", { name: "Use this address" }).click();
  await page.getByTestId("pass-swipe").click();
  const readBack = page.getByTestId("pass-read-back");
  await expect(readBack).toHaveAttribute("data-payee", payee);
  await expect(readBack).toHaveAttribute("data-bps", String(bps));
  return newAddress(page);
}

/** "I can help" → /give with a pasted payee and a sentence; returns the give address once delivered. */
async function helpWithPastedPayee(page: Page, words: string, payee: Address): Promise<string> {
  await page.getByTestId("hand-help").click();
  await expect(page).toHaveURL(/\/give$/);
  await page.getByTestId("give-words").fill(words);
  await page.getByRole("radio", { name: "An address I have" }).check();
  await page.getByRole("textbox", { name: "The address" }).fill(payee);
  await expect(page.getByTestId("give-agree").locator("[data-payee]")).toHaveAttribute("data-payee", payee);
  await page.getByTestId("give-swipe").click();
  await expect(page.getByTestId("give-delivered")).toHaveText("Delivered to 1 of 1 relay.", { timeout: 30_000 });
  await expect(page.getByTestId("give-delivered")).toHaveAttribute("data-value", "1/1");
  const copy = page.getByTestId("give-copy");
  await expect(copy).toBeVisible();
  return (await copy.getAttribute("data-value"))!;
}

/** The Raiser's /my page for a Hand, unlocked with one keys confirmation; returns the answer card. */
async function myAnswer(page: Page, handId: bigint, words: string) {
  await page.goto(`/my/${stand.chainId}/${handId}`);
  await pickDevAccount(page, 1);
  const unlock = page.getByTestId("my-unlock");
  await expect(unlock).toBeVisible({ timeout: 30_000 });
  if ((await unlock.getAttribute("data-value")) !== "unlocked") await unlock.click();
  await expect(unlock).toHaveAttribute("data-value", "unlocked", { timeout: 30_000 });
  const answer = page.getByTestId("my-answer");
  await expect(answer).toHaveCount(1, { timeout: 30_000 });
  await expect(answer).toContainText(words);
  return answer;
}

/** /thank once the give link is in: the Raiser connected, the cost known, the swipe pressed, the receipt read. */
async function thankHere(page: Page): Promise<Hex> {
  await expect(page.getByTestId("thank-predicted")).toBeVisible({ timeout: 30_000 });
  if ((await page.getByTestId("wallet-connected").count()) === 0) await pickDevAccount(page, 1);
  await expect(page.getByTestId("wallet-connected").first()).toHaveAttribute("data-value", RAISER);
  await expect(page.getByTestId("thank-cost")).toContainText(/costs about/, { timeout: 30_000 });
  await expect(page.getByTestId("thank-swipe")).toBeEnabled();
  await page.getByTestId("thank-swipe").click();
  const done = page.getByTestId("thank-done");
  await expect(done).toBeVisible({ timeout: 60_000 });
  return (await done.getAttribute("data-hash")) as Hex;
}

async function predictedRows(page: Page) {
  return page.getByTestId("thank-predicted-row").evaluateAll((rows) =>
    rows.map((row) => ({ kind: row.getAttribute("data-kind")!, payee: row.getAttribute("data-payee")!, amount: row.getAttribute("data-amount")! })),
  );
}

async function payoutRows(page: Page) {
  return page.getByTestId("thank-payout").evaluateAll((rows) =>
    rows.map((row) => ({ kind: row.getAttribute("data-kind")!, payee: row.getAttribute("data-payee")!, amount: row.getAttribute("data-amount")!, landed: row.getAttribute("data-landed")! })),
  );
}

/** Raises on /raise as dev account 1 and returns the Hand's number and its copied address. */
async function raise(page: Page, c: Parameters<typeof compose>[1]): Promise<{ handId: bigint; address: string }> {
  await page.goto("/raise");
  await expect(page.getByTestId("raise-what")).toBeVisible({ timeout: 30_000 });
  await compose(page, c);
  await swipe(page, 1);
  const up = page.getByTestId("raise-up");
  await expect(up).toBeVisible({ timeout: 45_000 });
  const handId = BigInt((await up.getAttribute("data-hand-id"))!);
  // A tab that reloaded since its last raise forgot the keys; showing the link asks once more.
  if ((await page.getByTestId("raise-copy").count()) === 0) {
    await page.getByTestId("raise-copy-show").click();
    await answerPrompts(page, 1);
  }
  return { handId, address: await copied(page) };
}

/* ------------------------------------------------------------------ the life */

const people: Person[] = [];

test.beforeAll(async ({ browser }) => {
  // In dev mode Vite prepares each screen's modules on its first visit and may reload the page
  // once while it does. One throwaway visit per route here, so no person's page (whose dev
  // socket is silenced) meets a half-prepared module later.
  if (stand.mode !== "dev") return;
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const path of ["/", "/raise", "/my", "/thank", "/waiting", "/pass", "/give", `/${stand.chainId}/1`]) {
    await page.goto(path, { waitUntil: "networkidle" }).catch(() => undefined);
  }
  await context.close();
});

test.afterAll(async () => {
  for (const one of people) await one.context.close().catch(() => undefined);
  await setBlocked(chain, blacklist, ADDRESSES.blocked, false).catch(() => undefined);
});

const ADDRESSES = { bob: freshAddress(), gina: freshAddress(), blocked: freshAddress(), helper2: freshAddress(), gina4: freshAddress() };

test("the whole life: raise, pass at 0% and 10%, help, reply, thank, waiting money delivered, time's up and sent back, and a hand with no reward", async ({ browser }) => {
  test.setTimeout(600_000);
  const join = async (name: string) => {
    const one = await person(browser, name, stand);
    people.push(one);
    return one;
  };
  const raiser = await join("raiser");
  const alice = await join("alice");
  const bob = await join("bob");
  const gina = await join("gina");
  const visitor = await join("visitor");

  const title = `Who can lend a ladder in Batumi this weekend? ${Date.now() % 100_000}`;
  const words = "I have a three-metre ladder near the boulevard; text me and I'll bring it.";
  const reply = "Thank you! Saturday at ten, by the cathedral?";
  let first!: { handId: bigint; address: string };
  let alicePassed!: string;
  let bobPassed!: string;
  let ginaGive!: string;
  let ginaOpened!: Opened;

  await test.step("1. the Raiser raises an unlisted hand: 50 test dollars, 30 days, 70%; four states; no fragment after load", async () => {
    const before = await balanceOf(chain, usd, RAISER);
    const { page } = raiser;
    await page.goto("/raise");
    await expect(page.getByTestId("raise-what")).toBeVisible({ timeout: 30_000 });
    await compose(page, { title, details: "Three metres is enough. I can pick it up.", reward: "50", days: 30, mode: "unlisted" });
    await page.getByTestId("raise-fine-tune").click();
    await expect(page.getByTestId("raise-min-claim")).toHaveAttribute("data-value", "7000");
    // Every value the tx rail takes, as it takes it.
    await page.evaluate(() => {
      const w = window as unknown as { __rail: string[] };
      w.__rail = [];
      const note = () => {
        for (const rail of Array.from(document.querySelectorAll('[data-testid="raise-tx-rail"]'))) {
          const value = rail.getAttribute("data-value") ?? "";
          if (w.__rail.at(-1) !== value) w.__rail.push(value);
        }
      };
      new MutationObserver(note).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-value"] });
    });
    const at = await chainNow(chain);
    await swipe(page, 1);
    const up = page.getByTestId("raise-up");
    await expect(up).toBeVisible({ timeout: 45_000 });
    await expect(up).toContainText("Your hand is up.");
    first = { handId: BigInt((await up.getAttribute("data-hand-id"))!), address: "" };
    await expect(page.getByTestId("raise-tx-rail")).toHaveAttribute("data-value", "final", { timeout: 30_000 });
    const rail = await page.evaluate(() => (window as unknown as { __rail: string[] }).__rail);
    expect(rail).toEqual(["sent", "in-block", "safe", "final"]);
    const steps = page.getByTestId("raise-tx-rail").locator("li.ah-tx__step");
    await expect(steps).toHaveCount(4);
    for (let i = 0; i < 4; i++) await expect(steps.nth(i)).toHaveAttribute("data-state", "done");
    first.address = await copied(page);
    expect(first.address).toMatch(new RegExp(`^${site}/31337/${first.handId}\\?d=[A-Za-z0-9_-]+#[A-Za-z0-9_-]+$`));

    // The chain: the terms as asked, the money locked, and "final" means the chain's finalized
    // block has reached the raise.
    const row = await hands(chain, stand.core, first.handId);
    expect(row.raiser).toBe(RAISER);
    expect(row.token).toBe(usd);
    expect(row.reward).toBe(50n * USD);
    expect(row.minClaimBps).toBe(7000);
    expect(row.closedAt).toBe(0);
    expect(row.expiry).toBeGreaterThanOrEqual(at.timestamp + 30 * DAY);
    expect(row.expiry).toBeLessThanOrEqual(row.openedAt + 30 * DAY);
    expect(await up.getAttribute("data-data-hash")).toBe(row.dataHash);
    expect(await balanceOf(chain, usd, RAISER)).toBe(before - 50n * USD);
    const finalized = await chain.client.getBlock({ blockTag: "finalized" });
    expect(Number(finalized.timestamp)).toBeGreaterThanOrEqual(row.openedAt);
    expect(craft<Opened>("open", first.address).state).toBe("open");
  });

  await test.step("2. Alice, no wallet, opens the address and passes it at 0%: no wallet prompt, no request but the RPC and the site", async () => {
    const { page } = alice;
    await open(page, first.address);
    await expect(page.getByTestId("hand-deal-card")).toContainText(title);
    await expect(page.getByTestId("hand-deal-card")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("hand-rail")).toHaveAttribute("data-value", "1");
    alicePassed = await passFree(page);
    expect(alicePassed).not.toBe(first.address);

    expect(alice.watch.prompt).toBe(false);
    expect(methodsSent(alice).filter((m) => WALLET_METHODS.includes(m))).toEqual([]);
    expect([...originsOf(alice)].sort()).toEqual([rpcOrigin, site].sort());
    expect(methodsSent(alice)).toContain("eth_call");
    // Core's own checkRoute accepts the new route (craft opens it through the SDK and asks Core); the Hand is still open.
    const opened = craft<Opened>("open", alicePassed);
    expect(opened.ok).toBe(true);
    expect(opened.route).toEqual([expect.objectContaining({ payee: null, keptBps: 0 })]);
    expect((await hands(chain, stand.core, first.handId)).closedAt).toBe(0);
  });

  await test.step("3. Bob, no wallet, passes at 10% to a pasted address", async () => {
    const { page } = bob;
    await open(page, alicePassed);
    await expect(page.getByTestId("hand-rail")).toHaveAttribute("data-value", "2");
    bobPassed = await passKeeping(page, 1000, ADDRESSES.bob);
    expect(bob.watch.prompt).toBe(false);
    expect(methodsSent(bob).filter((m) => WALLET_METHODS.includes(m))).toEqual([]);
    const opened = craft<Opened>("open", bobPassed);
    expect(opened.route).toEqual([expect.objectContaining({ payee: null, keptBps: 0 }), expect.objectContaining({ payee: ADDRESSES.bob, keptBps: 1000 })]);
    expect(await balanceOf(chain, usd, ADDRESSES.bob)).toBe(0n);
  });

  await test.step("4. Gina, no wallet, helps with a pasted payee and writes a sentence: delivered to 1 of 1 relay", async () => {
    const { page } = gina;
    await open(page, bobPassed);
    await expect(page.getByTestId("hand-rail")).toHaveAttribute("data-value", "3");
    ginaGive = await helpWithPastedPayee(page, words, ADDRESSES.gina);
    expect(gina.watch.prompt).toBe(false);
    expect(methodsSent(gina).filter((m) => WALLET_METHODS.includes(m))).toEqual([]);
    // Core's checkGive accepts the give address; the claim is what is left after Bob's 10%.
    ginaOpened = craft<Opened>("open", ginaGive);
    expect(ginaOpened.give?.core).toBe("accepted");
    expect(ginaOpened.give?.payee).toBe(ADDRESSES.gina);
    expect(ginaOpened.give?.claimBps).toBe(9000);
    expect(ginaOpened.route).toHaveLength(2);
    // The giver's browser spoke to the relay of this stand and nothing else.
    expect([...originsOf(gina)].sort()).toEqual([rpcOrigin, site, new URL(stand.relay!.replace(/^ws/, "http")).origin].sort());
    expect((await hands(chain, stand.core, first.handId)).closedAt).toBe(0);
  });

  await test.step("5. the Raiser unlocks /my, sees Gina's words, replies, and thanks; the receipt equals the prediction and the chain", async () => {
    const { page } = raiser;
    const before = await balanceOf(chain, usd, RAISER);
    const answer = await myAnswer(page, first.handId, words);
    await expect(answer).toHaveAttribute("data-value", ginaOpened.give!.giveHash);
    await answer.getByTestId("my-reply-input").fill(reply);
    await answer.getByTestId("my-reply-send").click();
    await expect(answer.getByRole("status")).toContainText(/1 of 1/, { timeout: 20_000 });
    await answer.getByTestId("my-answer-thank").click();
    await expect(page).toHaveURL(/\/thank$/);

    await expect(page.getByTestId("thank-predicted")).toBeVisible({ timeout: 30_000 });
    const predicted = await predictedRows(page);
    const hash = await thankHere(page);
    await expect(page.getByTestId("thank-done")).toContainText("Thanked. Here's who got what — straight from the chain.");
    await expect(page.getByTestId("thank-receipt")).not.toHaveAttribute("data-landed", /false|^$/, { timeout: 15_000 });
    const shown = await payoutRows(page);

    // The screen: the receipt's rows are the predicted table's rows with money in them.
    const nonzero = predicted.filter((row) => BigInt(row.amount) > 0n).map((row) => ({ payee: getAddress(row.payee), amount: row.amount }));
    expect(shown.map((row) => ({ payee: getAddress(row.payee), amount: row.amount }))).toEqual(nonzero);
    expect(nonzero).toEqual([
      { payee: ADDRESSES.bob, amount: (5n * USD).toString() },
      { payee: ADDRESSES.gina, amount: (45n * USD).toString() },
    ]);
    expect(shown.every((row) => row.kind === "paid" && row.landed === "true")).toBe(true);

    // The chain: the transaction's own events, Core's views and the balances at the payees.
    const tx = await coreEventsOf(chain, stand.core, hash);
    expect(tx.status).toBe("success");
    // Core's order (R-56): Thanked, each Shake with its payout, then the Give with its payout. Alice's 0% pays nothing, so no Paid follows her Shake.
    expect(tx.events.map((e) => e.eventName)).toEqual(["Thanked", "Shaken", "Shaken", "Paid", "Given", "Paid"]);
    expect(payoutsOf(tx.events).map((p) => ({ payee: getAddress(p.payee), amount: p.amount.toString() }))).toEqual(nonzero);
    expect(await balanceOf(chain, usd, ADDRESSES.bob)).toBe(5n * USD);
    expect(await balanceOf(chain, usd, ADDRESSES.gina)).toBe(45n * USD);
    const closed = await hands(chain, stand.core, first.handId);
    expect(closed.closedAt).toBeGreaterThan(0);
    expect((await thanks(chain, stand.core, first.handId)).giveHash).toBe(ginaOpened.give!.giveHash);
    expect(await balanceOf(chain, usd, RAISER)).toBe(before);
    expect(craft<Opened>("open", first.address).state).toBe("thanked");
  });

  await test.step("6. Gina's tab shows the reply", async () => {
    const thread = gina.page.getByTestId("give-thread");
    await expect(thread.locator('[data-from="asker"]')).toContainText(reply, { timeout: 30_000 });
    await expect(thread.locator('[data-from="you"]').first()).toContainText(words);
    // What her tab says will land at her address has landed there, on chain.
    expect(await balanceOf(chain, usd, ADDRESSES.gina)).toBe(45n * USD);
  });

  await test.step("7. a hand in the BlacklistToken: the blocked payee's share waits, is unblocked, a stranger delivers it, Withdrawn", async () => {
    // The raise screen offers the chain's dollar token only, so this Hand is raised through the SDK
    // (craft, as account 1); every other step is a screen.
    const made = craft<{ handId: string; address: string }>("make", "--token", "blacklist", "--reward", "20", "--title", "Who can find me a used cargo bike?");
    const handId = BigInt(made.handId);
    await open(alice.page, made.address);
    const passed = await passKeeping(alice.page, 1000, ADDRESSES.blocked);
    await open(bob.page, passed);
    const give = await helpWithPastedPayee(bob.page, "My neighbour sells one, nearly new.", ADDRESSES.helper2);
    await setBlocked(chain, blacklist, ADDRESSES.blocked, true);

    const { page } = raiser;
    await page.goto("/thank");
    await page.getByTestId("thank-input").fill(give);
    await page.getByTestId("thank-open").click();
    const hash = await thankHere(page);
    const shown = await payoutRows(page);
    const waiting = shown.find((row) => isAddressEqual(row.payee as Address, ADDRESSES.blocked));
    expect(waiting?.kind).toBe("waiting");
    await expect(page.getByTestId("thank-payout").filter({ hasText: "is waiting for" })).toHaveCount(1);
    expect(waiting?.amount).toBe((2n * USD).toString());

    const tx = await coreEventsOf(chain, stand.core, hash);
    expect(payoutsOf(tx.events)).toEqual([
      { kind: "waiting", payee: ADDRESSES.blocked, amount: 2n * USD },
      { kind: "paid", payee: ADDRESSES.helper2, amount: 18n * USD },
    ]);
    expect(await pending(chain, stand.core, blacklist, ADDRESSES.blocked)).toBe(2n * USD);
    expect(await balanceOf(chain, blacklist, ADDRESSES.blocked)).toBe(0n);
    expect(await balanceOf(chain, blacklist, ADDRESSES.helper2)).toBe(18n * USD);
    expect((await hands(chain, stand.core, handId)).closedAt).toBeGreaterThan(0);

    // Unblocked; a stranger (dev account 3) opens /waiting for the payee and presses Deliver.
    await setBlocked(chain, blacklist, ADDRESSES.blocked, false);
    const stranger = visitor.page;
    await stranger.goto(`/waiting?for=${ADDRESSES.blocked}`);
    await pickDevAccount(stranger, 3);
    await expect(stranger.getByTestId("wallet-connected")).toHaveAttribute("data-value", account(3).address);
    const row = stranger.getByTestId("waiting-row").and(stranger.locator(`[data-value="${blacklist}"]`));
    await expect(row).toHaveAttribute("data-amount", (2n * USD).toString(), { timeout: 20_000 });
    await expect(stranger.getByTestId("waiting-take-out")).toHaveCount(0);
    const deliver = stranger.getByTestId("waiting-deliver");
    await expect(deliver).toBeEnabled({ timeout: 20_000 });
    await deliver.click();
    const withdrawn = stranger.getByTestId("waiting-withdrawn");
    await expect(withdrawn).toHaveAttribute("data-amount", (2n * USD).toString(), { timeout: 30_000 });
    await expect(withdrawn).toHaveAttribute("data-to", ADDRESSES.blocked);
    expect(await pending(chain, stand.core, blacklist, ADDRESSES.blocked)).toBe(0n);
    expect(await balanceOf(chain, blacklist, ADDRESSES.blocked)).toBe(2n * USD);
    const withdrawnLogs = await chain.client.getContractEvents({
      address: stand.core,
      abi: coreAbi(),
      eventName: "Withdrawn",
      args: { token: blacklist, payee: ADDRESSES.blocked },
      fromBlock: tx.block,
    });
    expect(withdrawnLogs).toHaveLength(1);
  });

  await test.step("8. a third hand: the chain jumps past its end; the view reads Time's up by the chain's clock; a Visitor sends it back; the raiser is whole", async () => {
    const before = await balanceOf(chain, usd, RAISER);
    const third = await raise(raiser.page, { title: `Who has a spare tent for one night? ${Date.now() % 100_000}`, reward: "5", days: 7 });
    expect(await balanceOf(chain, usd, RAISER)).toBe(before - 5n * USD);
    const { page } = visitor;
    await open(page, third.address);
    const card = page.getByTestId("hand-deal-card");
    await expect(card).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("hand-times-up")).toHaveCount(0);
    // The browser keeps this machine's clock (40 days behind the chain); only the chain moves.
    const row = await hands(chain, stand.core, third.handId);
    const jumped = JSON.parse(runProgram("infra/stand/time.ts", ["--slot", String(slot), String(8 * DAY), "--json"]).stdout) as { after: { timestamp: number } };
    expect(jumped.after.timestamp).toBeGreaterThan(row.expiry);
    // No reload: the view follows the chain's next block.
    await expect(card).toHaveAttribute("data-state", "expired", { timeout: 20_000 });
    // The sentence stands once, in the card; the column under it is headed by what it does (F7).
    await expect(card).toContainText("Time's up.");
    await expect(card).toContainText("Anyone can send the reward back to the asker now.");
    await expect(page.getByTestId("hand-times-up")).toContainText("Send the reward back");
    await expect(page.getByTestId("hand-times-up")).not.toContainText("Time's up.");
    await expect(page.getByTestId("hand-pass")).toHaveCount(0);
    expect(craft<Opened>("open", third.address).state).toBe("expired");

    await pickDevAccount(page, 5);
    await page.getByTestId("hand-send-back").click();
    await expect(page.getByTestId("hand-closed")).toHaveAttribute("data-value", "refunded", { timeout: 30_000 });
    await expect(card).toContainText("The reward went back on");
    expect((await hands(chain, stand.core, third.handId)).closedAt).toBeGreaterThan(0);
    expect(await balanceOf(chain, usd, RAISER)).toBe(before);
  });

  await test.step("9. a fourth hand with no reward: raised, passed, answered and thanked; Thanked and Given, no payout", async () => {
    const nonce = await chain.client.getTransactionCount({ address: RAISER });
    const fourth = await raise(raiser.page, { title: `A thank-you for a good book tip ${Date.now() % 100_000}`, reward: { custom: "0" } });
    // No approve: one transaction left the Raiser's account, and nothing is locked.
    expect(await chain.client.getTransactionCount({ address: RAISER })).toBe(nonce + 1);
    expect((await hands(chain, stand.core, fourth.handId)).reward).toBe(0n);

    await open(alice.page, fourth.address);
    await expect(alice.page.getByTestId("hand-deal-card")).toContainText("No reward: a thank-you only");
    await alice.page.getByTestId("hand-pass").click();
    await expect(alice.page.getByTestId("pass-no-reward")).toBeVisible();
    await expect(alice.page.getByTestId("pass-slider")).toHaveCount(0);
    await alice.page.getByTestId("pass-swipe").click();
    const passed = await newAddress(alice.page);

    const bookWords = "Read 'The Dispossessed'; it is about exactly this.";
    await open(gina.page, passed);
    const give = await helpWithPastedPayee(gina.page, bookWords, ADDRESSES.gina4);
    expect(craft<Opened>("open", give).give?.core).toBe("accepted");

    const answer = await myAnswer(raiser.page, fourth.handId, bookWords);
    await answer.getByTestId("my-answer-thank").click();
    await expect(raiser.page).toHaveURL(/\/thank$/);
    await expect(raiser.page.getByTestId("thank-no-reward")).toBeVisible({ timeout: 30_000 });
    const hash = await thankHere(raiser.page);
    await raiser.page.getByRole("button", { name: /What the chain recorded/ }).click();
    const shownEvents = await raiser.page.getByTestId("thank-receipt-event").evaluateAll((items) => items.map((item) => item.getAttribute("data-value")));
    expect(await raiser.page.getByTestId("thank-payout").count()).toBe(0);
    await expect(raiser.page.getByTestId("thank-no-money")).toBeVisible();

    const tx = await coreEventsOf(chain, stand.core, hash);
    const names = tx.events.map((e) => e.eventName);
    expect(names).toEqual(["Thanked", "Shaken", "Given"]);
    expect(payoutsOf(tx.events)).toEqual([]);
    // The receipt on screen lists exactly the events of the transaction, in its order.
    expect(shownEvents).toEqual(names);
    expect((await hands(chain, stand.core, fourth.handId)).closedAt).toBeGreaterThan(0);
    expect((await thanks(chain, stand.core, fourth.handId)).giveHash).not.toBe(zeroHash);
    expect(await balanceOf(chain, usd, ADDRESSES.gina4)).toBe(0n);
  });

  await test.step("no person's browser reached a host other than 127.0.0.1, logged an error, or held a fragment in the address bar after load", async () => {
    for (const one of people) {
      expect(one.offHost, `${one.name} reached off host`).toEqual([]);
      expect(one.errors, `${one.name}'s page errors and console errors`).toEqual([]);
      expect([...new Set(one.sent.map((s) => s.host))], `${one.name}'s hosts`).toEqual(["127.0.0.1"]);
      expect(one.watch.loads, `${one.name}'s watch ran`).toBeGreaterThan(0);
      expect(one.watch.fragmentsAfterLoad, `${one.name}'s address bar`).toBe(0);
    }
  });
});
