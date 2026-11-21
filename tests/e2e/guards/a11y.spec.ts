/**
 * Accessibility (UX-SPEC §13, WCAG 2.2 AA): axe with the WCAG 2.0, 2.1 and 2.2 A/AA tags on every
 * route of routes.ts, each at 390 and at 1280 pixels, in light and in dark; then a keyboard-only
 * passage through "Pass it on" and "I can help"; then reduced motion.
 *
 *   STAND_SLOT=2 bunx playwright test tests/e2e/guards/a11y.spec.ts
 *
 * A route's test fails on any violation of impact serious or critical, and attaches every
 * violation it saw (any impact) as JSON. The local-only routes are left out: /gallery redirects to
 * the gallery page, which the twist smoke checks with axe, and /dev/wallet is not in a public build.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { account } from "../lib/accounts";
import { fixtureOf, quiet, seedFixtures, visit, type SeedRun } from "./lib/guard";
import { readStand } from "../lib/stand";

const stand = readStand();
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const WIDTHS = [390, 1280] as const;
const SCHEMES = ["light", "dark"] as const;

let run: SeedRun;

test.beforeAll(() => {
  run = seedFixtures(["unlisted", "thanked", "expired", "give"]);
});

/** How to arrive at a route as a person does. */
interface Route {
  name: string;
  go(page: Page): Promise<void>;
}

const at = (path: string) => async (page: Page) => {
  await page.goto(path, { waitUntil: "networkidle" });
};

const ROUTES: Route[] = [
  { name: "/ (landing)", go: at("/") },
  { name: "hand view, open", go: (page) => visit(page, fixtureOf(run, "unlisted").address) },
  { name: "hand view, thanked", go: (page) => visit(page, fixtureOf(run, "thanked").address) },
  { name: "hand view, time's up", go: (page) => visit(page, fixtureOf(run, "expired").address) },
  { name: "hand view, a give link", go: (page) => visit(page, fixtureOf(run, "give").giveAddress!) },
  { name: "hand view, public (no link)", go: (page) => at(`/${run.chainId}/${fixtureOf(run, "thanked").handId}`)(page) },
  {
    name: "/pass",
    go: async (page) => {
      await visit(page, fixtureOf(run, "unlisted").address);
      await page.getByTestId("hand-pass").click();
      await expect(page.getByTestId("pass-swipe")).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "/give",
    go: async (page) => {
      await visit(page, fixtureOf(run, "unlisted").address);
      await page.getByTestId("hand-help").click();
      await expect(page.getByTestId("give-words")).toBeVisible({ timeout: 20_000 });
    },
  },
  { name: "/raise", go: at("/raise") },
  { name: "/my", go: at("/my") },
  { name: "/my/<chain>/<hand>", go: (page) => at(`/my/${run.chainId}/${fixtureOf(run, "unlisted").handId}`)(page) },
  { name: "/thank", go: at("/thank") },
  {
    name: "/thank with an answer",
    go: async (page) => {
      await page.goto("/thank");
      await page.getByTestId("thank-input").fill(fixtureOf(run, "give").giveAddress!);
      await page.getByTestId("thank-open").click();
      await expect(page.getByTestId("thank-predicted")).toBeVisible({ timeout: 20_000 });
    },
  },
  { name: "/waiting", go: at(`/waiting?for=${account(2).address}`) },
  { name: "/care/<chain>/<hand>", go: (page) => at(`/care/${run.chainId}/${fixtureOf(run, "unlisted").handId}`)(page) },
  { name: "/print", go: at("/print") },
  { name: "/<chain>/<hand>/proof", go: (page) => at(`/${run.chainId}/${fixtureOf(run, "thanked").handId}/proof`)(page) },
  { name: "/check", go: at("/check") },
  { name: "/core", go: at("/core") },
  { name: "/defaults", go: at("/defaults") },
  { name: "/without-us", go: at("/without-us") },
  { name: "not found", go: at("/no/such/place") },
];

interface Seen {
  width: number;
  scheme: string;
  id: string;
  impact: string;
  help: string;
  targets: string[];
  /** axe's own summary of the first node: the colours and ratio for a contrast failure. */
  summary: string;
}

async function audit(browser: Browser, route: Route, width: number, scheme: "light" | "dark"): Promise<Seen[]> {
  const context = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 800 }, colorScheme: scheme, reducedMotion: "reduce" });
  await quiet(context, stand.site!);
  const page = await context.newPage();
  try {
    await route.go(page);
    await expect(page.getByTestId("shell-main")).toBeVisible({ timeout: 20_000 });
    // Let the first block arrive and skeletons settle, so axe sees the screen a person reads.
    await page.waitForTimeout(1_200);
    const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    return result.violations.map((v) => ({
      width,
      scheme,
      id: v.id,
      impact: v.impact ?? "unknown",
      help: v.help,
      targets: v.nodes.map((node) => node.target.join(" ")),
      summary: (v.nodes[0]?.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 300),
    }));
  } finally {
    await context.close();
  }
}

/**
 * Serious violations already written down in tests/e2e/FINDINGS.md, each with its row's id. A
 * route's test passes only when what axe finds is exactly these: a new violation fails it, and so
 * does a known one that is gone (the row is fixed: delete its pattern here and mark the row).
 */
interface Known {
  finding: string;
  rule: string;
  schemes: readonly ("light" | "dark")[];
  /** Matches an axe target selector. */
  target: RegExp;
  /** Only these routes; every route when absent. */
  routes?: readonly string[];
}

// A-1 to A-4 are fixed (FINDINGS.md); a new serious violation is written down here with its row.
const KNOWN: readonly Known[] = [];

test.describe("axe, WCAG 2.2 AA, at 390 and 1280, light and dark", () => {
  for (const route of ROUTES) {
    test(route.name, async ({ browser }, info) => {
      test.setTimeout(120_000);
      const seen: Seen[] = [];
      for (const width of WIDTHS) for (const scheme of SCHEMES) seen.push(...(await audit(browser, route, width, scheme)));
      await info.attach("axe-violations.json", { body: JSON.stringify(seen, null, 2), contentType: "application/json" });
      const grave = seen
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .flatMap((v) => v.targets.map((target) => ({ ...v, target })));
      const known = KNOWN.filter((k) => !k.routes || k.routes.includes(route.name));
      const matches = (k: Known, v: (typeof grave)[number]) => k.rule === v.id && k.schemes.includes(v.scheme as "light" | "dark") && k.target.test(v.target);
      const fresh = grave.filter((v) => !known.some((k) => matches(k, v)));
      expect(fresh.map((v) => `${v.width}px ${v.scheme}: ${v.impact} ${v.id} (${v.help}) at ${v.target} — ${v.summary}`), "serious or critical violations not in FINDINGS.md").toEqual([]);
      const gone = known.filter((k) => !grave.some((v) => matches(k, v)));
      expect(gone.map((k) => `${k.finding} (${k.rule})`), "findings no longer seen: mark them fixed in FINDINGS.md and drop them from KNOWN").toEqual([]);
    });
  }
});

// The real gate: no exception at all.
test("WCAG 2.2 AA holds on every route with no known exception", () => {
  expect(KNOWN.map((k) => k.finding)).toEqual([]);
});

/** Presses Tab until `matches` is true of the focused element; fails after `max` presses. */
async function tabTo(page: Page, matches: (el: Element) => boolean, what: string, max = 80): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(`(${matches.toString()})(document.activeElement)`)) return;
  }
  throw new Error(`${max} presses of Tab never reached ${what}`);
}

const byTestId = (id: string) => new Function("el", `return !!el && el.getAttribute("data-testid") === ${JSON.stringify(id)};`) as (el: Element) => boolean;

/** The focused element shows a focus ring (UX-SPEC §13: a 2px ink ring). */
async function expectRing(page: Page, what: string): Promise<void> {
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return { style: "none", width: 0 };
    const style = getComputedStyle(el);
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) || 0 };
  });
  expect(ring.style, `${what} has no visible focus outline`).not.toBe("none");
  expect(ring.width, `${what}'s focus outline is thinner than 2px`).toBeGreaterThanOrEqual(2);
}

test.describe("keyboard only", () => {
  test.beforeEach(async ({ context }) => {
    await quiet(context, stand.site!);
  });

  test("pass it on: Tab to 'Pass it on', Enter, Tab to the swipe, Enter, the new link is made", async ({ page }) => {
    await visit(page, fixtureOf(run, "unlisted").address);
    await page.locator("body").focus();
    await tabTo(page, byTestId("hand-pass"), "Pass it on");
    await expectRing(page, "Pass it on");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/pass$/);
    // The swipe is disabled (so not focusable) until /pass has read the Hand from the chain.
    await expect(page.getByTestId("pass-swipe")).toBeEnabled({ timeout: 20_000 });
    await tabTo(page, byTestId("pass-swipe"), "the swipe 'Make my link'");
    await expectRing(page, "Make my link");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("pass-read-back")).toHaveAttribute("data-bps", "0", { timeout: 20_000 });
  });

  test("I can help: Tab to it, write, choose 'An address I have' with the arrows, type it, swipe with Enter", async ({ page }) => {
    await visit(page, fixtureOf(run, "unlisted").address);
    await page.locator("body").focus();
    await tabTo(page, byTestId("hand-help"), "I can help");
    await expectRing(page, "I can help");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("give-words")).toBeVisible({ timeout: 20_000 });
    await tabTo(page, byTestId("give-words"), "the words");
    await page.keyboard.type("I can lend you a room for that week.");
    await tabTo(page, (el) => el instanceof HTMLInputElement && el.type === "radio", "the choice of where the money lands");
    for (let i = 0; i < 4; i++) {
      const name = await page.evaluate(() => {
        const el = document.activeElement as HTMLInputElement;
        return el.labels?.[0]?.textContent ?? el.getAttribute("aria-label") ?? "";
      });
      if (name.includes("An address I have")) break;
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Space");
    await expect(page.getByRole("radio", { name: "An address I have" })).toBeChecked();
    await tabTo(page, (el) => el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? (el.getAttribute("placeholder") ?? "").startsWith("0x") : false, "the address field");
    await page.keyboard.type(account(7).address);
    await tabTo(page, byTestId("give-swipe"), "the swipe 'Send my answer'");
    await expectRing(page, "Send my answer");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("give-copy")).toBeVisible({ timeout: 30_000 });
  });
});

test("reduced motion: nothing keeps moving on the landing, the Hand view and /raise", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await quiet(context, stand.site!);
  const page = await context.newPage();
  const running = async () =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation) => animation.playState === "running")
        .map((animation) => {
          const target = (animation.effect as KeyframeEffect | null)?.target as Element | null;
          const name = (animation as CSSAnimation).animationName ?? (animation as CSSTransition).transitionProperty ?? "script";
          return `${name} on ${target ? `${target.tagName.toLowerCase()}.${target.className}` : "?"}`;
        }),
    );
  for (const go of [at("/"), (p: Page) => visit(p, fixtureOf(run, "unlisted").address), at("/raise")]) {
    await go(page);
    await expect(page.getByTestId("shell-main")).toBeVisible();
    await page.waitForTimeout(1_500);
    expect(await running(), page.url()).toEqual([]);
  }
  await context.close();
});
