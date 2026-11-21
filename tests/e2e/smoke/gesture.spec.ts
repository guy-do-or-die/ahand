/**
 * The gesture emoji move (fixed on 2026-11-21 after the owner reported that they had stopped;
 * UX-SPEC §2: the gesture on the main action and in the hero idles, reduced motion stops
 * everything). Each place
 * where a gesture is the hero of the moment is read in a real browser: the computed
 * animation-name is that gesture's own keyframes, the emoji's transform really changes over
 * time, and under emulated reduced motion the animation is "none".
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
  const first = await transformOf(emoji);
  // A loop is 3–4 s: a quarter of it apart, the two looks cannot be the same pose twice over.
  await page.waitForTimeout(900);
  const second = await transformOf(emoji);
  await page.waitForTimeout(900);
  await frame(page, emoji, `${name}-2`);
  const third = await transformOf(emoji);
  expect(first === second && second === third, `${name}: transform ${first} did not change`).toBe(false);
}

/** Under reduced motion the same emoji does not move at all. */
async function expectStillWhenAsked(page: Page, emoji: Locator): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await animationOf(emoji)).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

test("landing: the big hand, the raise button and each gesture card move their own way", async ({ browser }) => {
  const page = await fresh(browser, "/");
  const hero = page.locator('[data-screen="landing"] header [data-gesture]');
  await expectMoving(page, hero, "raise", "landing-hero-raise");
  await expectMoving(page, page.getByTestId("landing-raise").locator("[data-gesture]"), "raise", "landing-swipe-raise");
  const cards: [string, Kind][] = [
    ["raise", "raise"],
    ["pass", "shake"],
    ["thank", "bow"],
  ];
  for (const [card, kind] of cards) {
    await expectMoving(page, page.locator(`[data-testid="landing-gesture"][data-value="${card}"] [data-gesture]`), kind, `landing-card-${kind}`);
  }
  await expectStillWhenAsked(page, hero);
  await page.context().close();
});

test("an open Hand: the Deal card's hand rises, pass on shakes, help cheers; a thanked Hand's hand rests", async ({ browser }) => {
  const page = await fresh(browser, run.fixtures.public!.address);
  const hand = page.getByTestId("hand-deal-card").locator("[data-gesture]").first();
  await expectMoving(page, hand, "raise", "hand-deal-raise");
  await expectMoving(page, page.getByTestId("hand-pass").first().locator("[data-gesture]"), "shake", "hand-pass-shake");
  await expectMoving(page, page.getByTestId("hand-help").first().locator("[data-gesture]"), "cheer", "hand-help-cheer");
  await expectStillWhenAsked(page, hand);

  await page.goto(run.fixtures.thanked!.address);
  const rested = page.getByTestId("hand-deal-card").locator("[data-gesture]").first();
  await expect(page.getByTestId("hand-deal-card")).toHaveAttribute("data-state", "thanked", { timeout: 30_000 });
  expect(await animationOf(rested)).toBe("none");
  await page.context().close();
});

test("raise: the swipe's hand rises, and so does the one on 'Your hand is up.'", async ({ browser }) => {
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
