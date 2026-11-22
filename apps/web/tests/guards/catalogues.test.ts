import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SRC } from "./files";

/**
 * The catalogues guard (review round 1): the words are not in the entry chunk. A real `vite build`
 * of the main entry runs twice, with the example configuration made public (`local: false`) and
 * as it is (local), and the emitted JavaScript is read:
 *  - the entry chunk (`index-*.js`) holds no screen's sentence in either language;
 *  - each language's screen sentences sit in one chunk of their own, so a reader downloads the
 *    words of the language they read, and the other language only when they switch;
 *  - the dev wallet's sentences are in no file of a public build, and are in a local one.
 * Each build takes about two seconds.
 */

const HAND = join(SRC, "..");
const example = readFileSync(join(SRC, "config/config.example.json"), "utf8");
const work = mkdtempSync(join(tmpdir(), "ahand-catalogues-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

async function catalogue(path: string): Promise<Record<string, string>> {
  return ((await import(join(SRC, path))) as { default: Record<string, string> }).default;
}

/** The longest message of a catalogue that has no ICU argument: it reaches the bundle verbatim. */
function sentence(words: Record<string, string>): string {
  const plain = Object.values(words).filter((message) => !/[{}'"\\]/.test(message));
  return plain.sort((a, b) => b.length - a.length)[0]!;
}

const raiseEn = sentence(await catalogue("screens/raise/en.ts"));
const raiseRu = sentence(await catalogue("screens/raise/ru.ts"));
const devEn = sentence(await catalogue("screens/dev-wallet/en.ts"));
const devRu = sentence(await catalogue("screens/dev-wallet/ru.ts"));

/** Builds the main entry with the configuration `local`, returning each emitted .js file's text by name. */
function build(local: boolean): Map<string, string> {
  const name = local ? "local" : "public";
  const config = join(work, `${name}.json`);
  const parsed = JSON.parse(example) as { chain: { local: boolean } };
  parsed.chain.local = local;
  writeFileSync(config, JSON.stringify(parsed));
  const out = join(work, name);
  const run = Bun.spawnSync([process.execPath, "x", "vite", "build", "--logLevel", "error"], {
    cwd: HAND,
    env: { ...process.env, AHAND_CONFIG: config, AHAND_OUT_DIR: out, AHAND_VITE_CACHE: join(work, `cache-${name}`) },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (run.exitCode !== 0) throw new Error(`vite build (${name}) failed:\n${run.stderr.toString()}`);
  const files = new Map<string, string>();
  for (const file of readdirSync(join(out, "assets"))) if (file.endsWith(".js")) files.set(file, readFileSync(join(out, "assets", file), "utf8"));
  return files;
}

function holding(files: Map<string, string>, text: string): string[] {
  return [...files].filter(([, code]) => code.includes(text)).map(([file]) => file);
}

describe("catalogues: the words load by language, not in the entry chunk", () => {
  const publicBuild = build(false);
  const localBuild = build(true);

  test("the sentences picked are real sentences", () => {
    for (const text of [raiseEn, raiseRu, devEn, devRu]) expect(text.length).toBeGreaterThan(30);
  });

  for (const [name, files] of [
    ["public", publicBuild],
    ["local", localBuild],
  ] as const) {
    test(`${name} build: the entry chunk holds no screen sentence`, () => {
      const entry = [...files.keys()].filter((file) => /^index-[\w-]+\.js$/.test(file));
      expect(entry).toHaveLength(1);
      const code = files.get(entry[0]!)!;
      expect({ en: code.includes(raiseEn), ru: code.includes(raiseRu) }).toEqual({ en: false, ru: false });
    });

    test(`${name} build: English and Russian screen words are each in one chunk, not the same one`, () => {
      const en = holding(files, raiseEn);
      const ru = holding(files, raiseRu);
      expect(en).toHaveLength(1);
      expect(ru).toHaveLength(1);
      expect(en[0]).not.toBe(ru[0]);
    });
  }

  test("public build: the dev wallet's sentences are in no file", () => {
    expect([...holding(publicBuild, devEn), ...holding(publicBuild, devRu)]).toEqual([]);
  });

  test("local build: the dev wallet's sentences are there, each with its own language", () => {
    expect(holding(localBuild, devEn)).toEqual(holding(localBuild, raiseEn));
    expect(holding(localBuild, devRu)).toEqual(holding(localBuild, raiseRu));
  });
});
