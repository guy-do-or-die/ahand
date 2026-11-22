/**
 * One command for a show, on whatever branch this checkout is: a fresh stand on a free slot (it
 * comes up in a few seconds), the scenario played live in windows side by side with the director,
 * or recorded without windows into one video with every phone in it; then the stand goes down.
 *
 *   bun run show first-thanks                 # live, English
 *   bun run show first-thanks --ru            # live, Russian (app, captions, names, checks)
 *   bun run show first-thanks --record --ru   # no windows: tests/demo/videos/first-thanks.ru.mp4
 *   bun run show model-give-fund-thank        # a path of the Hand model (tests/demo/model)
 *   bun run show --list                       # every scenario id
 *
 * Options: --speed N (pace, 1 by default), --paused (wait for Step or Play), --slot N (a stand
 * slot; the first free one from 1 to 8 otherwise), --keep (leave the stand up). Ports come from
 * STAND_PORT_BASE (47000 when unset, so the default layout's ports and 3000 stay free). A scenario that
 * runs on the stand only; the fork and the site keep their own commands (README, Targets).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { slotInUse } from "../../infra/stand/stand.ts";
import { modelPaths } from "./model/paths.ts";
import { scenarioOf } from "./model/generate.ts";
import { SCENARIOS } from "./scenarios/index.ts";

const REPO = resolve(import.meta.dirname, "../..");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

const catalogue = SCENARIOS.filter((s) => s.targets.includes("stand")).map((s) => s.id);
const model = modelPaths("simple").map((p) => scenarioOf(p).id);
if (flag("--list")) {
  console.log(`catalogue (${catalogue.length}):\n  ${catalogue.join("\n  ")}\nmodel paths (${model.length}): model-…, e.g. ${model.slice(0, 3).join(", ")}`);
  process.exit(0);
}
// The scenario id: the one argument that is neither a flag nor a flag's value.
const takesValue = new Set(["--speed", "--slot"]);
const id = argv.find((a, i) => !a.startsWith("--") && !takesValue.has(argv[i - 1] ?? ""));
if (!id) {
  console.error("usage: bun run show <scenario id> [--ru] [--record] [--speed N] [--paused] [--slot N] [--keep] | --list");
  process.exit(2);
}
const isModel = model.includes(id);
if (!isModel && !catalogue.includes(id)) {
  console.error(`no stand scenario "${id}": bun run show --list`);
  process.exit(2);
}

const env: Record<string, string> = { ...(process.env as Record<string, string>), STAND_PORT_BASE: process.env.STAND_PORT_BASE ?? "47000" };
const bun = process.execPath;

async function freeSlot(): Promise<number> {
  if (value("--slot") !== undefined) return Number(value("--slot"));
  // Slot 9 is left for a long-lived local stand; never take it, even on another port base.
  for (let slot = 1; slot <= 8; slot++) {
    process.env.STAND_PORT_BASE = env.STAND_PORT_BASE;
    if ((await slotInUse(slot)).length === 0) return slot;
  }
  throw new Error("no free stand slot from 1 to 8: bun infra/stand/stand.ts status");
}

function run(command: string, args: string[], extra: Record<string, string> = {}): number {
  return spawnSync(command, args, { cwd: REPO, env: { ...env, ...extra }, stdio: "inherit" }).status ?? 1;
}

const slot = await freeSlot();
const record = flag("--record");
const lang = flag("--ru") ? "ru" : "en";
console.log(`show: ${id}, ${lang === "ru" ? "Russian" : "English"}, ${record ? "recorded" : "live"}, stand slot ${slot} (STAND_PORT_BASE ${env.STAND_PORT_BASE})`);
if (run(bun, ["infra/stand/stand.ts", "up", "--slot", String(slot)]) !== 0) process.exit(1);

const output = join(REPO, "tests/demo/test-results", `show-${id}`);
let status = 1;
try {
  // --grep keeps the other scenarios out of the list (each test's title is "<id>: <title>").
  status = run(bun, ["x", "playwright", "test", "-c", "playwright.demo.config.ts", isModel ? "tests/demo/model.spec.ts" : "tests/demo/scenarios.spec.ts", "--output", output, "--reporter", "list", "--grep", `${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: `], {
    DEMO: "1",
    DEMO_ONLY: id,
    DEMO_LANG: lang,
    STAND_SLOT: String(slot),
    ...(isModel ? { DEMO_MODEL: "simple" } : {}),
    ...(record ? { DEMO_HEADLESS: "1", DEMO_VIDEO: "1" } : {}),
    ...(value("--speed") ? { DEMO_SPEED: value("--speed")! } : {}),
    ...(flag("--paused") ? { DEMO_PAUSED: "1" } : {}),
  });
  if (status === 0 && record) {
    const folder = readdirSync(output).map((name) => join(output, name)).find((path) => statSync(path).isDirectory() && readdirSync(path).some((f) => f.startsWith("video-")));
    if (!folder) throw new Error(`no videos in ${output}`);
    if (run(bun, ["tests/demo/stitch.ts", folder]) !== 0) throw new Error("stitching failed");
    mkdirSync(join(REPO, "tests/demo/videos"), { recursive: true });
    const video = join(REPO, "tests/demo/videos", `${id}.${lang}.mp4`);
    renameSync(join(folder, "demo.mp4"), video);
    console.log(`show: ${video}`);
  }
} finally {
  if (!flag("--keep")) run(bun, ["infra/stand/stand.ts", "down", "--slot", String(slot)]);
  else console.log(`show: the stand stays up on slot ${slot}: bun infra/stand/stand.ts down --slot ${slot}`);
}
process.exit(status);
