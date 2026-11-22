/**
 * /give in a real browser against a stand (feat-give): a holder of a live link helps
 * in each of its three ways, and the result is checked on the chain and at the
 * Hand's inbox, never on the page's word alone.
 *
 *   STAND_SLOT=3 bunx playwright test tests/e2e/smoke/give.spec.ts
 *
 * - a pasted payee with no wallet: a one-time key confirms (its file is downloaded), Core's
 *   checkGive accepts the give address (tools/ahand.ts thank-calldata), the screen says
 *   "Delivered to 1 of 1 relay", the inbox receives the give with the words, and the thread works
 *   both ways;
 * - dev account 4 as the wallet: signer and payee are that account;
 * - the dev wallet's "not set up yet" account: the set-up sentence, an ERC-6492-wrapped answer
 *   that Core accepts with the setup and refuses bare;
 * - "I have none": twelve words, the swipe off until they are ticked as written down, and nothing
 *   of them (nor the key) in IndexedDB, localStorage or sessionStorage afterwards;
 * - back from a social login (simulated: the stand has no Privy): the answer typed before it is in
 *   the field again, for that Hand only, and the tab's session storage is empty again;
 * - the stand's relay stopped: the fallback sentence and a copyable give address; started again,
 *   the outbox delivers it by itself.
 *
 * Every Give's dataHash is zero (read back from the produced link).
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { bytesToHex, getAddress, zeroHash, type Address, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

import { account, NOT_SET_UP, pickDevAccount } from "../lib/accounts";
import { lensOn } from "../lib/lens";
import { storageText } from "../lib/feat-give/storage";
import { readStand, runProgram, seed, standSlot, startService, stopService } from "../lib/stand";

test.describe.configure({ mode: "serial" });

interface Fixture {
  handId: string;
  n: number;
  address: string;
  inbox?: Hex;
  reward: string;
}
type Seeded = { fixtures: Record<"unlisted" | "dark" | "public" | "twoPasses" | "noReward", Fixture> };

const slot = standSlot();
const stand = readStand(slot);
let fixtures: Seeded["fixtures"];

/** A spare test account as the pasted payee: it holds no role in the fixtures. */
const PASTED = account(7).address;

function json<T = Record<string, unknown>>(script: string, args: string[]): T {
  const { stdout, stderr, code } = runProgram(script, [...args, "--slot", String(slot)], { allowFailure: true });
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`${script} ${args[0]} exited ${code} without JSON:\n${stderr || stdout}`);
  }
}
const craft = <T = Record<string, unknown>>(args: string[]) => json<T>("tests/e2e/lib/craft.ts", args);
const asker = <T = Record<string, unknown>>(args: string[]) => json<T>("tests/e2e/lib/feat-give/asker.ts", args);

interface GiveOf {
  ok: boolean;
  kind: string;
  shape: string;
  signer: Address;
  payee: Address;
  dataHash: Hex;
  wrapped6492: boolean;
  seedPresent: boolean;
}

/** Opens a link as a person would (link intake takes the fragment), then goes to /give inside the app, as "I can help" does. */
async function openGive(page: Page, address: string): Promise<void> {
  // A dev server may reload the page once while it prepares modules, and a reload forgets the
  // link by design; so the visit is repeated until the screen holds it (at most three times).
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(address, { waitUntil: "networkidle" });
      await expect(page.getByTestId("shell-main")).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
      await page.evaluate(() => {
        window.history.pushState(null, "", "/give");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await expect(page.getByTestId("give-words")).toBeVisible({ timeout: 20_000 });
      break;
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
  await expect(page.locator(".ah-deal")).toBeVisible();
}

async function produced(page: Page): Promise<string> {
  const copy = page.getByTestId("give-copy");
  await expect(copy).toBeVisible({ timeout: 20_000 });
  const address = (await copy.getAttribute("data-value"))!;
  expect(address.startsWith(`${stand.site}/#`)).toBe(true);
  return address;
}

function expectZeroDataHash(give: GiveOf): void {
  expect(give.ok).toBe(true);
  expect(give.kind).toBe("give");
  expect(give.shape).toBe("bare");
  expect(give.dataHash).toBe(zeroHash);
  expect(give.seedPresent).toBe(false);
}

test.beforeAll(() => {
  fixtures = seed<Seeded>(slot, ["unlisted", "dark", "public", "twoPasses", "noReward"]).fixtures;
});

test.afterAll(() => {
  // Leave the slot's relay running whatever happened in the last test.
  try {
    startService(slot, "relay");
  } catch {
    // already running
  }
});

test("a pasted payee and no wallet: a one-time key confirms, Core accepts, delivered to 1 of 1 relay, and the thread runs both ways", async ({ page }) => {
  const hand = fixtures.unlisted;
  expect(hand.inbox).toBeTruthy();
  await openGive(page, hand.address);
  const words = "I know a quiet room in Vake; I can send you the owner's number tonight.";
  await page.getByTestId("give-words").fill(words);
  await expect(page.getByTestId("give-swipe")).toBeDisabled();

  await page.getByRole("radio", { name: "An address I have" }).check();
  await page.getByLabel("The address").fill(PASTED);
  const card = page.getByTestId("give-agree").locator("[data-payee]");
  await expect(card).toHaveAttribute("data-payee", PASTED);
  await expect(page.getByTestId("give-agree")).toContainText("Local test network");
  // The contract and the hand's number are exact data, and who confirms is a matter of keys: the
  // lens's, not the calm view's, which says only where the money goes.
  await expect(page.getByTestId("give-agree")).not.toContainText(`number ${hand.handId}`);
  await expect(page.getByTestId("give-agree")).not.toContainText("Who confirms it");
  await expect(page.getByText("The money goes to the address you pasted.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Keep this answer's key/ })).toHaveCount(0);
  await expect(page.getByTestId("give-agree")).toContainText(/100% of the reward — \$[0-9.,]+ today/);
  // Keeping the one-time key is for those who check: the lens shows the choice.
  await lensOn(page);
  await page.getByRole("checkbox", { name: /Keep this answer's key/ }).check();
  await expect(page.getByTestId("give-agree")).toContainText("Who confirms it");

  const download = page.waitForEvent("download");
  await page.getByTestId("give-swipe").click();
  const file = JSON.parse(readFileSync((await (await download).path())!, "utf8")) as { address: Address; privateKey: Hex };
  await expect(page.getByTestId("give-delivered")).toHaveAttribute("data-value", "1/1", { timeout: 20_000 });
  const address = await produced(page);

  // The Give inside the link: the one-time key confirmed it, the pasted address receives, dataHash 0.
  const give = asker<GiveOf>(["give-of", address]);
  expectZeroDataHash(give);
  expect(give.signer).toBe(getAddress(file.address));
  expect(give.payee).toBe(PASTED);
  expect(give.wrapped6492).toBe(false);

  // Core's own checkGive accepts it: the CLI asks Core and prints the thank calldata only then.
  const calldata = runProgram("tools/ahand.ts", ["thank-calldata", address, "--rpc", stand.rpc], { allowFailure: true });
  expect(calldata.code, calldata.stderr || calldata.stdout).toBe(0);
  expect(calldata.stdout).toMatch(/0x[0-9a-f]{200,}/);
  const inspect = runProgram("tools/ahand.ts", ["inspect", address, "--rpc", stand.rpc]);
  expect(inspect.stdout).toContain(`a Give by ${give.signer}, paid to ${PASTED}`);
  expect(craft<{ give: { core: string } }>(["open", address]).give.core).toBe("accepted");

  // The Hand's inbox received the give link with the words, from the giver's chat key.
  const arrived = craft<{ ok: boolean; envelopes: { kind: string; giveLink: string; text: string; replyTo: Hex; from: Hex }[] }>(["deliver-listen", "--n", String(hand.n), "--wait", "8000"]);
  expect(arrived.ok).toBe(true);
  const envelope = arrived.envelopes[0]!;
  expect(envelope.kind).toBe("give");
  expect(envelope.giveLink).toBe(address);
  expect(envelope.text).toBe(words);
  // The key file's private key is not in the delivered envelope or anywhere in the page's storage.
  expect(JSON.stringify(arrived)).not.toContain(file.privateKey.slice(2));
  expect((await storageText(page)).toLowerCase()).not.toContain(file.privateKey.slice(2).toLowerCase());

  // The asker answers from the Hand's inbox key; the reply appears; the giver answers back.
  const answer = "Thank you! Please send the number here.";
  expect(asker<{ ok: boolean }>(["reply", "--n", String(hand.n), "--to", envelope.replyTo, "--hand", hand.address, "--text", answer]).ok).toBe(true);
  const thread = page.getByTestId("give-thread");
  await expect(thread.locator('[data-from="asker"]')).toContainText(answer, { timeout: 15_000 });
  const back = "Sent: +995 555 000 000, ask for Nino.";
  await page.getByTestId("give-reply-input").fill(back);
  await page.getByTestId("give-reply-send").click();
  await expect(thread.locator('[data-from="you"]').filter({ hasText: back })).toBeVisible();
  const both = craft<{ envelopes: { kind: string; text?: string }[] }>(["deliver-listen", "--n", String(hand.n), "--count", "2", "--wait", "8000"]);
  expect(both.envelopes.some((e) => e.kind === "note" && e.text === back)).toBe(true);

  // After a reload the tab's link is gone, but the answer and its thread are on /my.
  await page.reload();
  await page.goto("/my");
  const mine = page.locator(`[data-testid="my-answer-mine"][data-value="${address}"]`);
  await expect(page.getByTestId("my-answers-mine")).toBeVisible({ timeout: 20_000 });
  await expect(mine).toHaveAttribute("data-delivery", "delivered");
  await expect(mine).toContainText(words);
  const kept = mine.getByTestId("my-answer-thread");
  await expect(kept.locator('[data-from="asker"]')).toContainText(answer, { timeout: 20_000 });
  await expect(kept.locator('[data-from="you"]').filter({ hasText: back })).toBeVisible();

  // The same link opened again: /give says this device already answered it.
  await page.goto(hand.address);
  await page.getByTestId("hand-help").click();
  await expect(page.locator('[data-value="answered-before"]')).toBeVisible({ timeout: 20_000 });
});

test("dev account 4 as the wallet: it confirms and receives", async ({ page }) => {
  const hand = fixtures.dark;
  await openGive(page, hand.address);
  await page.getByTestId("give-words").fill("I helped a friend with exactly this permit last spring.");
  await page.getByRole("button", { name: "Connect a wallet" }).click();
  await pickDevAccount(page, 4);
  const me = account(4).address;
  await expect(page.getByTestId("give-agree").locator("[data-payee]")).toHaveAttribute("data-payee", me);
  await page.getByTestId("give-swipe").click();
  await expect(page.getByTestId("give-delivered")).toHaveAttribute("data-value", "1/1", { timeout: 20_000 });
  const address = await produced(page);
  const give = asker<GiveOf>(["give-of", address]);
  expectZeroDataHash(give);
  expect(give.signer).toBe(me);
  expect(give.payee).toBe(me);
  expect(give.wrapped6492).toBe(false);
  expect(craft<{ give: { core: string } }>(["open", address]).give.core).toBe("accepted");
});

test("an account not set up yet: the set-up sentence, a wrapped answer Core accepts with the setup and refuses bare", async ({ page }) => {
  const hand = fixtures.public;
  await openGive(page, hand.address);
  await page.getByRole("button", { name: "Connect a wallet" }).click();
  await pickDevAccount(page, NOT_SET_UP);
  const payee = (await page.getByTestId("give-agree").locator("[data-payee]").getAttribute("data-payee")) as Address;
  await page.getByTestId("give-swipe").click();
  await expect(page.getByTestId("give-setup-band")).toHaveText(
    "Your account isn't set up on this network yet. That's fine: it gets set up when the asker thanks you.",
    { timeout: 20_000 },
  );
  const address = await produced(page);
  const give = asker<GiveOf>(["give-of", address]);
  expectZeroDataHash(give);
  expect(give.signer).toBe(payee);
  expect(give.payee).toBe(payee);
  const opened = craft<{ give: { wrapped6492: boolean; deployed: boolean; core: string; coreWithSetup: string } }>(["open", address]);
  expect(opened.give.wrapped6492).toBe(true);
  expect(opened.give.deployed).toBe(false);
  expect(opened.give.coreWithSetup).toBe("accepted");
  expect(opened.give.core).not.toBe("accepted");
  expect(opened.give.core).toBe("InvalidGiverSig");
});

test("I have none: twelve words shown once, the swipe off until they are written down, nothing of them stored", async ({ page }) => {
  const hand = fixtures.noReward;
  await openGive(page, hand.address);
  await expect(page.getByText("Say what you can do. This hand carries no reward: a thank-you only.")).toBeVisible();
  await expect(page.getByText("There is no reward now. If the asker adds one before thanking, it lands here.")).toBeVisible();
  await page.getByTestId("give-words").fill("Count me in for Thursday, I play at that level.");

  await page.getByRole("radio", { name: "I have none — make one" }).check();
  const list = page.getByTestId("land-words").locator("li");
  await expect(list).toHaveCount(12);
  const words = await list.evaluateAll((items) => items.map((li) => (li.lastChild?.textContent ?? "").trim()));
  expect(words.every((word) => /^[a-z]+$/.test(word))).toBe(true);
  const made = mnemonicToAccount(words.join(" "));
  const privateKey = bytesToHex(made.getHdKey().privateKey!).slice(2);

  await expect(page.getByTestId("give-swipe")).toBeDisabled();
  await page.getByRole("checkbox", { name: "I wrote them down" }).check();
  await expect(page.getByTestId("give-agree").locator("[data-payee]")).toHaveAttribute("data-payee", made.address);
  await expect(page.getByTestId("give-swipe")).toBeEnabled();
  await page.getByTestId("give-swipe").click();
  await expect(page.getByTestId("give-delivered")).toHaveAttribute("data-value", "1/1", { timeout: 20_000 });
  const address = await produced(page);
  await expect(page.getByTestId("land-words")).toHaveCount(0);

  const give = asker<GiveOf>(["give-of", address]);
  expectZeroDataHash(give);
  expect(give.signer).toBe(made.address);
  expect(give.payee).toBe(made.address);
  expect(craft<{ give: { core: string } }>(["open", address]).give.core).toBe("accepted");

  const stored = (await storageText(page)).toLowerCase();
  expect(stored.length).toBeGreaterThan(0); // the outbox wrote its entry: the search below looked at something
  expect(stored).not.toContain(words.join(" "));
  for (let i = 0; i + 3 <= words.length; i++) expect(stored).not.toContain(words.slice(i, i + 3).join(" "));
  expect(stored).not.toContain(privateKey.toLowerCase());
});

test("back from a social login: the answer typed before it is in the field again, for that Hand only, and the keys are gone", async ({ page }) => {
  // The stand has no Privy (its configurations carry no `privy`), so the page cannot leave for a
  // provider by itself and its own write (link-carry.ts, as the page leaves with Privy's window
  // open) does not run here; apps/web/tests/guards/carry.test.ts covers that write. Here the two
  // keys are put in the tab's session storage in the shape it writes, and the page comes back as
  // the provider sends it: a fresh load of /give with Privy's code and state in the query.
  const hand = fixtures.twoPasses;
  await openGive(page, hand.address);
  const words = "Typed before logging in: I can introduce you to the clinic's head nurse.\nShe answers by Friday.";
  await page.getByTestId("give-words").fill(words);
  const returning = "/give?privy_oauth_code=one-time&privy_oauth_state=st&privy_oauth_provider=twitter";
  const mark = hand.address.indexOf("#");
  const keys = { before: hand.address.slice(0, mark), fragment: hand.address.slice(mark + 1), chainId: stand.chainId, core: stand.core.toLowerCase(), words };
  const leave = (handId: string) =>
    page.evaluate(
      ({ before, fragment, chainId, core, words, handId }) => {
        const at = Date.now();
        sessionStorage.setItem("ahand-link-carry", JSON.stringify({ before, fragment, via: "address", path: "/give", hand: false, at }));
        sessionStorage.setItem("ahand-give-draft", JSON.stringify({ chainId, core, handId, text: words, at }));
      },
      { ...keys, handId },
    );
  const left = () => page.evaluate(() => [sessionStorage.getItem("ahand-link-carry"), sessionStorage.getItem("ahand-give-draft")]);

  await leave(hand.handId);
  await page.goto(returning);
  await expect(page.getByTestId("give-words")).toHaveValue(words, { timeout: 20_000 });
  await expect(page.getByText(`${Array.from(words).length} of 1000`)).toBeVisible();
  expect(await left()).toEqual([null, null]);

  // A draft written for another Hand: the link comes back, the field stays empty.
  await leave(String(BigInt(hand.handId) + 1000n));
  await page.goto(returning);
  await expect(page.locator(".ah-deal")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("give-words")).toHaveValue("");
  expect(await left()).toEqual([null, null]);

  // A load that is not the way back from a social login: both keys erased, nothing restored.
  await leave(hand.handId);
  await page.goto("/give");
  // With no link in the tab, /give hands over to the Hand view on "/", which says so.
  await expect.poll(() => page.evaluate(() => window.location.pathname), { timeout: 20_000 }).toBe("/");
  await expect(page.getByTestId("give-words")).toHaveCount(0);
  expect(await left()).toEqual([null, null]);
});

test("with the relay stopped: the fallback sentence and a copyable give address; started again, the outbox delivers it", async ({ page, context }) => {
  const hand = fixtures.twoPasses;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  stopService(slot, "relay");
  try {
    await openGive(page, hand.address);
    await page.getByRole("radio", { name: "An address I have" }).check();
    await page.getByLabel("The address").fill(PASTED);
    await page.getByTestId("give-swipe").click();
    await expect(page.getByTestId("give-fallback")).toContainText(
      "We couldn't reach them directly. Send this back to whoever sent you the link — each person knows the one before.",
      { timeout: 20_000 },
    );
    const address = await produced(page);
    await page.getByTestId("give-copy").getByRole("button").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
    await page.getByTestId("give-qr").click();
    await expect(page.locator("[data-qr-dense]")).toBeVisible();
    expect(craft<{ give: { core: string } }>(["open", address]).give.core).toBe("accepted");
    expectZeroDataHash(asker<GiveOf>(["give-of", address]));

    startService(slot, "relay");
    // No press: the outbox retries on its own while the page is open.
    await expect(page.getByTestId("give-delivered")).toHaveAttribute("data-value", "1/1", { timeout: 40_000 });
    const arrived = craft<{ ok: boolean; envelopes: { kind: string; giveLink: string }[] }>(["deliver-listen", "--n", String(hand.n), "--wait", "8000"]);
    expect(arrived.ok).toBe(true);
    expect(arrived.envelopes[0]!.giveLink).toBe(address);
  } finally {
    try {
      startService(slot, "relay");
    } catch {
      // already running
    }
  }
});
