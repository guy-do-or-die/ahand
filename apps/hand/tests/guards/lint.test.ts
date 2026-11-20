import { describe, expect, test } from "bun:test";

import { filesUnder, source } from "./files";

/**
 * The app has no linter (no eslint in its dependencies, no config, no lint script), so a linter's
 * directive in its sources switches nothing off and only looks like a check that ran. Where a
 * hook's dependency list leaves something out on purpose, a plain comment says why.
 */
describe("no linter directives in a tree with no linter", () => {
  test("no eslint-disable, eslint-enable or eslint-* comment anywhere in src/", () => {
    const found = filesUnder("", /\.(ts|tsx)$/).flatMap((file) =>
      source(file)
        .split("\n")
        .map((line, index) => ({ file, line: index + 1, text: line.trim() }))
        .filter(({ text }) => /\/[/*]\s*eslint[-\s]/.test(text)),
    );
    expect(found).toEqual([]);
  });
});
