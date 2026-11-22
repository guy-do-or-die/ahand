/**
 * Screenshots of /waiting for people to look at (not a test): English and Russian, at phone
 * width 390 px and at 1280 px, plus the phone in the dark theme, in the states the smoke drives.
 * Needs fresh fixtures first (a slot's stand, or a helper chain's stand file):
 *
 *   bun infra/stand/seed.ts --slot 6 --json --only blocked > /tmp/seed.json
 *   bun tests/e2e/lib/feat-waiting/pending.ts --payee-account 2 --slot 6
 *   bun tests/e2e/lib/feat-waiting/shots.ts --slot 6 --payee 0x… --out DIR [--site http://127.0.0.1:PORT]
 *
 * `--payee` is the blocked payee (still blocked). Account 2's own pending is shown connected.
 * `--site` names the site when the stand file has none (a helper chain with a dev server).
 * Nothing is sent: the shots stop before any button that moves money.
 *
 * In every state it also checks three things and fails at the end if one does not hold: the page
 * is no wider than the window, axe finds no serious or critical WCAG 2.2 AA violation, and after
 * "Connect a wallet" was opened from the row's Deliver the focus is back in the row.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { chromium, type Page } from "@playwright/test";

import { flagValue } from "../../../../infra/stand/seed.ts";
import { readStand } from "../stand";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

async function connect(page: Page, which: number): Promise<void> {
  await page.getByTestId("connect-wallet").first().click();
  await page.getByTestId(`dev-account-${which}`).click();
  await page.getByTestId("wallet-connected").waitFor();
}

async function main(argv: string[]): Promise<void> {
  const slot = Number(flagValue(argv, "--slot") ?? process.env.STAND_SLOT ?? "6");
  const payee = flagValue(argv, "--payee");
  const out = flagValue(argv, "--out");
  if (!payee || !out) throw new Error("--payee and --out are needed");
  mkdirSync(out, { recursive: true });
  const site = flagValue(argv, "--site") ?? readStand(slot).site;
  if (!site) throw new Error("the stand names no site: pass --site");
  const problems: string[] = [];
  const browser = await chromium.launch();
  try {
    const looks = [
      ...(["en", "ru"] as const).flatMap((lang) => [390, 1280].map((width) => ({ lang, width, scheme: "light" as const }))),
      { lang: "en" as const, width: 390, scheme: "dark" as const },
    ];
    for (const { lang, width, scheme } of looks) {
      const context = await browser.newContext({
        locale: lang === "en" ? "en-GB" : "ru-RU",
        colorScheme: scheme,
        viewport: { width, height: width === 390 ? 844 : 900 },
        deviceScaleFactor: width === 390 ? 2 : 1,
      });
      const page = await context.newPage();
      const shot = async (name: string, options: { fullPage?: boolean } = {}) => {
        const id = `${name}-${lang}-${width}${scheme === "dark" ? "-dark" : ""}`;
        await page.waitForTimeout(1500);
        await page.screenshot({ path: join(out, `${id}.png`), fullPage: options.fullPage ?? true });
        const wide = await page.evaluate(() => {
          const over = Array.from(document.querySelectorAll("body *")).filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5);
          return { by: document.documentElement.scrollWidth - window.innerWidth, what: over.slice(-4).map((el) => `${el.tagName}.${el.className}: ${(el.textContent ?? "").slice(0, 40)}`) };
        });
        if (wide.by > 0) problems.push(`${id}: the page is ${wide.by} px wider than the window (${wide.what.join(" | ")})`);
        const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        for (const v of axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")) {
          problems.push(`${id}: axe ${v.impact} ${v.id} (${v.help}) at ${v.nodes.map((node) => node.target.join(" ")).join(", ")}`);
        }
      };
      await page.goto(`${site}/waiting`);
      await page.locator('[data-screen="waiting"]').waitFor();
      await shot("1-start");

      // A visitor: Deliver is on the row, with the line that says what its press asks for.
      await page.goto(`${site}/waiting?for=${payee}`);
      await page.getByTestId("waiting-safe").waitFor();
      await page.getByTestId("waiting-deliver").waitFor();
      await shot("2-visitor");
      // The press sends nothing: it opens "Connect a wallet".
      await page.getByTestId("waiting-deliver").click();
      await page.getByTestId("kit-connect-sheet").waitFor();
      await shot("3-visitor-pressed-deliver", { fullPage: false });
      await page.getByTestId("kit-connect-sheet").getByTestId("dev-account-5").click();
      await page.getByTestId("kit-connect-sheet").waitFor({ state: "detached" });
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        return el?.closest('[data-testid="waiting-row"]') ? "the row" : (el?.tagName ?? "nothing");
      });
      if (focused !== "the row") problems.push(`${lang}-${width}: after connecting from Deliver the focus is on ${focused}, not back in the row`);
      // The payee is still blocked: the plain sentence, and the token's answer one tap below it.
      await page.getByTestId("waiting-error").first().waitFor();
      await shot("4-blocked-after-connecting");
      await page.getByTestId("waiting-error").first().getByRole("button").click();
      await shot("5-blocked-token-said-open");
      await page.getByTestId("waiting-error").first().getByRole("button").click();
      await page.locator("h1").click();
      await page.keyboard.press("?");
      await shot("6-blocked-lens");
      await page.keyboard.press("?");

      await page.goto(`${site}/waiting`);
      await connect(page, 2);
      await page.getByTestId("waiting-take-out").waitFor();
      await page.getByRole("radio").nth(1).click();
      await page.getByTestId("waiting-take-out-to").locator("textarea").fill("0xa0Ee7A142d267C1f36714E4a8F75612F20a79720");
      await page.getByTestId("kit-cost-line").waitFor();
      await shot("7-payee-take-out-elsewhere");
      await page.locator("h1").click(); // out of the field, so "?" opens the lens instead of being typed
      await page.keyboard.press("?");
      await shot("8-payee-lens");
      await context.close();
    }
  } finally {
    await browser.close();
  }
  if (problems.length > 0) throw new Error(`\n${problems.join("\n")}`);
}

main(process.argv.slice(2)).then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`shots: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
