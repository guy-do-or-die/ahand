import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SRC, filesUnder } from "./files";

/**
 * The punctuation guard: no semicolon in the words a person reads. A semicolon joins two
 * sentences that each stand better alone, and on a screen it reads as text nobody edited. The
 * guard reads every word file as source: each screen's `en.ts` and `ru.ts`, the common
 * catalogues, the kit's and the wallet's words, the flip's own (ui/twist-words.ts), and the words of exit.html. Only
 * a semicolon followed by a space counts (a sentence's), so code inside a message is not caught.
 */

const WORD_FILES = [
  ...filesUnder("screens", /^(en|ru)\.ts$/),
  ...filesUnder("i18n/common", /^(en|ru)\.ts$/),
  "ui/words.ts",
  "ui/twist-words.ts",
  "wallet/words.ts",
  "screens/check/offline.ts",
];
const EXIT_WORDS = join(SRC, "..", "exit", "words.ts");
/** The link preview's words, which the view server writes and the raise screen shows. */
const CARD_WORDS = join(SRC, "..", "..", "..", "packages", "card", "src", "words.ts");

/** The string literals of a source file, each with its line. */
function literals(text: string): { line: number; value: string }[] {
  const found: { line: number; value: string }[] = [];
  for (const match of text.matchAll(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)) {
    found.push({ line: text.slice(0, match.index).split("\n").length, value: match[0].slice(1, -1) });
  }
  return found;
}

const joined = (value: string) => /\S; \S/.test(value) && !/^[a-z-]+: [^;]+; [a-z-]+:/.test(value);

describe("punctuation: the words a person reads have no semicolons", () => {
  test("the guard reads every screen's words in both languages", () => {
    expect(WORD_FILES.filter((file) => file.endsWith("/en.ts")).length).toBeGreaterThan(15);
    expect(WORD_FILES.filter((file) => file.endsWith("/ru.ts")).length).toBe(WORD_FILES.filter((file) => file.endsWith("/en.ts")).length);
  });

  test("no sentence is joined to the next by a semicolon", () => {
    const hits = WORD_FILES.flatMap((file) =>
      literals(readFileSync(join(SRC, file), "utf8"))
        .filter(({ value }) => joined(value))
        .map(({ line, value }) => `${file}:${line}: ${value.slice(0, 90)}`),
    );
    expect(hits).toEqual([]);
  });

  test("nor in exit.html's own words", () => {
    const hits = literals(readFileSync(EXIT_WORDS, "utf8"))
      .filter(({ value }) => joined(value))
      .map(({ line, value }) => `exit/words.ts:${line}: ${value.slice(0, 90)}`);
    expect(hits).toEqual([]);
  });

  test("nor in the link preview's words, the card and the lines a messenger shows", () => {
    const hits = literals(readFileSync(CARD_WORDS, "utf8"))
      .filter(({ value }) => joined(value))
      .map(({ line, value }) => `packages/card/src/words.ts:${line}: ${value.slice(0, 90)}`);
    expect(hits).toEqual([]);
  });

  test("the pattern catches a joined sentence and spares code", () => {
    expect(joined("It stays in this tab only; a reload forgets it.")).toBe(true);
    expect(joined("Она останется только в этой вкладке; обновишь страницу")).toBe(true);
    expect(joined("It stays in this tab only. A reload forgets it.")).toBe(false);
    expect(joined("margin: 0; padding: 0")).toBe(false);
  });
});
