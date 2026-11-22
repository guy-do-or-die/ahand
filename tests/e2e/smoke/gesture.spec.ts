/**
 * The gesture emoji move (fixed on 2026-11-21 after they were seen to have stopped; the gesture
 * on the main action and in the hero moves, reduced motion stops everything). Each gesture makes
 * its own move once in a round of five seconds and then rests, and gestures that share a screen
 * take turns. Each place where a gesture is the hero of the moment is read in a real browser: the
 * computed animation-name is that gesture's own keyframes, the emoji's transform really changes
 * within one round, and under emulated reduced motion the animation is "none".
 *
 *   STAND_SLOT=2 bunx playwright test tests/e2e/smoke/gesture.spec.ts
 *
 * With GESTURE_SHOTS_DIR set, two frames of each emoji (half a loop apart) are kept there.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

import { account, pickDevAccount } from "../lib/accounts";
import { answerPrompts, compose } from "../lib/feat-raise/raise";
import { quietDevServer } from "../lib/feat-hand/helpers";
import { passedAndGiven } from "../lib/feat-thank/fixtures";
import { readStand, seed, standSlot } from "../lib/stand";

test.describe.configure({ mode: "serial" });

const KEYFRAMES = { raise: "ah-raise", shake: "ah-shake", cheer: "ah-cheer", bow: "ah-bow" } as const;
type Kind = keyof typeof KEYFRAMES;

interface SeedRun {
  fixtures: Record<string, { address: string }>;
}

const stand = readStand();
let run: SeedRun;

test.beforeAll(() => {
  run = seed<SeedRun>(standSlot(), ["public", "thanked"]);
});

async function fresh(browser: Browser, path: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  if (stand.mode === "dev") await quietDevServer(context, stand.site!);
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(path);
  return page;
}

const animationOf = (emoji: Locator) => emoji.evaluate((element) => getComputedStyle(element).animationName);
const transformOf = (emoji: Locator) => emoji.evaluate((element) => getComputedStyle(element).transform);

/** With GESTURE_SHOTS_DIR set: a frame of the emoji and the space it swings in. */
async function frame(page: Page, emoji: Locator, name: string): Promise<void> {
  const dir = process.env.GESTURE_SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const box = (await emoji.boundingBox())!;
  const pad = Math.round(box.height * 0.35);
  await page.screenshot({ path: join(dir, `${name}.png`), clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + 2 * pad, height: box.height + 2 * pad } });
}

/** The emoji idles with `kind`'s keyframes and its transform changes between two looks. */
async function expectMoving(page: Page, emoji: Locator, kind: Kind, name: string): Promise<void> {
  await expect(emoji).toBeVisible({ timeout: 30_000 });
  await expect(emoji).toHaveAttribute("data-gesture", kind);
  // A moving element is never "stable", so Playwright's own scrolling would wait for ever.
  await emoji.evaluate((element) => element.scrollIntoView({ block: "center" }));
  expect(await animationOf(emoji)).toBe(KEYFRAMES[kind]);
  await frame(page, emoji, `${name}-1`);
  // A round is 5 s with about one second of movement in it: looked at every 100 ms for a round
  // and a half, the emoji is seen both at rest and away from it.
  const poses = new Set<string>();
  for (let look = 0; look < 75 && poses.size < 2; look++) {
    poses.add(await transformOf(emoji));
    await page.waitForTimeout(100);
  }
  await frame(page, emoji, `${name}-2`);
  expect(poses.size, `${name}: the transform never changed from ${[...poses][0]}`).toBeGreaterThan(1);
}

/** The Deal card's hand greets once: its own keyframes, one iteration, then it rests. */
async function expectGreetsOnce(emoji: Locator): Promise<void> {
  await expect(emoji).toBeVisible({ timeout: 30_000 });
  await expect(emoji).toHaveAttribute("data-gesture", "raise");
  expect(await emoji.evaluate((element) => [getComputedStyle(element).animationName, getComputedStyle(element).animationIterationCount])).toEqual(["ah-raise", "1"]);
}

/** Two gestures on one screen take different turns in the round. */
async function expectTurns(first: Locator, second: Locator): Promise<void> {
  const turn = (emoji: Locator) => emoji.evaluate((element) => getComputedStyle(element).animationDelay);
  expect(await turn(first)).not.toBe(await turn(second));
}

/** Under reduced motion the same emoji does not move at all. */
async function expectStillWhenAsked(page: Page, emoji: Locator): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await animationOf(emoji)).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

test("landing: the raise button and each gesture card move their own way, and no third raised hand stands over the headline", async ({ browser }) => {
  const page = await fresh(browser, "/");
  const hero = page.getByTestId("landing-raise").locator("[data-gesture]");
  await expect(page.locator('[data-screen="landing"] header [data-gesture]')).toHaveCount(0);
  // The raised hand stands on the action and on the first card; the example Hand has the card's own small mark, which stands still.
  await expect(page.locator('[data-screen="landing"] [data-gesture="raise"]').filter({ visible: true })).toHaveCount(3);
  const example = page.getByTestId("landing-sample").locator('[data-testid="landing-example"][data-current="true"]');
  await expect(example.locator('[data-gesture="raise"]')).toHaveCount(1);
  expect(await example.locator("[data-gesture]").evaluateAll((marks) => marks.map((mark) => getComputedStyle(mark).animationName))).toEqual(["none", "none"]);
  // The example the page opens with stands still (the hand of one that arrives later greets once: about.spec.ts). Those out of turn lie under it unseen, and none of their marks moves either.
  expect(new Set(await page.getByTestId("landing-sample").locator("[data-gesture]").evaluateAll((marks) => marks.map((mark) => getComputedStyle(mark).animationName)))).toEqual(new Set(["none"]));
  await expectMoving(page, hero, "raise", "landing-swipe-raise");
  const cards: [string, Kind][] = [
    ["raise", "raise"],
    ["pass", "shake"],
    ["help", "cheer"],
    ["thank", "bow"],
  ];
  for (const [card, kind] of cards) {
    await expectMoving(page, page.locator(`[data-testid="landing-gesture"][data-value="${card}"] [data-gesture]`), kind, `landing-card-${kind}`);
  }
  await expectStillWhenAsked(page, hero);
  await page.context().close();
});

test("an open Hand: the Deal card's hand greets once, pass on shakes and help cheers in turn; a thanked Hand's hand rests", async ({ browser }) => {
  const page = await fresh(browser, run.fixtures.public!.address);
  const hand = page.getByTestId("hand-deal-card").locator("[data-gesture]").first();
  await expectGreetsOnce(hand);
  const pass = page.getByTestId("hand-pass").first().locator("[data-gesture]");
  const help = page.getByTestId("hand-help").first().locator("[data-gesture]");
  await expectMoving(page, pass, "shake", "hand-pass-shake");
  await expectMoving(page, help, "cheer", "hand-help-cheer");
  await expectTurns(pass, help);
  await expectStillWhenAsked(page, hand);

  await page.goto(run.fixtures.thanked!.address);
  const rested = page.getByTestId("hand-deal-card").locator("[data-gesture]").first();
  await expect(page.getByTestId("hand-deal-card")).toHaveAttribute("data-state", "thanked", { timeout: 30_000 });
  expect(await animationOf(rested)).toBe("none");
  await page.context().close();
});

test("the swipe button answers with its tone: a step under the pointer, deeper at once under a press, the button giving a little; a tap's press stays shown", async ({ browser }) => {
  // A pointer that can hover: the project's own context is a phone, where nothing is "under the pointer".
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false, deviceScaleFactor: 1 });
  if (stand.mode === "dev") await quietDevServer(context, stand.site!);
  const page = await context.newPage();
  await page.goto(run.fixtures.public!.address);
  const help = page.getByTestId("hand-help").first();
  await expect(help).toBeVisible({ timeout: 30_000 });
  const fill = () => help.evaluate((button) => getComputedStyle(button, "::before").backgroundColor);
  // The fill is a layer under a mask (the fade), not a gradient on the button itself.
  expect(await help.evaluate((button) => getComputedStyle(button).backgroundImage)).toBe("none");
  expect(await help.evaluate((button) => getComputedStyle(button, "::before").maskImage || getComputedStyle(button, "::before").webkitMaskImage)).toContain("linear-gradient");
  expect(await fill()).toBe("rgb(245, 184, 65)");

  await help.hover();
  await expect.poll(fill).toBe("rgb(255, 201, 92)");
  await page.mouse.down();
  await expect.poll(fill).toBe("rgb(226, 165, 43)");
  await expect(help).toHaveAttribute("data-pressed", "");
  await expect.poll(() => help.evaluate((button) => getComputedStyle(button).transform)).toBe("matrix(0.98, 0, 0, 0.98, 0, 0)");
  // Let go away from the button, so nothing is opened.
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await expect(help).not.toHaveAttribute("data-pressed", "");
  await expect.poll(fill).toBe("rgb(245, 184, 65)");

  // A finger's tap is over in a frame or two: the press is still shown after it, then let go.
  const stillPressed = await help.evaluate((button) => {
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
    button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" }));
    return new Promise<boolean>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(button.hasAttribute("data-pressed")))));
  });
  expect(stillPressed).toBe(true);
  await expect(help).not.toHaveAttribute("data-pressed", "");
  await expect(page).not.toHaveURL(/\/give/);
  await context.close();
});

test("raise: the swipe's hand rises, and so does the one on 'Your hand is up'", async ({ browser }) => {
  const page = await fresh(browser, "/raise");
  await expect(page.getByTestId("raise-what")).toBeVisible({ timeout: 20_000 });
  await compose(page, { title: `Gesture check ${Date.now() % 100000}`, reward: "5" });
  await expect(page.getByTestId("raise-swipe")).toBeEnabled({ timeout: 15_000 });
  await expectMoving(page, page.getByTestId("raise-swipe").locator("[data-gesture]"), "raise", "raise-swipe-raise");
  await page.getByTestId("raise-swipe").click();
  await answerPrompts(page, 1);
  const up = page.getByTestId("raise-up");
  await expect(up).toBeVisible({ timeout: 30_000 });
  await expectMoving(page, up.locator("h1 [data-gesture]"), "raise", "raise-up-raise");
  await page.context().close();
});

test("thank: the thank button bows, and so does the receipt's hand", async ({ browser }) => {
  const fixture = passedAndGiven({ reward: "6" });
  const page = await fresh(browser, "/thank");
  await page.getByTestId("thank-input").fill(fixture.given.address);
  await page.getByTestId("thank-open").click();
  await expect(page.getByTestId("thank-predicted")).toBeVisible({ timeout: 20_000 });
  await pickDevAccount(page, 1);
  await expect(page.getByTestId("wallet-connected")).toHaveAttribute("data-value", account(1).address);
  await expect(page.getByTestId("thank-swipe")).toBeEnabled({ timeout: 20_000 });
  await expectMoving(page, page.getByTestId("thank-swipe").locator("[data-gesture]"), "bow", "thank-swipe-bow");
  await page.getByTestId("thank-swipe").click();
  const done = page.getByTestId("thank-done");
  await expect(done).toBeVisible({ timeout: 45_000 });
  await expectMoving(page, done.locator("[data-gesture]").first(), "bow", "thank-done-bow");
  await expectStillWhenAsked(page, done.locator("[data-gesture]").first());
  await page.context().close();
});
