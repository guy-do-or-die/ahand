/**
 * The gate's runner: a step that fails fails the gate, every step runs to its end, a lane goes on
 * past a failure, no more run at once than the limit, and the table names what did not run.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
