import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { SRC, hits } from "./files";

/**
 * The browser guard: the app's own code, its exit page and the workspace packages it bundles call
 * nothing that Safari 15.4 does not have. A phone that was never updated keeps its first Safari
 * (an iPhone 14 on iOS 16.0 is in use), and one call to a newer function is enough to stop a
 * screen: `AbortSignal.any` in the code that follows a sent transaction threw on every iOS before
 * 17.4 right after the transaction had gone out, so a raise in two steps sent the allowance and
 * never the raise.
 *
 * Refused, with the Safari that brought each: AbortSignal.any, Promise.withResolvers,
 * Object.groupBy, Map.groupBy (17.4); Array.fromAsync and a regular expression that looks behind
 * (16.4); AbortSignal.timeout and the copying array methods toSorted, toReversed, toSpliced (16.0).
 * tests/setup/old-browser.ts takes these away from every unit test, and with them what a pattern
 * cannot tell by its name (a Set's union, intersection and the rest, 17.0; an array's `with`,
 * 16.0), so a call this file misses still fails where it is tested.
 *
 * Not read: the libraries in node_modules. What they call on a path the app takes shows in the
 * unit tests that run them, and nowhere else.
 */

const ROOT = join(SRC, "..", "..", "..");
const ROOTS = [SRC, join(SRC, "..", "exit"), ...["sdk", "abi", "deliver", "card"].map((name) => join(ROOT, "packages", name, "src"))];

const NEWER: [string, RegExp][] = [
  ["AbortSignal.any (Safari 17.4)", /\bAbortSignal\s*\.\s*any\b/],
  ["AbortSignal.timeout (Safari 16.0)", /\bAbortSignal\s*\.\s*timeout\b/],
  ["Promise.withResolvers (Safari 17.4)", /\bPromise\s*\.\s*withResolvers\b/],
  ["Object.groupBy or Map.groupBy (Safari 17.4)", /\b(?:Object|Map)\s*\.\s*groupBy\b/],
  ["Array.fromAsync (Safari 16.4)", /\bArray\s*\.\s*fromAsync\b/],
  ["toSorted, toReversed or toSpliced (Safari 16.0)", /\.\s*to(?:Sorted|Reversed|Spliced)\s*\(/],
  ["a regular expression that looks behind (Safari 16.4)", /\(\?<[=!]/],
];

function everyFile(root: string): string[] {
  const found: string[] = [];
  const walk = (at: string) => {
    let entries: string[];
    try {
      entries = readdirSync(at);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules") continue;
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(path);
    }
  };
  walk(root);
  return found.sort();
}

/** Script text with comments blanked; strings and regular expressions stay, since a call can hide in neither by accident. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (line, before: string) => before + " ".repeat(line.length - before.length));
}

describe("browser: nothing newer than Safari 15.4 in the code the app ships", () => {
  test("the sources call none of the newer functions and write no look-behind", () => {
    const found: string[] = [];
    for (const root of ROOTS) {
      for (const file of everyFile(root)) {
        const body = withoutComments(readFileSync(file, "utf8"));
        for (const [what, pattern] of NEWER) found.push(...hits(relative(ROOT, file), body, pattern).map((hit) => `${what}: ${hit}`));
      }
    }
    expect(found).toEqual([]);
  });

  test("the folders read are there, with files in them", () => {
    for (const root of ROOTS) expect({ root: relative(ROOT, root), files: everyFile(root).length > 0 }).toEqual({ root: relative(ROOT, root), files: true });
  });

  test("the patterns catch each newer thing and spare its neighbours", () => {
    const bad = ["AbortSignal.any([a, b])", "AbortSignal.timeout(5)", "Promise.withResolvers<void>()", "Object.groupBy(list, by)", "await Array.fromAsync(stream)", "rows.toSorted(byDate)", "/(?<=\\$)\\d+/", "/(?<!a)b/"];
    for (const line of bad) expect({ line, caught: NEWER.some(([, pattern]) => pattern.test(line)) }).toEqual({ line, caught: true });
    const good = ["new AbortController()", "signal.any", "list.sort(byDate)", "/(?<name>\\d+)/", "/(?=a)b/", "Promise.all(list)", "anyOf(signals)", "z.union([a, b])"];
    for (const line of good) expect({ line, caught: NEWER.some(([, pattern]) => pattern.test(line)) }).toEqual({ line, caught: false });
  });

  test("the unit tests themselves run without the newer functions (bunfig.toml, tests/setup/old-browser.ts)", () => {
    expect("any" in AbortSignal).toBe(false);
    expect("timeout" in AbortSignal).toBe(false);
    expect("withResolvers" in Promise).toBe(false);
    expect("toSorted" in Array.prototype).toBe(false);
    expect("union" in Set.prototype).toBe(false);
  });
});
