import { describe, expect, test } from "bun:test";

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { SRC, code, filesUnder, hits, source } from "./files";

/**
 * The colour guard: five raw colour values, and only in design/tokens.css and
 * design/tokens.ts. Everywhere else a colour is a token (`var(--ink)`, `var(--ink-a60)`,
 * `rgb(var(--ink-rgb) / 0.5)`). Caught: hex colours, and rgb()/hsl()/hwb()/lab()/oklch() written
 * with numbers.
 *
 * A see-through colour is never made with color-mix(), in a stylesheet or by a utility's opacity
 * modifier (a theme colour, a slash and a number): Safari before 16.2 has no color-mix(), the
 * build then leaves it the solid colour, and quiet text turns loud, a tone turns into a slab and
 * a fade into a hard edge. The steps are tokens over the theme's channels instead.
 */

/** Every file under an absolute folder whose name matches, node_modules left out. */
function everyFile(root: string, pattern: RegExp): string[] {
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
      else if (pattern.test(entry)) found.push(path);
    }
  };
  walk(root);
  return found.sort();
}

/** Script text with line and block comments blanked, strings kept. */
function stripComments(text: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const c = text[i]!;
    const next = text[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
    } else if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const TOKEN_FILES = new Set(["design/tokens.css", "design/tokens.ts"]);
const HEX = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/;
const FUNCTION = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[0-9.]/;

describe("colour: raw values live in the token files only", () => {
  const files = filesUnder("", /\.(ts|tsx|css)$/).filter((file) => !TOKEN_FILES.has(file));

  test("no hex colour outside the token files", () => {
    // CSS keeps its comments in the scan: a hex in a comment still invites a copy.
    expect(files.flatMap((file) => hits(file, file.endsWith(".css") ? source(file) : code(file), HEX))).toEqual([]);
  });

  test("no rgb(), hsl() or other colour function with raw numbers outside the token files", () => {
    expect(files.flatMap((file) => hits(file, file.endsWith(".css") ? source(file) : code(file), FUNCTION))).toEqual([]);
  });

  // A quick hint over the sources. What a build really writes is read in tests/vercel.test.ts.
  const MIX = /color-mix\(/i;
  // A utility that ends in a theme colour (or the current one, or a variable) and an opacity:
  // `text-ink/70`, `border-t-ink/50`, `bg-ink/[0.5]`, `bg-ink/(--a)`, `bg-current/50`, `bg-(--ink)/50`.
  const MODIFIER = /(?:^|[\s"'`:!])[a-z][a-z-]*-(?:(?:ink|paper|amber|card|gold|current)|\([^)\s]*\)|\[[^\]\s]*\])\/(?:\d|\[|\()/;

  test("no color-mix() in a stylesheet and no opacity modifier on a colour in markup, in the app, its exit page and the card", () => {
    const roots = [SRC, join(SRC, "..", "exit"), join(SRC, "..", "..", "..", "packages", "card", "src")];
    const found: string[] = [];
    for (const root of roots) {
      for (const file of everyFile(root, /\.(ts|tsx|css)$/)) {
        if (/\.test\.tsx?$/.test(file)) continue;
        const text = readFileSync(file, "utf8");
        // Comments are dropped: this file and the token file say the function's name to explain the rule.
        const body = file.endsWith(".css") ? text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " ")) : stripComments(text);
        const name = relative(join(SRC, "..", "..", ".."), file);
        found.push(...hits(name, body, MIX), ...hits(name, body, MODIFIER));
      }
    }
    expect(found).toEqual([]);
  });

  test("the modifier pattern catches every way to write one and spares what is not one", () => {
    for (const bad of ['"text-ink/70 underline"', "border-t-ink/50", "border-x-paper/20", "ring-offset-ink/40", "bg-ink/[0.5]", "bg-ink/(--a)", "bg-current/50", "hover:text-current/60", "bg-(--ink)/50", "bg-[var(--ink)]/50"]) {
      expect({ bad, caught: MODIFIER.test(bad) }).toEqual({ bad, caught: true });
    }
    for (const good of ['"text-ink underline"', "w-1/2", "aspect-[4/3]", "text-[color:var(--ink-a70)]", "a href='/limits/1'", "grid-cols-2/3"]) {
      expect({ good, caught: MODIFIER.test(good) }).toEqual({ good, caught: false });
    }
    expect(MIX.test("background: Color-Mix(in srgb, red, blue)")).toBe(true);
  });

  test("each raw colour and its channels are the same colour", () => {
    const tokens = source("design/tokens.css");
    for (const name of ["ink", "paper", "amber", "card"]) {
      const hex = tokens.match(new RegExp(`--ah-raw-${name}: #([0-9a-f]{6});`))![1]!;
      const channels = tokens.match(new RegExp(`--ah-raw-${name}-rgb: (\\d+) (\\d+) (\\d+);`))!.slice(1).map(Number);
      expect(channels).toEqual([0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)));
    }
  });

  test("whoever sets --ink or --paper sets its channels in the same rule, so the see-through steps follow", () => {
    const found: string[] = [];
    for (const root of [SRC, join(SRC, "..", "exit")]) {
      for (const file of everyFile(root, /\.css$/)) {
        const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
        // Each innermost rule body: no brace inside it.
        for (const rule of text.match(/\{[^{}]*\}/g) ?? []) {
          for (const slot of ["ink", "paper"]) {
            if (new RegExp(`(?:^|[\\s;{])--${slot}\\s*:`).test(rule) && !new RegExp(`--${slot}-rgb\\s*:`).test(rule)) found.push(`${relative(SRC, file)}: --${slot} without --${slot}-rgb`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });

  test("the patterns catch colours and spare addresses and ids", () => {
    for (const bad of ["color: #fff;", "#F5B841", "fill='#10101480'", "rgba(16, 16, 20, .45)", "hsl(40 90% 61%)"]) {
      expect(HEX.test(bad) || FUNCTION.test(bad)).toBe(true);
    }
    for (const good of ["0x0f0555972388151D2C187f636A0855b6eE9B9685", "href='/#main'", "color: var(--ink)", "rgb(var(--x))", "#root", "issue #1234x"]) {
      expect(HEX.test(good) || FUNCTION.test(good)).toBe(false);
    }
  });
});
