/**
 * The calm view and the lens (since 2026-11-21): ordinary people see plain sentences,
 * amounts, dates and the actions; whoever wants to check turns the lens on with the switch
 * beside the theme switch (or the `?` key) and sees every piece of evidence where it was.
 *
 *   STAND_SLOT=0 bunx playwright test tests/e2e/smoke/lens.spec.ts
 *
 * The kit's half (each component in both views) is apps/web/src/ui/lens.test.tsx.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { fixtureOf, quiet, seedFixtures, visit, type SeedRun } from "../guards/lib/guard";
import { lensOn } from "../lib/lens";
import { readStand } from "../lib/stand";

const stand = readStand();
let run: SeedRun;

test.beforeAll(() => {
  run = seedFixtures(["unlisted", "thanked"]);
});

test.beforeEach(async ({ context }) => {
  await quiet(context, stand.site!);
});

/** Short addresses as the kit writes them: 0x and four, an ellipsis, four. */
const SHORT = /0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}/;
/** What only the lens may show on a Hand's screen. */
const EVIDENCE = [/On chain/i, /hands\(\d+\)/, /\bblock \d/i, /What this link proves/i, /Checked here/i, SHORT];

async function mainText(page: Page): Promise<string> {
  return page.getByTestId("shell-main").innerText();
}

test("a Hand opens calm: plain words and the actions, none of the chain's machinery", async ({ page }) => {
  await visit(page, fixtureOf(run, "unlisted").address);
  await expect(page.locator("html")).not.toHaveAttribute("data-lens", "on");
  await expect(page.getByTestId("hand-pass")).toBeVisible();
  await expect(page.getByTestId("hand-help")).toBeVisible();
  // Safety stays: the test-money ribbon and the warning that the asker's words are not checked.
  await expect(page.getByTestId("shell-ribbon")).toBeVisible();
  await expect(page.getByTestId("kit-deal-words-label")).toBeVisible();
  const text = await mainText(page);
  expect(text).toContain("$50");
  expect(text).toMatch(/Asked by\s+someone/);
  for (const evidence of EVIDENCE) expect(text).not.toMatch(evidence);
  // The rail names people in words and nothing on it turns over.
  await expect(page.getByTestId("twist-flip")).toHaveCount(0);
  // The footer has no Core line and none of the old "Unaudited · No owner · No fee" (removed by
  // the change of 2026-11-21).
  // "Unaudited" is said in full on /core.
  await expect(page.getByTestId("shell-footer-core")).toHaveCount(0);
  await expect(page.getByTestId("shell-footer")).not.toContainText(/unaudited|no owner|no fee|0x/i);
});

test("the lens switch stands beside the theme switch, drawn alike (a bare glyph, no word), and names what it does", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const lens = page.getByTestId("shell-lens");
  const theme = page.getByTestId("shell-theme").getByRole("button");
  await expect(page.getByTestId("shell-header").getByTestId("shell-lens")).toHaveCount(0);
  await expect(page.getByTestId("shell-footer").getByTestId("shell-lens")).toBeVisible();
  await expect(lens).toHaveAccessibleName("Show the proof");
  await expect(lens).toHaveAttribute("aria-pressed", "false");
  await expect(lens).toHaveAttribute("aria-keyshortcuts", "?");
  await expect(lens).toHaveAttribute("title", /\?/);
  // Since 2026-11-21: the lens switch is a bare glyph, drawn like the theme switch.
  expect((await lens.innerText()).trim()).toBe("");
  const look = (button: typeof lens) =>
    button.evaluate((node) => {
      const css = getComputedStyle(node);
      return { border: css.borderTopWidth, background: css.backgroundColor, padding: css.paddingLeft, color: css.color, cursor: css.cursor };
    });
  expect(await look(lens)).toEqual(await look(theme));
  // Off, the magnifier's lens is an outline; on, it is filled: a change of shape, not only of colour.
  await expect(lens.locator("circle")).toHaveAttribute("fill", "none");
  const [a, b] = [await lens.boundingBox(), await theme.boundingBox()];
  expect(a && b).toBeTruthy();
  expect(Math.round(a!.height)).toBe(Math.round(b!.height));
  expect(Math.round(a!.width)).toBe(Math.round(b!.width));
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  expect(Math.abs(a!.x + a!.width - b!.x)).toBeLessThan(12);
});

test("the lens shows the evidence where it stood, stays on after a reload, and ? turns it off", async ({ page }) => {
  await visit(page, fixtureOf(run, "unlisted").address);
  await page.getByTestId("shell-lens").click();
  await expect(page.locator("html")).toHaveAttribute("data-lens", "on");
  await expect(page.getByTestId("shell-lens")).toHaveAttribute("aria-pressed", "true");
  const text = await mainText(page);
  expect(text).toMatch(/hands\(\d+\)\.reward = /);
  expect(text).toMatch(/On chain/i);
  expect(text).toMatch(SHORT);
  await expect(page.getByTestId("shell-lens").locator("circle")).toHaveAttribute("fill", "currentColor");
  // Under the lens the footer keeps one quiet line: Core's short address, linking to /core.
  const core = page.getByTestId("shell-footer-core");
  await expect(core).toHaveText(new RegExp(`^core ${SHORT.source}$`, "i"));
  await expect(core).toHaveAttribute("href", "/core");
  await expect(page.getByTestId("shell-footer")).not.toContainText(/unaudited|no owner|no fee/i);
  await expect(page.getByTestId("twist-flip").first()).toBeVisible();

  // Kept on this device: the next page opens with the lens on.
  await page.goto("/raise", { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-lens", "on");

  // Out of any field first: "?" typed into a field is a character, not the switch.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("?");
  await expect(page.locator("html")).not.toHaveAttribute("data-lens", "on");
  await expect(page.getByTestId("shell-lens")).toHaveAttribute("aria-pressed", "false");
});

test("a closed Hand's receipt says who got what in words; the lens adds the addresses and the proof", async ({ page }) => {
  await visit(page, fixtureOf(run, "thanked").address);
  const closed = page.getByTestId("hand-closed");
  await expect(closed.locator("table")).toBeVisible({ timeout: 20_000 });
  await expect(closed).toContainText("$38.00");
  await expect(closed).not.toContainText(SHORT);
  await expect(page.getByTestId("hand-proof-link")).toHaveCount(0);
  await expect(page.getByTestId("hand-newer-count")).toHaveCount(0);
  await lensOn(page);
  await expect(closed).toContainText(SHORT);
  await expect(page.getByTestId("hand-proof-link").first()).toBeVisible();
  await expect(page.getByTestId("hand-newer-count")).toBeVisible();
});

test("in Russian the switch says what it shows, and the footer carries none of the old line", async ({ browser }) => {
  const context = await browser.newContext({ locale: "ru-RU" });
  try {
    await quiet(context, stand.site!);
    const page = await context.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByTestId("shell-lens")).toHaveAccessibleName("Показать доказательства");
    expect((await page.getByTestId("shell-lens").innerText()).trim()).toBe("");
    await expect(page.getByTestId("shell-footer-core")).toHaveCount(0);
    await expect(page.getByTestId("shell-footer")).not.toContainText(/без аудита|без владельца|без комиссии/i);
  } finally {
    await context.close();
  }
});

test("both views of a Hand pass axe (WCAG 2.2 AA): no serious or critical violation", async ({ page }) => {
  await visit(page, fixtureOf(run, "unlisted").address);
  for (const view of ["calm", "lens"] as const) {
    if (view === "lens") await lensOn(page);
    await page.waitForTimeout(800);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const grave = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${view}: ${v.id} at ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(grave).toEqual([]);
  }
});
