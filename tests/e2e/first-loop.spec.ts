/**
 * The first run of the whole loop through the screens, on one stand:
 *
 *   STAND_SLOT=0 bunx playwright test tests/e2e/first-loop.spec.ts
 *
 * Four people, four browser contexts, no shortcut between them but the addresses a person would
 * copy: the asker (dev account 1) raises on /raise and copies the address; a holder with no wallet
 * opens it and passes it on at 0%; a helper (dev account 4) opens the passed address, presses
 * "I can help" and answers on /give, delivered to the Hand's inbox through the stand's relay; the
 * asker opens /my on the device that raised, unlocks, sees the answer, presses Thank and says
 * thanks on /thank. The money is then read back from the chain.
 *
 * Wave 5's `e2e-life` grows this into the whole life across five people.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { isAddressEqual, zeroHash, type Address } from "viem";

import { account, pickDevAccount } from "./lib/accounts";
import { compose, copied, swipe } from "./lib/feat-raise/raise";
import { lensOn } from "./lib/lens";
import { balanceOf, hands, rpc, thanks } from "./lib/rpc";
import { readStand, tokenOf } from "./lib/stand";

const USD = 1_000_000n;

async function person(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  // Leaving /raise before "I saved the link" asks first (beforeunload): this person agrees.
  page.on("dialog", (dialog) => void dialog.accept());
  // This loop reads each payout's payee, which stands under the lens.
  await lensOn(page);
  return { context, page };
}

test("raise, pass on, answer and thank, each through its screen, and the money lands", async ({ browser }) => {
  test.setTimeout(180_000);
  const stand = readStand();
  const chain = rpc(stand.rpc);
  const usd = tokenOf(stand, "usd").address;
  const helper = account(4).address as Address;
  const helperBefore = await balanceOf(chain, usd, helper);

  // 1. The asker raises an unlisted Hand of 50 test dollars and copies its address.
  const asker = await person(browser);
  await asker.page.goto("/raise");
  await expect(asker.page.getByTestId("raise-what")).toBeVisible({ timeout: 20_000 });
  const title = `Who can lend a ladder in Batumi this weekend? ${Date.now() % 100_000}`;
  await compose(asker.page, { title, details: "Three metres is enough. I can pick it up.", reward: "50" });
  await swipe(asker.page, 1);
  const up = asker.page.getByTestId("raise-up");
  await expect(up).toBeVisible({ timeout: 30_000 });
  const handId = BigInt((await up.getAttribute("data-hand-id"))!);
  const raised = await copied(asker.page);
  expect(raised).toMatch(new RegExp(`/31337/${handId}\\?d=[A-Za-z0-9_-]+#[A-Za-z0-9_-]+$`));

  // 2. A holder with no wallet opens it in a fresh context and passes it on at 0%.
  const holder = await person(browser);
  await holder.page.goto(raised);
  await expect(holder.page.getByTestId("hand-deal-card")).toContainText(title, { timeout: 20_000 });
  await expect(holder.page.getByTestId("hand-rail")).toHaveAttribute("data-value", "1");
  await holder.page.getByTestId("hand-pass").click();
  await expect(holder.page).toHaveURL(/\/pass$/);
  await holder.page.getByTestId("pass-swipe").click();
  await expect(holder.page.getByTestId("pass-read-back")).toHaveAttribute("data-bps", "0");
  const passed = ((await holder.page.getByTestId("pass-copy").locator(".ah-linkrow__value").textContent()) ?? "").trim();
  expect(passed).toContain("#");
  expect(passed).not.toBe(raised);

  // 3. The helper opens the passed address, presses "I can help" and answers with dev account 4.
  const giver = await person(browser);
  await giver.page.goto(passed);
  await expect(giver.page.getByTestId("hand-deal-card")).toContainText(title, { timeout: 20_000 });
  await expect(giver.page.getByTestId("hand-rail")).toHaveAttribute("data-value", "2");
  await giver.page.getByTestId("hand-help").click();
  await expect(giver.page).toHaveURL(/\/give$/);
  const words = "I have a three-metre ladder near the boulevard; text me and I'll bring it.";
  await giver.page.getByTestId("give-words").fill(words);
  await giver.page.getByRole("button", { name: "Connect a wallet" }).click();
  await pickDevAccount(giver.page, 4);
  await expect(giver.page.getByTestId("give-agree").locator("[data-payee]")).toHaveAttribute("data-payee", helper);
  await giver.page.getByTestId("give-swipe").click();
  await expect(giver.page.getByTestId("give-delivered")).toHaveText("Delivered to 1 of 1 relay.", { timeout: 20_000 });

  // 4. The asker, on the device that raised it, finds the answer on /my and thanks it.
  await asker.page.goto(`/my/${stand.chainId}/${handId}`);
  await pickDevAccount(asker.page, 1);
  const unlock = asker.page.getByTestId("my-unlock");
  await expect(unlock).toBeVisible({ timeout: 20_000 });
  if ((await unlock.getAttribute("data-value")) !== "unlocked") await unlock.click();
  await expect(unlock).toHaveAttribute("data-value", "unlocked", { timeout: 20_000 });
  const answer = asker.page.getByTestId("my-answer");
  await expect(answer).toHaveCount(1, { timeout: 30_000 });
  await expect(answer).toContainText(words);
  await answer.getByTestId("my-answer-thank").click();
  await expect(asker.page).toHaveURL(/\/thank$/);

  await expect(asker.page.getByTestId("thank-predicted")).toBeVisible({ timeout: 20_000 });
  await expect(asker.page.getByTestId("wallet-connected").first()).toHaveAttribute("data-value", account(1).address);
  await expect(asker.page.getByTestId("thank-cost")).toContainText(/costs about/, { timeout: 20_000 });
  await asker.page.getByTestId("thank-swipe").click();
  await expect(asker.page.getByTestId("thank-done")).toBeVisible({ timeout: 45_000 });

  // 5. The chain: the Hand is thanked, the receipt's rows are the money that moved.
  const closed = await hands(chain, stand.core, handId);
  expect(closed.closedAt).toBeGreaterThan(0);
  expect((await thanks(chain, stand.core, handId)).giveHash).not.toBe(zeroHash);
  const rows = await asker.page.getByTestId("thank-payout").evaluateAll((items) =>
    items.map((item) => ({ kind: item.getAttribute("data-kind")!, payee: item.getAttribute("data-payee")!, amount: item.getAttribute("data-amount")! })),
  );
  expect(rows.reduce((sum, row) => sum + BigInt(row.amount), 0n)).toBe(50n * USD);
  const helperRow = rows.find((row) => isAddressEqual(row.payee as Address, helper));
  expect(helperRow?.kind).toBe("paid");
  expect((await balanceOf(chain, usd, helper)) - helperBefore).toBe(BigInt(helperRow!.amount));

  // 6. The helper's tab, still open, hears it in plain words: this answer was thanked.
  await expect(giver.page.getByTestId("give-thanked")).toBeVisible({ timeout: 30_000 });
  await expect(giver.page.getByTestId("give-thanked")).toContainText("The asker thanked you for this answer.");

  for (const one of [asker, holder, giver]) await one.context.close();
});
