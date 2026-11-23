/**
 * Getting around: the viewer's own button in the header of every screen,
 * the person sheet it opens (and the same sheet for anyone else, from their name), and a long
 * screen's sections with the strip that moves between them.
 *
 *   STAND_SLOT=0 bunx playwright test tests/e2e/smoke/nav.spec.ts
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { fixtureOf, quiet, seedFixtures, visit, type SeedRun } from "../guards/lib/guard";
import { account, pickDevAccount } from "../lib/accounts";
import { deviceDelete, devicePut } from "../lib/feat-my/store";
import { readStand } from "../lib/stand";

const stand = readStand();
let run: SeedRun;

test.beforeAll(() => {
  run = seedFixtures(["unlisted", "twoPasses"]);
});

test.beforeEach(async ({ context }) => {
  await quiet(context, stand.site!);
});

async function serious(page: Page): Promise<string[]> {
  const found = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return found.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

test("with no account the header says Log in, and the word opens the way in at once over the page it stands on: no head, no sheet of settings, and the link held in the tab stays", async ({ page }) => {
  await visit(page, fixtureOf(run, "unlisted").address);
  await expect(page.getByTestId("hand-pass")).toBeVisible();
  const before = page.url();
  const logIn = page.getByTestId("shell-log-in");
  await expect(logIn).toHaveText("Log in");
  // Nobody to draw a mark for, and a device that keeps no hand gets no link to its hands.
  await expect(page.getByTestId("shell-person-open")).toHaveCount(0);
  await expect(page.getByTestId("shell-my-hands")).toHaveCount(0);
  expect(await logIn.evaluate((node) => node.getBoundingClientRect().height + 8)).toBeGreaterThanOrEqual(44);
  expect(await serious(page)).toEqual([]);
  await logIn.click();
  // The way in itself, not the person sheet.
  await expect(page.getByTestId("dev-account-1")).toBeVisible();
  await expect(page.getByTestId("shell-person")).toHaveCount(0);
  // Closing it leaves the page where it was: same address, the hand still open with its actions.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("dev-account-1")).toHaveCount(0);
  await expect(page.getByTestId("shell-person")).toHaveCount(0);
  expect(page.url()).toBe(before);
  await expect(page.getByTestId("hand-pass")).toBeVisible();
  await page.getByTestId("shell-lang").click();
  await page.getByTestId("shell-lang-ru").click();
  await expect(logIn).toHaveText("Войти");
});

test("the language is one bubble that opens the app's own list: each language under its own name, the one in use marked, walked with the arrows, closed by a choice, by Escape and by a press elsewhere", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("landing-hero")).toBeVisible();
  const bubble = page.getByTestId("shell-lang");
  const menu = page.getByRole("menu", { name: "Language" });
  await expect(bubble).toHaveAttribute("data-value", "en");
  await expect(bubble).toHaveAttribute("aria-expanded", "false");
  await expect(bubble).toHaveAccessibleName("en , Language: English");
  await expect(menu).toHaveCount(0);
  await bubble.click();
  await expect(bubble).toHaveAttribute("aria-expanded", "true");
  const items = menu.getByRole("menuitemradio");
  expect(await items.allInnerTexts()).toEqual(["English", "Русский"]);
  await expect(items.nth(0)).toHaveAttribute("aria-checked", "true");
  await expect(items.nth(0)).toBeFocused();
  expect(await items.nth(1).evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  // The list stays on the screen, under its bubble.
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await serious(page)).toEqual([]);
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(bubble).toBeFocused();
  // A press anywhere else closes it and changes nothing.
  await bubble.click();
  await page.mouse.click(8, 520); // the page's own margin: under no control, clear of the list
  await expect(menu).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // A choice changes the language and closes the list.
  await bubble.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(bubble).toHaveAttribute("data-value", "ru");
  await expect(menu).toHaveCount(0);
  await bubble.click();
  await expect(page.getByRole("menu", { name: "Язык" }).getByRole("menuitemradio").nth(1)).toHaveAttribute("aria-checked", "true");
});

test("a device that keeps a hand without an account gets one quiet link to its hands beside Log in, and the header still fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/");
  await expect(page.getByTestId("shell-log-in")).toBeVisible();
  await expect(page.getByTestId("shell-my-hands")).toHaveCount(0);
  await devicePut(page, [{ store: "passed", value: { id: "smoke-nav-passed", hand: "smoke-nav-hand", chainId: 31337, core: "0x0000000000000000000000000000000000000001", handId: "1", position: 0 } }]);
  await page.reload();
  const mine = page.getByTestId("shell-my-hands");
  await expect(mine).toHaveText("My hands");
  await page.getByTestId("shell-lang").click();
  await page.getByTestId("shell-lang-ru").click();
  await expect(mine).toHaveText("Мои руки");
  // One row: the lockup, the link, the language and the way in, nothing off the side or into the page's margin.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  const tops = await page.evaluate(() => ["shell-logo", "shell-my-hands", "shell-lang", "shell-log-in"].map((id) => Math.round(document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().bottom)));
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(8);
  expect(await page.getByTestId("shell-log-in").evaluate((node) => Math.round(node.getBoundingClientRect().right))).toBeLessThanOrEqual(360 - 16);
  // At 320px the row does not fit: it wraps, the way in under the lockup, and nothing runs off the side in either language.
  await page.setViewportSize({ width: 320, height: 700 });
  for (const lang of ["ru", "en"]) {
    if (lang === "en") {
      await page.getByTestId("shell-lang").click();
      await page.getByTestId("shell-lang-en").click();
      await expect(mine).toHaveText("My hands");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), lang).toBe(0);
    expect(await page.getByTestId("shell-log-in").evaluate((node) => Math.round(node.getBoundingClientRect().right)), lang).toBeLessThanOrEqual(320 - 16);
  }
  // A hand raised on this device belongs to its account: with nobody logged in it brings no link.
  await deviceDelete(page, "passed", "smoke-nav-passed");
  await devicePut(page, [{ store: "hands", value: { intent: "smoke-nav-raised", raiser: "0x0000000000000000000000000000000000000002", hand: "smoke-nav-hand" } }]);
  await page.reload();
  await expect(page.getByTestId("shell-log-in")).toBeVisible();
  await expect(mine).toHaveCount(0);
  await deviceDelete(page, "hands", "smoke-nav-raised");
  await devicePut(page, [{ store: "passed", value: { id: "smoke-nav-passed", hand: "smoke-nav-hand", chainId: 31337, core: "0x0000000000000000000000000000000000000001", handId: "1", position: 0 } }]);
  await page.reload();
  await mine.click();
  await expect(page).toHaveURL(/\/my$/);
});

test("logging in from the header brings the person sheet connected: the header carries the account's mark, the sheet shows its address, its money read from the token, this device's settings and the way out", async ({ page }) => {
  await page.goto("/raise");
  await page.getByTestId("shell-log-in").click();
  await expect(page.getByTestId("dev-account-1")).toBeVisible();
  await pickDevAccount(page, 1);
  const sheet = page.getByTestId("shell-person");
  const open = page.getByTestId("shell-person-open");
  await expect(sheet).toBeVisible();
  await expect(open).toHaveAttribute("data-value", account(1).address);
  await expect(page.getByTestId("shell-log-in")).toHaveCount(0);
  await expect(sheet).toHaveAttribute("data-who", "me");
  await expect(sheet.getByTestId("shell-person-address")).toContainText(account(1).address.slice(0, 10));
  const balance = sheet.getByTestId("shell-person-balance");
  await expect(balance).toHaveAttribute("data-value", /^[0-9]+$/);
  await expect(balance).toContainText("$");
  await expect(sheet.getByTestId("shell-person-hands")).toBeVisible();
  // The rows say their words, not their catalogue ids.
  await expect(sheet.getByTestId("shell-person-hands")).toContainText("Raised on this device");
  await expect(sheet.getByTestId("shell-person-raise")).toHaveText("Raise a hand");
  expect(await serious(page)).toEqual([]);

  // The proof switch in the sheet is the footer's lens.
  await sheet.getByTestId("shell-person-lens").click();
  await expect(page.locator("html")).toHaveAttribute("data-lens", "on");
  await sheet.getByTestId("shell-person-lens").click();
  await expect(page.locator("html")).not.toHaveAttribute("data-lens", "on");

  // The sheet's theme switch and the footer's show the same theme, whichever was pressed.
  const footerDisc = page.getByTestId("shell-theme").locator("svg");
  await expect(footerDisc).not.toHaveAttribute("style", /rotate/);
  await sheet.getByRole("button", { name: /Switch between light and dark$/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(footerDisc).toHaveAttribute("style", /rotate\(180deg\)/);
  await sheet.getByRole("button", { name: /Switch between light and dark$/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(footerDisc).not.toHaveAttribute("style", /rotate/);

  // A row that leads to a screen closes the sheet and goes there.
  await sheet.getByTestId("shell-person-raise").click();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/\/raise$/);

  // The mark opens the sheet again; logging out closes it and the header says Log in once more.
  await open.click();
  await page.getByTestId("shell-person-log-out").click();
  await expect(page.getByTestId("shell-person")).toHaveCount(0);
  await expect(page.getByTestId("shell-person-open")).toHaveCount(0);
  await expect(page.getByTestId("shell-log-in")).toBeVisible();
});

test("the line over the asker's words opens the asker as a person: the same sheet, with the address and nothing claimed beyond it", async ({ page }) => {
  await visit(page, fixtureOf(run, "unlisted").address);
  await page.getByTestId("kit-deal-raiser").click();
  const sheet = page.getByTestId("shell-person");
  await expect(sheet).toHaveAttribute("data-who", "other");
  await expect(sheet.getByTestId("shell-person-address")).toContainText("0x");
  await expect(sheet).toContainText("aHand knows a person by their address and nothing else.");
  await expect(sheet.getByTestId("shell-person-balance")).toHaveCount(0);
  await expect(sheet.getByTestId("shell-person-log-out")).toHaveCount(0);
  expect(await serious(page)).toEqual([]);
});

test("a hand that came through passes reads in three beats, each amount with whose it is: the whole reward at the asker, what was kept at those who passed it on, on amber what reaches the viewer; the line of those who passed opens them, and one opens its person", async ({ page }) => {
  await visit(page, fixtureOf(run, "twoPasses").address);
  const card = page.getByTestId("hand-deal-card");
  await expect(card).toHaveAttribute("data-state", "open");
  // Core's own figure stays the card's data; the amber amount is what is left at this place.
  await expect(card).toHaveAttribute("data-reward", "60000000");
  const spine = page.getByTestId("hand-rail");
  await expect(spine).toHaveAttribute("data-value", "3");
  await expect(spine.locator("> li")).toHaveCount(3);
  await expect(spine.locator('[data-role="asker"]')).toContainText("Someone raised a hand:");
  await expect(spine.getByTestId("kit-spine-whole")).toHaveText("Reward $60");
  await expect(spine.getByTestId("kit-spine-fold")).toHaveText("2 people passed it on");
  await expect(spine.getByTestId("kit-spine-kept")).toHaveText("kept $3");
  const you = spine.locator('[data-role="you"]');
  await expect(you.locator(".ah-deal__money")).toHaveAttribute("data-plate", "reaches");
  await expect(you.locator(".ah-deal__sum")).toHaveText("$57");
  await expect(you).toContainText("If you help and they thank you");
  // One sentence used to join the two amounts; now each stands in its own row.
  await expect(card.getByTestId("kit-deal-of-whole")).toHaveCount(0);
  // No rail is drawn beside the spine, and no mark stands on a plate.
  await expect(page.locator(".ah-rail")).toHaveCount(0);
  expect(await spine.locator(".ah-spine__gesture").first().evaluate((mark) => getComputedStyle(mark).backgroundColor)).toBe("rgba(0, 0, 0, 0)");

  // Those who passed it on stay folded until asked for. Opened, the line goes on down the spine,
  // one row for each pass in the route's order with what that pass kept; a pass that named an
  // address opens that person (the same sheet as from the line over the words), and one that
  // named none is "someone" and opens nothing.
  const fold = spine.getByTestId("kit-spine-fold");
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(spine.getByTestId("kit-spine-pass")).toHaveCount(0);
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  const passes = spine.getByTestId("kit-spine-pass");
  await expect(passes).toHaveCount(2);
  await expect(passes.nth(0)).toHaveText("someonekept $3");
  await expect(passes.nth(1)).toHaveText("someone");
  await expect(passes.nth(1).getByRole("button")).toHaveCount(0);
  // The beats are still three: the passes are rows inside the second one.
  await expect(spine.locator("> li")).toHaveCount(3);
  const people = spine.getByTestId("kit-spine-person");
  await expect(people).toHaveCount(1);
  await people.first().click();
  const sheet = page.getByTestId("shell-person");
  await expect(sheet).toHaveAttribute("data-who", "other");
  await expect(sheet.getByTestId("shell-person-address")).toContainText("0x");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  expect(await serious(page)).toEqual([]);
});

test("/raise in sections: the strip says what each is set to, moves to a section without touching the address, and the one action stays on the first screen", async ({ page }) => {
  await page.goto("/raise");
  const strip = page.getByTestId("raise-nav");
  await expect(strip).toBeVisible();
  const item = (id: string) => strip.locator(`[data-section="${id}"]`);
  await expect(item("raise-reward")).toContainText("$20");
  await expect(item("raise-who")).toContainText("Unlisted");

  // The action is within the first screen before any scroll, though its place is the screen's end.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByTestId("raise-swipe")).toBeInViewport({ ratio: 1 });

  // What the strip says follows what is chosen.
  await page.getByTestId("raise-reward-chip").and(page.locator('[data-value="50"]')).click();
  await expect(item("raise-reward")).toContainText("$50");

  // Pressing a section moves there and focuses it; the address gains nothing after "#".
  const before = page.url();
  await item("raise-who").click();
  await expect(page.locator("#raise-who")).toBeFocused();
  await expect(page.locator("#raise-who")).toBeInViewport();
  await expect(item("raise-who")).toHaveAttribute("aria-current", "true");
  expect(page.url()).toBe(before);
  expect(page.url()).not.toContain("#");
  // The strip is still at the top, and the section's heading is not under it.
  const stripBox = (await strip.boundingBox())!;
  expect(stripBox.y).toBeLessThanOrEqual(1);
  const heading = (await page.locator("#raise-who h2").boundingBox())!;
  expect(heading.y).toBeGreaterThanOrEqual(stripBox.y + stripBox.height);

  await item("raise-ask").click();
  await expect(page.locator("#raise-ask")).toBeFocused();
  expect(await serious(page)).toEqual([]);
});

/** Where the strip, the action and each section's start stand on the screen right now. */
const lookAtRaise = (page: Page) =>
  page.evaluate(() => {
    const top = document.querySelector(".ah-strip")!.getBoundingClientRect();
    const action = document.querySelector('[data-testid="raise-swipe"]')!.getBoundingClientRect();
    const starts = Array.from(document.querySelectorAll<HTMLElement>(".ah-section"))
      .map((section) => ({ id: section.id, at: Math.round(section.getBoundingClientRect().top) }))
      .filter((section) => section.at >= top.bottom - 2 && section.at < window.innerHeight - 8);
    return { strip: Math.round(top.top), stripEnd: Math.round(top.bottom), action: [Math.round(action.top), Math.round(action.bottom)], starts, height: window.innerHeight, snap: getComputedStyle(document.documentElement).scrollSnapType };
  });

test("/raise on a phone shows a section at a time: the strip stays at the top and the action at the bottom, a section fills the room between them less a peek of the next, and any section is reached from any", async ({ page }) => {
  await page.goto("/raise");
  const strip = page.getByTestId("raise-nav");
  await expect(strip).toBeVisible({ timeout: 20_000 });
  const look = () => lookAtRaise(page);
  // The page comes to rest at a section's start only when let go near one; it scrolls freely otherwise.
  expect((await look()).snap).toMatch(/^y( proximity)?$/);
  // It loads at its own top, with the header in view, and comes back to it.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByTestId("shell-log-in")).toBeInViewport();
  const items = strip.locator(".ah-strip__item");
  const ids = ["raise-ask", "raise-reward", "raise-expiry", "raise-who", "raise-preview"];
  for (const [index, id] of ids.entries()) {
    await items.nth(index).click();
    // Settled: the section named stands first under the strip (while the page is still moving it is further down).
    await expect
      .poll(async () => {
        const seen = await look();
        return seen.starts[0]?.id === id && (index === 0 || seen.starts[0].at - seen.stripEnd < 24);
      })
      .toBe(true);
    const now = await look();
    // The first section stands under the header at the page's top; from the second on the strip is pinned.
    if (index > 0) expect(now.strip).toBe(0);
    else expect(now.strip).toBeGreaterThanOrEqual(0);
    expect(now.action[0]).toBeGreaterThan(now.height / 2);
    expect(now.action[1]).toBeLessThanOrEqual(now.height);
    // The section in view starts right under the strip. The next one shows its head in the lower
    // part of the screen, clear of the action: there is more below, and nothing lies over anything.
    if (index > 0) expect(now.starts[0]!.at - now.stripEnd).toBeLessThan(24);
    const peek = now.starts[1];
    if (index > 0 && index < ids.length - 1) {
      expect(peek?.id).toBe(ids[index + 1]);
      expect(peek!.at).toBeGreaterThan(now.height * 0.6);
      expect(now.action[0] - peek!.at).toBeGreaterThan(60);
    }
  }
  // No control steps to the next section: its head on the screen, in shade, says there is one.
  await expect(page.getByTestId("raise-nav-next")).toHaveCount(0);
  // The chat's preview and the page's stand together in the last section.
  await expect(page.locator("#raise-preview").getByTestId("raise-unfurl")).toBeVisible();
  await expect(page.locator("#raise-preview").getByTestId("raise-preview")).toBeVisible();
  // From the last back to the first, in one step, and up to the page's own top.
  await items.nth(0).click();
  await expect.poll(async () => (await look()).starts[0]?.id).toBe("raise-ask");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByTestId("shell-log-in")).toBeInViewport();
  await expect(page).toHaveURL(/\/raise$/);
});

/** The day a moment falls on in a zone, as the card writes it (UTC's) or as a reader there counts it. */
const dayIn = (expiry: number, timeZone: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(new Date(expiry * 1000));

/**
 * A zone whose day of `expiry` is not UTC's. Kiritimati (UTC+14) is on the next day from 10:00 UTC,
 * Etc/GMT+12 (UTC−12) on the day before until 12:00 UTC: the choice turns at 11:00, an hour from
 * either edge, so the chain's clock moving on between two pages does not change the answer.
 */
const zoneApart = (expiry: number) => (new Date(expiry * 1000).getUTCHours() >= 11 ? "Pacific/Kiritimati" : "Etc/GMT+12");

/** The expiry the screen counts from and the UTC line in the date's section, read in one look at the page. */
const readUtcNote = (page: Page) =>
  page.evaluate(() => ({
    expiry: Number(document.querySelector('[data-testid="raise-expiry-line"]')!.getAttribute("data-expiry")),
    inSection: document.querySelector('#raise-expiry [data-testid="raise-expiry-utc"]')?.textContent ?? null,
    anywhere: document.querySelectorAll('[data-testid="raise-expiry-utc"]').length,
  }));

test("/raise's preview writes its date in UTC, as the card does: where the reader's own day is another, the date's section says the day the preview will show", async ({ browser }) => {
  // Between them, these two zones put the reader's day apart from UTC's at any hour.
  let said = 0;
  for (const timezoneId of ["Pacific/Kiritimati", "Etc/GMT+12"]) {
    const context = await browser.newContext({ timezoneId });
    await quiet(context, stand.site!);
    const page = await context.newPage();
    await page.goto("/raise");
    await expect(page.getByTestId("raise-expiry-line")).toBeVisible({ timeout: 20_000 });
    // The expiry is the chain's clock plus the days: whether the days differ follows from it, not from the hour the suite runs.
    const seen = await readUtcNote(page);
    if (dayIn(seen.expiry, timezoneId) === dayIn(seen.expiry, "UTC")) expect(seen.anywhere).toBe(0);
    else {
      expect(seen.anywhere).toBe(1);
      expect(seen.inSection).toBe(`The link's preview counts days in UTC and will show ${dayIn(seen.expiry, "UTC").replace(" ", "\u00a0")}.`);
      said++;
    }
    // Nothing about it stands with the preview itself.
    await expect(page.locator("#raise-preview").getByText("UTC")).toHaveCount(0);
    await context.close();
  }
  expect(said).toBeGreaterThan(0);
});

test("/raise on a wide screen: the examples and the action stand beside the sections in a box no taller than the window, the strip has no item for them, and the next section comes up in shade as on a phone", async ({ browser }) => {
  // Where the reader's day of the expiry is not UTC's, the date's section gains a line saying the
  // preview's day. The box of examples must not change with it: it is measured first in UTC, where
  // the line never shows, then in a zone picked from the expiry so that it does, at any hour.
  const wide = { viewport: { width: 1280, height: 720 }, hasTouch: false, isMobile: false, deviceScaleFactor: 1 };
  const examples = (page: Page) => page.locator("#raise-preview").evaluate((box) => box.scrollHeight);
  const utc = await browser.newContext({ ...wide, timezoneId: "UTC" });
  const inUtc = await utc.newPage();
  await inUtc.goto("/raise");
  await expect(inUtc.getByTestId("raise-expiry-line")).toBeVisible({ timeout: 20_000 });
  await expect(inUtc.getByTestId("raise-expiry-utc")).toHaveCount(0);
  await expect(inUtc.getByTestId("raise-unfurl")).toBeInViewport();
  await expect(inUtc.getByTestId("raise-preview")).toBeInViewport();
  const plain = await examples(inUtc);
  const timezoneId = zoneApart((await readUtcNote(inUtc)).expiry);
  await utc.close();

  const context = await browser.newContext({ ...wide, timezoneId });
  const page = await context.newPage();
  await page.goto("/raise");
  const strip = page.getByTestId("raise-nav");
  await expect(strip).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("raise-expiry-line")).toBeVisible();
  const apart = await readUtcNote(page);
  expect(dayIn(apart.expiry, timezoneId)).not.toBe(dayIn(apart.expiry, "UTC"));
  await expect(page.locator("#raise-expiry").getByTestId("raise-expiry-utc")).toBeVisible();
  expect(await examples(page)).toBe(plain);
  const look = () => lookAtRaise(page);
  // Four sections to move between: the examples are beside them, in view throughout.
  await expect(strip.locator(".ah-strip__item:visible")).toHaveCount(4);
  await expect(strip.locator('[data-section="raise-preview"]')).toBeHidden();
  await expect(page.getByTestId("raise-unfurl")).toBeInViewport();
  await expect(page.getByTestId("raise-preview")).toBeInViewport();
  // The action is whole on the screen even on a short window, and no scrollbar is drawn in the box of examples.
  const first = await look();
  expect(first.action[1]).toBeLessThanOrEqual(first.height);
  expect(await page.locator("#raise-preview").evaluate((box) => getComputedStyle(box).scrollbarWidth)).toBe("none");

  // No control steps to the next section on any width: its head shows at the screen's foot, in
  // shade, as on a phone, and the strip moves between the four.
  await expect(page.getByTestId("raise-nav-next")).toHaveCount(0);
  const items = strip.locator(".ah-strip__item:visible");
  await items.nth(1).click();
  await expect(page.locator("#raise-reward")).toBeFocused();
  await expect
    .poll(async () => {
      const seen = await look();
      return seen.starts[0]?.id === "raise-reward" && seen.starts[0].at - seen.stripEnd < 24 ? seen.starts[1]?.id : undefined;
    })
    .toBe("raise-expiry");
  const peek = (await look()).starts[1]!;
  expect(peek.at).toBeGreaterThan(first.height * 0.6);
  // The haze lies over that head: a layer of the page's own colour that takes no pointer.
  const haze = await page.locator(".ah-sections").evaluate((column) => {
    const style = getComputedStyle(column, "::after");
    return { position: style.position, events: style.pointerEvents, image: style.backgroundImage.slice(0, 15) };
  });
  expect(haze).toEqual({ position: "sticky", events: "none", image: "linear-gradient" });
  await items.nth(3).click();
  await expect(page.locator("#raise-who")).toBeFocused();
  const last = await look();
  expect(last.action[1]).toBeLessThanOrEqual(last.height);
  expect(await serious(page)).toEqual([]);
  await context.close();
});

test("/raise, how long it stays open: bare numbers of days and beside them the date they come to, which opens the app's own calendar for any other day up to the contract's last", async ({ page }) => {
  await page.goto("/raise");
  const strip = page.getByTestId("raise-nav");
  await expect(strip).toBeVisible({ timeout: 20_000 });
  await strip.locator('.ah-strip__item[data-section="raise-expiry"]').click();
  const chips = page.getByTestId("raise-expiry-chip");
  expect(await chips.allInnerTexts()).toEqual(["7", "30", "90"]);
  const date = page.getByTestId("raise-expiry-date");
  // The date is said once in the row, and the strip says the same.
  await expect(date).toHaveText(/^until \d{1,2} \w{3,4}$/);
  await chips.nth(0).click();
  const week = (await date.getAttribute("data-value"))!;
  await expect(strip.locator('[data-section="raise-expiry"]')).toContainText((await date.innerText()).replace("until ", ""));
  // No browser's own date field anywhere: the calendar is the app's.
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await expect(page.getByTestId("raise-expiry-calendar")).toHaveCount(0);

  await date.click();
  const calendar = page.getByTestId("raise-expiry-calendar");
  await expect(calendar).toBeVisible();
  await expect(date).toHaveAttribute("aria-expanded", "true");
  await expect(calendar).toHaveAttribute("data-value", week);
  await expect(calendar.locator('[aria-pressed="true"]')).toHaveAttribute("data-date", week);
  // The span is the contract's: from tomorrow by the chain's clock to its cap. Days outside it are not pressable.
  const first = (await calendar.getAttribute("data-min"))!;
  const last = (await calendar.getAttribute("data-max"))!;
  expect(Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000)).toBeGreaterThanOrEqual(178);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  // The last day of the span: a few months on, and pressing it is the whole cap, with no ready number chosen.
  for (let month = 0; month < 8 && (await calendar.locator(`[data-date="${last}"]`).count()) === 0; month++) await calendar.locator('[data-step="later"]').click();
  await expect(calendar.locator('[data-step="later"]')).toBeDisabled();
  await calendar.locator(`[data-date="${last}"]`).click();
  await expect(calendar).toHaveCount(0);
  await expect(date).toHaveAttribute("data-value", last);
  // Picking closes the calendar and hands the keyboard back to the date, which now holds the choice.
  await expect(date).toBeFocused();
  await expect(date).toHaveAttribute("aria-current", "true");
  await expect(page.locator('[data-testid="raise-expiry-chip"][aria-checked="true"]')).toHaveCount(0);
  await expect(page.getByTestId("raise-expiry-line")).toContainText("If you thank nobody by then, the reward can be sent back to you. Anyone can do it, and it goes only to you.");
  // Escape closes the calendar without picking, and the keyboard is back on the date.
  await date.press("Enter");
  await expect(calendar).toBeVisible();
  await calendar.locator('.ah-cal__day[tabindex="0"]').focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Escape");
  await expect(calendar).toHaveCount(0);
  await expect(date).toBeFocused();
  await expect(date).toHaveAttribute("data-value", last);
  // A ready number takes over again.
  await chips.nth(1).click();
  await expect(page.locator('[data-testid="raise-expiry-chip"][aria-checked="true"]')).toHaveText("30");
  await expect(date).not.toHaveAttribute("data-value", last);
  await expect(date).not.toHaveAttribute("aria-current", "true");
  expect(await serious(page)).toEqual([]);
});
