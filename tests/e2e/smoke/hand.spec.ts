/**
 * The Hand view, the pass, and sending a Hand back after its end, in a real browser against a
 * real local chain (PLAN wave 4, feat-hand). Every Hand comes from this file's own seed run.
 *
 *   STAND_SLOT=2 bunx playwright test tests/e2e/smoke/hand.spec.ts
 *
 * What is asserted on the chain is read from the chain (lib/rpc.ts), not from the page.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { erc20Abi, type Address } from "viem";

import { account, pickDevAccount } from "../lib/accounts";
import { aggregateCount, craft, cutRpc, getLogsCount, logRequests, quietDevServer, type SeedRun } from "../lib/feat-hand/helpers";
import { hands, handsCount, rpc, type Rpc } from "../lib/rpc";
import { lensOn } from "../lib/lens";
import { readStand, seed, tokenOf } from "../lib/stand";

test.describe.configure({ mode: "serial" });

let run: SeedRun;
let chain: Rpc;
const stand = readStand();

test.beforeAll(() => {
  run = seed<SeedRun>();
  chain = rpc(stand.rpc);
});

test.beforeEach(async ({ context }) => {
  await quietDevServer(context, stand.site!);
});

const fixture = (name: string) => {
  const found = run.fixtures[name];
  if (!found) throw new Error(`the seed made no ${name} fixture`);
  return found;
};

/** axe's findings at WCAG 2.2 AA for the page as it stands, as short lines. */
async function axe(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]).analyze();
  return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

/** The text of the new address in the pass screen's copy row (the row shows it whole). */
async function newAddress(page: Page): Promise<string> {
  const text = (await page.getByTestId("pass-copy").locator(".ah-linkrow__value").textContent()) ?? "";
  expect(text).toContain("#");
  return text.trim();
}

/** Opens an address in a fresh browser context, the way the next person would. */
async function openElsewhere(browser: Browser, address: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await quietDevServer(context, stand.site!);
  const page = await context.newPage();
  await page.goto(address);
  return page;
}

test("the fresh hand opens with no account, passes at 0%, and the next person sees one more hand; nothing goes but to the network and the site", async ({ page, browser }) => {
  const seen = logRequests(page.context());
  const unlisted = fixture("unlisted");
  await page.goto(unlisted.address);

  const card = page.getByTestId("hand-deal-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText(unlisted.title);
  await expect(card).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("hand-rail")).toHaveAttribute("data-value", "1");
  await expect(page.getByTestId("hand-hands-so-far")).toHaveText("So far only the asker.");
  await expect(page.getByTestId("hand-help-note")).toContainText("The asker decides whether to thank.");
  await expect(page.getByTestId("hand-tab-only")).toBeVisible();
  expect(page.url()).not.toContain("#");

  await page.getByTestId("hand-pass").click();
  await expect(page).toHaveURL(/\/pass$/);
  await expect(page.getByTestId("pass-share-money")).toHaveAttribute("data-value", "0");
  await page.getByTestId("pass-swipe").click();
  const readBack = page.getByTestId("pass-read-back");
  await expect(readBack).toHaveAttribute("data-bps", "0");
  await expect(readBack).toHaveAttribute("data-payee", "");
  // The read-back is said in words; its "checked here" mark is the lens's.
  await expect(readBack).not.toContainText("checked here", { ignoreCase: true });
  const next = await newAddress(page);
  expect(next.startsWith(`${stand.site}/${run.chainId}/${unlisted.handId}?d=`)).toBe(true);

  const other = await openElsewhere(browser, next);
  await expect(other.getByTestId("hand-deal-card")).toContainText(unlisted.title);
  await expect(other.getByTestId("hand-rail")).toHaveAttribute("data-value", "2");
  await expect(other.getByTestId("hand-hands-so-far")).toHaveText("So far: the asker and 1 more.");
  await other.context().close();

  const allowed = new Set([new URL(stand.site!).origin, new URL(stand.rpc).origin]);
  const elsewhere = seen.filter((item) => !allowed.has(item.origin) && !item.url.startsWith("data:") && !item.url.startsWith("blob:"));
  expect(elsewhere).toEqual([]);
  expect(seen.some((item) => item.origin === new URL(stand.rpc).origin)).toBe(true);
});

test("a 10% share lands at a pasted address, read back from the new link; Core's own address is refused", async ({ page, browser }) => {
  const dark = fixture("dark");
  await page.goto(dark.address);
  await expect(page.getByTestId("hand-deal-card")).toContainText(dark.title);
  await page.getByTestId("hand-pass").click();

  const slider = page.getByTestId("pass-slider");
  await expect(slider).toHaveAttribute("data-max", "3000");
  await slider.fill("1000");
  await expect(page.getByTestId("pass-share-money")).toHaveAttribute("data-value", "1000");
  await expect(page.getByTestId("pass-share-money")).toContainText("10% — about $5 if this route is thanked");
  // A running sentence: with tabular figures this face sets "." and "," as wide as a digit ("$2 . 50").
  await slider.fill("500");
  await expect(page.getByTestId("pass-share-money")).toContainText("5% — about $2.50 if this route is thanked");
  expect(await page.getByTestId("pass-share-money").evaluate((el) => getComputedStyle(el).fontVariantNumeric)).not.toContain("tabular-nums");
  await slider.fill("1000");
  await expect(page.getByTestId("pass-swipe")).toBeDisabled();

  await page.getByRole("button", { name: "Choose where it lands" }).click();
  await page.getByText("An address I have").click();
  const field = page.getByLabel("The address");
  await field.fill(run.core);
  await expect(page.locator('[data-reading="refused"][data-problem="core"]')).toBeVisible();
  await expect(page.getByText("That is the contract's own address.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use this address" })).toBeDisabled();

  const payee = account(7).address;
  await field.fill(payee);
  await expect(page.locator('[data-reading="ok"]')).toBeVisible();
  await page.getByRole("button", { name: "Use this address" }).click();
  await expect(page.getByTestId("land-sheet")).toHaveAttribute("data-value", payee);
  await page.getByTestId("pass-swipe").click();

  const readBack = page.getByTestId("pass-read-back");
  await expect(readBack).toHaveAttribute("data-payee", payee);
  await expect(readBack).toHaveAttribute("data-bps", "1000");
  await expect(readBack).toContainText("10%");
  const next = await newAddress(page);
  expect(next.startsWith(`${stand.site}/#`)).toBe(true);

  // The SDK, run outside the browser, reads the same pass out of the new link.
  const opened = craft<{ ok: boolean; shape: string; route: { payee: Address | null; keptBps: number }[] }>(["open", next]);
  expect(opened.ok).toBe(true);
  expect(opened.shape).toBe("bare");
  expect(opened.route).toEqual([expect.objectContaining({ payee: payee, keptBps: 1000 })]);
  const other = await openElsewhere(browser, next);
  await expect(other.getByTestId("hand-rail")).toHaveAttribute("data-value", "2");
  // The calm view names the pass "someone"; the lens shows the address it named.
  await expect(other.getByTestId("hand-rail")).toContainText("someone");
  await lensOn(other);
  await expect(other.getByTestId("hand-rail")).toContainText(`${payee.slice(0, 6)}…${payee.slice(-4)}`);
  await other.context().close();
});

test("a lost description still passes; a damaged link, another Core and a newer version each have their own sentence", async ({ page }) => {
  const lost = fixture("lost");
  await page.goto(lost.address);
  await expect(page.getByTestId("hand-lost")).toBeVisible();
  await expect(page.getByTestId("hand-deal-card")).toHaveAttribute("data-description", "lost");
  await expect(page.getByText("The description didn't arrive with this link. Ask whoever sent it.")).toBeVisible();
  await page.getByTestId("hand-pass").click();
  await page.getByTestId("pass-swipe").click();
  await expect(page.getByTestId("pass-read-back")).toHaveAttribute("data-shakes", "1");

  const unlisted = fixture("unlisted");
  const cases: [string, string, string][] = [
    ["flip", "link.malformed", "This link is damaged. Ask for it again."],
    ["other-core", "link.untrusted", "This link names a contract this site doesn't read. Nothing was opened."],
    ["version", "link.unsupported", "This link was made by a newer app."],
  ];
  for (const [how, id, sentence] of cases) {
    const { address } = craft<{ address: string }>(["tamper", unlisted.address, "--how", how]);
    await page.goto("about:blank");
    await page.goto(address);
    const error = page.getByTestId("hand-error");
    await expect(error).toHaveAttribute("data-value", id);
    await expect(error).toContainText(sentence);
    await expect(page.getByTestId("hand-deal-card")).toHaveCount(0);
    if (how === "other-core") await expect(error).not.toContainText("newer app");
    if (how === "version") await expect(error).not.toContainText("doesn't read");
  }

  // An address whose part before # is not its link's own Hand (review round 1). Each is said as
  // what it is, before the public part is weighed: another Hand's address with that Hand's own
  // public part, another number with no public part, and a chain this site does not read.
  const [before, link] = unlisted.address.split("#") as [string, string];
  const twoPasses = fixture("twoPasses");
  expect(twoPasses.handId).not.toBe(unlisted.handId);
  const numbered = before.slice(0, before.indexOf("?d="));
  expect(numbered.endsWith(`/${run.chainId}/${unlisted.handId}`)).toBe(true);
  const misplaced: [string, string, string, string][] = [
    ["another Hand's address", `${twoPasses.address.split("#")[0]}#${link}`, "link.another-hand", "The address shows one hand and the link is for another."],
    ["another number", `${numbered.slice(0, numbered.lastIndexOf("/"))}/${twoPasses.handId}#${link}`, "link.another-hand", "The address shows one hand and the link is for another."],
    ["another chain", `${before.replace(`/${run.chainId}/`, "/8453/")}#${link}`, "link.untrusted", "This link names a contract this site doesn't read. Nothing was opened."],
  ];
  for (const [what, address, id, sentence] of misplaced) {
    await page.goto("about:blank");
    await page.goto(address);
    const error = page.getByTestId("hand-error");
    await expect(error, what).toHaveAttribute("data-value", id);
    await expect(error, what).toContainText(sentence);
    await expect(error, what).not.toContainText("Part of this address doesn't match its link");
    await expect(page.getByTestId("hand-deal-card"), what).toHaveCount(0);
    await expect(page.getByTestId("hand-pass"), what).toHaveCount(0);
  }
  // The right Hand with a public part that is not its own keeps its own sentence.
  const otherD = (twoPasses.address.split("#")[0] as string).split("?d=")[1];
  await page.goto("about:blank");
  await page.goto(`${numbered}?d=${otherD}#${link}`);
  await expect(page.getByTestId("hand-error")).toHaveAttribute("data-value", "link.unmatched-data");
});

test("past its end by the network's clock (the browser's two years behind) it reads Time's up, and account 3 sends it back", async ({ page }) => {
  // The proof, the count of requests and the evidence under the card stand under the lens.
  await lensOn(page);
  const expired = fixture("expired");
  await page.clock.setFixedTime(new Date(Date.now() - 2 * 365 * 86_400_000));
  const usd = tokenOf(stand, "usd");
  const before = await chain.client.readContract({ address: usd.address, abi: erc20Abi, functionName: "balanceOf", args: [run.raiser.address] });

  await page.goto(expired.address);
  await expect(page.getByTestId("hand-deal-card")).toHaveAttribute("data-state", "expired");
  // The sentence stands in the card; the column under it is where it is sent back (FINDINGS F7).
  await expect(page.getByTestId("hand-deal-card")).toContainText("Time's up.");
  await expect(page.getByTestId("hand-times-up")).toContainText("Send the reward back");
  await expect(page.getByTestId("hand-times-up")).not.toContainText("Time's up.");
  await expect(page.getByTestId("hand-pass")).toHaveCount(0);

  await pickDevAccount(page, 3);
  await page.getByTestId("hand-send-back").click();
  // The send lands; the next block's read of hands(id) turns the view to the closed one, whose
  // receipt comes from the Refunded and Paid events.
  await expect(page.getByTestId("hand-closed")).toHaveAttribute("data-value", "refunded", { timeout: 20_000 });
  await expect(page.getByTestId("hand-deal-card")).toContainText("The reward went back on");
  await expect(page.getByTestId("hand-closed").locator("table")).toContainText("$15.00");
  // Under the receipt, the way to the Hand's passport (FINDINGS E-6).
  await expect(page.getByTestId("hand-closed").getByTestId("hand-proof-link")).toHaveAttribute("href", `/${run.chainId}/${expired.handId}/proof`);

  const row = await hands(chain, run.core, BigInt(expired.handId));
  expect(Number(row.closedAt)).toBeGreaterThan(0);
  const after = await chain.client.readContract({ address: usd.address, abi: erc20Abi, functionName: "balanceOf", args: [run.raiser.address] });
  expect(after - before).toBe(BigInt(expired.reward));
});

test("a refunded hand looks for a newer one by the same asker by hand numbers, with exactly the requests it announced; a found hand opens with no actions", async ({ page }) => {
  // The proof, the count of requests and the evidence under the card stand under the lens.
  await lensOn(page);
  const refunded = fixture("refunded");
  await page.goto(refunded.address);
  await expect(page.getByTestId("hand-closed")).toHaveAttribute("data-value", "refunded");
  await expect(page.getByTestId("hand-ask-sender")).toHaveText("Ask whoever sent you the link whether there is a newer one.");
  const count = page.getByTestId("hand-newer-count");
  await expect(count).toBeVisible();
  // Core's handsCount was read first: every Hand numbered after this one is read, up to 200 per
  // request. Other workers may raise Hands on this stand meanwhile, so the count is at most today's.
  const after = Number(await count.getAttribute("data-hands"));
  expect(after).toBeGreaterThan(0);
  expect(BigInt(after)).toBeLessThanOrEqual((await handsCount(chain, run.core)) - BigInt(refunded.handId));
  const announced = Number(await count.getAttribute("data-value"));
  expect(announced).toBe(Math.ceil(after / 200));
  await expect(count).toHaveText(new RegExp(`^Reads (the one hand|the ${after} hands) raised after this one \\(${announced} requests?\\)\\. Any of them by the same address counts, even one raised while this one was still open\\.$`));

  const seen = logRequests(page);
  await page.getByTestId("hand-newer-look").click();
  const found = page.getByTestId("hand-newer-found");
  await expect(found).toBeVisible();
  // Found Hands show after any batch, so the count waits for the look to be done.
  await expect(found).toHaveAttribute("data-look", "done");
  // Each request is one eth_call to the forwarder's aggregate3, and no log is read.
  expect(aggregateCount(seen, stand.forwarder!)).toBe(announced);
  expect(getLogsCount(seen)).toBe(0);

  const ids = ((await found.getAttribute("data-value")) ?? "").split(",");
  const later = fixture("thanked").handId;
  expect(ids).toContain(later);
  await page.getByRole("button", { name: `Hand ${later}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${run.chainId}/${later}$`));
  await expect(page.locator('[data-screen="hand"]')).toHaveAttribute("data-arrival", "public");
  await expect(page.getByTestId("hand-deal-card")).toBeVisible();
  await expect(page.getByTestId("hand-pass")).toHaveCount(0);
  await expect(page.getByTestId("hand-help")).toHaveCount(0);
});

test("a give link opened by a holder says pass it back; opened by the asker it leads to thanks", async ({ page }) => {
  const give = run.fixtures.give as unknown as { giveAddress: string; title: string };
  await page.goto(give.giveAddress);
  const band = page.getByTestId("hand-give-link");
  await expect(band).toHaveAttribute("data-value", "holder");
  await expect(band).toContainText("Someone answered this hand. Pass it back to whoever sent you the link.");
  // Core's own checkGive was asked, as the flip asks it, and it takes this answer (FINDINGS H-5).
  await expect(band).toHaveAttribute("data-check", "ok", { timeout: 10_000 });
  await expect(page.getByTestId("hand-give-refused")).toHaveCount(0);
  await expect(page.getByTestId("hand-copy")).toBeVisible();
  await expect(page.getByTestId("hand-rail")).toHaveAttribute("data-value", "3");
  await expect(page.getByTestId("hand-pass")).toHaveCount(0);

  // The asker connects here: the same link is now an answer to their own hand.
  await pickDevAccount(page, 1);
  await expect(page.getByTestId("hand-give-link")).toHaveAttribute("data-value", "raiser");
  await expect(page.getByTestId("hand-give-link")).toContainText("This is an answer to your hand.");
  await page.getByTestId("hand-to-thank").click();
  await expect(page).toHaveURL(/\/thank$/);
  // /thank takes the give link from the tab's memory: Core's check runs and the table shows.
  await expect(page.getByTestId("thank-predicted")).toBeVisible({ timeout: 20_000 });
});

test("a faced address with no link is the public view: the title matched against Core, and no actions", async ({ page }) => {
  const open = fixture("public");
  await page.goto(open.address.slice(0, open.address.indexOf("#")));
  await expect(page.locator('[data-screen="hand"]')).toHaveAttribute("data-arrival", "public");
  await expect(page.getByTestId("hand-deal-card")).toContainText(open.title);
  await expect(page.getByTestId("hand-no-link")).toHaveText("To pass it on or help, open the link you were sent.");
  await expect(page.getByTestId("hand-pass")).toHaveCount(0);
  await expect(page.getByTestId("hand-help")).toHaveCount(0);
  await expect(page.getByTestId("hand-tab-only")).toHaveCount(0);
});

test("a hand with no reward says so and never shows $0; the address bar keeps no fragment", async ({ page }) => {
  const free = fixture("noReward");
  await page.goto(free.address);
  const card = page.getByTestId("hand-deal-card");
  await expect(card).toHaveAttribute("data-reward", "0");
  await expect(card).toContainText("No reward: a thank-you only");
  await expect(card).toContainText("it's free; there is no share to keep");
  expect(await page.evaluate(() => location.href)).not.toContain("#");
  expect(await page.locator("body").innerText()).not.toMatch(/\$0(?![.,]?\d*[1-9])/);
  await page.getByTestId("hand-pass").click();
  await expect(page.getByTestId("pass-no-reward")).toBeVisible();
  await expect(page.getByTestId("pass-slider")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toMatch(/\$0(?![.,]?\d*[1-9])/);
});

/** Every request to the stand's RPC fails, as it does while the network can't be reached; returns the way back and how many failed. */
async function cutNetwork(page: Page, only?: (methods: string[]) => boolean): Promise<{ restore: () => Promise<void>; failed: () => number }> {
  const origin = new URL(stand.rpc).origin;
  let failed = 0;
  const matcher = (url: URL) => url.origin === origin;
  const handler = async (route: import("@playwright/test").Route) => {
    if (only) {
      let methods: string[] = [];
      try {
        const body = route.request().postDataJSON() as unknown;
        methods = (Array.isArray(body) ? body : [body]).map((item) => String((item as { method?: unknown })?.method ?? ""));
      } catch {
        // not JSON: let it through
      }
      if (!only(methods)) return route.continue();
    }
    ++failed;
    return route.abort("connectionrefused");
  };
  await page.route(matcher, handler);
  return { restore: () => page.unroute(matcher, handler), failed: () => failed };
}

test("the network fails as a dark link opens: the link is kept and said so, the code is NETWORK, and the Hand appears without a reload when the network answers", async ({ page }) => {
  const dark = fixture("dark");
  const cut = await cutNetwork(page);
  await page.goto(dark.address);
  const band = page.getByTestId("hand-unreachable");
  await expect(band).toBeVisible();
  await expect(band).toHaveAttribute("data-held", "true");
  await expect(band).toContainText("Can't reach the network right now.");
  await expect(band).toContainText("Your link is still open in this tab; nothing was sent.");
  // The code NETWORK is the lens's; the calm view says the sentence and what was kept.
  await expect(band).not.toContainText("NETWORK");
  await expect(band).toContainText("This link lives in this tab only.");
  await expect(page.locator("body")).not.toContainText(/ContractFunction|HttpRequest|Error\b/);
  // Not a verdict: no refusal, and nothing that sends the person away from their link.
  await expect(page.getByTestId("hand-error")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "To the start" })).toHaveCount(0);
  expect(page.url()).not.toContain("#");

  // It asks again on its own: more requests fail while the page is only looked at.
  const before = cut.failed();
  await expect.poll(() => cut.failed(), { timeout: 15_000 }).toBeGreaterThan(before);
  await expect(band).toBeVisible();
  // "Try again" asks at once, and a try that fails leaves the band and the link where they were.
  await page.getByTestId("hand-retry").click();
  await expect(band).toBeVisible();
  expect(await axe(page)).toEqual([]);

  // The network is back. The same document (a mark set now survives) shows the Hand: no reload, no link asked for again.
  await page.evaluate(() => {
    (window as unknown as { stillHere?: boolean }).stillHere = true;
  });
  await cut.restore();
  const card = page.getByTestId("hand-deal-card");
  await expect(card).toContainText(dark.title, { timeout: 20_000 });
  await expect(card).toHaveAttribute("data-state", "open");
  await expect(band).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { stillHere?: boolean }).stillHere)).toBe(true);
  // The link is the one that came: it still passes on.
  await page.getByTestId("hand-pass").click();
  await page.getByTestId("pass-swipe").click();
  await expect(page.getByTestId("pass-read-back")).toHaveAttribute("data-shakes", "1");
});

test("the link opens and then the network's clock can't be read: the same band, and the Hand comes when blocks do", async ({ page }) => {
  const unlisted = fixture("unlisted");
  // `hands(id)` answers (the link is proven), the latest block does not: no state can be claimed.
  const cut = await cutNetwork(page, (methods) => methods.some((method) => method === "eth_getBlockByNumber"));
  await page.goto(unlisted.address);
  const band = page.getByTestId("hand-unreachable");
  await expect(band).toBeVisible();
  await expect(band).toContainText("Your link is still open in this tab; nothing was sent.");
  await expect(page.getByTestId("hand-error")).toHaveCount(0);
  await expect(page.getByTestId("hand-pass")).toHaveCount(0);
  expect(cut.failed()).toBeGreaterThan(0);
  await cut.restore();
  await expect(page.getByTestId("hand-deal-card")).toContainText(unlisted.title, { timeout: 20_000 });
  await expect(page.getByTestId("hand-deal-card")).toHaveAttribute("data-state", "open");
});

test("on a phone both actions of an open hand are on the first screen, in English and Russian, for a three-line title; the bar steps aside for a keyboard and a closed hand has none", async ({ page }) => {
  const hands = [
    { lang: "en", title: "Who can lend me a tent for one weekend?", content: "For two people, back on Monday." },
    { lang: "ru", title: "Кто одолжит палатку на одни выходные?", content: "На двоих, верну в понедельник." },
  ];
  for (const { lang, title, content } of hands) {
    const made = craft<{ ok: boolean; address: string }>(["make", "--title", title, "--content", content, "--reward", "40"]);
    expect(made.ok).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("about:blank");
    await page.goto(made.address);
    await page.getByTestId(`shell-lang-${lang}`).click();
    const heading = page.getByTestId("hand-deal-card").getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(title);
    const lines = await heading.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    expect(lines, `${lang}: the title's lines`).toBe(3);

    // Before any scroll, both buttons lie whole inside the 844 px screen, each a full target.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    for (const id of ["hand-pass", "hand-help"]) {
      const button = page.getByTestId(id);
      await expect(button).toHaveCount(1);
      await expect(button).toBeInViewport({ ratio: 1 });
      const box = (await button.boundingBox())!;
      expect(box.y, `${lang} ${id} top`).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, `${lang} ${id} bottom`).toBeLessThanOrEqual(844);
      expect(box.height, `${lang} ${id} height`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${lang} ${id} width`).toBeGreaterThanOrEqual(44);
      // Its words are whole and readable: inside the button, and on the solid part of its fill
      // (the fill fades out from 58% of the width, where the gesture stands).
      const label = await button.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el.firstChild!);
        const text = range.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return { inside: text.top >= box.top && text.bottom <= box.bottom && text.left >= box.left, ends: (text.right - box.left) / box.width };
      });
      expect(label.inside, `${lang} ${id} label inside`).toBe(true);
      expect(label.ends, `${lang} ${id} label ends on the solid fill`).toBeLessThanOrEqual(0.58);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${lang}: no sideways scroll`).toBe(true);
    // The honest line about thanks is still on the page.
    await expect(page.getByTestId("hand-help-note")).toBeVisible();
    expect(await axe(page), `${lang}: axe with the bar`).toEqual([]);

    // A keyboard: while a text field has the focus the bar steps aside and the two buttons stand
    // in the page (never absent); the bar comes back after.
    await page.evaluate(() => {
      const field = document.createElement("input");
      field.id = "probe-field";
      field.setAttribute("aria-label", "probe");
      document.querySelector('[data-screen="hand"]')!.prepend(field);
      field.focus();
    });
    await expect(page.getByTestId("hand-action-bar")).toHaveCount(0);
    await expect(page.getByTestId("hand-pass")).toHaveCount(1);
    await expect(page.getByTestId("hand-help")).toHaveCount(1);
    await page.evaluate(() => document.getElementById("probe-field")!.remove());
    await expect(page.getByTestId("hand-action-bar")).toBeVisible();

    // A control focused by keyboard under the bar's place is scrolled clear of it.
    // (On a shorter screen, where that control starts out below the bar's top edge.) The control
    // is the evidence's own toggle, which stands under the lens.
    await lensOn(page);
    await page.setViewportSize({ width: 390, height: 640 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const proof = page.getByRole("button", { name: lang === "en" ? "What this link proves" : "Что доказывает эта ссылка" });
    expect((await proof.boundingBox())!.y, `${lang}: the control starts below the bar's top`).toBeGreaterThan((await page.getByTestId("hand-action-bar").boundingBox())!.y);
    await proof.focus();
    const focused = (await proof.boundingBox())!;
    const over = (await page.getByTestId("hand-action-bar").boundingBox())!;
    expect(focused.y + focused.height, `${lang}: the focused control ends above the bar`).toBeLessThanOrEqual(over.y);
    await page.setViewportSize({ width: 390, height: 844 });

    // At the foot of the page the bar rests above the footer and covers none of it.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const bar = (await page.getByTestId("hand-action-bar").boundingBox())!;
    const footer = (await page.getByTestId("shell-footer").boundingBox())!;
    expect(bar.y + bar.height).toBeLessThanOrEqual(footer.y);

    // Wider than a phone: no bar, the two buttons stand in the page as before.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId("hand-action-bar")).toHaveCount(0);
    await expect(page.getByTestId("hand-pass")).toHaveCount(1);
    await expect(page.getByTestId("hand-help")).toBeVisible();
    await page.getByTestId("shell-lang-en").click();
  }

  // A hand that is not open has no bar.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("about:blank");
  await page.goto(fixture("refunded").address);
  await expect(page.getByTestId("hand-closed")).toBeVisible();
  await expect(page.getByTestId("hand-action-bar")).toHaveCount(0);
});

test("while the network can't be reached the card claims nothing, says the block it was read at, and passing and helping wait; it comes back by itself", async ({ page }) => {
  const unlisted = fixture("unlisted");
  await page.goto(unlisted.address);
  const card = page.getByTestId("hand-deal-card");
  await expect(card).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("hand-offline")).toHaveCount(0);

  const restore = await cutRpc(page, stand.rpc);
  // The watcher gives a read 4 s and one retry: well inside 20 s (FINDINGS E-5).
  await expect(page.getByTestId("hand-offline")).toBeVisible({ timeout: 20_000 });
  // The calm view says it may have changed; the block it was read at stands in data-value and under the lens.
  await expect(page.getByTestId("hand-offline")).toHaveText("Can't reach the network right now. What you see here may have changed since.");
  await expect(page.getByTestId("hand-offline")).toHaveAttribute("data-value", /^\d+$/);
  await expect(card).not.toHaveAttribute("data-state", "open");
  await expect(card).not.toContainText("open until");
  await expect(page.getByTestId("hand-pass")).toBeDisabled();
  await expect(page.getByTestId("hand-help")).toBeDisabled();

  await restore();
  await expect(card).toHaveAttribute("data-state", "open", { timeout: 20_000 });
  await expect(page.getByTestId("hand-offline")).toHaveCount(0);
  await expect(page.getByTestId("hand-pass")).toBeEnabled();
  await expect(page.getByTestId("hand-help")).toBeEnabled();
});

test("a link opened while the network is down says NETWORK and that the link is still in this tab; Try again opens it once the network is back", async ({ page }) => {
  const unlisted = fixture("unlisted");
  const restore = await cutRpc(page, stand.rpc);
  await page.goto(unlisted.address);
  // Not a verdict on the link: the merged Hand view says it in its offline band (hand-unreachable), not as a refusal.
  const error = page.getByTestId("hand-unreachable");
  await expect(error).toHaveAttribute("data-code", "NETWORK", { timeout: 20_000 });
  await expect(page.getByTestId("hand-error")).toHaveCount(0);
  await expect(error).not.toContainText("NETWORK");
  await expect(error).toContainText("Can't reach the network right now. Your link is still open in this tab; nothing was sent.");
  await expect(error).not.toContainText("ContractFunctionExecutionError");
  await restore();
  await page.getByTestId("hand-retry").click();
  await expect(page.getByTestId("hand-deal-card")).toHaveAttribute("data-state", "open", { timeout: 20_000 });
  await expect(page.getByTestId("hand-deal-card")).toContainText(unlisted.title);
  expect(page.url()).not.toContain("#");
});

test("every Hand leads to its proof: a thanked one under its receipt with no count beside it; an open one at the end of what its link proves, and to /check with nothing in the address", async ({ page }) => {
  // The proof, the count of requests and the evidence under the card stand under the lens.
  await lensOn(page);
  const thanked = fixture("thanked");
  await page.goto(thanked.address);
  await expect(page.getByTestId("hand-closed")).toHaveAttribute("data-value", "thanked");
  await expect(page.getByTestId("hand-closed").getByTestId("hand-proof-link")).toHaveAttribute("href", `/${run.chainId}/${thanked.handId}/proof`);
  await expect(page.getByTestId("hand-hands-so-far")).toHaveCount(0);
  await page.getByTestId("hand-closed").getByTestId("hand-proof-link").click();
  await expect(page).toHaveURL(new RegExp(`/${run.chainId}/${thanked.handId}/proof$`));
  await expect(page.locator('[data-screen="proof"]')).toBeVisible();

  const unlisted = fixture("unlisted");
  await page.goto("about:blank");
  await page.goto(unlisted.address);
  await page.getByRole("button", { name: /What this link proves/i }).click();
  await expect(page.getByTestId("hand-proof-link")).toHaveAttribute("href", `/${run.chainId}/${unlisted.handId}/proof`);
  await expect(page.getByTestId("hand-proof-link")).toHaveText("See the proof →");
  const toCheck = page.getByTestId("hand-check-link");
  await expect(toCheck).toHaveText("Check this link in detail →");
  await toCheck.click();
  await expect(page).toHaveURL(/\/check$/);
  const url = new URL(page.url());
  expect(url.hash).toBe("");
  expect(url.search).toBe("");
  await expect(page.locator('[data-screen="check"]')).toBeVisible();
});

test("a screen whose code cannot arrive draws the offline band, not the crash screen, and Try again loads it with the link still in the tab (U-1)", async ({ page }) => {
  const unlisted = fixture("unlisted");
  // /give's own chunk never arrives, as when the network drops before it was fetched.
  const giveChunk = /\/assets\/give-[^/]*\.js$/;
  await page.route(giveChunk, (route) => route.abort("internetdisconnected"));
  await page.goto(unlisted.address);
  await expect(page.getByTestId("hand-deal-card")).toHaveAttribute("data-state", "open");
  await page.getByTestId("hand-help").click();
  const band = page.getByTestId("shell-offline");
  await expect(band).toBeVisible({ timeout: 20_000 });
  await expect(band).toContainText("Can't reach the network right now.");
  await expect(band).toContainText("Everything open in this tab is still here; nothing was sent.");
  await expect(page.getByTestId("shell-crash")).toHaveCount(0);

  await page.unroute(giveChunk);
  await page.getByTestId("shell-offline-retry").click();
  // /give drew from the link this tab still holds: no reload, nothing in the address.
  await expect(page.getByTestId("give-words")).toBeVisible({ timeout: 20_000 });
  expect(new URL(page.url()).hash).toBe("");
});
