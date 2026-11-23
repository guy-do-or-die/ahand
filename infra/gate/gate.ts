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

/**
 * How long a step's output is still read after the step exited. A process the step started and
 * left behind (a test's server, after an assertion failed before its cleanup) keeps the step's
 * output open; without this limit the lane would wait for it for ever, printing nothing.
 */
export const DRAIN_MS = 2_000;

/**
 * Runs one step to its end, its output kept rather than printed. The step ends when its process
 * exits: its output is read for at most `drainMs` more, and when something it started still holds
 * the output then, the output is closed and the report says so. That process is left running, as
 * a chain of `&&` leaves it.
 */
export function run(step: Step, drainMs = DRAIN_MS): Promise<Ran> {
  const started = performance.now();
  return new Promise((done) => {
    const child = spawn(step.command, step.args, { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    let ended = false;
    const end = (ok: boolean, extra = "") => {
      if (ended) return;
      ended = true;
      done({ name: step.name, ok, seconds: (performance.now() - started) / 1000, output: Buffer.concat(chunks).toString("utf8") + extra });
    };
    child.on("error", (error) => end(false, `\n${error.message}\n`));
    // Both events carry the exit; "close" also says every holder of the output let it go.
    const verdict = (code: number | null, signal: NodeJS.Signals | null) => ({ ok: code === 0, stopped: signal ? `\nstopped by ${signal}\n` : "" });
    child.on("close", (code, signal) => {
      const { ok, stopped } = verdict(code, signal);
      end(ok, stopped);
    });
    child.on("exit", (code, signal) => {
      const { ok, stopped } = verdict(code, signal);
      setTimeout(() => {
        if (ended) return;
        child.stdout.destroy();
        child.stderr.destroy();
        end(ok, `${stopped}\n(the step exited; a process it started still held its output ${drainMs / 1000} s later and was left running)\n`);
      }, drainMs).unref();
    });
  });
}

function report(ran: Ran): void {
  const head = `── ${ran.name} ${ran.ok ? "passed" : "FAILED"} in ${ran.seconds.toFixed(1)} s`;
  process.stdout.write(`\n${head}\n${ran.output}${ran.output.endsWith("\n") || ran.output === "" ? "" : "\n"}`);
}

/**
 * How many threads each of the three steps that would take every core may use while the gate runs
 * them beside the other lanes: a quarter of the cores each. The machine is shared rather than
 * overrun: with all three at full width, or the SDK's tests on half the cores, the load stood at
 * twice the cores, and tests that watch a chain or a relay within a deadline (a reorg seen before
 * the block is safe, a relay's answer within 300 ms) failed. Run alone, each step still takes
 * every core.
 */
export function shares(cores: number): Record<string, string[]> {
  const quarter = String(Math.max(2, Math.floor(cores / 4)));
  return {
    typecheck: ["--jobs", quarter],
    "test:contracts": ["--threads", quarter],
    "test:sdk": ["--maxWorkers", quarter, "--minWorkers", "1"],
  };
}

const SHARES = shares(availableParallelism());

/**
 * Steps that only compute, with no clock in any check: they run at a lower priority (nice 10), so
 * the lanes beside them whose tests wait for a relay's answer or a block within a deadline get
 * the CPU when they need it. Under a full machine a relay's 300 ms answer came late otherwise.
 */
export const BACKGROUND = new Set(["typecheck", "test:contracts", "test:sdk"]);

/** `bun run <name>`, with its share of the machine when it has one (bun run passes the arguments on). */
function script(name: string): Step {
  const args = ["run", name, ...(SHARES[name] ?? [])];
  return BACKGROUND.has(name) ? { name, command: "nice", args: ["-n", "10", process.execPath, ...args] } : { name, command: process.execPath, args };
}

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
