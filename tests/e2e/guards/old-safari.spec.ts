/**
 * A browser without color-mix() draws what every other browser draws. Safari before 16.2 has no
 * color-mix(), and phones still run it: where a see-through colour was made with it, the build
 * leaves the solid colour, so quiet text turns loud, a tone turns into a slab with its words
 * unreadable on it, and a button's fade into a hard edge.
 *
 *   STAND_SLOT=2 bunx playwright test tests/e2e/guards/old-safari.spec.ts
 *
 * The engine under test has color-mix(), so the page is opened twice: as served, and with every
 * color-mix( in its stylesheets made a function no browser knows, which is what such a Safari
 * makes of it. The two must compute the same colours, tones, lines and fades.
 *
 * The same Safari, up to 16.4, does not read a width condition written as a range
 * (`width>=1000px`) and drops the rule under it, so the served stylesheets must write every
 * condition the old way (`min-width`, `max-width`).
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

import { readStand } from "../lib/stand";
import { quiet } from "./lib/guard";

const stand = readStand();

async function open(browser: Browser, path: string, scheme: "light" | "dark", without: boolean): Promise<Page> {
  const context = await browser.newContext({ colorScheme: scheme });
  await quiet(context, stand.site!);
  if (without) {
    await context.route("**/*.css", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).split("color-mix(").join("no-such-function(") });
    });
  }
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

/** What each named thing computes to: its colour, its tone, its lines, and the fade over a button's fill. */
async function look(page: Page, things: Record<string, string>): Promise<Record<string, string[]>> {
  for (const selector of Object.values(things)) await expect(page.locator(selector).first()).toBeAttached({ timeout: 20_000 });
  return page.evaluate((named) => {
    const out: Record<string, string[]> = {};
    for (const [name, selector] of Object.entries(named)) {
      const node = document.querySelector(selector)!;
      const own = getComputedStyle(node);
      const fill = getComputedStyle(node, "::before");
      const hint = getComputedStyle(node, "::placeholder");
      out[name] = [own.color, own.backgroundColor, own.borderTopColor, own.textDecorationColor, fill.maskImage || fill.webkitMaskImage, fill.backgroundImage, hint.color];
    }
    return out;
  }, things);
}

const PAGES: { path: string; things: Record<string, string> }[] = [
  {
    path: "/",
    things: {
      ribbon: '[data-testid="shell-ribbon"]',
      language: '[data-testid="shell-lang"]',
      logIn: '[data-testid="shell-log-in"]',
      raise: '[data-testid="landing-raise"]',
      note: "#landing-raise-note",
      card: ".lp-flip__face",
      cardLine: ".lp-flip__more",
      footer: '[data-testid="shell-footer"]',
      footerLink: '[data-testid="shell-footer-defaults"]',
    },
  },
  { path: "/raise", things: { ask: '[data-testid="raise-what"]', strip: '[data-testid="raise-nav"]', swipe: '[data-testid="raise-swipe"]', go: ".ah-go" } },
];

for (const scheme of ["light", "dark"] as const) {
  test(`without color-mix() the ${scheme} pages compute the same colours, tones, lines and fades`, async ({ browser }) => {
    for (const { path, things } of PAGES) {
      const served = await open(browser, path, scheme, false);
      const without = await open(browser, path, scheme, true);
      const [a, b] = [await look(served, things), await look(without, things)];
      expect(b, `${path} in ${scheme}`).toEqual(a);
      if (path === "/") {
        // And they are see-through where they should be: a tone under the ribbon, quiet words, a fade over the fill.
        expect(a.ribbon![1]).toMatch(/rgba\(.*, 0\.08\)/);
        expect(a.note![0]).toMatch(/rgba\(.*, 0\.6\)/);
        expect(a.raise![4]).toContain("linear-gradient");
      } else {
        expect(a.ask![6]).toMatch(/rgba\(/);
        expect(a.swipe![4]).toContain("linear-gradient");
      }
      await served.context().close();
      await without.context().close();
    }
  });
}

test("the served stylesheets write every width and height condition as min- or max-, never as a range", async ({ browser }) => {
  const context = await browser.newContext();
  await quiet(context, stand.site!);
  const sheets: string[] = [];
  context.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith(".css")) void response.text().then((text) => sheets.push(text), () => undefined);
  });
  const page = await context.newPage();
  for (const path of ["/", "/raise", "/limits", "/defaults"]) {
    await page.goto(path);
    await expect(page.getByTestId("shell-footer")).toBeAttached({ timeout: 20_000 });
  }
  expect(sheets.length).toBeGreaterThan(0);
  const all = sheets.join("\n");
  expect(all.match(/@media[^{]*\(\s*(?:width|height)\s*[<>]=?[^{]*\{/g) ?? []).toEqual([]);
  expect(all).toMatch(/@media \(min-width:/);
  await context.close();
});
