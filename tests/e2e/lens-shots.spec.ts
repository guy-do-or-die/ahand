/**
 * Screenshots of the calm view and the lens, side by side: each screen with the lens off (the
 * default, for ordinary people) and then with it on, on one page, at 1440 and 390 pixels.
 *
 *   STAND_SLOT=5 LENS_SHOTS=<folder> bunx playwright test tests/e2e/lens-shots.spec.ts
 *
 * LENS_SHOTS names the folder the pictures land in (as <screen>-<lang>-<width>-lens-<off|on>.png);
 * without it this file is skipped, so a plain `bun run e2e` does not take them. LENS_ONLY narrows
 * the run to a comma-separated list of screens, and LENS_LANGS to "en" or "ru". English is taken
 * for every screen, Russian for the screens a person meets on the way through one Hand. The
 * smokes and lens.spec.ts judge the content; this file only waits for each screen to settle.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { account, pickDevAccount } from "./lib/accounts";
import { fixtureOf, quiet, seedFixtures, visit, type SeedRun } from "./guards/lib/guard";
import { readStand, seed, standSlot } from "./lib/stand";

const OUT = process.env.LENS_SHOTS;
const ONLY = process.env.LENS_ONLY?.split(",").filter(Boolean);
const ONLY_LANGS = process.env.LENS_LANGS?.split(",").filter(Boolean);
const WIDTHS = [1440, 390] as const;
const LANGS = [
  { id: "en", locale: "en-US" },
  { id: "ru", locale: "ru-RU" },
] as const;
type Lang = (typeof LANGS)[number];

test.skip(!OUT, "LENS_SHOTS names no folder");
test.describe.configure({ mode: "serial" });

let run: SeedRun;

test.beforeAll(() => {
  if (!OUT) return;
  run = seedFixtures(["unlisted", "thanked", "expired", "give", "twoPasses"]);
});

interface Shot {
  slug: string;
  /** Whether Russian is taken too. */
  ru?: boolean;
  go(page: Page): Promise<void>;
}

const at = (path: string) => async (page: Page) => {
  await page.goto(path, { waitUntil: "networkidle" });
};

async function thanked(page: Page): Promise<void> {
  const fresh = seed<SeedRun>(standSlot(), ["give"]);
  await page.goto("/thank");
  await page.getByTestId("thank-input").fill(fixtureOf(fresh, "give").giveAddress!);
  await page.getByTestId("thank-open").click();
  await expect(page.getByTestId("thank-predicted")).toBeVisible({ timeout: 20_000 });
  await pickDevAccount(page, 1);
  await expect(page.getByTestId("thank-swipe")).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId("thank-swipe").click();
  await expect(page.getByTestId("thank-done")).toBeVisible({ timeout: 45_000 });
  const table = page.getByTestId("thank-receipt").locator("table");
  await expect(table).toHaveAttribute("data-sweep", /^(\d+)\/\1$/, { timeout: 20_000 });
}

const SCREENS: Shot[] = [
  { slug: "landing", ru: true, go: at("/") },
  { slug: "raise", ru: true, go: at("/raise") },
  { slug: "hand-open", ru: true, go: (page) => visit(page, fixtureOf(run, "unlisted").address) },
  { slug: "hand-two-passes", go: (page) => visit(page, fixtureOf(run, "twoPasses").address) },
  { slug: "hand-closed", ru: true, go: (page) => visit(page, fixtureOf(run, "thanked").address) },
  { slug: "hand-expired", go: (page) => visit(page, fixtureOf(run, "expired").address) },
  { slug: "hand-give-link", go: (page) => visit(page, fixtureOf(run, "give").giveAddress!) },
  {
    slug: "pass",
    go: async (page) => {
      await visit(page, fixtureOf(run, "unlisted").address);
      await page.getByTestId("hand-pass").click();
      await expect(page.getByTestId("pass-swipe")).toBeEnabled({ timeout: 20_000 });
    },
  },
  {
    slug: "give",
    ru: true,
    go: async (page) => {
      await visit(page, fixtureOf(run, "unlisted").address);
      await page.getByTestId("hand-help").click();
      await expect(page.getByTestId("give-words")).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    slug: "thank-predicted",
    go: async (page) => {
      await page.goto("/thank");
      await page.getByTestId("thank-input").fill(fixtureOf(run, "give").giveAddress!);
      await page.getByTestId("thank-open").click();
      await expect(page.getByTestId("thank-predicted")).toBeVisible({ timeout: 20_000 });
    },
  },
  { slug: "thank-receipt", ru: true, go: thanked },
  { slug: "my", go: at("/my") },
  { slug: "my-hand", go: (page) => at(`/my/${run.chainId}/${fixtureOf(run, "unlisted").handId}`)(page) },
  { slug: "waiting", go: at(`/waiting?for=${account(2).address}`) },
  { slug: "care", go: (page) => at(`/care/${run.chainId}/${fixtureOf(run, "unlisted").handId}`)(page) },
  { slug: "passport", go: (page) => at(`/${run.chainId}/${fixtureOf(run, "thanked").handId}/proof`)(page) },
  { slug: "check", go: at("/check") },
  { slug: "core", go: at("/core") },
  { slug: "defaults", go: at("/defaults") },
  { slug: "without-us", go: at("/without-us") },
  { slug: "print", go: at("/print") },
];

async function person(browser: Browser, width: number, lang: Lang) {
  const context = await browser.newContext({
    viewport: { width, height: width < 768 ? 844 : 900 },
    colorScheme: "light",
    locale: lang.locale,
    reducedMotion: "reduce",
    ...(width < 768 ? { hasTouch: true, isMobile: true } : {}),
  });
  await quiet(context, readStand().site!);
  return { context, page: await context.newPage() };
}

async function snap(page: Page, slug: string, lang: Lang, width: number, lens: "off" | "on"): Promise<void> {
  mkdirSync(OUT!, { recursive: true });
  await page.screenshot({ path: join(OUT!, `${slug}-${lang.id}-${width}-lens-${lens}.png`), fullPage: true, animations: "disabled" });
}

for (const shot of SCREENS) {
  if (ONLY && !ONLY.includes(shot.slug)) continue;
  test(`lens off and on: ${shot.slug}`, async ({ browser }) => {
    test.setTimeout(480_000);
    for (const lang of LANGS) {
      if (lang.id === "ru" && !shot.ru) continue;
      if (ONLY_LANGS && !ONLY_LANGS.includes(lang.id)) continue;
      for (const width of WIDTHS) {
        const { context, page } = await person(browser, width, lang);
        try {
          await shot.go(page);
          await expect(page.getByTestId("shell-main")).toBeVisible({ timeout: 20_000 });
          await page.waitForTimeout(1_500);
          await expect(page.locator("html")).not.toHaveAttribute("data-lens", "on");
          await snap(page, shot.slug, lang, width, "off");
          await page.getByTestId("shell-lens").click();
          await expect(page.locator("html")).toHaveAttribute("data-lens", "on");
          await page.waitForTimeout(600);
          await snap(page, shot.slug, lang, width, "on");
        } finally {
          await context.close();
        }
      }
    }
  });
}
