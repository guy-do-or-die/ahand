/**
 * The gate's runner: a step that fails fails the gate, every step runs to its end, a lane goes on
 * past a failure, no more run at once than the limit, and the table names what did not run. As a
 * program (tests/plan.ts): a slow reader gets everything, and a signal stops it cleanly.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { FIRST, LANES, LAST, PROJECTS, inOrder, run, sideBySide, summaryText, type Ran } from "../gate.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const sh = (name: string, line: string) => ({ name, command: "bash", args: ["-c", line] });

describe("run", () => {
  test("keeps the output and the exit code", async () => {
    expect(await run(sh("ok", "echo out; echo err >&2"))).toMatchObject({ name: "ok", ok: true, output: "out\nerr\n" });
    expect((await run(sh("fails", "exit 3"))).ok).toBe(false);
    expect((await run({ name: "missing", command: "/no/such/program", args: [] })).ok).toBe(false);
  });

  test("ends when the step exits, though a process it left behind still holds its output", async () => {
    const started = performance.now();
    const ran = await run(sh("holds", "sleep 3 & echo hi; exit 1"), 300);
    expect((performance.now() - started) / 1000).toBeLessThan(2);
    expect(ran.ok).toBe(false);
    expect(ran.output).toStartWith("hi\n");
    expect(ran.output).toContain("still held its output");
  });
});

describe("sideBySide", () => {
  test("fails when one step fails, and still runs every step", async () => {
    const all: Ran[] = [];
    const ok = await sideBySide([sh("a", "exit 1"), sh("b", "true"), sh("c", "true")], 2, all, () => {});
    expect(ok).toBe(false);
    expect(all.map((ran) => ran.name).sort()).toEqual(["a", "b", "c"]);
  });

  test("runs no more steps at once than the limit", async () => {
    const all: Ran[] = [];
    const started = performance.now();
    expect(await sideBySide([sh("a", "sleep 0.3"), sh("b", "sleep 0.3"), sh("c", "sleep 0.3")], 2, all, () => {})).toBe(true);
    const seconds = (performance.now() - started) / 1000;
    expect(seconds).toBeGreaterThan(0.55);
    expect(seconds).toBeLessThan(2);
  });
});

describe("inOrder", () => {
  const quiet = () => {};

  test("a lane goes on past a failed step", async () => {
    const all: Ran[] = [];
    const notRun: string[] = [];
    expect(await inOrder([sh("a", "exit 1"), sh("b", "true")], all, { stopAtFailure: false, notRun, onEnd: quiet })).toBe(false);
    expect(all.map((ran) => ran.name)).toEqual(["a", "b"]);
    expect(notRun).toEqual([]);
  });

  test("the first steps stop at a failure, and the steps after it are named as not run", async () => {
    const all: Ran[] = [];
    const notRun: string[] = [];
    expect(await inOrder([sh("a", "true"), sh("b", "exit 1"), sh("c", "true"), sh("d", "true")], all, { stopAtFailure: true, notRun, onEnd: quiet })).toBe(false);
    expect(all.map((ran) => ran.name)).toEqual(["a", "b"]);
    expect(notRun).toEqual(["c", "d"]);
  });

  test("the table names every step: passed, failed and not run", () => {
    const text = summaryText(
      [
        { name: "a", ok: true, seconds: 1, output: "" },
        { name: "b", ok: false, seconds: 2, output: "" },
      ],
      ["c"],
      3,
      false,
    );
    expect(text).toMatch(/ok .* a\n/);
    expect(text).toMatch(/FAILED .* b\n/);
    expect(text).toMatch(/not run .* c\n/);
    expect(text).toEndWith("FAILED in 3.0 s\n");
  });
});

describe("the gate as a program", () => {
  const PLAN = resolve(import.meta.dirname, "plan.ts");

  test("a slow reader still gets the whole output and the table, FAILED lines included", async () => {
    // 2 MB from a step that fails, read by a pipe that waits a second before it reads at all.
    const plan = JSON.stringify({ first: [], lanes: [[["loud", "yes x | head -c 2000000; exit 1"]]], last: [] });
    const reader = Bun.spawn(["bash", "-c", `${process.execPath} ${PLAN} '${plan}' | (sleep 1; cat); exit \${PIPESTATUS[0]}`], { stdout: "pipe" });
    const text = await new Response(reader.stdout).text();
    expect(await reader.exited).toBe(1);
    expect(text.length).toBeGreaterThan(2_000_000);
    expect(text).toContain("── loud FAILED");
    expect(text).toMatch(/FAILED +[0-9.]+ s +loud\nFAILED in [0-9.]+ s\n$/);
  }, 20_000);

  test("SIGINT stops the running steps, starts no other, prints what it had, and exits 130", async () => {
    const plan = JSON.stringify({
      first: [["first", "true"]],
      lanes: [[["slow", "echo pid $$; sleep 30"], ["after", "true"]], [["quick", "true"]]],
      last: [["last", "true"]],
    });
    const gate = Bun.spawn([process.execPath, PLAN, plan], { stdout: "pipe", stderr: "pipe" });
    await Bun.sleep(1_500);
    const started = performance.now();
    // Twice at once, as from a terminal: to the gate and passed on by `bun run`.
    gate.kill("SIGINT");
    gate.kill("SIGINT");
    const code = await gate.exited;
    const text = await new Response(gate.stdout).text();
    expect(code).toBe(130);
    expect((performance.now() - started) / 1000).toBeLessThan(5);
    expect(text).toContain("── slow FAILED");
    expect(text).toMatch(/ok +[0-9.]+ s +quick\n/);
    expect(text).toMatch(/not run +after\n/);
    expect(text).toMatch(/not run +last\n/);
    expect(text).toEndWith(` s\n`);
    expect(text).toMatch(/INTERRUPTED by SIGINT in [0-9.]+ s\n$/);
    // The step's shell got the signal too: it is gone, not left running.
    const pid = Number(/pid (\d+)/.exec(text)?.[1]);
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow();
  }, 20_000);
});

describe("the gate under more signals", () => {
  const PLAN = resolve(import.meta.dirname, "plan.ts");
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  /** The state letter of a process in /proc (T: stopped), or undefined when it is gone. */
  const state = (pid: number) => {
    try {
      return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.[0];
    } catch {
      return undefined;
    }
  };
  const pidIn = async (file: string) => {
    for (let tries = 0; tries < 50 && !existsSync(file); tries++) await Bun.sleep(100);
    return Number(readFileSync(file, "utf8"));
  };
  const scratch = () => mkdtempSync(join(tmpdir(), "gate-test-"));

  test("a second signal a second later kills a step that caught the first, and exits at once", async () => {
    const file = join(scratch(), "pid");
    const plan = JSON.stringify({ first: [], lanes: [[["stubborn", `trap 'echo caught' INT; echo $$ > ${file}; while :; do sleep 0.2; done`]]], last: [] });
    const gate = Bun.spawn([process.execPath, PLAN, plan], { stdout: "ignore", stderr: "ignore" });
    const pid = await pidIn(file);
    gate.kill("SIGINT");
    await Bun.sleep(1_500);
    expect(alive(pid)).toBe(true);
    gate.kill("SIGINT");
    expect(await gate.exited).toBe(130);
    await Bun.sleep(200);
    expect(alive(pid)).toBe(false);
  }, 20_000);

  test("SIGQUIT is passed on to the steps, and the gate exits 131 with its table", async () => {
    const file = join(scratch(), "pid");
    const plan = JSON.stringify({ first: [], lanes: [[["slow", `echo $$ > ${file}; sleep 30`]]], last: [["last", "true"]] });
    const gate = Bun.spawn([process.execPath, PLAN, plan], { stdout: "pipe", stderr: "ignore" });
    const pid = await pidIn(file);
    gate.kill("SIGQUIT");
    expect(await gate.exited).toBe(131);
    expect(await new Response(gate.stdout).text()).toMatch(/not run +last\nINTERRUPTED by SIGQUIT in [0-9.]+ s\n$/);
    expect(alive(pid)).toBe(false);
  }, 20_000);

  test.skipIf(!existsSync("/proc/self/stat"))("Ctrl-Z stops the steps with the gate, and SIGCONT starts them again", async () => {
    const file = join(scratch(), "pid");
    const plan = JSON.stringify({ first: [], lanes: [[["loop", `echo $$ > ${file}; while :; do sleep 0.1; done`]]], last: [] });
    const gate = Bun.spawn([process.execPath, PLAN, plan], { stdout: "ignore", stderr: "ignore" });
    const pid = await pidIn(file);
    gate.kill("SIGTSTP");
    await Bun.sleep(500);
    expect(state(gate.pid)).toBe("T");
    expect(state(pid)).toBe("T");
    gate.kill("SIGCONT");
    await Bun.sleep(500);
    expect(state(gate.pid)).not.toBe("T");
    expect(state(pid)).not.toBe("T");
    gate.kill("SIGTERM");
    expect(await gate.exited).toBe(143);
    expect(alive(pid)).toBe(false);
  }, 20_000);
});

describe("what the gate runs", () => {
  const scripts = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).scripts as Record<string, string>;

  test("every step is a script of the root package.json, and every test and check script is a step", () => {
    const steps = [...FIRST, ...LANES.flat(), ...LAST];
    for (const step of steps) expect(scripts[step]).toBeDefined();
    const covered = new Set(steps);
    const left = Object.keys(scripts).filter((name) => /^(test|check):/.test(name) && !covered.has(name));
    expect(left).toEqual([]);
    expect(covered.has("typecheck") && covered.has("build")).toBe(true);
  });

  test("the steps that rewrite files others read run first, alone", () => {
    expect([...FIRST]).toEqual(["check:core", "build:contracts", "check:abi", "test:vectors"]);
    expect([...LAST]).toEqual(["check:core"]);
  });

  test("every tsconfig.json of the workspaces is typechecked", () => {
    const glob = new Bun.Glob("{apps,packages,infra,tests,tools}/**/tsconfig.json");
    const found = [...glob.scanSync({ cwd: ROOT })]
      .filter((file) => !file.includes("node_modules") && !file.startsWith("infra/anvil/") && !file.startsWith("infra/seed/"))
      .map((file) => file.replace(/\/tsconfig\.json$/, ""))
      .sort();
    expect([...PROJECTS].sort() as string[]).toEqual(found);
  });
});
