/**
 * The twist (UX-SPEC §3, PLAN wave 5 `twist`): every hand turns over, and the marker sweeps the
 * receipt. In a real browser against a real local chain: the gallery's routes are signed in the
 * page and Core on the stand's chain is asked about them; the Hand view turns over a seeded
 * two-pass link and a thanked Hand's give link, whose answers Core gives for Hands that exist.
 *
 *   STAND_SLOT=3 bunx playwright test tests/e2e/smoke/twist.spec.ts
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { isAddressEqual, type Address } from "viem";

import { quietDevServer } from "../lib/feat-hand/helpers";
import { rpc, type Rpc } from "../lib/rpc";
import { readStand, seed } from "../lib/stand";

test.describe.configure({ mode: "serial" });

interface Fixture {
  handId: string;
  reward: string;
  address: string;
  giveAddress?: string;
  giveHash?: string;
  thankTx?: string;
  passes?: { payee: Address | null; keptBps: number }[];
}

const stand = readStand();
let chain: Rpc;
let fixtures: Record<string, Fixture>;

test.beforeAll(() => {
  chain = rpc(stand.rpc);
  fixtures = seed<{ fixtures: Record<string, Fixture> }>(undefined, ["twoPasses", "thanked", "unlisted"]).fixtures;
});

test.beforeEach(async ({ context }) => {
  await quietDevServer(context, stand.site!);
});

const fixture = (name: string): Fixture => {
  const found = fixtures[name];
  if (!found) throw new Error(`the seed made no ${name} fixture`);
  return found;
};

async function gallery(page: Page, query = "?theme=light"): Promise<Locator> {
  await page.goto(`/gallery.html${query}`);
  const flip = page.locator('[data-kit="Flip"]').first();
  // The routes are signed in the page when it opens.
  await expect(flip.locator('[data-case="twist-route"] [data-testid="twist-flip-front"]')).toHaveCount(4);
  return flip;
}

/** The back of a card once its checks have all ticked and Core has answered. */
async function answered(card: Locator): Promise<Locator> {
  const back = card.getByTestId("twist-back");
  await expect(back).toBeVisible();
  await expect(back.getByTestId("twist-core")).toBeVisible({ timeout: 15_000 });
  return back;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface RailMap {
  /** The page: how wide it is, and how wide what it holds is. */
  page: { width: number; content: number };
  /** The rail's own visible box: what of the route a reader sees without scrolling it. */
  list: Box;
  hands: Box[];
  you: Box | null;
  slot: Box | null;
  /** The backs now shown. */
  backs: Box[];
}

/** Where the rail's parts are on the screen, in CSS pixels. */
function railMap(rail: Locator): Promise<RailMap> {
  return rail.evaluate((element) => {
    const box = (found: Element): Box => {
      const rect = found.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const one = (selector: string) => {
      const found = element.querySelector(selector);
      return found ? box(found) : null;
    };
    const all = (selector: string) => Array.from(element.querySelectorAll(selector)).map(box);
    return {
      page: { width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth },
      list: box(element.querySelector("ol.ah-rail")!),
      hands: all('[data-testid="twist-flip-front"]'),
      you: one(".ah-rail__you"),
      slot: one(".ah-rail__slot"),
      backs: all('[data-testid="twist-back"]:not([hidden])'),
    };
  });
}

/** Whether a part lies inside the rail's visible box from side to side (half a pixel of rounding allowed). */
const shown = (part: Box | null, list: Box): boolean => !!part && part.left >= list.left - 0.5 && part.right <= list.right + 0.5;

test("gallery: a pass turns over to its share, payee and key, three checks tick in Core's order, then Core's answer at a block", async ({ page }) => {
  const flip = await gallery(page);
  const card = flip.locator('[data-case="twist-route"] [data-testid="twist-flip"]').nth(1);
  const before = await chain.client.getBlockNumber({ cacheTime: 0 });
  await card.getByTestId("twist-flip-front").click();
  await expect(card).toHaveAttribute("data-flipped", "true");
  // The hand turns where it stands (rotateY) while its back unrolls under the rail.
  expect(
    await card.evaluate((element) => ["twist-flip-front", "twist-back"].map((id) => getComputedStyle(element.querySelector(`[data-testid="${id}"]`)!).animationName)),
  ).toEqual(["ah-hand-over", "ah-sheet-open"]);
  const back = await answered(card);
  const after = await chain.client.getBlockNumber({ cacheTime: 0 });

  await expect(back.getByTestId("twist-share")).toHaveAttribute("data-value", "200");
  await expect(back.getByTestId("twist-share")).toContainText("2% · $0.80 at today's reward");
  await expect(back.getByTestId("twist-payee")).toHaveAttribute("data-value", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  await expect(back.getByTestId("twist-key")).toContainText("0x");

  const steps = back.getByTestId("twist-step");
  await expect(steps).toHaveCount(3);
  expect(await steps.evaluateAll((items) => items.map((item) => [item.getAttribute("data-check"), item.getAttribute("data-status")]))).toEqual([
    ["InvalidClaim", "pass"],
    ["AnonymousMargin", "pass"],
    ["InvalidKeySig", "pass"],
  ]);
  await expect(back).toContainText("shares add up");
  await expect(back).toContainText("names someone to pay");
  await expect(back).toContainText("made by the key that held the link");

  // The sample Hand was never raised: Core's own answer says so, at a block between our reads.
  const core = back.getByTestId("twist-core");
  await expect(core).toHaveAttribute("data-status", "refused");
  const block = BigInt((await core.getAttribute("data-block"))!);
  expect(block >= before && block <= after).toBe(true);
  await expect(core).toContainText(/checkRoute · eth_call · block [\d  ]+ · NotRaised/i);
  await expect(core).toContainText("There is no hand with this number.");

  // The back is the next thing in the document after the button that turned it.
  const order = await card.evaluate((element) => {
    const button = element.querySelector('[data-testid="twist-flip-front"]')!;
    return button.nextElementSibling?.getAttribute("data-testid");
  });
  expect(order).toBe("twist-back");

  // A tap on the back turns it again.
  await back.click({ position: { x: 10, y: 10 } });
  await expect(card).toHaveAttribute("data-flipped", "false");
});

test("gallery: a pass made by the wrong key fails where Core would fail it, with Core's sentence, and the helper's card ticks seven checks", async ({ page }) => {
  const flip = await gallery(page);
  const broken = flip.locator('[data-case="twist-broken"] [data-testid="twist-flip"]').nth(2);
  await broken.getByTestId("twist-flip-front").click();
  const back = await answered(broken);
  expect(await back.getByTestId("twist-step").evaluateAll((items) => items.map((item) => item.getAttribute("data-status")))).toEqual(["pass", "pass", "fail"]);
  await expect(back).toContainText("One step on this route wasn't made by whoever held the link.");

  const helper = flip.locator('[data-case="twist-route"] [data-testid="twist-flip"]').nth(3);
  await helper.getByTestId("twist-flip-front").click();
  const giveBack = await answered(helper);
  await expect(giveBack.getByTestId("twist-step")).toHaveCount(7);
  expect(await giveBack.getByTestId("twist-step").evaluateAll((items) => items.every((item) => item.getAttribute("data-status") === "pass"))).toBe(true);
  await expect(giveBack.getByTestId("twist-share")).toContainText("98% · $39.20 at today's reward");
  await expect(giveBack.getByTestId("twist-signer")).toContainText("0x");
  await expect(giveBack.getByTestId("twist-core")).toContainText(/checkGive/i);
  await expect(giveBack.getByTestId("twist-givehash")).toHaveAttribute("data-value", /^0x[0-9a-f]{64}$/);
});

test("gallery: a receipt row turns over to its formula with the real numbers and its events", async ({ page }) => {
  await gallery(page);
  const receipt = page.locator('[data-kit="Sweep"]').first().locator('[data-case="twist-receipt"]');
  const first = receipt.getByTestId("twist-flip").first();
  await first.getByTestId("twist-flip-front").click();
  const formula = first.getByTestId("twist-formula");
  await expect(formula).toHaveAttribute("data-value", "800000");
  expect((await formula.textContent())!.replace(/ /g, " ")).toContain("40 000 000 × (10 000 − 9 800) ÷ 10 000 = 800 000 · $0.80");
  expect(await first.getByTestId("twist-event").evaluateAll((items) => items.map((item) => item.getAttribute("data-value")))).toEqual(["Shaken", "Paid"]);

  const helper = receipt.getByTestId("twist-flip").nth(3);
  await helper.getByTestId("twist-flip-front").click();
  expect((await helper.getByTestId("twist-formula").textContent())!.replace(/ /g, " ")).toContain("40 000 000 − 800 000 − 0 − 1 200 000 = 38 000 000 · $38.00");
});

test("gallery: the marker sweeps a row only after its flag, in order, and stops at the helper while 🙏 bows", async ({ page }) => {
  await gallery(page);
  const sweep = page.locator('[data-kit="Sweep"]').first();
  for (const id of ["twist-sweep", "twist-sweep-all"]) {
    const box = sweep.locator(`[data-case="${id}"]`);
    await box.getByTestId("twist-replay").click();
    let sawPartial = false;
    for (let sample = 0; sample < 80; ++sample) {
      const rows = await box.locator("tbody tr").evaluateAll((items) => items.map((item) => [item.getAttribute("data-landed"), item.getAttribute("data-swept")]));
      const swept = rows.map(([, s]) => s === "true");
      // Swept only once landed, and only as a prefix: never ahead of the evidence or out of order.
      rows.forEach(([landed, s]) => expect(s === "true" ? landed === "true" : true).toBe(true));
      expect(swept.indexOf(false) < 0 || swept.slice(swept.indexOf(false)).every((value) => !value)).toBe(true);
      const done = swept.filter(Boolean).length;
      if (done > 0 && done < rows.length) sawPartial = true;
      if (done === rows.length) break;
      await page.waitForTimeout(60);
    }
    expect(sawPartial).toBe(true);
    await expect(box.locator("table")).toHaveAttribute("data-sweep", "4/4");
    await expect(box.getByTestId("twist-bow")).toBeVisible();
    await expect(box.locator('tr[data-kind="helped"] [data-testid="twist-sweep"]')).toHaveAttribute("data-state", "done");
  }
});

test("reduced motion: the flip and the sweep reach their end state with no animation running", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const flip = await gallery(page);
  const card = flip.locator('[data-case="twist-route"] [data-testid="twist-flip"]').nth(1);
  await card.getByTestId("twist-flip-front").click();
  const state = await card.evaluate((element) => {
    const front = element.querySelector('[data-testid="twist-flip-front"]')!;
    const back = element.querySelector('[data-testid="twist-back"]')!;
    return {
      animations: [front, back].map((side) => getComputedStyle(side).animationName),
      running: element.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length,
      back: getComputedStyle(back).display,
      // The hand already shows its other side: filled, not clear.
      filled: getComputedStyle(front).backgroundColor !== "rgba(0, 0, 0, 0)",
    };
  });
  expect(state.animations).toEqual(["none", "none"]);
  expect(state.running).toBe(0);
  expect(state.back).not.toBe("none");
  expect(state.filled).toBe(true);
  // The checks are shown at once, with no ticking.
  await expect(card.getByTestId("twist-core")).toBeVisible({ timeout: 15_000 });
  expect(await card.locator('[data-testid="twist-step"][data-shown="false"]').count()).toBe(0);

  // A receipt row turns as one card: under less motion it is already turned, with no transition.
  const row = page.locator('[data-kit="Sweep"]').first().locator('[data-case="twist-receipt"]').getByTestId("twist-flip").first();
  await row.getByTestId("twist-flip-front").click();
  const turned = await row.evaluate((element) => {
    const style = getComputedStyle(element.querySelector(".ah-flip__card")!);
    return { duration: style.transitionDuration, transform: style.transform, running: element.getAnimations({ subtree: true }).length };
  });
  expect(turned.duration).toBe("0s");
  expect(turned.transform).toMatch(/^matrix3d\(-1, 0, 0?/); // rotateY(180deg), already there
  expect(turned.running).toBe(0);
  await expect(row.getByTestId("twist-formula")).toBeVisible();

  const box = page.locator('[data-kit="Sweep"]').first().locator('[data-case="twist-sweep-all"]');
  await box.getByTestId("twist-replay").click();
  await expect(box.locator("table")).toHaveAttribute("data-sweep", "4/4");
  const sweep = await box.evaluate((element) => ({
    states: Array.from(element.querySelectorAll('[data-testid="twist-sweep"]')).map((band) => band.getAttribute("data-state")),
    animations: Array.from(element.querySelectorAll('[data-testid="twist-sweep"], [data-testid="twist-bow"]')).map((band) => getComputedStyle(band).animationName),
    running: element.getAnimations({ subtree: true }).length,
  }));
  expect(sweep.states).toEqual(["done", "done", "done", "done"]);
  expect(sweep.animations.every((name) => name === "none")).toBe(true);
  expect(sweep.running).toBe(0);
});

test("keyboard only: Tab reaches each hand, Enter and Space turn it, and aria-expanded follows", async ({ page }) => {
  const flip = await gallery(page);
  const route = flip.locator('[data-case="twist-route"]');
  await route.locator("ol").focus();
  const fronts = route.getByTestId("twist-flip-front");
  for (let index = 0; index < 4; ++index) {
    await page.keyboard.press("Tab");
    await expect(fronts.nth(index)).toBeFocused();
    await expect(fronts.nth(index)).toHaveAttribute("aria-expanded", "false");
  }
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  const pass = fronts.nth(1);
  await expect(pass).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(pass).toHaveAttribute("aria-expanded", "true");
  await expect(route.getByTestId("twist-back").nth(1)).toBeVisible();
  // The focus stays on the hand, which stays up; its ring is drawn around it, clear of its ink.
  await expect(pass).toBeFocused();
  const ring = await pass.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.outlineStyle, style.outlineWidth, style.outlineOffset];
  });
  expect(ring).toEqual(["solid", "2px", "2px"]);
  await page.keyboard.press("Space");
  await expect(pass).toHaveAttribute("aria-expanded", "false");
});

for (const query of ["?theme=light", "?theme=dark&lang=ru"]) {
  test(`axe: no serious or critical issue in the twist, turned over (${query}); no shadow anywhere in it`, async ({ page }) => {
    const flip = await gallery(page, query);
    await flip.locator('[data-case="twist-route"] [data-testid="twist-flip-front"]').nth(1).click();
    await answered(flip.locator('[data-case="twist-route"] [data-testid="twist-flip"]').nth(1));
    const sweep = page.locator('[data-kit="Sweep"]').first();
    await sweep.locator('[data-case="twist-receipt"] [data-testid="twist-flip-front"]').first().click();
    await expect(sweep.locator('[data-case="twist-sweep"] table')).toHaveAttribute("data-sweep", "4/4", { timeout: 10_000 });

    const results = await new AxeBuilder({ page })
      .include('[data-kit="Flip"]')
      .include('[data-kit="Sweep"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    const grave = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    expect(grave.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`)).toEqual([]);

    const shadows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-kit="Flip"] *, [data-kit="Sweep"] *')).filter((element) => getComputedStyle(element).boxShadow !== "none").length,
    );
    expect(shadows).toBe(0);
  });
}

test("Hand view: a seeded two-pass link turns over; Core answers checkRoute ok at a block, and the asker's terms match Core", async ({ page }) => {
  const two = fixture("twoPasses");
  await page.goto(two.address);
  const rail = page.getByTestId("hand-rail");
  await expect(rail.locator("[data-flippable]")).toHaveAttribute("data-flippable", "true", { timeout: 15_000 });
  const cards = rail.getByTestId("twist-flip");
  await expect(cards).toHaveCount(3);

  const before = await chain.client.getBlockNumber({ cacheTime: 0 });
  await cards.nth(1).getByTestId("twist-flip-front").click();
  const back = await answered(cards.nth(1));
  const after = await chain.client.getBlockNumber({ cacheTime: 0 });
  // 5% of a $60 reward.
  await expect(back.getByTestId("twist-share")).toHaveAttribute("data-value", "500");
  await expect(back.getByTestId("twist-share")).toContainText("5% · $3.00 at today's reward");
  const payee = (await back.getByTestId("twist-payee").getAttribute("data-value")) as Address;
  expect(isAddressEqual(payee, two.passes![0]!.payee!)).toBe(true);
  expect(await back.getByTestId("twist-step").evaluateAll((items) => items.map((item) => item.getAttribute("data-status")))).toEqual(["pass", "pass", "pass"]);
  const core = back.getByTestId("twist-core");
  await expect(core).toHaveAttribute("data-status", "ok");
  const block = BigInt((await core.getAttribute("data-block"))!);
  expect(block >= before && block <= after).toBe(true);
  await expect(core).toContainText(/checkRoute · eth_call · block [\d  ]+ · ok/i);

  // The second pass kept nothing: no money line, and it needs no one to pay.
  await cards.nth(2).getByTestId("twist-flip-front").click();
  const second = await answered(cards.nth(2));
  await expect(second.getByTestId("twist-share")).toHaveAttribute("data-value", "0");
  await expect(second).toContainText("keeps no share, so needs no one to pay");
  await expect(second.getByTestId("twist-core")).toHaveAttribute("data-status", "ok");

  await cards.nth(0).getByTestId("twist-flip-front").click();
  const terms = await answered(cards.nth(0));
  await expect(terms.getByTestId("twist-hand")).toHaveAttribute("data-value", two.handId);
  await expect(terms.getByTestId("twist-match")).toHaveAttribute("data-status", "match");
});

test("Hand view: turning a hand leaves the rail where it was, YOU and the next slot in view, and its back opens under the rail at the rail's width", async ({ page }) => {
  await page.goto(fixture("unlisted").address);
  const rail = page.getByTestId("hand-rail");
  await expect(rail.locator("[data-flippable]")).toHaveAttribute("data-flippable", "true", { timeout: 15_000 });
  const before = await railMap(rail);
  expect(shown(before.you, before.list)).toBe(true);
  expect(shown(before.slot, before.list)).toBe(true);

  const card = rail.getByTestId("twist-flip").first();
  await card.getByTestId("twist-flip-front").click();
  await answered(card);
  // Once the turn has ended: nothing on the rail has moved sideways.
  await expect.poll(async () => (await card.evaluate((element) => element.getAnimations({ subtree: true }).length)) === 0).toBe(true);
  const turned = await railMap(rail);
  expect(shown(turned.you, turned.list)).toBe(true);
  expect(shown(turned.slot, turned.list)).toBe(true);
  expect([turned.you!.left, turned.slot!.left, turned.hands[0]!.left].map(Math.round)).toEqual([before.you!.left, before.slot!.left, before.hands[0]!.left].map(Math.round));

  // The back: one panel under every hand of the rail, as wide as the rail, inside the page.
  expect(turned.backs).toHaveLength(1);
  const back = turned.backs[0]!;
  expect(back.top).toBeGreaterThanOrEqual(Math.max(turned.hands[0]!.bottom, turned.you!.bottom, turned.slot!.bottom));
  expect(back.left).toBeGreaterThanOrEqual(turned.list.left);
  expect(back.right).toBeLessThanOrEqual(turned.list.right);
  expect(back.right - back.left).toBeGreaterThanOrEqual(turned.list.right - turned.list.left - 10);
  expect(turned.page.content).toBeLessThanOrEqual(turned.page.width);

  // It is still the next thing in the document after the button that turned it (UX-SPEC §13).
  expect(await card.evaluate((element) => element.querySelector('[data-testid="twist-flip-front"]')!.nextElementSibling?.getAttribute("data-testid"))).toBe("twist-back");
});

test("Hand view, a 320 px phone and a route longer than the screen: one hand is turned at a time, and turning it back brings YOU into view", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(fixture("twoPasses").address);
  const rail = page.getByTestId("hand-rail");
  await expect(rail.locator("[data-flippable]")).toHaveAttribute("data-flippable", "true", { timeout: 15_000 });
  const cards = rail.getByTestId("twist-flip");
  await expect(cards).toHaveCount(3);

  // The reader scrolled the rail back to the asker: YOU is off its right edge.
  await rail.locator("ol.ah-rail").evaluate((list) => list.scrollTo({ left: 0, behavior: "instant" }));
  const start = await railMap(rail);
  expect(shown(start.you, start.list)).toBe(false);

  await cards.nth(0).getByTestId("twist-flip-front").click();
  await answered(cards.nth(0));
  await cards.nth(1).getByTestId("twist-flip-front").click();
  await answered(cards.nth(1));
  await expect(cards.nth(0)).toHaveAttribute("data-flipped", "false");
  await expect(cards.nth(0).getByTestId("twist-flip-front")).toHaveAttribute("aria-expanded", "false");
  await expect(rail.locator('[data-testid="twist-back"]:not([hidden])')).toHaveCount(1);
  // The panel stays as wide as the screen's rail however long the route is.
  const open = await railMap(rail);
  expect(shown(open.backs[0]!, open.list)).toBe(true);
  expect(open.page.content).toBeLessThanOrEqual(open.page.width);

  await rail.locator("ol.ah-rail").evaluate((list) => list.scrollTo({ left: 0, behavior: "instant" }));
  await cards.nth(1).getByTestId("twist-back").click({ position: { x: 10, y: 10 } });
  await expect(cards.nth(1)).toHaveAttribute("data-flipped", "false");
  await expect.poll(async () => {
    const closed = await railMap(rail);
    return shown(closed.you, closed.list);
  }).toBe(true);
});

test("Hand view: a thanked Hand's helper turns over to GIVEHASH MATCHES CORE, and its receipt rows to their events on chain", async ({ page }) => {
  const thanked = fixture("thanked");
  await page.goto(thanked.giveAddress!);
  await expect(page.getByTestId("hand-closed")).toHaveAttribute("data-value", "thanked", { timeout: 15_000 });
  const cards = page.getByTestId("hand-rail").getByTestId("twist-flip");
  await expect(cards).toHaveCount(3);
  await cards.nth(2).getByTestId("twist-flip-front").click();
  const back = await answered(cards.nth(2));
  await expect(back.getByTestId("twist-givehash")).toHaveAttribute("data-value", thanked.giveHash!);
  await expect(back.getByTestId("twist-match")).toHaveAttribute("data-status", "match");
  await expect(back.getByTestId("twist-match")).toHaveText(/giveHash matches Core/i);
  await expect(back.getByTestId("twist-core")).toContainText(/thanks\(id\) · eth_call · block/i);

  const receipt = page.getByTestId("hand-closed").locator("table");
  const row = receipt.getByTestId("twist-flip").first();
  await row.getByTestId("twist-flip-front").click();
  const events = row.getByTestId("twist-event");
  await expect(events.first()).toHaveAttribute("data-tx", thanked.thankTx!);
  await expect(row.getByTestId("twist-formula")).toBeVisible();
});
