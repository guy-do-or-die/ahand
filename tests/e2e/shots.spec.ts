/**
 * Screenshots for the experiment's evidence (PLAN wave 7, `evidence`): every screen of the app in
 * light and dark, English and Russian, at 390 and 1280 pixels; then the twist's back, the sweep's
 * end state after a real thanks, the passport (one of the routes) and the face's preview cards.
 *
 *   STAND_SLOT=0 bunx playwright test tests/e2e/shots.spec.ts
 *
 * Everything is taken from a built stand with seeded fixtures, nothing is drawn from mocks. The
 * language comes from the browser's locale (en-US or ru-RU) and the theme from its colour scheme,
 * the way a person's device sets them. Files land in tests/e2e/shots/<screen>/<lang>-<theme>-<width>.png
 * and are overwritten on each run. This file asserts only that each screen showed its main region
 * (or its own marker) before the picture was taken; the guards and smokes judge the content.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { account, pickDevAccount } from "./lib/accounts";
import { fixtureOf, quiet, seedFixtures, visit, type SeedRun } from "./guards/lib/guard";
import { lensOn } from "./lib/lens";
import { readStand, seed, standSlot } from "./lib/stand";

const stand = readStand();
const OUT = join(import.meta.dirname, "shots");
const WIDTHS = [390, 1280] as const;
const THEMES = ["light", "dark"] as const;
const LANGS = [
  { id: "en", locale: "en-US" },
  { id: "ru", locale: "ru-RU" },
] as const;

type Theme = (typeof THEMES)[number];
type Lang = (typeof LANGS)[number];

test.describe.configure({ mode: "serial" });

let run: SeedRun;

test.beforeAll(() => {
  run = seedFixtures(["unlisted", "thanked", "expired", "give", "twoPasses"]);
});

interface Shot {
  /** The folder under tests/e2e/shots. */
  slug: string;
  /** Brings the page to the screen and waits until it is the screen a person reads. */
  go(page: Page): Promise<void>;
  /** The shell's main region by default; exit.html has its own page. */
  ready?: (page: Page) => Promise<void>;
}

const at = (path: string) => async (page: Page) => {
  await page.goto(path, { waitUntil: "networkidle" });
};

const SCREENS: Shot[] = [
  { slug: "landing", go: at("/") },
  { slug: "hand-open", go: (page) => visit(page, fixtureOf(run, "unlisted").address) },
  { slug: "hand-thanked", go: (page) => visit(page, fixtureOf(run, "thanked").address) },
  { slug: "hand-times-up", go: (page) => visit(page, fixtureOf(run, "expired").address) },
  { slug: "hand-give-link", go: (page) => visit(page, fixtureOf(run, "give").giveAddress!) },
  { slug: "hand-public-no-link", go: (page) => at(`/${run.chainId}/${fixtureOf(run, "thanked").handId}`)(page) },
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
    go: async (page) => {
      await visit(page, fixtureOf(run, "unlisted").address);
      await page.getByTestId("hand-help").click();
      await expect(page.getByTestId("give-words")).toBeVisible({ timeout: 20_000 });
    },
  },
  { slug: "raise", go: at("/raise") },
  { slug: "my", go: at("/my") },
  { slug: "my-hand", go: (page) => at(`/my/${run.chainId}/${fixtureOf(run, "unlisted").handId}`)(page) },
  { slug: "thank-empty", go: at("/thank") },
  {
    slug: "thank-answer",
    go: async (page) => {
      await page.goto("/thank");
      await page.getByTestId("thank-input").fill(fixtureOf(run, "give").giveAddress!);
      await page.getByTestId("thank-open").click();
      await expect(page.getByTestId("thank-predicted")).toBeVisible({ timeout: 20_000 });
    },
  },
  { slug: "waiting", go: at(`/waiting?for=${account(2).address}`) },
  { slug: "care", go: (page) => at(`/care/${run.chainId}/${fixtureOf(run, "unlisted").handId}`)(page) },
  { slug: "print", go: at("/print") },
  {
    slug: "passport",
    go: async (page) => {
      await page.goto(`/${run.chainId}/${fixtureOf(run, "thanked").handId}/proof`, { waitUntil: "networkidle" });
    },
  },
  { slug: "check", go: at("/check") },
  { slug: "core", go: at("/core") },
  { slug: "defaults", go: at("/defaults") },
  { slug: "without-us", go: at("/without-us") },
  { slug: "dev-wallet", go: at("/dev/wallet") },
  { slug: "not-found", go: at("/no/such/place") },
  {
    slug: "exit-page",
    go: at("/exit.html"),
    ready: async (page) => {
      await expect(page.locator("body")).not.toBeEmpty();
    },
  },
];

async function person(browser: Browser, width: number, theme: Theme, lang: Lang) {
  const context = await browser.newContext({
    viewport: { width, height: width < 768 ? 844 : 800 },
    colorScheme: theme,
    locale: lang.locale,
    reducedMotion: "reduce",
    ...(width < 768 ? { hasTouch: true, isMobile: true } : {}),
  });
  await quiet(context, stand.site!);
  return { context, page: await context.newPage() };
}

function fileOf(slug: string, lang: Lang, theme: Theme, width: number): string {
  const dir = join(OUT, slug);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${lang.id}-${theme}-${width}.png`);
}

async function settle(page: Page, ready?: Shot["ready"]): Promise<void> {
  if (ready) await ready(page);
  else await expect(page.getByTestId("shell-main")).toBeVisible({ timeout: 20_000 });
  // The first block arrives and skeletons settle, as the a11y guard waits.
  await page.waitForTimeout(1_200);
}

for (const shot of SCREENS) {
  test(`every screen: ${shot.slug}`, async ({ browser }) => {
    test.setTimeout(240_000);
    for (const width of WIDTHS)
      for (const theme of THEMES)
        for (const lang of LANGS) {
          const { context, page } = await person(browser, width, theme, lang);
          try {
            await shot.go(page);
            await settle(page, shot.ready);
            await page.screenshot({ path: fileOf(shot.slug, lang, theme, width), fullPage: true, animations: "disabled" });
          } finally {
            await context.close();
          }
        }
  });
}

test("the flip's back: a pass on a two-pass Hand, turned over, with Core's answer", async ({ browser }) => {
  test.setTimeout(240_000);
  const two = fixtureOf(run, "twoPasses");
  for (const width of WIDTHS)
    for (const theme of THEMES)
      for (const lang of LANGS) {
        const { context, page } = await person(browser, width, theme, lang);
        try {
          await visit(page, two.address);
          // The twist is proof: hands turn over only under the lens.
          await lensOn(page);
          const rail = page.getByTestId("hand-rail");
          await expect(rail.locator("[data-flippable]")).toHaveAttribute("data-flippable", "true", { timeout: 15_000 });
          const card = rail.getByTestId("twist-flip").nth(1);
          await card.getByTestId("twist-flip-front").click();
          await expect(card).toHaveAttribute("data-flipped", "true");
          await expect(card.getByTestId("twist-core")).toHaveAttribute("data-status", "ok", { timeout: 15_000 });
          await page.waitForTimeout(400);
          await card.scrollIntoViewIfNeeded();
          await page.screenshot({ path: fileOf("flip-back", lang, theme, width), fullPage: true, animations: "disabled" });
        } finally {
          await context.close();
        }
      }
});

/**
 * The sweep's end state after a real thanks: a fresh `give` fixture is thanked by dev account 1
 * on /thank, and the picture is taken once every receipt row was found in the chain's logs.
 */
for (const [width, theme, lang] of [
  [390, "light", LANGS[0]],
  [1280, "dark", LANGS[1]],
] as const) {
  test(`the sweep's end state after a real thanks (${lang.id}, ${theme}, ${width})`, async ({ browser }) => {
    test.setTimeout(180_000);
    const fresh = seed<SeedRun>(standSlot(), ["give"]);
    const { context, page } = await person(browser, width, theme, lang);
    try {
      await page.goto("/thank");
      await page.getByTestId("thank-input").fill(fixtureOf(fresh, "give").giveAddress!);
      await page.getByTestId("thank-open").click();
      await expect(page.getByTestId("thank-predicted")).toBeVisible({ timeout: 20_000 });
      await pickDevAccount(page, 1);
      await expect(page.getByTestId("wallet-connected")).toHaveAttribute("data-value", account(1).address);
      await expect(page.getByTestId("thank-swipe")).toBeEnabled({ timeout: 20_000 });
      await page.getByTestId("thank-swipe").click();
      await expect(page.getByTestId("thank-done")).toBeVisible({ timeout: 45_000 });
      await expect(page.getByTestId("thank-receipt")).not.toHaveAttribute("data-landed", /false|^$/, { timeout: 15_000 });
      const table = page.getByTestId("thank-receipt").locator("table");
      await expect(table).toHaveAttribute("data-sweep", /^(\d+)\/\1$/, { timeout: 15_000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: fileOf("sweep-end", lang, theme, width), fullPage: true, animations: "disabled" });
    } finally {
      await context.close();
    }
  });
}

test("the preview cards: face's 1200×630 PNG for an unlisted Hand, and the generic card", async ({ request }) => {
  const unlisted = new URL(fixtureOf(run, "unlisted").address);
  for (const lang of LANGS)
    for (const theme of THEMES) {
      const query = new URLSearchParams(unlisted.search);
      query.set("l", lang.id);
      if (theme === "dark") query.set("th", "d");
      const answer = await request.get(`/og${unlisted.pathname}.png?${query}`);
      expect(answer.status()).toBe(200);
      expect(answer.headers()["content-type"]).toBe("image/png");
      writeFileSync(fileOf("preview-card", lang, theme, 1200), await answer.body());
    }
  const generic = await request.get("/og/generic.png");
  expect(generic.status()).toBe(200);
  writeFileSync(fileOf("preview-card-generic", LANGS[0], "light", 1200), await generic.body());
});
