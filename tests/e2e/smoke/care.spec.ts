/**
 * /care and /print in a real browser against the stand's chain (PLAN wave 5, care-print;
 * UX-SPEC §7.4, §11).
 *
 *   STAND_SLOT=5 bunx playwright test tests/e2e/smoke/care.spec.ts
 *
 * Every Hand here is this file's own, raised by account 1 through the craft tool (the SDK), so the
 * file passes in any order on one stand. Each send is made on the screen with the dev wallet and
 * checked on the chain afterwards: hands(id).reward and hands(id).expiry. Time comes from the
 * chain only. Set CARE_PRINT_SHOTS=1 to keep screenshots in the experiment's shots folder.
 */
import { expect, test } from "@playwright/test";

import { account } from "../lib/accounts";
import { DAY, MARGIN, USD, capOf, connectAs, craft, downloaded, icsSeconds, keepOnDevice, make, myRaise, parseIcs, passTimes, phone, printAddress, shot } from "../lib/care-print/care";
import { chainNow, hands, rpc, type Rpc } from "../lib/rpc";
import { readStand, seed, type StandInfo } from "../lib/stand";

test.describe.configure({ mode: "serial" });

let stand: StandInfo;
let chain: Rpc;
let cap: number;

test.beforeAll(async () => {
  stand = readStand();
  chain = rpc(stand.rpc);
  cap = await capOf(chain, stand.core);
});

const ASKER = account(1);
const OTHER = account(2);

test("add 10 test dollars: the reward grows by exactly that, and a link made before still opens and passes", async ({ browser }) => {
  const made = make("--mode", "unlisted", "--reward", "25", "--title", "Who can fix a bicycle wheel today?");
  const id = BigInt(made.handId);
  const before = await hands(chain, stand.core, id);

  const { context, page } = await phone(browser);
  await page.goto(`/care/${stand.chainId}/${id}`);
  await expect(page.getByTestId("care-fund-input")).toBeVisible({ timeout: 20_000 });
  await connectAs(page, 1, ASKER.address);
  await page.getByTestId("care-fund-input").locator("input").fill("10");
  await expect(page.getByTestId("kit-cost-line").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Every link already out there stays good.").first()).toBeVisible();
  await shot(page, "care-fund-390-en");
  await page.getByTestId("care-fund-swipe").click();
  await expect(page.getByTestId("care-tx-rail-fund-done")).toBeVisible({ timeout: 30_000 });

  const after = await hands(chain, stand.core, id);
  expect(after.reward - before.reward).toBe(10n * USD);
  expect(after.expiry).toBe(before.expiry);

  // Under the success line nothing stays armed: the box is empty and the swipe waits for a new amount.
  await expect(page.getByTestId("care-fund-input").locator("input")).toHaveValue("");
  await expect(page.getByTestId("care-fund-swipe")).toBeDisabled();
  await expect(page.getByTestId("care-fund-swipe")).toHaveText(/^Add to the reward/);
  await shot(page, "care-fund-done-390-en");
  await page.getByTestId("care-fund-swipe").click({ force: true });
  await page.waitForTimeout(2_000);
  expect((await hands(chain, stand.core, id)).reward).toBe(after.reward);

  // The link made before the fund: it opens (in the SDK and in another browser) and can be passed.
  const opened = craft<{ ok: boolean; state: string; view: { reward: string } }>("open", made.address);
  expect(opened.ok).toBe(true);
  expect(opened.state).toBe("open");
  expect(BigInt(opened.view.reward)).toBe(35n * USD);
  const passed = craft<{ address: string }>("pass", made.address);
  expect(craft<{ ok: boolean; shakes: number }>("open", passed.address)).toMatchObject({ ok: true, shakes: 1 });

  const holder = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const view = await holder.newPage();
  await view.goto(made.address);
  await expect(view.getByTestId("hand-deal-card")).toContainText("$35", { timeout: 20_000 });
  await holder.close();
  await context.close();
});

test("keep it open: +30 days from the end exactly, then 'up to 180 days from today' is the chain's time plus the cap less ten minutes", async ({ browser }) => {
  const made = make("--mode", "dark", "--reward", "5", "--title", "A sitter for a cat, two weekends");
  const id = BigInt(made.handId);
  const before = await hands(chain, stand.core, id);

  const { context, page } = await phone(browser);
  await page.goto(`/care/${stand.chainId}/${id}`);
  await expect(page.locator('[data-testid="care-extend-chip"][data-value="30"]')).toBeVisible({ timeout: 20_000 });
  await connectAs(page, 1, ASKER.address);
  await page.locator('[data-testid="care-extend-chip"][data-value="30"]').click();
  await expect(page.locator('[data-testid="care-extend-chip"][data-value="30"]')).toHaveAttribute("data-target", String(before.expiry + 30 * DAY));
  await expect(page.getByTestId("kit-cost-line").first()).toBeVisible({ timeout: 15_000 });
  await shot(page, "care-extend-390-en");
  await page.getByTestId("care-extend-swipe").click();
  await expect(page.getByTestId("care-tx-rail-extend-done")).toBeVisible({ timeout: 30_000 });
  const plus30 = await hands(chain, stand.core, id);
  expect(plus30.expiry).toBe(before.expiry + 30 * DAY);

  // Under the success line no chip is chosen and the swipe waits: one more swipe moves nothing.
  await expect(page.locator('[data-testid="care-extend-chip"][aria-checked="true"]')).toHaveCount(0);
  await expect(page.getByTestId("care-extend-swipe")).toBeDisabled();
  await expect(page.getByTestId("care-extend-swipe")).toHaveText(/^Keep it open longer/);
  await shot(page, "care-extend-done-390-en");
  await page.getByTestId("care-extend-swipe").click({ force: true });
  await page.waitForTimeout(2_000);
  expect((await hands(chain, stand.core, id)).expiry).toBe(plus30.expiry);

  // The new end reaches the screen with the next block; then "today" is chosen.
  await expect(page.locator('[data-testid="care-extend-chip"][data-value="30"]')).toHaveAttribute("data-target", String(plus30.expiry + 30 * DAY), { timeout: 15_000 });
  await page.locator('[data-testid="care-extend-chip"][data-value="max"]').click();
  const from = await chainNow(chain);
  await page.getByTestId("care-extend-swipe").click();
  await expect.poll(async () => (await hands(chain, stand.core, id)).expiry, { timeout: 30_000 }).not.toBe(plus30.expiry);
  await expect(page.getByTestId("care-tx-rail-extend-done")).toBeVisible({ timeout: 30_000 });
  const to = await chainNow(chain);
  const max = await hands(chain, stand.core, id);
  // Never past what Core allows at the block that carried it, and within a minute of now + cap − margin.
  expect(max.expiry).toBeLessThanOrEqual(to.timestamp + cap - MARGIN);
  expect(max.expiry).toBeGreaterThanOrEqual(from.timestamp + cap - MARGIN - 60);
  expect(Math.abs(max.expiry - (to.timestamp + cap - MARGIN))).toBeLessThanOrEqual(60);

  // At the cap no chip moves the end any more: all three are off.
  for (const key of ["30", "90", "max"]) {
    await expect(page.locator(`[data-testid="care-extend-chip"][data-value="${key}"]`)).toBeDisabled({ timeout: 15_000 });
  }
  await context.close();
});

test("the reminder is a calendar file made in the page: one VEVENT at the end, an alarm three days before", async ({ browser }) => {
  const made = make("--mode", "unlisted", "--reward", "5");
  const id = BigInt(made.handId);
  const row = await hands(chain, stand.core, id);
  const { context, page } = await phone(browser);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(`/care/${stand.chainId}/${id}`);
  await expect(page.getByTestId("care-reminder")).toBeVisible({ timeout: 20_000 });
  const asked = requests.length;
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("care-reminder").click()]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^ahand-${id}-\\d{8}\\.ics$`));
  const ics = parseIcs(await downloaded(download));
  expect(ics.components).toEqual(["VCALENDAR", "VEVENT", "VALARM"]);
  expect(icsSeconds(ics.event.DTSTART!)).toBe(row.expiry);
  expect(ics.alarm["TRIGGER;RELATED=START"]).toBe("-P3D");
  expect(ics.alarm.ACTION).toBe("DISPLAY");
  expect(ics.event.URL).toMatch(new RegExp(`/care/${stand.chainId}/${id}$`));
  // Made in the page: pressing the button asked no server for anything but the chain's blocks.
  expect(requests.slice(asked).filter((url) => !url.startsWith(stand.rpc) && !url.startsWith("blob:"))).toEqual([]);
  await context.close();
});

test("a second account sees the NotRaiser sentence and no send button", async ({ browser }) => {
  const made = make("--mode", "unlisted", "--reward", "5");
  const { context, page } = await phone(browser);
  await page.goto(`/care/${stand.chainId}/${made.handId}`);
  await expect(page.getByTestId("care-fund-input")).toBeVisible({ timeout: 20_000 });
  await connectAs(page, 2, OTHER.address);
  const band = page.locator('[data-testid="care-error"][data-value="NotRaiser"]');
  await expect(band).toBeVisible();
  await expect(band).toContainText("Only the account that raised this hand can do that.");
  await expect(page.getByTestId("care-fund-swipe")).toHaveCount(0);
  await expect(page.getByTestId("care-extend-swipe")).toHaveCount(0);
  await shot(page, "care-not-raiser-390-en");
  await context.close();
});

test("the raiser's own device: /care shows the kept words framed as this device's, then as the hand's once unlocked", async ({ browser }) => {
  const title = "Who can lend a ladder this weekend?";
  const content = "Three metres is enough; I can pick it up.";
  const raised = myRaise("--mode", "unlisted", "--reward", "5", "--title", title, "--content", content);
  const { context, page } = await phone(browser);
  await page.goto("/my");
  await keepOnDevice(page, raised);
  await page.goto(`/care/${stand.chainId}/${raised.handId}`);
  await connectAs(page, 1, ASKER.address);

  // Locked: the words are this device's, said so, and the card claims nothing.
  const words = page.getByTestId("care-words");
  await expect(words).toHaveAttribute("data-value", "unknown", { timeout: 20_000 });
  await expect(words).toContainText(title);
  await expect(words).toContainText("Your words, as this device keeps them. They are checked once you unlock.");
  await expect(page.getByTestId("kit-deal-card")).not.toContainText(title);
  await shot(page, "care-words-locked-390-en");

  // Unlocked here: the kept words give the dataHash Core keeps, and the card is the hand's own.
  await page.getByTestId("my-unlock").click();
  await expect(words).toHaveAttribute("data-value", "device", { timeout: 15_000 });
  await expect(words).toHaveText("Your words, as this device keeps them. They match what the contract keeps.");
  await expect(page.getByTestId("kit-deal-card")).toContainText(title);
  await expect(page.getByTestId("kit-deal-card")).not.toContainText("Someone raised a hand.");
  await shot(page, "care-words-device-390-en");

  // Words that are not the hand's own are never shown as its own.
  await keepOnDevice(page, { ...raised, title: "Who can lend a car this weekend?" });
  await page.reload();
  await connectAs(page, 1, ASKER.address);
  await page.getByTestId("my-unlock").click();
  await expect(words).toHaveAttribute("data-value", "mismatch", { timeout: 15_000 });
  await expect(page.getByTestId("kit-deal-card")).not.toContainText("Who can lend a car");
  await context.close();
});

test("print: a short dark link prints as the tag; a link of ten passes is not offered small", async ({ browser }) => {
  const short = make("--mode", "dark", "--reward", "5", "--title", "Lost: a grey cat", "--content", "");
  const { context, page } = await phone(browser);
  await printAddress(page, short.address);
  const tag = page.getByTestId("print-tag");
  await expect(tag).toBeVisible({ timeout: 20_000 });
  expect(Number(await tag.getAttribute("data-version"))).toBeLessThanOrEqual(13);
  await expect(page.getByTestId("print-too-dense")).toHaveCount(0);
  await shot(page, "print-tag-390-en");
  await page.emulateMedia({ media: "print" });
  await expect(tag).toBeVisible();
  await expect(tag).toContainText("Found this? Scan it.");
  // In print only the sheet stands: the paste box, the header and the button are gone.
  await expect(page.getByTestId("print-go")).toBeHidden();
  await expect(page.getByTestId("shell-header")).toBeHidden();
  const box = await tag.boundingBox();
  expect(Math.round(box!.width)).toBe(Math.round((85 / 25.4) * 96));
  // Ink on white whatever the theme: the dark scheme does not reach paper.
  await page.emulateMedia({ media: "print", colorScheme: "dark" });
  const paint = await tag.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color, getComputedStyle(document.body).backgroundColor]);
  expect(paint).toEqual(["rgb(255, 255, 255)", "rgb(16, 16, 20)", "rgb(255, 255, 255)"]);
  await page.emulateMedia({ media: "screen", colorScheme: "light" });

  const long = passTimes(make("--mode", "unlisted", "--reward", "5").address, 10);
  await printAddress(page, long);
  await expect(page.getByTestId("print-too-dense")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("print-too-dense")).toContainText("Too dense to print small. Show it on a screen.");
  await expect(page.getByTestId("print-tag")).toHaveCount(0);
  expect(Number(await page.getByTestId("print-too-dense").getAttribute("data-version"))).toBeGreaterThan(13);
  await shot(page, "print-ten-passes-390-en");
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("print-tag")).toHaveCount(0);
  await page.emulateMedia({ media: "screen" });
  await context.close();
});

test("print the receipt: the table from Core's events, a code to the passport and the verify line", async ({ browser }) => {
  const fixtures = seed<{ fixtures: { thanked: { handId: string } } }>(undefined, ["thanked"]);
  const id = fixtures.fixtures.thanked.handId;
  const { context, page } = await phone(browser);
  await page.goto(`/print?receipt=${stand.chainId}/${id}`);
  const sheet = page.getByTestId("print-receipt");
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(sheet.getByTestId("kit-receipt").or(sheet.locator("table"))).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("print-verify")).toHaveText(`bun tools/ahand.ts verify --rpc ${stand.rpc} --core ${stand.core} ${id}`);
  await shot(page, "print-receipt-390-en");
  await context.close();
});

test("in Russian at 390 px: /care and /print speak Russian and nothing runs past the column", async ({ browser }) => {
  const made = make("--mode", "dark", "--reward", "5", "--title", "Кто одолжит палатку на выходные?", "--content", "");
  const { context, page } = await phone(browser, "ru");
  await page.goto(`/care/${stand.chainId}/${made.handId}`);
  await expect(page.getByText("Позаботиться о руке.")).toBeVisible({ timeout: 20_000 });
  await connectAs(page, 1, ASKER.address);
  await expect(page.getByText("Все уже разосланные ссылки остаются в силе.").first()).toBeVisible();
  await expect(page.locator('[data-testid="care-extend-chip"][data-value="max"]')).toContainText("до 180 дней с сегодняшнего дня");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, "care-390-ru");
  await printAddress(page, made.address);
  await expect(page.getByTestId("print-tag")).toContainText("Нашёл? Отсканируй.", { timeout: 20_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, "print-tag-390-ru");
  await context.close();
});
