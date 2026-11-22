/**
 * Paths of the Hand model (tests/demo/model) played as scenarios. Nothing runs unless DEMO_MODEL
 * says which paths:
 *
 *   DEMO_MODEL=gaps      one shortest path to every end the catalogue never reaches
 *   DEMO_MODEL=shortest  one shortest path to every end (36)
 *   DEMO_MODEL=simple    every path, in every order (DEMO_MODEL_K: at most k events)
 *
 *   DEMO_MODEL=gaps STAND_SLOT=5 bunx playwright test -c playwright.demo.config.ts tests/demo/model.spec.ts
 */
import { test } from "@playwright/test";

import { play } from "./engine/play";
import { targetOf } from "./engine/target";
import { scenarioOf } from "./model/generate";
import { coverage, modelPaths } from "./model/paths";
import { SCENARIOS } from "./scenarios";

const mode = process.env.DEMO_MODEL;
const k = Number(process.env.DEMO_MODEL_K ?? Infinity);
const target = targetOf();
const only = process.env.DEMO_ONLY?.split(",").filter(Boolean);

function chosen() {
  if (mode === "gaps") return coverage(SCENARIOS, modelPaths("shortest", k)).paths.filter((p) => p.sameEnd.length === 0).map((p) => p.path);
  if (mode === "shortest" || mode === "simple") return modelPaths(mode, k);
  if (mode) throw new Error(`DEMO_MODEL=${mode}: gaps, shortest or simple`);
  return [];
}

for (const path of chosen()) {
  const scenario = scenarioOf(path);
  const skip = (only && !only.includes(scenario.id)) || !scenario.targets.includes(target as never);
  test(`${scenario.id}: ${scenario.title}`, { tag: ["@generated"] }, async ({ browser }, info) => {
    test.skip(skip, only && !only.includes(scenario.id) ? "not asked for in DEMO_ONLY" : `cannot run on ${target}`);
    // A live show waits for the director as long as it takes; a recording or a test does not.
    test.setTimeout(process.env.DEMO === "1" ? (process.env.DEMO_HEADLESS === "1" ? 600_000 : 0) : 240_000);
    await play(scenario, browser, info);
  });
}
