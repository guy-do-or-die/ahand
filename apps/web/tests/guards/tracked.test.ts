import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The tracked-files guard: the repository is public, so no tracked text file carries Russian
 * profanity, a path into someone's home folder, or a record id of a private working document. It
 * reads every file `git ls-files` lists (the whole clone, not only apps/web; contracts/lib is not
 * tracked), skips binary files, and checks each line.
 *
 * - Profanity: a short list of Russian stems, case-insensitive. The stems that also sit inside
 *   ordinary words (the Russian for "requires", "bread" or "to use") count only at the start of a
 *   word. The i18n catalogues and their tests are read too: none of their words matches, so they
 *   need no exemption.
 * - Home folders: a Linux or macOS home path (the users folder too). Allowed, by file: the
 *   synthetic `me` paths of exit.html's file-serving tests and the CI runner's own home in the
 *   workflow. Nothing else.
 * - Private record ids: a capital letter group from a private working document's numbering
 *   followed by a dash and a number, such as the letter R, a dash and 3 (the groups are listed at
 *   PRIVATE_ID; capitals only, and only standing as a word of their own). A finding's id is caught
 *   with or without the dash: F, then one to three digits, standing alone; a private use case's as
 *   U and one or two digits, and a private UX spec's sections as "UX" and the section sign. No public file defines
 *   them, so they point at nothing a reader can open. A function key's name standing alone would
 *   be caught too, so a line that needs one names the key in words.
 *
 * The patterns are written with escapes, so this file does not match itself.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");

/** A word from its code points, so the stems never stand in this file as text. */
function w(...points: number[]): string {
  return String.fromCodePoint(...points);
}

/** Stems matched anywhere in a word, then stems matched only where a word starts. */
const ANYWHERE = [w(0x445, 0x443, 0x439), w(0x445, 0x443, 0x44f), w(0x445, 0x443, 0x435), w(0x43f, 0x438, 0x437, 0x434), w(0x43d, 0x430, 0x445, 0x435, 0x440), w(0x43f, 0x43e, 0x445, 0x435, 0x440)];
const WORD_START = [w(0x431, 0x43b, 0x44f), w(0x441, 0x443, 0x43a, 0x430), w(0x436, 0x43e, 0x43f), w(0x435, 0x431, 0x43b), w(0x435, 0x431, 0x430), w(0x435, 0x431, 0x443)];
const PROFANITY = new RegExp(`(?:${ANYWHERE.join("|")})|(?<![\\u0430-\\u044f\\u0451])(?:${WORD_START.join("|")})`, "iu");

const HOME = /\/(?:home|Users)\/[^\s/"'`]+/;

/**
 * A private record id: R, D, M, IN, U, C, A, W, O, L or F, a dash and a number, F and one to three
 * digits with no dash (a finding's id), U and one or two digits with no dash (a private list of use
 * cases), standing as a word of its own; or a section of a private UX spec ("UX" and the section sign): a letter group inside
 * a longer name (the end of SHA), a hex number (0xF1) and a colour (#F00) are not one.
 */
const PRIVATE_ID = /(?<![\w#+-])(?:(?:R|D|M|IN|U|C|A|W|O|L|F)-\d+|F\d{1,3}|U\d{1,2})(?![\w-])|UX ?\u00a7/u;

/** The only home paths allowed, by file: each is synthetic or the CI runner's. */
const HOME_ALLOWED: Record<string, string[]> = {
  ".github/workflows/check.yml": [path("home", "runner")],
  "apps/web/exit/logic.test.ts": [path("home", "me"), path("Users", "me")],
};

/** "/a/b", built from its parts so this file never matches HOME. */
function path(...parts: string[]): string {
  return `/${parts.join("/")}`;
}

function tracked(): string[] {
  const run = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: ROOT });
  if (run.exitCode !== 0) throw new Error(`git ls-files failed: ${run.stderr.toString()}`);
  return run.stdout.toString().split("\0").filter(Boolean);
}

function text(file: string): string | null {
  const path = join(ROOT, file);
  try {
    if (!statSync(path).isFile()) return null;
  } catch {
    return null; // listed by git but deleted in the working tree
  }
  const bytes = readFileSync(path);
  return bytes.includes(0) ? null : bytes.toString("utf8");
}

/** Each offending line of `body`, as "file:line: text". */
export function offences(file: string, body: string): string[] {
  const allowed = HOME_ALLOWED[file] ?? [];
  const out: string[] = [];
  body.split("\n").forEach((line, i) => {
    const home = allowed.reduce((rest, path) => rest.split(path).join(""), line);
    if (PROFANITY.test(line) || HOME.test(home) || PRIVATE_ID.test(line)) out.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return out;
}

describe("tracked files: no profanity, no home paths and no private record ids", () => {
  const files = tracked();

  test("the clone's tracked files are found", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain("apps/web/src/shell/Shell.tsx");
    expect(files).toContain("docs/app.md");
  });

  test("no tracked text file holds Russian profanity, a home path or a private record id", () => {
    const found = files.flatMap((file) => {
      const body = text(file);
      return body === null ? [] : offences(file, body);
    });
    expect(found).toEqual([]);
  });

  test("the patterns catch what they are for and spare ordinary words", () => {
    // In order: eight swear words, each in a line; then six ordinary words that hold a stem inside.
    const bad = [
      w(0x43d, 0x430, 0x445, 0x443, 0x44f),
      w(0x425, 0x443, 0x439, 0x43d, 0x44f),
      w(0x440, 0x430, 0x441, 0x43f, 0x438, 0x437, 0x434, 0x435, 0x446),
      w(0x431, 0x43b, 0x44f),
      w(0x436, 0x43e, 0x43f, 0x430),
      w(0x435, 0x431, 0x430, 0x442, 0x44c),
      w(0x441, 0x443, 0x43a, 0x430),
      w(0x43f, 0x43e, 0x445, 0x435, 0x440, 0x438, 0x43b),
    ];
    for (const word of bad) expect(offences("docs/x.md", `so ${word}!`)).toHaveLength(1);
    const good = [
      w(0x442, 0x440, 0x435, 0x431, 0x443, 0x435, 0x442, 0x441, 0x44f),
      w(0x445, 0x43b, 0x435, 0x431, 0x430),
      w(0x443, 0x43f, 0x43e, 0x442, 0x440, 0x435, 0x431, 0x43b, 0x44f, 0x442, 0x44c),
      w(0x425, 0x443, 0x434, 0x43e, 0x436, 0x43d, 0x438, 0x43a),
      w(0x43d, 0x435, 0x431, 0x43e),
      w(0x43a, 0x43e, 0x448, 0x435, 0x43b, 0x451, 0x43a),
    ];
    for (const word of good) expect(offences("docs/x.md", `so ${word}.`)).toEqual([]);
    const home = path("home", "someone", "work", "x.ts");
    expect(offences("tests/e2e/x.ts", `const SHOTS = "${home}";`)).toHaveLength(1);
    expect(offences("tests/e2e/x.ts", `cd ${path("Users", "someone", "src")}`)).toHaveLength(1);
    expect(offences("tests/e2e/x.ts", "join(REPO_ROOT, \"output\", \"shots\")")).toEqual([]);
  });

  test("private record ids are caught; look-alikes in ordinary text are not", () => {
    const id = (group: string, n: number) => `${group}-${n}`;
    const ids = [id("R", 3), id("D", 40), id("M", 1), id("IN", 21), id("U", 7), id("C", 12), id("A", 1), id("W", 2), id("O", 5), id("L", 1), id("F", 4)];
    for (const found of ids) {
      expect(offences("apps/web/src/x.ts", `// as decided (${found}).`)).toHaveLength(1);
    }
    // A finding's id with no dash, in a comment and in a test's title.
    const finding = (n: number) => `F${n}`;
    expect(offences("apps/web/src/x.ts", `// ${finding(5)}: the row says the address comes later.`)).toHaveLength(1);
    expect(offences("tests/e2e/x.spec.ts", `test("the paste row comes after the gestures (${finding(17)})", () => {});`)).toHaveLength(1);
    for (const ok of ["0xF1", "#F00", "F1a", "xF2", "FF1", `${finding(1234)}`, `${finding(2)}-b`, `${finding(3)}_x`]) {
      expect(offences("apps/web/src/x.ts", `// ${ok}`)).toEqual([]);
    }
    expect(offences("tests/e2e/x.ts", `// ${id("A", 1)} to ${id("A", 4)} are fixed`)).toHaveLength(1);
    const fine = ["UTF-8", "SHA-1", "SHA-256", "ERC-6492", "EIP-712", "NIP-17", "x-1", "L2", "WCAG 2.2 AA", "l-1", "a-1", `${id("AR", 3)}`, `${id("R", 3)}a`, `${id("L", 1)}a`, `x${id("W", 2)}`, `${id("O", 5)}-b`];
    for (const ok of fine) {
      expect(offences("apps/web/src/x.ts", `// ${ok}`)).toEqual([]);
    }
  });

  test("the home-path allowance holds only its own paths in its own files", () => {
    const runner = path("home", "runner", ".foundry", "bin");
    expect(offences(".github/workflows/check.yml", `FOUNDRY_BIN: ${runner}`)).toEqual([]);
    expect(offences("docs/x.md", `FOUNDRY_BIN: ${runner}`)).toHaveLength(1);
    const other = path("home", "someone", "x");
    expect(offences(".github/workflows/check.yml", `X: ${other}`)).toHaveLength(1);
  });
});
