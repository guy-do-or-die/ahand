/**
 * The Hand view, the pass, and sending a Hand back after its end, in a real browser against a
 * real local chain (PLAN wave 4, feat-hand). Every Hand comes from this file's own seed run.
 *
 *   STAND_SLOT=2 bunx playwright test tests/e2e/smoke/hand.spec.ts
 *
 * What is asserted on the chain is read from the chain (lib/rpc.ts), not from the page.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { erc20Abi, type Address } from "viem";

import { account, pickDevAccount } from "../lib/accounts";
import { craft, getLogsCount, logRequests, quietDevServer, type SeedRun } from "../lib/feat-hand/helpers";
import { hands, rpc, type Rpc } from "../lib/rpc";
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
  await expect(readBack).toContainText("checked here", { ignoreCase: true });
  const next = await newAddress(page);
  expect(next.startsWith(`${stand.site}/${run.chainId}/${unlisted.handId}?d=`)).toBe(true);

  const other = await openElsewhere(browser, next);
  await expect(other.getByTestId("hand-deal-card")).toContainText(unlisted.title);
  await expect(other.getByTestId("hand-rail")).toHaveAttribute("data-value", "2");
  await expect(other.getByTestId("hand-hands-so-far")).toHaveText("2 hands so far.");
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
});

test("past its end by the network's clock (the browser's two years behind) it reads Time's up, and account 3 sends it back", async ({ page }) => {
  const expired = fixture("expired");
  await page.clock.setFixedTime(new Date(Date.now() - 2 * 365 * 86_400_000));
  const usd = tokenOf(stand, "usd");
  const before = await chain.client.readContract({ address: usd.address, abi: erc20Abi, functionName: "balanceOf", args: [run.raiser.address] });

  await page.goto(expired.address);
  await expect(page.getByTestId("hand-deal-card")).toHaveAttribute("data-state", "expired");
  await expect(page.getByTestId("hand-times-up")).toContainText("Time's up. Anyone can send the reward back to the asker now.");
  await expect(page.getByTestId("hand-pass")).toHaveCount(0);

  await pickDevAccount(page, 3);
  await page.getByTestId("hand-send-back").click();
  // The send lands; the next block's read of hands(id) turns the view to the closed one, whose
  // receipt comes from the Refunded and Paid events.
  await expect(page.getByTestId("hand-closed")).toHaveAttribute("data-value", "refunded", { timeout: 20_000 });
  await expect(page.getByTestId("hand-deal-card")).toContainText("The reward went back on");
  await expect(page.getByTestId("hand-closed").locator("table")).toContainText("$15.00");

  const row = await hands(chain, run.core, BigInt(expired.handId));
  expect(Number(row.closedAt)).toBeGreaterThan(0);
  const after = await chain.client.readContract({ address: usd.address, abi: erc20Abi, functionName: "balanceOf", args: [run.raiser.address] });
  expect(after - before).toBe(BigInt(expired.reward));
});

test("a refunded hand looks for a newer one by the same asker with exactly the requests it announced; a found hand opens with no actions", async ({ page }) => {
  const refunded = fixture("refunded");
  await page.goto(refunded.address);
  await expect(page.getByTestId("hand-closed")).toHaveAttribute("data-value", "refunded");
  await expect(page.getByTestId("hand-ask-sender")).toHaveText("Ask whoever sent you the link whether there is a newer one.");
  const count = page.getByTestId("hand-newer-count");
  await expect(count).toBeVisible();
  const announced = Number(await count.getAttribute("data-value"));
  expect(announced).toBeGreaterThan(0);

  const seen = logRequests(page);
  await page.getByTestId("hand-newer-look").click();
  const found = page.getByTestId("hand-newer-found");
  await expect(found).toBeVisible();
  expect(getLogsCount(seen)).toBe(announced);

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
