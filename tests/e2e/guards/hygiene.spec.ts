/**
 * Secret hygiene (ARCHITECTURE §11, PLAN rule 14): a live link's seed, a live link's text and
 * the twelve words never reach a request, a WebSocket frame, the console or the browser's storage
 * in the clear; signatures travel only in JSON-RPC bodies to the chain.
 *
 *   STAND_SLOT=2 bunx playwright test tests/e2e/guards/hygiene.spec.ts
 *
 * 1. The search finds what it should: a seed planted in localStorage (and one printed to the
 *    console) is caught in each of its three forms.
 * 2. One whole life through the screens, three people in three browser contexts, every one of
 *    them recorded: the asker raises on /raise (dev account 1), a holder with no wallet passes it
 *    on keeping 10% for a pasted address, a helper answers with "I have none — make one" (twelve
 *    words), and the asker thanks on /thank. Then every recording and every storage is searched.
 * 3. Dev account 5, whose confirmations differ each time: between sending the raise and "I saved
 *    the link" the device's escrow store holds one locked record, and it holds none of the seed's
 *    three forms; after the tick the store is empty.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { bytesToHex, createWalletClient, erc20Abi, http, type Address } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { account, pickDevAccount } from "../lib/accounts";
import { answerPrompts, compose, copied, dumpDb, swipe } from "../lib/feat-raise/raise";
import { hands, pauseBlocks, resumeBlocks, rpc } from "../lib/rpc";
import { readStand, tokenOf } from "../lib/stand";
import { craft, forge, quiet, secretsOf, visit } from "./lib/guard";
import { Recorder, describeHits, linkNeedles, search, wordNeedles, type Hay, type Needle } from "./lib/record";

const stand = readStand();
const chain = rpc(stand.rpc);
const rpcOrigin = new URL(stand.rpc).origin;
const USD = 1_000_000n;

test.afterEach(async () => {
  // A failed escrow test must not leave the stand without blocks.
  await resumeBlocks(chain);
});

async function person(browser: Browser, recorder?: Recorder, who = "someone"): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await quiet(context, stand.site!);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  recorder?.watch(context, who);
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  return { context, page };
}

/** Signatures outside JSON-RPC bodies: the link's own, by value, and any 65-byte hex run. */
function signaturesOutsideRpc(hays: readonly Hay[], sigs: readonly string[]): string[] {
  const out: string[] = [];
  const run = /(?<![0-9a-fA-F])[0-9a-fA-F]{130}(?![0-9a-fA-F])/;
  for (const hay of hays) {
    if (hay.kind === "storage" || hay.rpc) continue;
    const lower = hay.text.toLowerCase();
    if (sigs.some((sig) => lower.includes(sig))) out.push(`a signature of the link — in ${hay.kind}: ${hay.where}`);
    else if (run.test(hay.text)) out.push(`a 65-byte hex run — in ${hay.kind}: ${hay.where}`);
  }
  return out;
}

test("the search works: a seed planted in localStorage and printed to the console is found in all three forms", async ({ browser }) => {
  const made = craft<{ ok: boolean; address: string }>("make", "--mode", "dark", "--reward", "1", "--title", "The hygiene guard's own test hand");
  expect(made.ok).toBe(true);
  const forms = secretsOf(made.address);
  expect(forms.hex).toMatch(/^[0-9a-f]{32}$/);
  expect(forms.digits).toMatch(/^[0-9]+$/);

  const recorder = new Recorder(rpcOrigin);
  const { context, page } = await person(browser, recorder, "planter");
  await page.goto("/");
  await page.evaluate((f) => {
    localStorage.setItem("planted-hex", `0x${f.hex.toUpperCase()}`);
    localStorage.setItem("planted-b64", JSON.stringify({ seed: f.base64url }));
    sessionStorage.setItem("planted-digits", f.digits);
    console.log("a careless line", f.base64url);
  }, forms);
  await recorder.storage(page, "planter");
  const hits = search(recorder.hays, linkNeedles("planted", made.address, forms));
  const got = new Set(hits.map((hit) => `${hit.label} / ${hit.kind}`));
  expect([...got].sort()).toEqual(
    ["planted: seed as base64url / console", "planted: seed as base64url / storage", "planted: seed as decimal digits / storage", "planted: seed as hex / storage"].sort(),
  );
  // And a 65-byte hex run outside a JSON-RPC body is caught too.
  expect(signaturesOutsideRpc([{ kind: "console", where: "test", text: `sig 0x${"ab".repeat(65)}` }], [])).toHaveLength(1);
  await context.close();
});

test("raise, pass, give and thank: no seed, no live link, no twelve words anywhere; signatures only in JSON-RPC bodies", async ({ browser }) => {
  test.setTimeout(240_000);
  const recorder = new Recorder(rpcOrigin);

  // 1. The asker raises.
  const asker = await person(browser, recorder, "asker");
  await asker.page.goto("/raise");
  await expect(asker.page.getByTestId("raise-what")).toBeVisible({ timeout: 20_000 });
  const title = `Who can lend a projector on Friday? ${Date.now() % 100_000}`;
  await compose(asker.page, { title, details: "For an evening film club, ten people.", reward: "20" });
  await swipe(asker.page, 1);
  const up = asker.page.getByTestId("raise-up");
  await expect(up).toBeVisible({ timeout: 40_000 });
  const handId = BigInt((await up.getAttribute("data-hand-id"))!);
  const raised = await copied(asker.page);
  expect(raised).toContain("#");

  // 2. A holder with no wallet keeps 10% for a pasted address and passes it on.
  const holder = await person(browser, recorder, "holder");
  await visit(holder.page, raised);
  await holder.page.getByTestId("hand-pass").click();
  await holder.page.getByTestId("pass-slider").fill("1000");
  await holder.page.getByRole("button", { name: "Choose where it lands" }).click();
  await holder.page.getByText("An address I have").click();
  await holder.page.getByRole("textbox", { name: "The address" }).fill(account(7).address);
  await holder.page.getByRole("button", { name: "Use this address" }).click();
  await holder.page.getByTestId("pass-swipe").click();
  await expect(holder.page.getByTestId("pass-read-back")).toHaveAttribute("data-bps", "1000");
  const passed = ((await holder.page.getByTestId("pass-copy").locator(".ah-linkrow__value").textContent()) ?? "").trim();
  expect(passed).toContain("#");

  // 3. A helper with no wallet makes an address from twelve words and answers.
  const helper = await person(browser, recorder, "helper");
  await visit(helper.page, passed);
  await helper.page.getByTestId("hand-help").click();
  await expect(helper.page.getByTestId("give-words")).toBeVisible({ timeout: 20_000 });
  await helper.page.getByTestId("give-words").fill("I run a film club myself; you can borrow ours on Friday.");
  await helper.page.getByRole("radio", { name: "I have none — make one" }).check();
  const list = helper.page.getByTestId("land-words").locator("li");
  await expect(list).toHaveCount(12);
  const words = await list.evaluateAll((items) => items.map((li) => (li.lastChild?.textContent ?? "").trim()));
  expect(words.every((word) => /^[a-z]+$/.test(word))).toBe(true);
  const made = mnemonicToAccount(words.join(" "));
  const madeKey = bytesToHex(made.getHdKey().privateKey!).slice(2);
  await helper.page.getByRole("checkbox", { name: "I wrote them down" }).check();
  await helper.page.getByTestId("give-swipe").click();
  const copy = helper.page.getByTestId("give-copy");
  await expect(copy).toBeVisible({ timeout: 30_000 });
  const given = (await copy.getAttribute("data-value"))!;
  expect(given).toContain("#");

  // 4. The asker pastes the answer on /thank and thanks.
  await asker.page.goto("/thank");
  await asker.page.getByTestId("thank-input").fill(given);
  await asker.page.getByTestId("thank-open").click();
  await expect(asker.page.getByTestId("thank-predicted")).toBeVisible({ timeout: 30_000 });
  if (!(await asker.page.getByTestId("wallet-connected").isVisible())) await pickDevAccount(asker.page, 1);
  await expect(asker.page.getByTestId("thank-swipe")).toBeEnabled({ timeout: 20_000 });
  await asker.page.getByTestId("thank-swipe").click();
  await expect(asker.page.getByTestId("thank-done")).toBeVisible({ timeout: 45_000 });
  expect((await hands(chain, stand.core, handId)).closedAt).toBeGreaterThan(0);

  // Everything each person's browser keeps, as of the end.
  for (const [who, p] of [["asker", asker.page], ["holder", holder.page], ["helper", helper.page]] as const) await recorder.storage(p, who);

  const needles: Needle[] = [
    ...linkNeedles("the raised link", raised, secretsOf(raised)),
    ...linkNeedles("the passed link", passed, secretsOf(passed)),
    ...wordNeedles(words),
    { label: "the made address's key", text: madeKey, caseless: true },
  ];
  // The search looked at something real: requests to the chain and the relay, and storage.
  expect(recorder.hays.filter((hay) => hay.rpc).length).toBeGreaterThan(10);
  expect(recorder.hays.some((hay) => hay.kind === "frame")).toBe(true);
  expect(recorder.hays.filter((hay) => hay.kind === "storage" && hay.text.length > 0).length).toBeGreaterThan(0);

  expect(describeHits(search(recorder.hays, needles))).toEqual([]);
  const sigs = forge<{ ok: boolean; sigs: string[] }>("sigs", given).sigs;
  expect(sigs.length).toBeGreaterThanOrEqual(3);
  expect(signaturesOutsideRpc(recorder.hays, sigs)).toEqual([]);
  // The signatures did travel, to the chain: the search for them is not empty-handed.
  expect(recorder.hays.some((hay) => hay.rpc && sigs.some((sig) => hay.text.toLowerCase().includes(sig)))).toBe(true);

  for (const p of [asker, holder, helper]) await p.context.close();
});

/** Lets account `index` spend `amount` for Core from the test side, so a paused chain holds only the raise. */
async function preApprove(index: number, amount: bigint): Promise<void> {
  const wallet = createWalletClient({ account: privateKeyToAccount(account(index).privateKey), chain: foundry, transport: http(stand.rpc) });
  const hash = await wallet.writeContract({ address: tokenOf(stand, "usd").address as Address, abi: erc20Abi, functionName: "approve", args: [stand.core, amount] });
  await chain.client.waitForTransactionReceipt({ hash });
}

test("dev account 5: the escrow store holds one locked record between sending and 'I saved the link', with no form of the seed in it, and nothing after", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await person(browser);
  await page.goto("/raise");
  await expect(page.getByTestId("raise-what")).toBeVisible({ timeout: 20_000 });
  await preApprove(5, 5n * USD);
  await compose(page, { title: `The escrow guard ${Date.now() % 100_000}`, details: "Sent while no blocks are made.", reward: "5" });
  await expect(page.getByTestId("raise-swipe")).toBeEnabled({ timeout: 15_000 });

  // No blocks: the raise is sent and waits, so the device's state "between" can be read.
  await pauseBlocks(chain);
  await page.getByTestId("raise-swipe").click();
  await answerPrompts(page, 5);
  await expect.poll(async () => JSON.parse(await dumpDb(page)).escrow.length, { timeout: 20_000 }).toBe(1);
  const whileSent = await dumpDb(page);
  await resumeBlocks(chain);

  const up = page.getByTestId("raise-up");
  await expect(up).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId("raise-locked-copy")).toContainText("Your account can't rebuild this link later.");
  const address = await copied(page);
  const needles = linkNeedles("the new link", address, secretsOf(address));
  const beforeTick = await dumpDb(page);
  expect(JSON.parse(beforeTick).escrow.length).toBe(1);
  const hays: Hay[] = [
    { kind: "storage", where: "escrow while the raise waited for a block", text: whileSent },
    { kind: "storage", where: "escrow after the hand was up, before the tick", text: beforeTick },
  ];
  expect(describeHits(search(hays, needles))).toEqual([]);

  await page.getByTestId("raise-saved-tick").check();
  await expect(page.getByTestId("raise-copy-gone")).toBeVisible();
  const afterTick = await dumpDb(page);
  expect(JSON.parse(afterTick).escrow).toEqual([]);
  expect(describeHits(search([{ kind: "storage", where: "after the tick", text: afterTick }], needles))).toEqual([]);
  await context.close();
});
