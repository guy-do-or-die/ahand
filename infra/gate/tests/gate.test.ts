/**
 * The gate's runner: a step that fails fails the gate, every step runs to its end, and no more run
 * at once than the limit.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { FIRST, LANES, LAST, PROJECTS, run, sideBySide, type Ran } from "../gate.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const sh = (name: string, line: string) => ({ name, command: "bash", args: ["-c", line] });

describe("run", () => {
  test("keeps the output and the exit code", async () => {
    expect(await run(sh("ok", "echo out; echo err >&2"))).toMatchObject({ name: "ok", ok: true, output: "out\nerr\n" });
    expect((await run(sh("fails", "exit 3"))).ok).toBe(false);
    expect((await run({ name: "missing", command: "/no/such/program", args: [] })).ok).toBe(false);
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
