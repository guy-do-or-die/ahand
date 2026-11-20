import { describe, expect, test } from "bun:test";

import { code, filesUnder, hits, source } from "./files";

/**
 * The colour guard (UX-SPEC §2): five raw colour values, and only in design/tokens.css and
 * design/tokens.ts. Everywhere else a colour is a token (`var(--ink)`, `text-ink/50`,
 * `color-mix(… var(--ink) …)`). Caught: hex colours, and rgb()/hsl()/hwb()/lab()/oklch() written
 * with numbers.
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

  test("the patterns catch colours and spare addresses and ids", () => {
    for (const bad of ["color: #fff;", "#F5B841", "fill='#10101480'", "rgba(16, 16, 20, .45)", "hsl(40 90% 61%)"]) {
      expect(HEX.test(bad) || FUNCTION.test(bad)).toBe(true);
    }
    for (const good of ["0x65ac707E2AE7392583de5d6192C619F1D8862309", "href='/#main'", "color: var(--ink)", "rgb(var(--x))", "#root", "issue #1234x"]) {
      expect(HEX.test(good) || FUNCTION.test(good)).toBe(false);
    }
  });
});
