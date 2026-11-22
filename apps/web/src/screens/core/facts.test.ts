import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";

import { reproduceCommand } from "../../../../../tools/manifest";
import example from "../../config/config.example.json";
import en from "./en";
import ru from "./ru";
import { capDays, derive, paidPassesAtWorst, readServedBuild, reproduceLine } from "./facts";
import { LIMIT_COUNT } from "./limits";

describe("core: the facts /core shows", () => {
  test("the derivation of the example configuration gives its Core, and another salt does not", () => {
    const deployment = example.deployment as { factory: `0x${string}`; salt: `0x${string}`; initcodeHash: `0x${string}` };
    const core = getAddress(example.cores.canonical);
    expect(derive(deployment, core)).toEqual({ derived: core, matches: true });
    const other = derive({ ...deployment, salt: `0x${"00".repeat(32)}` }, core);
    expect(other.matches).toBe(false);
  });

  test("the reproduce line is the CLI's, word for word, with and without a commit", () => {
    expect(reproduceLine()).toBe(reproduceCommand());
    expect(reproduceLine("9d2bf363")).toBe(reproduceCommand("9d2bf363"));
  });

  test("build.json: a built site's answer is read; a dev server's page is not a build", () => {
    const hash = "ab".repeat(32);
    expect(readServedBuild("application/json", JSON.stringify({ hash, command: "sha256sum", commit: "abc", dirty: false, files: [1, 2] }))).toEqual({
      kind: "served",
      hash,
      command: "sha256sum",
      commit: "abc",
      dirty: false,
      files: 2,
    });
    expect(readServedBuild("text/html", "<!doctype html>")).toEqual({ kind: "none" });
    expect(readServedBuild("application/json", "{}")).toEqual({ kind: "none" });
    expect(readServedBuild("application/json", "not json")).toEqual({ kind: "none" });
    expect(readServedBuild(null, JSON.stringify({ hash }))).toEqual({ kind: "none" });
  });

  test("the cap in days", () => {
    expect(capDays(180 * 86_400)).toBe(180);
  });

  test("twelve accepted limits in both languages", () => {
    expect(LIMIT_COUNT).toBe(12);
    for (let n = 1; n <= 12; ++n) {
      expect((en as Record<string, string>)[`core.lens.limit.${n}`]).toBeTruthy();
      expect((ru as Record<string, string>)[`core.lens.limit.${n}`]).toBeTruthy();
    }
    expect((en as Record<string, string>)["core.lens.limit.13"]).toBeUndefined();
  });

  test("the paid passes one thanks can carry at worst: 55 at this build's default, 66 at 200", () => {
    expect(example.defaults.payoutGasK).toBe(250);
    expect(paidPassesAtWorst(example.defaults.payoutGasK)).toBe(55);
    expect(paidPassesAtWorst(200)).toBe(66);
    // The sentence's "about 70" is the figure of a smaller limit; a larger limit carries fewer.
    expect(paidPassesAtWorst(500)).toBeLessThan(55);
    for (const words of [en, ru] as Record<string, string>[]) {
      expect(words["core.lens.limit.4.body"]).toMatch(/70/); // the limit's sentence stays as it is
      expect(words["core.lens.limit.4.here"]).toContain("{n");
      expect(words["core.lens.limit.4.here"]).toContain("{k}");
    }
  });
});
