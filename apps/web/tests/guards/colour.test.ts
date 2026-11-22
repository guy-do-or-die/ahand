import { describe, expect, test } from "bun:test";

import { code, filesUnder, hits, source } from "./files";

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

  test("no color-mix() in a stylesheet and no opacity modifier on a theme colour in markup", () => {
    const MIX = /color-mix\(/;
    const MODIFIER = /\b(?:text|bg|border|decoration|ring|outline|fill|stroke|divide|from|to|via|placeholder|caret|accent|shadow)-(?:ink|paper|amber|card|gold)\/\d/;
    const all = filesUnder("", /\.(ts|tsx|css)$/);
    // Comments are dropped: this file and the token file say the function's name to explain the rule.
    const body = (file: string) => (file.endsWith(".css") ? source(file).replace(/\/\*[\s\S]*?\*\//g, "") : code(file));
    expect(all.filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx")).flatMap((file) => [...hits(file, body(file), MIX), ...hits(file, body(file), MODIFIER)])).toEqual([]);
  });

  test("each raw colour and its channels are the same colour", () => {
    const tokens = source("design/tokens.css");
    for (const name of ["ink", "paper", "amber"]) {
      const hex = tokens.match(new RegExp(`--ah-raw-${name}: #([0-9a-f]{6});`))![1]!;
      const channels = tokens.match(new RegExp(`--ah-raw-${name}-rgb: (\\d+) (\\d+) (\\d+);`))!.slice(1).map(Number);
      expect(channels).toEqual([0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)));
    }
  });

  test("the patterns catch colours and spare addresses and ids", () => {
    for (const bad of ["color: #fff;", "#F5B841", "fill='#10101480'", "rgba(16, 16, 20, .45)", "hsl(40 90% 61%)"]) {
      expect(HEX.test(bad) || FUNCTION.test(bad)).toBe(true);
    }
    for (const good of ["0x65ac707E2AE7392583de5d6192C619F1D8862309", "href='/#main'", "color: var(--ink)", "rgb(var(--x))", "#root", "issue #1234x"]) {
      expect(HEX.test(good) || FUNCTION.test(good)).toBe(false);
    }
  });
});
