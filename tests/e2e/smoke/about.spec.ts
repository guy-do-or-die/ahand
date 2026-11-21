/**
 * The three pages that say what aHand is and is not (PLAN wave 5, about-pages): the landing and
 * its "Got a link? Paste it" row against real seeded Hands on a real local chain, "What it can't
 * promise" and "About these defaults" in both languages, and axe on all three. The early review's
 * fixes are held here too: the gestures come before the paste row and each card front takes its
 * own height (F17), only an entry's first sentence is bold on /limits (F13), /without-us reads
 * whole (F9), and /core and /defaults write Russian numbers and units (F10, F16).
 *
 *   STAND_SLOT=6 bunx playwright test tests/e2e/smoke/about.spec.ts
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { digitsOf, quietDevServer, type SeedRun } from "../lib/about-pages/helpers";
import { lensOn } from "../lib/lens";
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
  await expect(gestures.nth(2).locator("pre")).toContainText("thank(handId, signedShakes, signedGive, dataHash)");
  await raise.getByRole("button", { name: /Turn it back/ }).click();
  await expect(raise).toHaveAttribute("data-open", "false");
  const front = raise.getByRole("button", { name: /Ask, and lock a reward/ });
  await expect(front).toHaveAttribute("aria-expanded", "false");
  await front.click();
  await expect(raise).toHaveAttribute("data-open", "true");

  await expect(page.getByTestId("landing-my")).toHaveAttribute("href", "/my");
  await expect(page.getByTestId("landing-without-us")).toHaveAttribute("href", "/without-us");
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
  // The row numbers and exact values are the record's, so they stand under the lens.
  await expect(page.getByTestId("defaults-row").first()).not.toContainText(/D-\d+/);
  await lensOn(page);
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
      // Under the lens the gesture cards stand turned to Core's calls, so axe reads their backs too.
      if (path === "/") await lensOn(page);
      // The screen itself; the shell's header and footer are the shell's own (see docs/build-notes/about-pages.md).
      const results = await new AxeBuilder({ page }).include("#main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
      const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });
  }
}

test("the landing shows the three gestures before the paste row, each card as tall as its own front, «твои люди» on one line (F17)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const gestures = page.getByTestId("landing-gesture");
  const input = page.getByTestId("landing-open-input");
  const first = (await gestures.first().boundingBox())!;
  expect((await input.boundingBox())!.y).toBeGreaterThan(((await gestures.last().boundingBox())!).y);
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

test("/limits sets only each entry's first sentence in bold (F13)", async ({ page }) => {
  await page.goto("/limits");
  const first = page.getByTestId("limits-entry").first();
  await expect(first.locator("strong")).toHaveText("Thanking is voluntary.");
  await toRussian(page);
  await expect(first.locator("strong")).toHaveText("Благодарить — по желанию.");
  await expect(first).toContainText("так и не сказать спасибо до конца срока");
  await expect(page.locator("h1")).toHaveText("Чего aHand не обещает.");
});

test("/without-us's refund line reads whole in both languages (F9)", async ({ page }) => {
  await page.goto("/without-us");
  await expect(page.locator("[data-screen]")).toContainText("Send it back. Anyone may, from the second the hand's end date passes.");
  await toRussian(page);
  await expect(page.locator("[data-screen]")).toContainText("Вернуть. Может кто угодно, начиная с секунды, когда наступил срок руки.");
  await expect(page.locator("[data-screen]")).not.toContainText("наступил expiry");
});

test("/core and /defaults write Russian numbers and units on the Russian page (F10)", async ({ page }) => {
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
