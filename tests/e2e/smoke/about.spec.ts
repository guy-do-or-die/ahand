/**
 * The pages that say what aHand is and is not (about-pages): the landing and its
 * "Got a link? Paste it" row against real seeded Hands on a real local chain, "About these
 * defaults" in both languages, and axe on both. The "What it can't promise" screen was removed on
 * 2026-11-22: an old /limits link lands on the not-found page. Earlier fixes are held here too:
 * the gestures come before the paste row and each card front takes its own height, /without-us
 * reads whole, and /core and /defaults write Russian numbers and units.
 *
 *   STAND_SLOT=6 bunx playwright test tests/e2e/smoke/about.spec.ts
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { digitsOf, quietDevServer, type SeedRun } from "../lib/about-pages/helpers";
import { lensOn } from "../lib/lens";
import { readStand, seed } from "../lib/stand";
import { EXAMPLES, keptOf, reachesOf } from "../../../apps/web/src/screens/landing/examples";

test.describe.configure({ mode: "serial" });

const stand = readStand();
let run: SeedRun;

test.beforeAll(() => {
  run = seed<SeedRun>(undefined, ["unlisted", "dark"]);
});

test.beforeEach(async ({ context }) => {
  await quietDevServer(context, stand.site!);
});

const fixture = (name: string) => {
  const found = run.fixtures[name];
  if (!found) throw new Error(`the seed made no ${name} fixture`);
  return found;
};

async function toRussian(page: Page): Promise<void> {
  await page.getByTestId("shell-lang").click();
  await page.getByTestId("shell-lang-ru").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
}

async function paste(page: Page, text: string): Promise<void> {
  // The paste row is folded into one question until someone with a link asks for it.
  await page.getByTestId("landing-open-ask").click();
  await page.getByTestId("landing-open-input").fill(text);
  await page.getByTestId("landing-open-submit").click();
}

test("the landing says what this is, turns each of the four gestures over to Core's own call, and leads to raising a hand", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("landing-hero")).toHaveText(/Raise a hand\.\s*Your people take it from there\./);
  const gestures = page.getByTestId("landing-gesture");
  await expect(gestures).toHaveCount(4);
  expect(await gestures.evaluateAll((cards) => cards.map((card) => card.getAttribute("data-value")))).toEqual(["raise", "pass", "help", "thank"]);
  await expect(page.getByRole("heading", { name: "Four gestures" })).toBeVisible();
  await expect(gestures.nth(1)).toContainText("Pass it on, maybe keep a share");
  await expect(gestures.nth(2)).toContainText("Help, and wait for thanks");
  await expect(gestures.nth(3)).toContainText("Thank, and everyone is paid");
  // The calm view: each gesture is its sentence, and nothing turns over to Core's call.
  await expect(gestures.nth(0)).toContainText("Ask, and lock a reward");
  await expect(page.getByRole("button", { name: /Ask, and lock a reward/ })).toHaveCount(0);
  await expect(page.locator("pre")).toHaveCount(0);

  // Under the lens every card stands turned to Core's call, and each still turns back and over.
  await lensOn(page);
  const raise = gestures.nth(0);
  await expect(raise).toHaveAttribute("data-open", "true");
  await expect(raise.locator("pre")).toContainText("raise(token, reward, expiry, rootKey, payoutGasK, minClaimBps, dataHash)");
  await expect(gestures.nth(1).locator("pre")).toContainText("checkRoute(handId, signedShakes)");
  await expect(gestures.nth(2).locator("pre")).toContainText("checkGive(handId, signedShakes, signedGive)");
  await expect(gestures.nth(3).locator("pre")).toContainText("thank(handId, signedShakes, signedGive, dataHash)");
  await raise.getByRole("button", { name: /Turn it back/ }).click();
  await expect(raise).toHaveAttribute("data-open", "false");
  const front = raise.getByRole("button", { name: /Ask, and lock a reward/ });
  await expect(front).toHaveAttribute("aria-expanded", "false");
  await front.click();
  await expect(raise).toHaveAttribute("data-open", "true");

  // The honest sentence stays; it no longer leads to a limits screen.
  await expect(page.locator("[data-screen]")).toContainText("Thanking is voluntary: the asker decides.");
  await expect(page.locator('a[href="/limits"]')).toHaveCount(0);
  // One's own hands are behind the header's button and "Do it without us" is in the footer, on
  // every screen: the landing repeats neither.
  await expect(page.locator('[data-screen="landing"] a[href="/my"], [data-screen="landing"] a[href="/without-us"]')).toHaveCount(0);
  await expect(page.locator('footer a[href="/without-us"]')).toHaveCount(1);
  await page.getByTestId("landing-raise").click();
  await expect(page).toHaveURL(/\/raise$/);

  await page.goto("/");
  await toRussian(page);
  await expect(page.getByTestId("landing-hero")).toHaveText(/Подними руку\.\s*Дальше — твои люди\./);
});

test("a seeded address pasted into “Got a link? Paste it” opens the Hand view with its title; the link never enters the address bar", async ({ page }) => {
  const unlisted = fixture("unlisted");
  await page.goto("/");
  await paste(page, `  ${unlisted.address}\n`);
  await expect(page).toHaveURL(new RegExp(`/${run.chainId}/${unlisted.handId}\\?d=`));
  expect(page.url()).not.toContain("#");
  const card = page.getByTestId("hand-deal-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText(unlisted.title);
});

test("the same link under another host shows the other-site sentence first, then opens here", async ({ page }) => {
  const unlisted = fixture("unlisted");
  const elsewhere = unlisted.address.replace(new URL(unlisted.address).origin, "https://ahand.elsewhere.example");
  await page.goto("/");
  await paste(page, elsewhere);
  const said = page.getByTestId("landing-other-site");
  await expect(said).toContainText(
    "This address was made for ahand.elsewhere.example. The link opens anywhere. Make sure you trust the site you're on.",
  );
  await expect(page).toHaveURL(/\/$/);
  await said.getByRole("button", { name: "Open it here" }).click();
  await expect(page).toHaveURL(new RegExp(`/${run.chainId}/${unlisted.handId}\\?d=`));
  await expect(page.getByTestId("hand-deal-card")).toContainText(unlisted.title);

  await page.goto("/");
  await toRussian(page);
  await paste(page, elsewhere);
  await expect(page.getByTestId("landing-other-site")).toContainText("Этот адрес сделан для ahand.elsewhere.example.");
});

test("the QR digits of a seeded link, pasted alone, open the Hand", async ({ page }) => {
  const dark = fixture("dark");
  const link = dark.address.slice(dark.address.indexOf("#") + 1);
  const digits = digitsOf(link);
  expect(digits).toMatch(/^[1-9][0-9]+$/);
  await page.goto("/");
  await paste(page, digits);
  await expect(page.getByTestId("hand-deal-card")).toContainText(dark.title);
  expect(new URL(page.url()).pathname).toBe("/");
  expect(page.url()).not.toContain(digits);
});

test("text that is no link opens nothing and says so", async ({ page }) => {
  await page.goto("/");
  await paste(page, "see you at noon");
  await expect(page.getByRole("alert")).toContainText("This isn't an aHand address or link. Nothing was opened.");
  await expect(page).toHaveURL(/\/$/);
});

test("an old /limits link lands on the not-found page, which leads back to the start", async ({ page }) => {
  await page.goto("/limits");
  const missing = page.locator('[data-screen="not-found"]');
  await expect(missing).toContainText("Nothing here");
  await missing.getByRole("link", { name: "To the start" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("“About these defaults” marks every row as not the project owner's, with no row numbers", async ({ page }) => {
  await page.goto("/defaults");
  await expect(page.getByTestId("defaults-row").first()).not.toContainText(/D-\d+/);
  await lensOn(page);
  const rows = page.getByTestId("defaults-row");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(12);
  for (let i = 0; i < count; i++) {
    await expect(rows.nth(i)).toContainText("Chosen for this experiment, not by the project's owner.");
    await expect(rows.nth(i)).not.toContainText(/D-\d+/);
    await expect(rows.nth(i)).toHaveAttribute("data-value", /^d[0-9]+[a-z]*$/);
  }
  for (const key of ["d21", "d26a", "d32", "d49", "d61", "d62", "d63", "d66"]) {
    await expect(page.locator(`[data-testid="defaults-row"][data-value="${key}"]`)).toHaveCount(1);
  }
  // The relays row takes its key from the relays the app is built with: the stand's own relay on
  // this computer gives d40, a relay anywhere else d40public, the rule of relaysArePublic on /defaults.
  const relays = stand.relay ? [stand.relay] : [];
  const relaysKey = relays.some((url) => !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) ? "d40public" : "d40";
  const relaysRow = page.locator(`[data-testid="defaults-row"][data-value="${relaysKey}"]`);
  await expect(relaysRow).toHaveCount(1);
  await expect(page.locator(`[data-testid="defaults-row"][data-value="${relaysKey === "d40" ? "d40public" : "d40"}"]`)).toHaveCount(0);
  if (relays.length) await expect(relaysRow).toContainText(`NIP-17 · ${relays.join(" · ")}`);
  await expect(rows.filter({ hasText: "The helper gets at least 70%" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "A hand is open for 30 days" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "payoutGasK = 250" })).toHaveCount(1);

  await toRussian(page);
  await expect(rows).toHaveCount(count);
  for (let i = 0; i < count; i++) await expect(rows.nth(i)).toContainText("Выбрано для этого эксперимента, а не владельцем проекта.");
  await expect(rows.filter({ hasText: "Рука открыта 30 дней" })).toHaveCount(1);
});

/** "$1,500" as the page writes it in either language (ui/format.ts `money`, whole dollars). */
const dollars = (units: bigint, lang: "en" | "ru") => `$${new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-US").format(units / 1_000_000n)}`;

for (const [name, viewport] of [
  ["a wide screen", { width: 1280, height: 800 }],
  ["a phone", { width: 390, height: 844 }],
] as const) {
  test(`the landing's examples on ${name}: one at a time, each with amounts that add up, in a place that never changes its height, and after the last comes the first`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, hasTouch: false, isMobile: false });
    await quietDevServer(context, stand.site!);
    const page = await context.newPage();
    await page.goto("/");
    const sample = page.getByTestId("landing-sample");
    const next = page.getByTestId("landing-sample-next");
    const all = sample.getByTestId("landing-example");
    const how = page.locator("#landing-how");
    await expect(all).toHaveCount(EXAMPLES.length);
    // Each example is the receiver's own card: one card's root for each.
    await expect(sample.locator("article.ah-deal--spine")).toHaveCount(EXAMPLES.length);
    // Nothing is said to a screen reader on arrival.
    await expect(sample.getByRole("status")).toHaveText("");
    for (const lang of ["en", "ru"] as const) {
      if (lang === "ru") await toRussian(page);
      const place = { sample: (await sample.boundingBox())!, next: (await next.boundingBox())!, how: (await how.boundingBox())! };
      // Each control is big enough for a finger, and the two places to press do not overlap.
      const pause = page.getByTestId("landing-sample-pause");
      for (const control of [next, pause]) expect(await control.evaluate((node) => parseFloat(getComputedStyle(node, "::after").height))).toBeGreaterThanOrEqual(44);
      const reach = async (control: typeof next) => control.evaluate((node) => ({ left: node.getBoundingClientRect().left - 7, right: node.getBoundingClientRect().right + 7 }));
      expect((await reach(pause)).right).toBeLessThanOrEqual((await reach(next)).left);
      for (let step = 1; step <= EXAMPLES.length; step++) {
        const example = EXAMPLES[step % EXAMPLES.length]!;
        await next.click();
        await expect(sample).toHaveAttribute("data-value", example.id);
        // One is seen and the rest are neither seen nor read.
        await expect(all.filter({ visible: true })).toHaveCount(1);
        const shown = sample.locator('[data-testid="landing-example"][data-current="true"]');
        await expect(shown).toBeVisible();
        const kept = keptOf(example);
        const passes = shown.locator('[data-role="passers"]');
        await expect(passes).toHaveCount(example.route.length > 0 ? 1 : 0);
        if (example.route.length > 1) await expect(passes).toContainText(String(example.route.length));
        // The whole reward stands at the asker only where passes kept some of it, and then the three amounts add up.
        const whole = shown.locator('[data-role="asker"] .ah-spine__terms');
        await expect(whole).toHaveCount(kept > 0n ? 1 : 0);
        if (kept > 0n) {
          await expect(whole).toContainText(dollars(example.reward, lang));
          await expect(passes.locator(".ah-spine__quiet")).toContainText(dollars(kept, lang));
        } else {
          await expect(passes.locator(".ah-spine__quiet")).toHaveCount(0);
        }
        if (example.reward > 0n) await expect(shown.locator(".ah-marker")).toHaveText(dollars(reachesOf(example), lang));
        else await expect(shown.locator(".ah-marker")).toHaveCount(0);
        // The page holds still: the example's place, its control and what follows it are where they were.
        expect((await sample.boundingBox())!).toEqual(place.sample);
        expect((await next.boundingBox())!).toEqual(place.next);
        expect((await how.boundingBox())!).toEqual(place.how);
        // The example fits its place, and no page is wider than its window.
        const box = (await shown.boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(place.sample.y + place.sample.height);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
        // A screen reader is told the new example's words.
        await expect(sample.getByRole("status")).toHaveText(await shown.locator(".ah-deal__title").innerText());
      }
      // After the last comes the first.
      await expect(sample).toHaveAttribute("data-value", EXAMPLES[0]!.id);
    }
    await context.close();
  });
}

test("the landing's examples by the keyboard: the control keeps the focus, each example arrives beat after beat, and with less motion asked for it arrives by tone alone", async ({ page }) => {
  await page.goto("/");
  const sample = page.getByTestId("landing-sample");
  const next = page.getByTestId("landing-sample-next");
  const shown = sample.locator('[data-testid="landing-example"][data-current="true"]');
  const arrival = () => shown.locator(".ah-spine__row").evaluateAll((rows) => rows.map((row) => `${getComputedStyle(row).animationName} ${getComputedStyle(row).animationDelay}`));
  // The example the page opens with stands still.
  await expect(shown).toBeVisible();
  expect(await arrival()).toEqual(["none 0s", "none 0s", "none 0s"]);
  await next.focus();
  // The focus in the example holds it where it is.
  await expect(sample).toHaveAttribute("data-running", "false");
  await page.keyboard.press("Enter");
  await expect(sample).toHaveAttribute("data-value", EXAMPLES[1]!.id);
  await expect(next).toBeFocused();
  await page.keyboard.press("Space");
  await expect(sample).toHaveAttribute("data-value", EXAMPLES[2]!.id);
  await expect(next).toBeFocused();
  // It arrives down its route: who asked, then the reader's own place (this one has no pass).
  expect(EXAMPLES[2]!.route.length).toBe(0);
  expect(await arrival()).toEqual(["lp-arrive 0s", "lp-arrive 0.22s"]);
  await page.keyboard.press("Enter");
  expect(await arrival()).toEqual(["lp-arrive 0s", "lp-arrive 0.22s", "lp-arrive 0.44s"]);
  // Where less motion is asked for the tone stays and every move stops: each beat comes in without rising, in the same order, and no hand greets.
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect((await arrival()).map((row) => row.split(" ")[0])).toEqual(["none", "none", "none"]);
  expect(await shown.locator("[data-gesture]").evaluateAll((marks) => marks.map((mark) => getComputedStyle(mark).animationName))).toEqual(["none", "none"]);
  await page.keyboard.press("Enter");
  expect(await shown.locator(".ah-spine__row").evaluateAll((rows) => rows.map((row) => `${getComputedStyle(row).transitionProperty} ${getComputedStyle(row).transitionDelay} ${getComputedStyle(row).transform}`))).toEqual(["opacity 0s none", "opacity 0.22s none", "opacity 0.44s none"]);
  await expect.poll(() => shown.locator(".ah-spine__row").evaluateAll((rows) => rows.map((row) => getComputedStyle(row).opacity))).toEqual(["1", "1", "1"]);
  // The change by itself stays, and so does its pause.
  await expect(page.getByTestId("landing-sample-pause")).toHaveCount(1);
  await next.blur();
  await page.mouse.move(0, 0);
  await expect(sample).toHaveAttribute("data-running", "true");
  // Read by axe with an example other than the first in turn.
  const results = await new AxeBuilder({ page }).include("#main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("the landing's examples come by themselves: the next after nine seconds with the page standing still, held by the pointer, by the focus, by the pause and on a page nobody sees, and never said aloud", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
  await quietDevServer(context, stand.site!);
  const page = await context.newPage();
  await page.clock.install();
  await page.goto("/");
  const sample = page.getByTestId("landing-sample");
  const next = page.getByTestId("landing-sample-next");
  const pause = page.getByTestId("landing-sample-pause");
  const how = page.locator("#landing-how");
  await expect(sample).toHaveAttribute("data-value", EXAMPLES[0]!.id);
  await expect(sample).toHaveAttribute("data-running", "true");
  const place = { sample: (await sample.boundingBox())!, how: (await how.boundingBox())! };
  // Not before its time, and then the next one, and after it the one after.
  await page.clock.runFor(8_000);
  await expect(sample).toHaveAttribute("data-value", EXAMPLES[0]!.id);
  await page.clock.runFor(1_500);
  await expect(sample).toHaveAttribute("data-value", EXAMPLES[1]!.id);
  await page.clock.runFor(9_000);
  await expect(sample).toHaveAttribute("data-value", EXAMPLES[2]!.id);
  expect((await sample.boundingBox())!).toEqual(place.sample);
  expect((await how.boundingBox())!).toEqual(place.how);
  // One that came by itself is not said to a screen reader.
  await expect(sample.getByRole("status")).toHaveText("");
  // The asker's hand greets once on arrival, as on the receiver's card. Those who passed it on stand still.
  await page.clock.runFor(9_000);
  const shown = sample.locator('[data-testid="landing-example"][data-current="true"]');
  await expect(sample).toHaveAttribute("data-value", EXAMPLES[3]!.id);
  expect(await shown.locator("[data-gesture]").evaluateAll((marks) => marks.map((mark) => `${getComputedStyle(mark).animationName} ${getComputedStyle(mark).animationIterationCount}`))).toEqual(["ah-raise 1", "none 1"]);
  // The pointer over the example holds it for as long as it stays.
  await sample.hover();
  await expect(sample).toHaveAttribute("data-running", "false");
  await page.clock.runFor(30_000);
  await expect(sample).toHaveAttribute("data-value", EXAMPLES[3]!.id);
  await page.mouse.move(0, 0);
  await expect(sample).toHaveAttribute("data-running", "true");
  // So does the focus in it.
  await next.focus();
  await expect(sample).toHaveAttribute("data-running", "false");
  await page.clock.runFor(30_000);
  await expect(sample).toHaveAttribute("data-value", EXAMPLES[3]!.id);
  await next.blur();
  await expect(sample).toHaveAttribute("data-running", "true");
  // The pause holds it until it is let go, wherever the pointer and the focus are.
  await expect(pause).toHaveAccessibleName("Pause the examples");
  await pause.click();
  await expect(pause).toHaveAttribute("data-value", "paused");
  await expect(pause).toHaveAccessibleName("Let the examples go on");
  await pause.blur();
  await page.mouse.move(0, 0);
  await expect(sample).toHaveAttribute("data-running", "false");
  await page.clock.runFor(30_000);
  await expect(sample).toHaveAttribute("data-value", EXAMPLES[3]!.id);
  // Asking for another while it is paused still brings one, and that one is said.
  await next.click();
  await expect(sample).toHaveAttribute("data-value", EXAMPLES[4]!.id);
  await expect(sample.getByRole("status")).toHaveText(await shown.locator(".ah-deal__title").innerText());
  await pause.click();
  await expect(pause).toHaveAttribute("data-value", "running");
  await pause.blur();
  await page.mouse.move(0, 0);
  await expect(sample).toHaveAttribute("data-running", "true");
  // A page nobody sees keeps its example.
  await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => true }));
  await page.clock.runFor(30_000);
  await expect(sample).toHaveAttribute("data-value", EXAMPLES[4]!.id);
  await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => false }));
  await page.clock.runFor(9_500);
  await expect(sample).toHaveAttribute("data-value", EXAMPLES[5]!.id);
  // A device that asks for less motion still gets the next one in its time.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(sample).toHaveAttribute("data-running", "true");
  await page.clock.runFor(9_500);
  await expect(sample).toHaveAttribute("data-value", EXAMPLES[6]!.id);
  await context.close();
});

for (const path of ["/", "/defaults"]) {
  for (const lang of ["en", "ru"] as const) {
    test(`axe finds no serious or critical issue on the ${path} screen (${lang})`, async ({ page }) => {
      await page.goto(path);
      if (lang === "ru") await toRussian(page);
      await expect(page.locator(`[data-screen]`).first()).toBeVisible();
      // Under the lens the gesture cards stand turned to Core's calls, so axe reads their backs too.
      if (path === "/") await lensOn(page);
      // The screen itself; the shell's header and footer are the shell's own.
      const results = await new AxeBuilder({ page }).include("#main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
      const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });
  }
}

test("the landing shows the four gestures before the paste row, which is one question until asked for; each card as tall as its own front, «твои люди» on one line", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const gestures = page.getByTestId("landing-gesture");
  const ask = page.getByTestId("landing-open-ask");
  const first = (await gestures.first().boundingBox())!;
  expect((await ask.boundingBox())!.y).toBeGreaterThan(((await gestures.last().boundingBox())!).y);
  await expect(ask).toHaveText("Got a link?");
  // Folded, no field stands on the page; asked for, it opens with the focus in it.
  await expect(page.getByTestId("landing-open-input")).toHaveCount(0);
  await ask.click();
  await expect(page.getByTestId("landing-open-input")).toBeFocused();
  await expect(page.getByText("Got a link? Paste it")).toBeVisible();
  // The raise card's front is one short sentence: it is shorter than its back, which the lens turns in.
  const front = first.height;
  await lensOn(page);
  await expect(gestures.first()).toHaveAttribute("data-open", "true");
  await page.waitForTimeout(500);
  expect(front).toBeLessThan(((await gestures.first().boundingBox())!).height);
  await toRussian(page);
  expect(await page.locator(".lp-mark").evaluate((node) => node.getClientRects().length)).toBe(1);
  await expect(page.getByText("Есть ссылка? Вставь её")).toBeVisible();
});

test("the landing's first screen: two sentences, the action with one line under it, and a Hand as its receiver sees it, beside them on a wide screen and after them on a phone", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
  const page = await context.newPage();
  await page.goto("/");
  const raise = page.getByTestId("landing-raise");
  const sample = page.getByTestId("landing-sample");
  const shown = sample.locator('[data-testid="landing-example"][data-current="true"]');
  // The pointer rests on the example, which holds it where it is while this test reads it.
  await sample.hover();
  await expect(sample).toHaveAttribute("data-running", "false");
  await expect(sample).toContainText("What your people see");
  // The first example is the plain case: a reward in the tens and two passes that each kept a share.
  await expect(sample).toHaveAttribute("data-value", "sublet");
  await expect(shown).toContainText("Someone raised a hand:");
  await expect(shown).toContainText("Who knows of a sublet in Barcelona for June?");
  await expect(shown).toContainText("Reward $40");
  await expect(shown).toContainText("2 people passed it on");
  await expect(shown).toContainText("kept $12");
  await expect(shown).toContainText("It reached you");
  await expect(shown.locator(".ah-marker")).toHaveText("$28");
  // The example is a picture with nothing to press. Its two quiet controls stand in the caption's line, and no action of a real Hand is drawn.
  await expect(shown.locator("button, a")).toHaveCount(0);
  await expect(sample.locator("button, a")).toHaveCount(2);
  await expect(page.getByTestId("landing-sample-next")).toHaveText("Another example");
  await expect(page.getByTestId("landing-sample-pause")).toHaveAccessibleName("Pause the examples");
  await expect(sample.locator(".ah-swipe")).toHaveCount(0);
  await expect(page.locator("#landing-raise-note")).toHaveText("The reward is paid only when you thank.");
  // Beside the words on a wide screen, the whole of it on the first screen with the action.
  const wide = { raise: (await raise.boundingBox())!, sample: (await sample.boundingBox())! };
  expect(wide.sample.x).toBeGreaterThan(wide.raise.x + wide.raise.width);
  expect(wide.sample.y + wide.sample.height).toBeLessThan(800);
  expect(wide.raise.y + wide.raise.height).toBeLessThan(800);
  // On a phone the action comes first and the example after it, and nothing runs off the side.
  await page.setViewportSize({ width: 390, height: 844 });
  const narrow = { raise: (await raise.boundingBox())!, sample: (await sample.boundingBox())! };
  expect(narrow.raise.y + narrow.raise.height).toBeLessThan(844);
  expect(narrow.sample.y).toBeGreaterThan(narrow.raise.y + narrow.raise.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await toRussian(page);
  await expect(sample).toContainText("Что увидят твои люди");
  await expect(page.getByTestId("landing-sample-next")).toHaveText("Другой пример");
  await expect(page.getByTestId("landing-sample-pause")).toHaveAccessibleName("Остановить смену примеров");
  await expect(shown).toContainText("2 человека передали дальше");
  await expect(shown).toContainText("оставили себе $12");
  await expect(page.getByTestId("landing-gesture").nth(1)).toContainText("Аккаунт для этого не нужен.");
  await context.close();
});

test("/without-us's refund line reads whole in both languages", async ({ page }) => {
  await page.goto("/without-us");
  await expect(page.locator("[data-screen]")).toContainText("Send it back. Anyone may, from the second the hand's end date passes.");
  await toRussian(page);
  await expect(page.locator("[data-screen]")).toContainText("Вернуть. Может кто угодно, начиная с секунды, когда наступил срок руки.");
  await expect(page.locator("[data-screen]")).not.toContainText("наступил expiry");
});

test("/core and /defaults write Russian numbers and units on the Russian page", async ({ page }) => {
  await page.goto("/core");
  await expect(page.getByTestId("core-cap")).toHaveAttribute("data-value", String(180 * 86_400), { timeout: 15_000 });
  await toRussian(page);
  await expect(page.locator("[data-screen]")).toContainText(/Его код на месте: [\d\u00a0 ]+ байт(а)?\./);
  await expect(page.getByTestId("core-cap")).toContainText("15\u00a0552\u00a0000 с = 180 дн.");
  await expect(page.locator("[data-screen]")).toContainText("фабрика развёртывания (CREATE2) по фиксированному адресу");
  await page.goto("/defaults");
  await toRussian(page);
  await lensOn(page);
  await expect(page.locator('[data-testid="defaults-row"][data-key="d26b"]')).toContainText("expiry = время блока + 30 дн.");
});
