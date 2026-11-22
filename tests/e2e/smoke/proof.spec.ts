/**
 * The verifier's three pages in a real browser against the stand's chain:
 *
 *   STAND_SLOT=4 bunx playwright test tests/e2e/smoke/proof.spec.ts
 *   STAND_FILE=<a helper chain's stand.json> STAND_BASE_URL=<its site> bunx playwright test tests/e2e/smoke/proof.spec.ts
 *
 * Fixtures, made in beforeAll and used by this file only: the seed's `thanked`, `refunded`,
 * `expired` and `unlisted` Hands, its `twoPasses` live address and its open `give`. The passport's
 * verdicts are compared with the SDK's own `verifyBundle` run in a child process over the bundle
 * the page downloaded, and its transaction line and token moves with the receipt read here by
 * viem; /core's derived address with the Core in stand.json; /check's DOM is searched for the live
 * link's seed in three forms (craft.ts `secrets`), its sentence about the Hand's state is read on
 * every kind of Hand, and its page is run with the browser offline and with only the RPC cut.
 *
 * The early review's fixes are held here too: /check states a closed
 * or ended Hand's state before Core's sentence and checks a link held in tab memory without a
 * paste; the passport says "Pass n" and that the words are the asker's, unchecked; the printed
 * receipt has its head and its amounts in one column on paper.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";
import { erc20Abi, getAddress, isAddressEqual, keccak256, parseEventLogs, type Hex } from "viem";

import { chainNow, code, hands, rpc, thanks } from "../lib/rpc";
import { readStand, runProgram, seed, standSlot, type StandInfo } from "../lib/stand";

test.describe.configure({ mode: "serial" });

interface HandFixture {
  handId: string;
  address: string;
}
interface SeedRun {
  fixtures: {
    thanked: HandFixture & { giveAddress: string; passedAddress: string; thankTx: Hex; giveHash: Hex; title: string };
    refunded: HandFixture & { refundTx: Hex };
    expired: HandFixture;
    unlisted: HandFixture;
    twoPasses: HandFixture;
    give: HandFixture & { giveAddress: string };
  };
}
interface Line {
  id: string;
  verdict: string;
  mark: string;
}

let stand: StandInfo;
let fixtures: SeedRun["fixtures"];

/** How craft.ts is told which chain: the slot, or the helper chain's file when STAND_FILE names one. */
const standArgs = (): string[] => (process.env.STAND_FILE ? ["--stand", process.env.STAND_FILE] : ["--slot", String(standSlot())]);
const craft = <T>(args: string[]): T => JSON.parse(runProgram("tests/e2e/lib/craft.ts", [...args, ...standArgs()]).stdout) as T;

test.beforeAll(() => {
  stand = readStand();
  fixtures = seed<SeedRun>(standSlot(), ["refunded", "expired", "thanked", "unlisted", "twoPasses", "give"]).fixtures;
});

/** Pastes a link into /check and waits for the contract's column to settle. */
async function checkLink(page: Page, text: string, state = "done"): Promise<void> {
  await page.getByTestId("check-input").fill(text);
  await page.getByTestId("check-run").click();
  await expect(page.getByTestId("check-core-answer")).toHaveAttribute("data-state", state, { timeout: 30_000 });
}

/** Opens a passport and waits until every line has ticked in. */
async function openPassport(page: Page, handId: string): Promise<Line[]> {
  await page.goto(`/${stand.chainId}/${handId}/proof`);
  await expect(page.getByTestId("proof-tally")).toHaveAttribute("data-done", "true", { timeout: 30_000 });
  return linesOf(page);
}

/** Moves inside the app, as a link on a screen does, keeping this tab's memory. */
async function inApp(page: Page, to: string): Promise<void> {
  await page.evaluate((path) => {
    history.pushState(null, "", path);
    dispatchEvent(new PopStateEvent("popstate"));
  }, to);
}

async function toRussian(page: Page): Promise<void> {
  await page.getByTestId("shell-lang").click();
  await page.getByTestId("shell-lang-ru").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
}

async function checkPasted(page: Page, address: string): Promise<void> {
  await page.goto("/check");
  await page.getByTestId("check-input").fill(address);
  await page.getByTestId("check-run").click();
  await expect(page.getByTestId("check-core-answer")).toHaveAttribute("data-state", "done", { timeout: 30_000 });
}

async function linesOf(page: Page): Promise<Line[]> {
  return page.getByTestId("proof-check").evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute("data-value") ?? "",
      verdict: node.getAttribute("data-verdict") ?? "",
      mark: node.getAttribute("data-mark") ?? "",
    })),
  );
}

test("the thanked Hand's passport: every line carries a mark, none failed, the giveHash matches Core", async ({ page }) => {
  const lines = await openPassport(page, fixtures.thanked.handId);
  expect(lines.length).toBeGreaterThan(10);
  for (const line of lines) {
    expect(["ok", "not-checkable"], `${line.id} is ${line.verdict}`).toContain(line.verdict);
    expect(["checked", "chain", "waiting"]).toContain(line.mark);
  }
  // Each line shows its mark's words (the three marks never look alike: ✓ / ⛓ / ⏳ and their words).
  const checks = page.getByTestId("proof-check");
  for (let index = 0; index < lines.length; ++index) await expect(checks.nth(index).locator(".ah-mark")).toHaveCount(1);
  // A line that can't be checked says so in words and is never a finding.
  await expect(page.locator(".proof-finding")).toHaveCount(0);
  for (const line of lines.filter((l) => l.verdict === "not-checkable")) {
    await expect(page.locator(`[data-value="${line.id}"] .proof-nc`)).toBeVisible();
  }
  const ids = lines.map((line) => line.id);
  // The SDK's first four, with the page's own line about the raise's block after `raised`.
  expect(ids.slice(0, 5)).toEqual(["core", "raised", "time.opened", "reward-time", "description"]);
  expect(ids).toContain("give-hash");
  // The contract's two times are the times of the blocks that carry the raise and the thanks.
  expect(lines.find((line) => line.id === "time.opened")!.verdict).toBe("ok");
  expect(lines.find((line) => line.id === "time.closed")!.verdict).toBe("ok");
  expect(ids.indexOf("time.closed")).toBeLessThan(ids.findIndex((id) => id.startsWith("payout.")));
  expect(lines.find((line) => line.id === "core")!.verdict).toBe("ok"); // the stand's deployment facts derive its Core
  await expect(page.getByTestId("proof-givehash-matches")).toBeVisible();
  await expect(page.getByTestId("proof-givehash-matches")).toHaveText(/giveHash matches Core/i);
  await expect(page.getByTestId("proof-givehash-matches")).toHaveCSS("text-transform", "uppercase");

  // "Check it all again" re-runs and ticks the same lines in order.
  await page.getByTestId("proof-again").click();
  await expect(page.getByTestId("proof-tally")).toHaveAttribute("data-done", "false");
  await expect(page.getByTestId("proof-tally")).toHaveAttribute("data-done", "true", { timeout: 30_000 });
  expect((await linesOf(page)).map((line) => [line.id, line.verdict])).toEqual(lines.map((line) => [line.id, line.verdict]));

  // "Check it without this site": the CLI over a clone, with this chain, Core, number and commit.
  await page.getByTestId("proof-without-site").getByRole("button").first().click();
  const verify = (await page.getByTestId("proof-verify-line").textContent()) ?? "";
  expect(verify).toContain("bun tools/ahand.ts verify");
  expect(verify).toContain(`--rpc ${stand.rpc}`);
  expect(verify).toContain(`--core ${getAddress(stand.core)}`);
  expect(verify).toMatch(new RegExp(` ${fixtures.thanked.handId}$`));
  expect(verify).toMatch(/git checkout [0-9a-f]{40} /);
  expect(verify).not.toMatch(/\bnpx\b|\bbunx\b|npm i/);
});

test("the passport shows how the thanks was sent, the token's own Transfer under each Paid line, and says where its first line's numbers come from", async ({ page }) => {
  const chain = rpc(stand.rpc);
  const receipt = await chain.client.getTransactionReceipt({ hash: fixtures.thanked.thankTx });
  const hand = await hands(chain, stand.core, BigInt(fixtures.thanked.handId));
  await openPassport(page, fixtures.thanked.handId);

  // The transaction line: the receipt's own sender, gas and price, read again here by viem.
  const sent = page.getByTestId("proof-sent");
  await expect(sent).toHaveAttribute("data-state", "read");
  await expect(sent).toHaveAttribute("data-tx", fixtures.thanked.thankTx);
  expect(getAddress((await sent.getAttribute("data-from"))!)).toBe(getAddress(receipt.from));
  await expect(sent).toHaveAttribute("data-gas", String(receipt.gasUsed));
  await expect(sent).toHaveAttribute("data-fee", String(receipt.gasUsed * receipt.effectiveGasPrice));
  await expect(sent).toContainText(/The thanks was sent by 0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4} in block [\d\s\u00a0]+\. Sending it cost them [\d.]+ ETH, about \$[\d.]+ at the ETH price of \d+ \w+\./);
  await expect(sent.locator('[data-verdict-tag="ok"]')).toHaveCount(0); // information, not a verdict
  await sent.getByRole("button", { name: /evidence/i }).click();
  await expect(sent).toContainText(`gasUsed ${receipt.gasUsed}`);
  await expect(sent).toContainText(`from ${getAddress(receipt.from)}`);

  // Each Paid line carries the token's Transfer from Core: the same payee, amount and log index as the receipt holds.
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).filter(
    (log) => isAddressEqual(log.address, hand.token) && isAddressEqual(log.args.from, stand.core),
  );
  expect(transfers.length).toBeGreaterThanOrEqual(2); // the holder's share and the helper's amount
  const moves = await page.getByTestId("proof-move").evaluateAll((nodes) =>
    nodes.map((node) => ({ found: node.getAttribute("data-found"), log: node.getAttribute("data-log"), to: node.getAttribute("data-to"), amount: node.getAttribute("data-amount") })),
  );
  expect(moves).toEqual(transfers.map((log) => ({ found: "true", log: String(log.logIndex), to: log.args.to, amount: String(log.args.value) })));
  await expect(page.getByTestId("proof-move").first()).toContainText("The token recorded the same move itself");

  // The first line says its inputs come with the site, and its back side carries the command and the two code hashes.
  const core = page.locator('[data-testid="proof-check"][data-value="core"]');
  await expect(page.getByTestId("proof-core-caveat")).toContainText("come with this site");
  await core.getByRole("button", { name: /evidence/i }).click();
  await expect(page.getByTestId("proof-core-command")).toContainText('cast" keccak');
  await expect(page.getByTestId("proof-core-command")).toContainText(/git checkout [0-9a-f]{40} /);
  const hashes = page.getByTestId("proof-code-hashes");
  await expect(hashes).toHaveAttribute("data-runtime", keccak256(await code(chain, stand.core)));
  const factory = (stand as StandInfo & { deployment?: { factory?: Hex } }).deployment?.factory ?? "0x4e59b44847b379578588920cA78FbF26c0B4956C";
  await expect(hashes).toHaveAttribute("data-factory", keccak256(await code(chain, factory)));
  await expect(core).toContainText("recorded, not the proof");
});

test("the downloaded bundle, checked by the SDK in a child process, gives the page's ids and verdicts", async ({ page }) => {
  const lines = await openPassport(page, fixtures.thanked.handId);
  const download = page.waitForEvent("download");
  await page.getByTestId("proof-download").click();
  const file = join(mkdtempSync(join(tmpdir(), "ahand-proof-")), (await download).suggestedFilename());
  expect(file).toMatch(new RegExp(`ahand-proof-${stand.chainId}-${fixtures.thanked.handId}\\.json$`));
  await (await download).saveAs(file);
  type Row = { id: string; verdict: string; basis: string };
  const { stdout } = runProgram("tests/e2e/lib/proof-pages/verify-bundle.ts", [file]);
  const fromBundle = (JSON.parse(stdout) as { checks: Row[] }).checks;
  // The SDK checks every line but the page's own two (the blocks' times), which it does not know yet.
  const pageOnly = ["time.opened", "time.closed"];
  const pageLines = lines.filter((line) => !pageOnly.includes(line.id)).map(({ id, verdict }) => ({ id, verdict }));
  // With no network a file proves its signatures, hashes and sums; its events and views are only
  // what it records: those lines read "recorded", never ok.
  expect(fromBundle.map(({ id }) => id)).toEqual(pageLines.map(({ id }) => id));
  for (const [index, row] of fromBundle.entries()) {
    const shown = pageLines[index]!;
    expect(row.verdict, row.id).toBe(row.basis === "recorded" && shown.verdict === "ok" ? "recorded" : shown.verdict);
  }
  expect(fromBundle.some((row) => row.verdict === "recorded")).toBe(true);
  // Against the chain, the same file gives one first line, chain, and then the page's verdicts.
  const reread = runProgram("tests/e2e/lib/proof-pages/verify-bundle.ts", [file, "--rpc", stand.rpc]);
  const onChain = (JSON.parse(reread.stdout) as { checks: Row[] }).checks.map(({ id, verdict }) => ({ id, verdict }));
  expect(onChain).toEqual([{ id: "chain", verdict: "ok" }, ...pageLines]);
  expect(lines.filter((line) => pageOnly.includes(line.id)).map((line) => line.verdict)).toEqual(["ok", "ok"]);
  // What the page read beside the record is in the file too: the sending and the two blocks' times.
  const chain = rpc(stand.rpc);
  const receipt = await chain.client.getTransactionReceipt({ hash: fixtures.thanked.thankTx });
  const hand = await hands(chain, stand.core, BigInt(fixtures.thanked.handId));
  const extra = (JSON.parse(readFileSync(file, "utf8")) as { extra: { format: string; sent: { from: string; gasUsed: string; moves: unknown[] }; opened: { timestamp: number }; closed: { timestamp: number; block: string } } }).extra;
  expect(extra.format).toBe("aHand.proof-page/1");
  expect(getAddress(extra.sent.from)).toBe(getAddress(receipt.from));
  expect(extra.sent.gasUsed).toBe(String(receipt.gasUsed));
  expect(extra.sent.moves.length).toBeGreaterThanOrEqual(2);
  expect(extra.opened.timestamp).toBe(hand.openedAt);
  expect(extra.closed.timestamp).toBe(hand.closedAt);
  expect(extra.closed.block).toBe(String(receipt.blockNumber));
});

test("the refunded Hand's passport is the short list, ending in the refund", async ({ page }) => {
  const lines = await openPassport(page, fixtures.refunded.handId);
  const sections = await page.locator(".proof-section").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-section")));
  expect(sections).toEqual(["core", "raised", "reward-time", "description", "back"]);
  expect(lines.slice(0, 7).map((line) => line.id)).toEqual(["core", "raised", "time.opened", "reward-time", "description", "refunded", "time.closed"]);
  expect(lines.some((line) => line.id.startsWith("route.") || line.id === "give-hash")).toBe(false);
  for (const line of lines) expect(line.verdict).not.toBe("fail");
  expect(lines.find((line) => line.id === "time.closed")!.verdict).toBe("ok");
  // The return's own sending and the token's Transfer back to the asker.
  const receipt = await rpc(stand.rpc).client.getTransactionReceipt({ hash: fixtures.refunded.refundTx });
  await expect(page.getByTestId("proof-sent")).toHaveAttribute("data-gas", String(receipt.gasUsed));
  await expect(page.getByTestId("proof-sent")).toContainText("The return was sent by");
  await expect(page.getByTestId("proof-move")).toHaveCount(1);
  await expect(page.getByTestId("proof-move")).toHaveAttribute("data-found", "true");
  await expect(page.locator('.proof-section[data-section="back"] .proof-section__title')).toHaveText(/The reward went back/);
  // "Print the receipt" leads to /print's receipt of this Hand.
  await page.getByTestId("proof-print").click();
  await expect(page).toHaveURL(new RegExp(`/print\\?receipt=\\d+/${fixtures.refunded.handId}$`));
  await expect(page.getByTestId("print-receipt")).toBeVisible();
});

test("/check ticks every step of a live address, agrees with Core, and never holds the seed", async ({ page }) => {
  const secrets = craft<{ hex: string; base64url: string; digits: string }>(["secrets", fixtures.twoPasses.address]);
  await page.goto("/check");
  await page.getByTestId("check-input").fill(fixtures.twoPasses.address);
  await page.getByTestId("check-run").click();
  await expect(page.getByTestId("check-input")).toHaveValue("");

  await expect(page.getByTestId("check-ruler")).toBeVisible();
  await expect(page.locator('.check-ruler__seg[data-kind="secret"]')).toHaveCount(1);
  await expect(page.getByTestId("check-core-answer")).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  await expect(page.getByTestId("check-core-answer")).toHaveAttribute("data-value", "accepted");
  await expect(page.getByTestId("check-agree")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("check-finding")).toHaveCount(0);
  const statuses = await page.getByTestId("check-step").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-status")));
  expect(statuses).toEqual(Array(6).fill("pass")); // two passes × three of Core's checks each

  const dom = await page.content();
  const values = await page.locator("input, textarea").evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value).join("\n"));
  const text = `${dom}\n${values}`;
  const hex = secrets.hex.replace(/^0x/, "").toLowerCase();
  expect(text.toLowerCase().includes(hex), "seed as hex").toBe(false);
  expect(text.includes(secrets.base64url), "seed as base64url").toBe(false);
  expect(text.includes(secrets.digits), "seed as digits").toBe(false);
  // Nor the link itself: the box was emptied and nothing renders it.
  expect(text.includes(fixtures.twoPasses.address.split("#")[1]!)).toBe(false);
});

test("/check: an answer whose helper confirmation was altered fails at the same step here and in Core", async ({ page }) => {
  const tampered = craft<{ address: string }>(["tamper", fixtures.give.giveAddress, "--how", "giver-sig"]).address;
  await page.goto("/check");
  await page.getByTestId("check-input").fill(tampered);
  await page.getByTestId("check-run").click();
  await expect(page.getByTestId("check-core-answer")).toHaveAttribute("data-value", "InvalidGiverSig", { timeout: 30_000 });
  await expect(page.getByTestId("check-agree")).toBeVisible({ timeout: 15_000 });
  const steps = await page.getByTestId("check-step").evaluateAll((nodes) => nodes.map((node) => [node.getAttribute("data-check"), node.getAttribute("data-status")]));
  expect(steps.at(-1)).toEqual(["InvalidGiverSig", "fail"]);
  expect(steps.slice(0, -1).every(([, status]) => status === "pass")).toBe(true);
});

test("/check says what the Hand itself is: Core accepting an answer never reads as \"can be thanked\" on a closed or ended Hand", async ({ page }) => {
  await page.goto("/check");
  const now = page.getByTestId("check-hand-now");
  const core = page.getByTestId("check-core-answer");

  // The very answer the asker thanked: Core still accepts it (checkGive does not look at closedAt).
  await checkLink(page, fixtures.thanked.giveAddress);
  await expect(core).toHaveAttribute("data-value", "accepted");
  await expect(now).toHaveAttribute("data-state", "thanked-this");
  await expect(now).toContainText("This is the answer that was thanked");
  await expect(core).not.toContainText(/can thank|asker thanks/i);
  await expect(page.getByTestId("check-passport")).toHaveAttribute("href", `/${stand.chainId}/${fixtures.thanked.handId}/proof`);
  // The state is read at the block Core answered at, and the chain agrees: closed, with this Give kept.
  const chain = rpc(stand.rpc);
  const block = BigInt((await now.getAttribute("data-block")) ?? "0");
  expect(block).toBeGreaterThan(0n);
  expect((await hands(chain, stand.core, BigInt(fixtures.thanked.handId))).closedAt).not.toBe(0);
  expect((await thanks(chain, stand.core, BigInt(fixtures.thanked.handId))).giveHash).toBe(fixtures.thanked.giveHash);

  // Another answer to the same, already thanked Hand: accepted by Core, and plainly too late.
  const other = craft<{ address: string }>(["give", fixtures.thanked.passedAddress, "--giver", "5"]).address;
  await checkLink(page, other);
  await expect(core).toHaveAttribute("data-value", "accepted");
  await expect(now).toHaveAttribute("data-state", "thanked-other");
  await expect(now).toContainText("thanked another answer");
  await expect(core).not.toContainText(/can thank|asker thanks/i);

  // A route of the thanked Hand with no answer at its end.
  await checkLink(page, fixtures.thanked.passedAddress);
  await expect(now).toHaveAttribute("data-state", "thanked");
  await expect(core).not.toContainText(/asker thanks whoever/i);

  // A Hand whose reward went back.
  await checkLink(page, fixtures.refunded.address);
  await expect(now).toHaveAttribute("data-state", "refunded");
  await expect(now).toContainText("the reward went back to the asker");
  await expect(page.getByTestId("check-passport")).toHaveAttribute("href", `/${stand.chainId}/${fixtures.refunded.handId}/proof`);

  // Past its time by the network's clock, still open in the contract.
  await checkLink(page, fixtures.expired.address);
  await expect(core).toHaveAttribute("data-value", "accepted");
  await expect(now).toHaveAttribute("data-state", "expired");
  await expect(now).toContainText("Time's up on");
  await expect(core).not.toContainText(/asker thanks whoever/i);
  await expect(page.getByTestId("check-passport")).toHaveCount(0);
  const expired = await hands(chain, stand.core, BigInt(fixtures.expired.handId));
  expect(expired.closedAt).toBe(0);
  expect((await chainNow(chain)).timestamp).toBeGreaterThanOrEqual(expired.expiry);

  // An open Hand's answer: only here does the page say it can be thanked.
  await checkLink(page, fixtures.give.giveAddress);
  await expect(now).toHaveAttribute("data-state", "open");
  await expect(now).toContainText("The asker can thank this answer.");
  // And an open route keeps its promise of a share, with the date it holds until.
  await checkLink(page, fixtures.twoPasses.address);
  await expect(now).toHaveAttribute("data-state", "open");
  await expect(now).toContainText(/If the asker thanks whoever answers this route, they get 95% of the reward\./);
});

test("/check with the browser offline: the contract's column says it was not asked, the bytes are read, nothing hangs", async ({ page, context }) => {
  const secrets = craft<{ hex: string; base64url: string; digits: string }>(["secrets", fixtures.twoPasses.address]);
  await page.goto("/check");
  await expect(page.getByTestId("check-input")).toBeVisible();
  const failed: string[] = [];
  page.on("requestfailed", (request) => failed.push(request.url()));
  await context.setOffline(true);

  await checkLink(page, fixtures.twoPasses.address, "offline");
  const core = page.getByTestId("check-core-answer");
  await expect(core).toContainText("Not asked");
  await expect(core).not.toContainText(/asking the contract/i);
  // The ruler needs no network.
  await expect(page.getByTestId("check-ruler")).toBeVisible();
  await expect(page.locator('.check-ruler__seg[data-kind="secret"]')).toHaveCount(1);
  // The network's sentence stands once, with no raw id anywhere.
  const text = await page.locator('[data-screen="check"]').innerText();
  expect(text.match(/Nothing was sent\./g) ?? []).toHaveLength(1);
  expect(text.match(/Can't reach the network right now\./g) ?? []).toHaveLength(1);
  expect(text).not.toMatch(/common\.error|link\.[a-z-]+\b(?!\S)/);
  // What the bytes alone say: each pass's share and payee, nothing called checked.
  const passes = await page.getByTestId("check-offline-pass").evaluateAll((nodes) => nodes.map((node) => [node.getAttribute("data-kept"), node.getAttribute("data-next")]));
  expect(passes).toEqual([
    ["500", "9500"],
    ["0", "9500"],
  ]);
  await expect(page.getByTestId("check-offline")).toContainText("What the route leaves for whoever helps: 95%.");
  await expect(page.getByTestId("check-offline")).toContainText("Not checked: whether each pass was made with the key that held the link");
  await expect(page.getByTestId("check-offline")).toContainText("Not compared with the chain");
  await expect(page.getByTestId("check-step")).toHaveCount(0);
  await expect(page.getByTestId("check-agree")).toHaveCount(0);
  await expect(page.locator('.ah-mark')).toHaveCount(0); // no mark claims a check that was not made
  // Offline, the page asked for no file of its own (viem's lazy helper included); only RPC polls fail.
  expect(failed.filter((url) => !url.startsWith(stand.rpc))).toEqual([]);
  // Nor is the seed anywhere, though the link is kept in memory for the retry.
  const dom = (await page.content()).toLowerCase();
  expect(dom.includes(secrets.hex.replace(/^0x/, "").toLowerCase())).toBe(false);
  expect(dom.includes(secrets.base64url.toLowerCase())).toBe(false);
  expect(dom.includes(secrets.digits)).toBe(false);

  // Back online, "Try again" checks the same link without pasting it again.
  await context.setOffline(false);
  await page.getByTestId("check-retry").click();
  await expect(core).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  await expect(page.getByTestId("check-agree")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("check-offline")).toHaveCount(0);
});

test("/check when only the RPC is cut: the same offline state, and viem's lazy helper is not fetched", async ({ page }) => {
  await page.goto("/check");
  await expect(page.getByTestId("check-input")).toBeVisible();
  const origin = new URL(stand.rpc).origin;
  const lazy: string[] = [];
  page.on("request", (request) => {
    if (/ccip/i.test(request.url())) lazy.push(request.url());
  });
  await page.route((url) => url.origin === origin, (route) => route.abort());
  await checkLink(page, fixtures.give.giveAddress, "offline");
  await expect(page.getByTestId("check-offline-band")).toHaveAttribute("data-ccip", "true");
  await expect(page.getByTestId("check-offline")).toContainText("The answer names the helper");
  await expect(page.getByTestId("check-offline")).toContainText("The helper confirmed it with a key.");
  expect((await page.locator('[data-screen="check"]').innerText()).match(/Nothing was sent\./g) ?? []).toHaveLength(1);
  expect(lazy).toEqual([]);
});

test("/core derives the Core in use, lists the twelve limits, and labels the served build", async ({ page, request }) => {
  await page.goto("/core");
  await expect(page.getByTestId("core-address")).toHaveText(getAddress(stand.core));
  const derivation = page.getByTestId("core-derivation");
  await expect(derivation).toHaveAttribute("data-match", "true");
  await expect(derivation).toHaveAttribute("data-value", getAddress(stand.core));
  await expect(page.getByTestId("core-cap")).toHaveAttribute("data-value", String(180 * 86_400), { timeout: 15_000 });
  await expect(page.getByTestId("core-domain")).toContainText(getAddress(stand.core));
  await expect(page.getByTestId("core-commit")).toHaveAttribute("data-value", /^[0-9a-f]{40}$/);
  await expect(page.getByTestId("core-limits").locator("li")).toHaveCount(12);
  await expect(page.getByTestId("core-limits")).toContainText("Thanking is voluntary.");
  await expect(page.getByTestId("core-limits")).toContainText("Gas-heavy refund");
  // The record's "about 70" keeps its words; this build's own figure, computed from its default, stands under it.
  await expect(page.getByTestId("core-limits")).toContainText("about 70 gas-burning payees");
  await expect(page.getByTestId("core-limit-here")).toHaveAttribute("data-gas-k", "250");
  await expect(page.getByTestId("core-limit-here")).toHaveAttribute("data-value", "55");
  await expect(page.getByTestId("core-limit-here")).toHaveText(/With this site's default of 250 thousand gas per payout: 55 paid passes at worst\./i);
  await expect(page.getByTestId("core-command")).toContainText("cast\" keccak");
  await expect(page.getByTestId("core-unaudited")).toHaveText(
    "Unaudited: seven AI reviews and one AI scan found no defect. No professional audit has been done.",
  );
  // A built stand serves /build.json and the page shows its hash; a dev stand serves none and says so.
  const served = await request.get("/build.json");
  const isJson = served.ok() && (served.headers()["content-type"] ?? "").includes("json");
  const real = isJson ? ((await served.json()) as { hash?: unknown }).hash : undefined;
  if (typeof real === "string") {
    await expect(page.getByTestId("core-build-hash")).toHaveAttribute("data-state", "served");
    await expect(page.getByTestId("core-build-value")).toHaveText(real);
  } else {
    await expect(page.getByTestId("core-build-hash")).toHaveAttribute("data-state", "none");
    await expect(page.getByTestId("core-build-hash")).toContainText("There is no build to hash");
  }

  // With /build.json served, the hash stands with its label.
  const hash = "5e".repeat(32);
  await page.route("**/build.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hash, command: "sha256sum", commit: null, dirty: false, files: [] }) }),
  );
  await page.reload();
  await expect(page.getByTestId("core-build-hash")).toHaveAttribute("data-state", "served");
  await expect(page.getByTestId("core-build-label")).toHaveText(/served by this site/i);
  await expect(page.getByTestId("core-build-value")).toHaveText(hash);
});

test("/check says a thanked, refunded or ended Hand's state before Core's sentence, and promises no payout on it", async ({ page }) => {
  await checkPasted(page, fixtures.thanked.giveAddress);
  const state = page.getByTestId("check-hand-state");
  await expect(state).toHaveAttribute("data-value", "thanked");
  await expect(state).toContainText(/This hand is closed: thanked on \d{1,2} \w{3,4}\. The route is valid, but nobody can be paid through it any more\./);
  await expect(page.getByTestId("check-core-answer")).toHaveAttribute("data-value", "accepted");
  await expect(page.getByTestId("check-core-answer")).not.toContainText("The asker can thank it");

  await checkPasted(page, fixtures.refunded.address);
  await expect(state).toHaveAttribute("data-value", "refunded");
  await expect(state).toContainText(/This hand is closed: the reward went back to the asker on \d{1,2} \w{3,4}\./);
  await expect(page.getByTestId("check-core-answer")).not.toContainText("of the reward");

  await checkPasted(page, fixtures.expired.address);
  await expect(state).toHaveAttribute("data-value", "expired");
  await expect(state).toContainText(/Time's up on \d{1,2} \w{3,4}\. Only sending the reward back is possible now\./);

  await checkPasted(page, fixtures.unlisted.address);
  await expect(state).toHaveAttribute("data-value", "open");
  // Merged with the build's /check: Core's own sentence says only that it accepts the route; the
  // promise of a share stands with the open Hand's date in "The hand itself" (check-hand-now).
  await expect(page.getByTestId("check-core-answer")).toContainText("The contract accepts this route.");
  await expect(page.getByTestId("check-hand-now")).toContainText("If the asker thanks whoever answers this route, they get 100% of the reward.");

  await checkPasted(page, fixtures.thanked.giveAddress);
  await toRussian(page);
  await expect(state).toContainText(/Эта рука закрыта: спасибо сказано \d{1,2} [а-я]{3,4}\. Путь верный, но заплатить по нему уже никому нельзя\./);
});

test("/check reached with a link in this tab's memory checks it without a paste, and never prints it", async ({ page }) => {
  await page.goto(fixtures.twoPasses.address);
  await expect(page.getByTestId("hand-deal-card")).toBeVisible({ timeout: 20_000 });
  await inApp(page, "/check");
  await expect(page.getByTestId("check-ruler")).toBeVisible();
  await expect(page.getByTestId("check-core-answer")).toHaveAttribute("data-value", "accepted", { timeout: 30_000 });
  await expect(page.getByTestId("check-hand-state")).toHaveAttribute("data-value", "open");
  await expect(page.getByTestId("check-input")).toHaveValue("");
  expect(new URL(page.url()).pathname).toBe("/check");
  expect(page.url()).not.toContain("#");
  expect(await page.content()).not.toContain(fixtures.twoPasses.address.split("#")[1]!);
});

test("the passport names a route position as a pass and says the words are the asker's, unchecked", async ({ page }) => {
  await openPassport(page, fixtures.thanked.handId);
  const sentences = await page.locator(".proof-line__sentence").allInnerTexts();
  expect(sentences.filter((line) => /^Hand \d/.test(line))).toEqual([]);
  expect(sentences).toContain("Pass 1 was made with the very key that held the link.");
  expect(sentences).toContain("These are the asker's own words, unchanged since the hand was raised. Nobody checked whether they are true.");
  await toRussian(page);
  await expect(page.locator(".proof-line__sentence").filter({ hasText: /^Передача 1 сделана тем самым ключом/ })).toHaveCount(1);
  await expect(page.locator(".proof header .ah-meta")).toContainText(/^Сеть \d+ · Core 0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4} · Рука \d+ · Прочитано в блоке/);
});

test("the printed receipt says what was asked, how and when the hand closed and who asked; on paper the amounts stand in one column", async ({ page }) => {
  await page.goto(fixtures.thanked.address);
  await expect(page.getByTestId("hand-deal-card")).toBeVisible({ timeout: 20_000 });
  await inApp(page, `/${stand.chainId}/${fixtures.thanked.handId}/proof`);
  await expect(page.getByTestId("proof-tally")).toHaveAttribute("data-done", "true", { timeout: 30_000 });
  await page.getByTestId("proof-print").click();
  const head = page.getByTestId("print-header");
  await expect(head).toHaveAttribute("data-closing", "thanked", { timeout: 20_000 });
  await expect(head).toContainText(`Receipt · hand #${fixtures.thanked.handId}`);
  await expect(head).toContainText(fixtures.thanked.title);
  await expect(head).toContainText(/Thanked on \d{1,2} \w{3,4} \d{4}, block \d+/);
  await expect(head).toContainText(/Asked by 0x[0-9a-fA-F]{40}/);

  await page.emulateMedia({ media: "print" });
  const paper = await page.evaluate(() => ({
    feet: Array.from(document.querySelectorAll(".ah-print-sheet .ah-receipt__what")).map((node) => getComputedStyle(node).textDecorationLine),
    chips: Array.from(document.querySelectorAll(".ah-print-sheet .ah-receipt__amount--chip")).map((node) => getComputedStyle(node).paddingRight),
    rights: Array.from(document.querySelectorAll(".ah-print-sheet tbody .ah-receipt__sum")).map((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return Math.round(range.getBoundingClientRect().right);
    }),
  }));
  expect(paper.feet.length).toBeGreaterThan(0);
  expect(new Set(paper.feet)).toEqual(new Set(["none"]));
  expect(paper.chips).toEqual(["0px"]);
  expect(new Set(paper.rights).size).toBe(1);
  await page.emulateMedia({ media: "screen" });

  await toRussian(page);
  await expect(head).toContainText(`Квитанция · рука №${fixtures.thanked.handId}`);
  await expect(head).toContainText(/Спасибо сказано \d{1,2} [а-я]{3,4}\.? \d{4}, блок \d+/);
});
