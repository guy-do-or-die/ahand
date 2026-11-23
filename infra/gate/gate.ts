/**
 * The gate, `bun run check`: every check of the repository, in lanes that run side by side.
 *
 *   bun infra/gate/gate.ts              # the whole gate (bun run check)
 *   bun infra/gate/gate.ts typecheck    # every TypeScript project, side by side (bun run typecheck)
 *   bun infra/gate/gate.ts typecheck --jobs 4
 *
 * Each step is a script of the root package.json, run as `bun run <script>`, so a step run by
 * hand is the step the gate runs. The order that matters:
 *
 *   first   one after another: Core is unchanged; forge build; the ABI package regenerated
 *           (check:abi writes packages/abi/src/generated.ts); the SDK's fixtures rewritten from
 *           Core (test:vectors writes contracts/test/fixtures/*.json). Every later step reads what
 *           these wrote, so none of them runs while they write.
 *   lanes   side by side, each lane's steps one after another (LANES below). Lanes share no port:
 *           each package's tests take ports of their own range or free ones, and the stand's tests
 *           take the slots in STAND_TEST_SLOTS.
 *   last    Core is still unchanged.
 *
 * A step's output is printed whole when the step ends, under its name and time. Every lane runs to
 * its end even when another failed, so one run names every failure; the gate fails when any did.
 */
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

/** The TypeScript projects, `tsc --noEmit -p <project>` each: the slowest first, so it is never left to run alone at the end. */
export const PROJECTS = [
  "apps/web",
  "packages/sdk/tests",
  "apps/view",
  "tests/e2e",
  "infra/stand",
  "tools",
  "tests/demo",
  "packages/sdk",
  "packages/abi",
  "packages/deliver",
  "packages/card",
  "infra/relay",
  "infra/gate",
] as const;

export const FIRST = ["check:core", "build:contracts", "check:abi", "test:vectors"] as const;

/** Side by side after FIRST; within a lane, in order. */
export const LANES: readonly (readonly string[])[] = [
  ["typecheck"],
  ["test:contracts"],
  ["test:exit"],
  ["test:sdk", "test:abi"],
  ["test:deliver", "test:card", "test:relay"],
  ["test:view"],
  ["test:web", "build"],
  ["test:stand"],
  ["test:tools"],
  ["check:catalogue", "check:atlas", "test:gate"],
];

export const LAST = ["check:core"] as const;

export interface Step {
  name: string;
  command: string;
  args: string[];
}

export interface Ran {
  name: string;
  ok: boolean;
  seconds: number;
  output: string;
}

/** Runs one step to its end, its output kept rather than printed. */
export function run(step: Step): Promise<Ran> {
  const started = performance.now();
  return new Promise((done) => {
    const child = spawn(step.command, step.args, { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    const end = (ok: boolean, extra = "") =>
      done({ name: step.name, ok, seconds: (performance.now() - started) / 1000, output: Buffer.concat(chunks).toString("utf8") + extra });
    child.on("error", (error) => end(false, `\n${error.message}\n`));
    child.on("close", (code, signal) => end(code === 0, signal ? `\nstopped by ${signal}\n` : ""));
  });
}

function report(ran: Ran): void {
  const head = `── ${ran.name} ${ran.ok ? "passed" : "FAILED"} in ${ran.seconds.toFixed(1)} s`;
  process.stdout.write(`\n${head}\n${ran.output}${ran.output.endsWith("\n") || ran.output === "" ? "" : "\n"}`);
}

/**
 * How many threads each of the three steps that would take every core may use while the gate runs
 * them beside the other lanes, so the machine is shared rather than overrun (all three at full
 * width loaded 14 cores about twice over, and tests that wait for a few seconds timed out): half
 * the cores for the SDK's tests, the longest lane, and a quarter each for tsc and forge. Run
 * alone, each step still takes every core.
 */
export function shares(cores: number): Record<string, string[]> {
  const half = String(Math.max(2, Math.floor(cores / 2)));
  const quarter = String(Math.max(2, Math.floor(cores / 4)));
  return {
    typecheck: ["--jobs", quarter],
    "test:contracts": ["--threads", quarter],
    "test:sdk": ["--maxWorkers", half, "--minWorkers", "1"],
  };
}

const SHARES = shares(availableParallelism());

/** `bun run <name>`, with its share of the machine when it has one (bun run passes the arguments on). */
const script = (name: string): Step => ({ name, command: process.execPath, args: ["run", name, ...(SHARES[name] ?? [])] });

/** Runs `steps` one after another, stopping at the first that fails. */
async function inOrder(steps: readonly Step[], all: Ran[]): Promise<boolean> {
  for (const step of steps) {
    const ran = await run(step);
    report(ran);
    all.push(ran);
    if (!ran.ok) return false;
  }
  return true;
}

/** Runs `steps` with at most `limit` at once; true when every one passed. */
export async function sideBySide(steps: readonly Step[], limit: number, all: Ran[], onEnd: (ran: Ran) => void = report): Promise<boolean> {
  let next = 0;
  let ok = true;
  const worker = async () => {
    while (next < steps.length) {
      const ran = await run(steps[next++]);
      onEnd(ran);
      all.push(ran);
      ok &&= ran.ok;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, steps.length) }, worker));
  return ok;
}

function summary(all: Ran[], seconds: number, ok: boolean): void {
  const lines = all.map((ran) => `  ${ran.ok ? "ok    " : "FAILED"} ${ran.seconds.toFixed(1).padStart(6)} s  ${ran.name}`);
  process.stdout.write(`\n${lines.join("\n")}\n${ok ? "passed" : "FAILED"} in ${seconds.toFixed(1)} s\n`);
}

async function typecheck(jobs: number): Promise<boolean> {
  const tsc = resolve(ROOT, "node_modules/.bin/tsc");
  const all: Ran[] = [];
  const started = performance.now();
  const steps = PROJECTS.map((project) => ({ name: `tsc -p ${project}`, command: tsc, args: ["--noEmit", "-p", project] }));
  const ok = await sideBySide(steps, jobs, all);
  summary(all, (performance.now() - started) / 1000, ok);
  return ok;
}

async function gate(): Promise<boolean> {
  const all: Ran[] = [];
  const started = performance.now();
  let ok = await inOrder(FIRST.map(script), all);
  if (ok) {
    const lanes = await Promise.all(LANES.map((lane) => inOrder(lane.map(script), all)));
    ok = lanes.every(Boolean);
  }
  ok = (await inOrder(LAST.map(script), all)) && ok;
  summary(all, (performance.now() - started) / 1000, ok);
  return ok;
}

if (import.meta.main) {
  const [what, flag, value] = process.argv.slice(2);
  // tsc checks on one thread: by default as many at once as there are cores, at most six, which is
  // about all a laptop's memory carries; --jobs N when the gate shares the machine.
  const jobs = flag === "--jobs" && /^[1-9][0-9]*$/.test(value ?? "") ? Number(value) : Math.min(6, availableParallelism());
  if (!(what === undefined || (what === "typecheck" && (flag === undefined || jobs === Number(value))))) {
    console.error("usage: bun infra/gate/gate.ts [typecheck [--jobs N]]");
    process.exit(2);
  }
  process.exit((await (what === "typecheck" ? typecheck(jobs) : gate())) ? 0 : 1);
}
