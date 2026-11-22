/**
 * Fail closed: eleven ways
 * to hand the app a link, an answer or an address it must not go on with. Each case asserts the
 * plain sentence and that nothing on the screen leads on (no Deal card for a link that did not
 * open, no "Pass it on", no "I can help", no swipe that can be pressed).
 *
 *   STAND_SLOT=2 bunx playwright test tests/e2e/guards/failclosed.spec.ts
 *
 * Every Hand comes from this file's own seed run, or is made here with the craft and forge tools.
 */
import { expect, test, type Page } from "@playwright/test";

import { pickDevAccount } from "../lib/accounts";
import { hands, rpc } from "../lib/rpc";
import { readStand } from "../lib/stand";
import { craft, expectNoWayOn, fixtureOf, forge, quiet, seedFixtures, visit, within, type SeedRun } from "./lib/guard";

const stand = readStand();
const chain = rpc(stand.rpc);
let run: SeedRun;

test.beforeAll(() => {
  run = seedFixtures(["unlisted", "dark", "give", "resigned", "expired", "twoPasses"]);
});

test.beforeEach(async ({ context }) => {
  await quiet(context, stand.site!);
});

const SENTENCE = {
  malformed: "This link is damaged. Ask for it again.",
  unmatched: "Part of this address doesn't match its link. Ask for it again.",
  anotherHand: "The address shows one hand and the link is for another.",
  untrusted: "This link names a contract this site doesn't read. Nothing was opened.",
  unsupported: "This link was made by a newer app.",
  belowMin: "This route leaves the helper less than the asker promised. It can't go further.",
  giverSig: "The helper's confirmation doesn't check out.",
  resigned: "This answer came by a shorter route than one you already saw.",
  timesUp: "Time's up. Anyone can send the reward back to the asker now.",
  sendBack: "Send the reward back",
  payeeCore: "That is the contract's own address.",
};

/** The Hand view refused the link: its sentence, its id, and nothing that leads on. */
async function refused(page: Page, id: string, sentence: string): Promise<void> {
  const error = page.getByTestId("hand-error");
  await expect(error).toBeVisible({ timeout: 20_000 });
  await expect(error).toHaveAttribute("data-value", id);
  await expect(error).toContainText(sentence);
  await expect(page.getByTestId("hand-deal-card")).toHaveCount(0);
  await expect(page.getByTestId("hand-pass")).toHaveCount(0);
  await expect(page.getByTestId("hand-help")).toHaveCount(0);
  await expectNoWayOn(page);
}

function tampered(address: string, how: string): string {
  const made = craft<{ ok: boolean; address: string; message?: string }>("tamper", address, "--how", how);
  if (!made.ok) throw new Error(`tamper ${how}: ${made.message}`);
  return made.address;
}

test("1. one byte flipped: damaged, nothing opened", async ({ page }) => {
  await visit(page, tampered(fixtureOf(run, "unlisted").address, "flip"));
  await refused(page, "link.malformed", SENTENCE.malformed);
});

test("2. a described address cut off from its d: the part before # no longer matches, nothing opened", async ({ page }) => {
  const unlisted = fixtureOf(run, "unlisted");
  const cut = tampered(unlisted.address, "cut-d");
  expect(cut).not.toContain("?d=");
  await visit(page, cut);
  await refused(page, "link.unmatched-data", SENTENCE.unmatched);
  await expect(page.getByTestId("shell-main")).not.toContainText(unlisted.content!);
});

test("3. the address names another hand's number than its link", async ({ page }) => {
  await visit(page, tampered(fixtureOf(run, "unlisted").address, "other-number"));
  await refused(page, "link.another-hand", SENTENCE.anotherHand);
});

test("3b. the part before # is another Hand's own, or names a chain this site does not read", async ({ page }) => {
  const unlisted = fixtureOf(run, "unlisted");
  const twoPasses = fixtureOf(run, "twoPasses");
  expect(twoPasses.handId).not.toBe(unlisted.handId);
  const [before, link] = unlisted.address.split("#") as [string, string];
  const numbered = before.slice(0, before.indexOf("?d="));
  // Another Hand's address with that Hand's own ?d=, carrying this link.
  await visit(page, `${twoPasses.address.split("#")[0]}#${link}`);
  await refused(page, "link.another-hand", SENTENCE.anotherHand);
  // A numbered path with another number and no ?d=.
  await visit(page, `${numbered.slice(0, numbered.lastIndexOf("/"))}/${twoPasses.handId}#${link}`);
  await refused(page, "link.another-hand", SENTENCE.anotherHand);
  // The path's chain replaced by Base (8453), which this build does not read.
  await visit(page, `${before.replace(`/${run.chainId}/`, "/8453/")}#${link}`);
  await refused(page, "link.untrusted", SENTENCE.untrusted);
});

test("4 and 5. another Core reads 'doesn't read'; a newer version reads 'newer app'; the two sentences differ", async ({ page }) => {
  const dark = fixtureOf(run, "dark");
  await visit(page, tampered(dark.address, "other-core"));
  await refused(page, "link.untrusted", SENTENCE.untrusted);
  const untrusted = (await page.getByTestId("hand-error").innerText()).trim();
  expect(untrusted).not.toContain("newer app");

  await visit(page, tampered(dark.address, "version"));
  await refused(page, "link.unsupported", SENTENCE.unsupported);
  const newer = (await page.getByTestId("hand-error").innerText()).trim();
  expect(newer).not.toContain("doesn't read");
  expect(newer).not.toBe(untrusted);
});

test("6. a route that leaves the helper less than the hand's minimum", async ({ page }) => {
  const below = forge<{ ok: boolean; address: string; message?: string }>("below-min");
  expect(below.ok, below.message).toBe(true);
  // The SDK refuses it outside the browser too.
  expect(craft<{ ok: boolean; message: string }>("open", below.address)).toMatchObject({ ok: false, message: expect.stringContaining("minimum") });
  await visit(page, below.address);
  await refused(page, "core.BelowMinClaim", SENTENCE.belowMin);
});

/** /thank with a pasted give address, as the asker. */
async function pasteAnswer(page: Page, address: string): Promise<void> {
  await page.goto("/thank");
  await page.getByTestId("thank-input").fill(address);
  await page.getByTestId("thank-open").click();
}

test("7. a give address whose giver signature was altered: Core's refusal as a sentence, no thanks offered", async ({ page }) => {
  const give = fixtureOf(run, "give");
  const altered = tampered(give.giveAddress!, "giver-sig");
  expect(craft<{ give: { core: string } }>("open", altered).give.core).toBe("InvalidGiverSig");
  await pasteAnswer(page, altered);
  const error = page.getByTestId("thank-error");
  await expect(error).toHaveAttribute("data-value", "InvalidGiverSig", { timeout: 20_000 });
  await expect(error).toContainText(SENTENCE.giverSig);
  // No table, no swipe, and not even a wallet asked for: the refusal is the end of the screen.
  await expect(page.getByTestId("thank-predicted")).toHaveCount(0);
  await expect(page.getByTestId("thank-swipe")).toHaveCount(0);
  await expectNoWayOn(page);
  expect((await hands(chain, run.core, BigInt(give.handId))).closedAt).toBe(0);
});

test("8. a re-signed answer that drops a holder: the dropped holder is named and thanks stay off until each is ticked", async ({ page }) => {
  const resigned = fixtureOf(run, "resigned");
  await pasteAnswer(page, resigned.firstGiveAddress!);
  await expect(page.getByTestId("thank-predicted")).toBeVisible({ timeout: 20_000 });
  await pasteAnswer(page, resigned.secondGiveAddress!);
  const band = page.getByTestId("thank-resigned");
  await expect(band).toBeVisible({ timeout: 20_000 });
  await expect(band).toContainText(SENTENCE.resigned);
  await expect(page.getByTestId("thank-dropped")).toHaveCount(resigned.dropped!.length);
  await pickDevAccount(page, 1);
  await expect(page.getByTestId("wallet-connected")).toHaveAttribute("data-value", run.raiser.address);
  await expect(page.getByTestId("thank-swipe")).toBeDisabled();
  await expect(page.getByTestId("thank-anyway")).toBeDisabled();
  expect((await hands(chain, run.core, BigInt(resigned.handId))).closedAt).toBe(0);
});

test("9. a hand past its end: Time's up; passing and helping are off, on the Hand view and by going to /pass or /give; Send it back is on", async ({ page }) => {
  const expired = fixtureOf(run, "expired");
  expect(expired.state).toBe("expired");
  await visit(page, expired.address);
  await expect(page.getByTestId("hand-deal-card")).toHaveAttribute("data-state", "expired");
  await expect(page.getByTestId("hand-deal-card")).toContainText("Time's up.");
  await expect(page.getByTestId("hand-deal-card")).toContainText(SENTENCE.timesUp.replace("Time's up. ", ""));
  await expect(page.getByTestId("hand-times-up")).toContainText(SENTENCE.sendBack);
  await expect(page.getByTestId("hand-pass")).toHaveCount(0);
  await expect(page.getByTestId("hand-help")).toHaveCount(0);
  await pickDevAccount(page, 3);
  await expect(page.getByTestId("hand-send-back")).toBeEnabled();

  // The same tab, straight to the screens that go on: neither may make a link or an answer.
  for (const path of ["/pass", "/give"]) {
    await within(page, path);
    await expect(page.locator(`[data-screen="${path.slice(1)}"]`)).toBeVisible();
    // The screen says why, and its swipe is either gone or cannot be pressed.
    await expect(page.getByTestId("shell-main")).toContainText("Time's up.");
    await expectNoWayOn(page);
  }
});

test("10a. Core's own address as the payee on /pass is refused, and the link is not made", async ({ page }) => {
  await visit(page, fixtureOf(run, "dark").address);
  await page.getByTestId("hand-pass").click();
  await page.getByTestId("pass-slider").fill("1000");
  await page.getByRole("button", { name: "Choose where it lands" }).click();
  await page.getByText("An address I have").click();
  await page.getByRole("textbox", { name: "The address" }).fill(run.core);
  await expect(page.locator('[data-reading="refused"][data-problem="core"]')).toBeVisible();
  await expect(page.getByText(SENTENCE.payeeCore)).toBeVisible();
  await expect(page.getByRole("button", { name: "Use this address" })).toBeDisabled();
  await expect(page.getByTestId("pass-swipe")).toBeDisabled();
  await expect(page.getByTestId("pass-copy")).toHaveCount(0);
});

test("10b. Core's own address as the payee on /give is refused, and no answer is made", async ({ page }) => {
  await visit(page, fixtureOf(run, "unlisted").address);
  await page.getByTestId("hand-help").click();
  await expect(page.getByTestId("give-words")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("give-words").fill("I know someone with exactly such a room.");
  await page.getByRole("radio", { name: "An address I have" }).check();
  await page.getByRole("textbox", { name: "The address" }).fill(run.core);
  await expect(page.locator('[data-reading="refused"][data-problem="core"]')).toBeVisible();
  await expect(page.getByText(SENTENCE.payeeCore)).toBeVisible();
  await expect(page.getByTestId("give-swipe")).toBeDisabled();
  await expect(page.getByTestId("give-copy")).toHaveCount(0);
});

test("11. an address made for another site, pasted on the landing page: the sentence names that host, and nothing goes to it", async ({ page }) => {
  const dark = fixtureOf(run, "dark");
  const foreign = `https://other.example${dark.address.slice(dark.address.indexOf("/#"))}`;
  const elsewhere: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "other.example") elsewhere.push(request.url());
  });
  await page.goto("/");
  await page.getByTestId("landing-open-ask").click();
  await page.getByTestId("landing-open-input").fill(foreign);
  await page.getByTestId("landing-open-submit").click();
  const warning = page.getByTestId("landing-other-site");
  await expect(warning).toBeVisible({ timeout: 10_000 });
  await expect(warning).toContainText("This address was made for other.example. The link opens anywhere. Make sure you trust the site you're on.");
  expect(new URL(page.url()).origin).toBe(new URL(stand.site!).origin);
  expect(page.url()).not.toContain("#");
  expect(elsewhere).toEqual([]);
});
