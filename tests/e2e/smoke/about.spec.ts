/**
 * The three pages that say what aHand is and is not (PLAN wave 5, about-pages): the landing and
 * its "Open a link" box against real seeded Hands on a real local chain, "What it can't promise"
 * and "About these defaults" in both languages, and axe on all three.
 *
 *   STAND_SLOT=6 bunx playwright test tests/e2e/smoke/about.spec.ts
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { digitsOf, quietDevServer, type SeedRun } from "../lib/about-pages/helpers";
import { readStand, seed } from "../lib/stand";

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
  await page.getByTestId("shell-lang-ru").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
}

async function paste(page: Page, text: string): Promise<void> {
  await page.getByTestId("landing-open-input").fill(text);
  await page.getByTestId("landing-open-submit").click();
}

test("the landing says what this is, turns each gesture over to Core's own call, and leads to the three ways in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("landing-hero")).toHaveText(/Raise a hand\.\s*Your people take it from there\./);
  const gestures = page.getByTestId("landing-gesture");
  await expect(gestures).toHaveCount(3);
  await expect(gestures.nth(0)).toHaveAttribute("data-value", "raise");

  const raise = gestures.nth(0);
  const front = raise.getByRole("button", { name: /Ask, and lock a reward/ });
  await expect(front).toHaveAttribute("aria-expanded", "false");
  await front.click();
  await expect(raise).toHaveAttribute("data-open", "true");
  await expect(raise.locator("pre")).toContainText("raise(token, reward, expiry, rootKey, payoutGasK, minClaimBps, dataHash)");
  await expect(gestures.nth(1).locator("pre")).toContainText("checkRoute(handId, signedShakes)");
  await expect(gestures.nth(2).locator("pre")).toContainText("thank(handId, signedShakes, signedGive, dataHash)");
  await raise.getByRole("button", { name: /Turn it back/ }).click();
  await expect(raise).toHaveAttribute("data-open", "false");

  await expect(page.getByTestId("landing-my")).toHaveAttribute("href", "/my");
  await expect(page.getByTestId("landing-without-us")).toHaveAttribute("href", "/without-us");
  await page.getByTestId("landing-raise").click();
  await expect(page).toHaveURL(/\/raise$/);

  await page.goto("/");
  await toRussian(page);
  await expect(page.getByTestId("landing-hero")).toHaveText(/Подними руку\.\s*Дальше — твои люди\./);
});

test("a seeded address pasted into “Open a link” opens the Hand view with its title; the link never enters the address bar", async ({ page }) => {
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
    "This address was made for ahand.elsewhere.example. The link opens anywhere; make sure you trust the site you're on.",
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

const TOKEN_EN = "If a token stops moving or changes its rules after a reward is locked, everything held in that token is stuck in the contract";
const USDC_EN = "USDC has an issuer. It can freeze any address, the contract's own included, or the whole token.";
const TOKEN_RU = "Если токен перестанет переводиться или сменит правила после того, как награда положена";
const USDC_RU = "У USDC есть эмитент. Он может заморозить любой адрес, в том числе сам контракт, или весь токен.";

test("“What it can't promise” has exactly sixteen entries in English and in Russian, from voluntary thanks to the unaudited sentence", async ({ page }) => {
  await page.goto("/limits");
  const entries = page.getByTestId("limits-entry");
  await expect(entries).toHaveCount(16);
  await expect(entries.first()).toContainText("Thanking is voluntary. The asker can get help and let the hand run out; the reward then goes back to them.");
  await expect(entries.last()).toContainText("Unaudited: seven AI reviews and one AI scan found no defect; no professional audit has been done.");
  await expect(page.getByTestId("limits-entry").filter({ hasText: TOKEN_EN })).toHaveCount(1);
  await expect(page.getByTestId("limits-entry").filter({ hasText: USDC_EN })).toHaveCount(1);
  for (let i = 0; i < 16; i++) await expect(entries.nth(i)).toHaveAttribute("data-index", String(i + 1));

  await toRussian(page);
  await expect(entries).toHaveCount(16);
  await expect(entries.first()).toContainText("Благодарить — по желанию.");
  await expect(entries.last()).toContainText("Без аудита");
  await expect(page.getByTestId("limits-entry").filter({ hasText: TOKEN_RU })).toHaveCount(1);
  await expect(page.getByTestId("limits-entry").filter({ hasText: USDC_RU })).toHaveCount(1);
});

test("“About these defaults” marks every row as not the project owner's, with its row number", async ({ page }) => {
  await page.goto("/defaults");
  const rows = page.getByTestId("defaults-row");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(12);
  for (let i = 0; i < count; i++) {
    await expect(rows.nth(i)).toContainText("Chosen for this experiment, not by the project's owner.");
    await expect(rows.nth(i)).toHaveAttribute("data-value", /^D-[0-9]+$/);
  }
  for (const number of ["D-21", "D-26", "D-32", "D-40", "D-49", "D-61", "D-62", "D-63", "D-66"]) {
    await expect(page.locator(`[data-testid="defaults-row"][data-value="${number}"]`).first()).toContainText(number);
  }
  await expect(rows.filter({ hasText: "The helper gets at least 70%." })).toHaveCount(1);
  await expect(rows.filter({ hasText: "A hand is open for 30 days." })).toHaveCount(1);
  await expect(rows.filter({ hasText: "payoutGasK = 250" })).toHaveCount(1);

  await toRussian(page);
  await expect(rows).toHaveCount(count);
  for (let i = 0; i < count; i++) await expect(rows.nth(i)).toContainText("Выбрано для этого эксперимента, а не владельцем проекта.");
  await expect(rows.filter({ hasText: "Рука открыта 30 дней." })).toHaveCount(1);
});

for (const path of ["/", "/limits", "/defaults"]) {
  for (const lang of ["en", "ru"] as const) {
    test(`axe finds no serious or critical issue on the ${path} screen (${lang})`, async ({ page }) => {
      await page.goto(path);
      if (lang === "ru") await toRussian(page);
      await expect(page.locator(`[data-screen]`).first()).toBeVisible();
      if (path === "/") await page.getByTestId("landing-gesture").nth(1).getByRole("button").first().click();
      // The screen itself; the shell's header and footer are the shell's own (see docs/build-notes/about-pages.md).
      const results = await new AxeBuilder({ page }).include("#main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
      const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });
  }
}
