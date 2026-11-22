/**
 * Every scenario of the catalogue as one Playwright test (tests/demo/README.md).
 *
 *   STAND_SLOT=5 bunx playwright test -c playwright.demo.config.ts                 # all, headless
 *   DEMO=1 DEMO_ONLY=first-thanks STAND_SLOT=5 bunx playwright test -c playwright.demo.config.ts   # a live show
 */
import { test } from "@playwright/test";

import { play } from "./engine/play";
import { targetOf } from "./engine/target";
import { SCENARIOS } from "./scenarios";

const target = targetOf();
const only = process.env.DEMO_ONLY?.split(",").filter(Boolean);

for (const scenario of SCENARIOS) {
  const skip = (only && !only.includes(scenario.id)) || !scenario.targets.includes(target as never);
  test(`${scenario.id}: ${scenario.title}`, { tag: (scenario.tags ?? []).map((t) => `@${t}`) }, async ({ browser }, info) => {
    test.skip(skip, only && !only.includes(scenario.id) ? "not asked for in DEMO_ONLY" : `cannot run on ${target}`);
    // A live show waits for the director as long as it takes; a recording or a test does not.
    test.setTimeout(process.env.DEMO === "1" ? (process.env.DEMO_HEADLESS === "1" ? 600_000 : 0) : 240_000);
    await play(scenario, browser, info);
  });
}
