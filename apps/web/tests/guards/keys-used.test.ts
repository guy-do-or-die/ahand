import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { Catalogue } from "../../src/i18n/catalogue";
import { code, filesUnder, SRC } from "./files";

/**
 * The used-keys guard (code review of 2026-11-22): every key of every Lingui catalogue
 * (i18n/common and each screens/<name>/en.ts and ru.ts) is read somewhere. The review found keys
 * no screen used, left behind when words moved to ui/words.ts, and they had drifted from the live
 * words; a key nobody reads is a sentence nobody checks.
 *
 * A key is read when it stands as a whole string literal ("raise.title", 'raise.title' or
 * `raise.title`) in the app's code (src, less the catalogues and the tests), in exit/, which
 * takes Core's refusals and the link errors from the common catalogue, or in the SDK's sources,
 * whose proof bundle names each check's sentence ("proof.core") and whose messageIdOf names the
 * error lines. A key built at run time, such as `core.${refusal.name}`, is read when it belongs
 * to a family in DYNAMIC below. The list
 * is explicit and kept short: each family names the file and the template that builds it, the
 * guard fails when that template is gone or the family matches no key, and a new template that
 * builds a key from a catalogue's prefix must be added here before it passes.
 *
 * It also reads the other way: an id written whole in a t() call is a key some catalogue has.
 * Lingui renders an unknown id as the id itself, and nothing else catches it: t() takes any string.
 *
 * The localization structure itself (several word systems: the Lingui catalogues, ui/words.ts,
 * exit/words.ts and the view server's own words; and only English and Russian) will get its own review later.
 * This guard only keeps the catalogues free of dead keys until then.
 */

/** Families of keys built at run time: the keys they match, where, and the template that builds them. */
const DYNAMIC: readonly { family: RegExp; file: string; template: string }[] = [
  { family: /^core\.[A-Z]\w*$/, file: "screens/thank/failure.ts", template: "`core.${refusal.name}`" },
  { family: /^link\.[a-z-]+$/, file: "screens/print/index.tsx", template: "`link.${named.code}`" },
  { family: /^common\.chain\.\d+$/, file: "i18n/common/chain.ts", template: "`common.chain.${chain.id}`" },
  { family: /^common\.language\.\w+$/, file: "shell/Shell.tsx", template: "`common.language.${code}`" },
  { family: /^common\.person\.role\.\w+$/, file: "shell/PersonSheet.tsx", template: "`common.person.role.${role}`" },
  { family: /^common\.token\.\w+$/, file: "screens/waiting/index.tsx", template: "`common.token.${token.kind}`" },
  { family: /^landing\.\w+\.say$/, file: "screens/landing/index.tsx", template: "`landing.${gesture}.say`" },
  { family: /^landing\.lens\.\w+$/, file: "screens/landing/index.tsx", template: "`landing.lens.${gesture}`" },
  { family: /^landing\.\w+\.more$/, file: "screens/landing/index.tsx", template: "`landing.${gesture}.more`" },
  { family: /^landing\.example\.\w+\.title$/, file: "screens/landing/examples.ts", template: "`landing.example.${example.id}.title`" },
  { family: /^landing\.example\.\w+\.details$/, file: "screens/landing/examples.ts", template: "`landing.example.${example.id}.details`" },
  { family: /^check\.state\.\w+$/, file: "screens/check/model.ts", template: "`check.state.${standing}`" },
  { family: /^check\.step\.\w+\.\w+$/, file: "screens/check/model.ts", template: "`check.step.${step.of}.${step.check}`" },
  { family: /^check\.kind\.[\w-]+$/, file: "screens/check/index.tsx", template: "`check.kind.${ruler.kind}`" },
  { family: /^check\.ruler\.[\w-]+$/, file: "screens/check/index.tsx", template: "`check.ruler.${segment.kind}`" },
  { family: /^check\.status\.[\w-]+$/, file: "screens/check/index.tsx", template: "`check.status.${step.status}`" },
  { family: /^check\.now\.[\w-]+$/, file: "screens/check/index.tsx", template: "`check.now.${now.state}`" },
  { family: /^thank\.payee\.\w+$/, file: "screens/thank/Flow.tsx", template: "`thank.payee.${finding.problem}`" },
  { family: /^core\.lens\.limit\.\d+$/, file: "screens/core/index.tsx", template: "`core.lens.limit.${n}`" },
  { family: /^core\.lens\.limit\.\d+\.body$/, file: "screens/core/index.tsx", template: "`core.lens.limit.${n}.body`" },
  { family: /^proof\.bad\.\w+$/, file: "screens/proof/index.tsx", template: "`proof.bad.${load.what}`" },
  { family: /^proof\.section\.[\w-]+$/, file: "screens/proof/index.tsx", template: "`proof.section.${section.key}`" },
  { family: /^proof\.(route|share)\.to$/, file: "screens/proof/model.ts", template: "`${check.messageId}.to`" },
  { family: /^dev-wallet\.connect\.role\.\w+$/, file: "screens/dev-wallet/index.tsx", template: "`dev-wallet.connect.role.${role}`" },
  { family: /^raise\.who\.\w+\.site$/, file: "screens/raise/parts.tsx", template: "`raise.who.${each}.site`" },
  { family: /^raise\.who\.unfurl\.\w+$/, file: "screens/raise/parts.tsx", template: "`raise.who.unfurl.${mode}`" },
  { family: /^give\.agree\.flagged\.\w+$/, file: "screens/give/index.tsx", template: "`give.agree.flagged.${landing.flagged}`" },
  { family: /^defaults\.\w+\.title$/, file: "screens/defaults/index.tsx", template: "`defaults.${row.key}.title`" },
  { family: /^defaults\.\w+\.body$/, file: "screens/defaults/index.tsx", template: "`defaults.${row.key}.body`" },
  { family: /^defaults\.value\.\w+$/, file: "screens/defaults/index.tsx", template: "`defaults.value.${row.value.key}`" },
  { family: /^print\.format\.\w+$/, file: "screens/print/index.tsx", template: "`print.format.${item}`" },
  { family: /^print\.closed\.\w+$/, file: "screens/print/index.tsx", template: "`print.closed.${closing.how}`" },
  { family: /^hand\.code\.link\.[a-z-]+$/, file: "screens/hand/held.ts", template: "`hand.code.link.${error.code}`" },
];

/** A catalogue file: i18n/common/{en,ru}.ts or screens/<name>/{en,ru}.ts. */
const CATALOGUE = /^(i18n\/common|screens\/[^/]+)\/(en|ru)\.ts$/;

async function load(path: string): Promise<Catalogue> {
  return ((await import(join(SRC, path))) as { default: Catalogue }).default;
}

// A screen folder without its own catalogue (one that only uses common words) is simply skipped.
const screens = readdirSync(join(SRC, "screens"))
  .filter((name) => !name.startsWith(".") && existsSync(join(SRC, "screens", name, "en.ts")))
  .sort();
const catalogues = ["i18n/common", ...screens.map((name) => `screens/${name}`)].flatMap((dir) => [`${dir}/en.ts`, `${dir}/ru.ts`]);
const keys = new Map<string, string>(); // key → the first catalogue that defines it
for (const path of catalogues) for (const key of Object.keys(await load(path))) if (!keys.has(key)) keys.set(key, path);

/** The code that reads the catalogues: src, exit/ and the SDK, comments blanked, less the catalogues and the tests. */
const SDK = "../../../packages/sdk/src";
const readers = [".", "../exit", SDK].flatMap((dir) => filesUnder(dir, /\.(ts|tsx)$/)).filter(
  (file) => !CATALOGUE.test(file) && !/\.test\.tsx?$/.test(file),
);
const texts = new Map(readers.map((file) => [file, code(file)]));
const corpus = [...texts.values()].join("\n");

const literal = (key: string) => [`"${key}"`, `'${key}'`, `\`${key}\``].some((quoted) => corpus.includes(quoted));
const dynamic = (key: string) => DYNAMIC.some(({ family }) => family.test(key));

describe("catalogue keys: every key is read somewhere", () => {
  test("the catalogues and the readers were found", () => {
    expect(catalogues.length).toBeGreaterThan(20);
    expect(keys.size).toBeGreaterThan(500);
    expect(readers).toContain("../exit/main.ts");
    expect(readers).toContain("shell/Shell.tsx");
    expect(readers).toContain(`${SDK}/proof.ts`);
  });

  test("no catalogue key is unused: each stands as a literal in the code or belongs to a listed dynamic family", () => {
    const unused = [...keys].filter(([key]) => !literal(key) && !dynamic(key)).map(([key, path]) => `${path}: ${key}`);
    expect(unused).toEqual([]);
  });

  test("every id written whole in a t() call is a key the catalogues have: an unknown id renders as itself", () => {
    // t("common.word.raise"), and both ids of t(cond ? "raise.a" : "raise.b"); an id built at run time is DYNAMIC's.
    const whole = /\bt\(\s*(["'`])([\w.-]+)\1/g;
    const either = /\bt\(\s*[^()"'`?]*\?\s*(["'`])([\w.-]+)\1\s*:\s*(["'`])([\w.-]+)\3/g;
    const missing: string[] = [];
    for (const [file, text] of texts) {
      const ids = [...[...text.matchAll(whole)].map((match) => match[2]!), ...[...text.matchAll(either)].flatMap((match) => [match[2]!, match[4]!])];
      for (const id of ids) if (!keys.has(id)) missing.push(`${file}: ${id}`);
    }
    expect(missing).toEqual([]);
  });

  test("each dynamic family's template still stands in its file and matches at least one key", () => {
    const stale = DYNAMIC.filter(({ family, file, template }) => !texts.get(file)?.includes(template) || ![...keys.keys()].some((key) => family.test(key)));
    expect(stale.map(({ file, template }) => `${file}: ${template}`)).toEqual([]);
  });

  test("every template that builds a key from a catalogue's prefix has its shape listed in DYNAMIC", () => {
    // The shape of a template is its text with each ${…} emptied: `core.${result.refusal.name}` in
    // a screen and `core.${string}` in exit/ have the listed family's shape `core.${}`.
    const shape = (template: string) => template.replace(/\$\{[^}]*\}/g, "${}");
    const prefixes = new Set([...keys.keys()].map((key) => key.split(".")[0]!));
    const listed = new Set(DYNAMIC.map(({ template }) => shape(template)));
    const unlisted: string[] = [];
    for (const [file, text] of texts) {
      for (const [template, prefix] of text.matchAll(/`([a-z][\w-]*)\.[\w.-]*\$\{[^`]*`/g)) {
        if (prefixes.has(prefix!) && !listed.has(shape(template))) unlisted.push(`${file}: ${template}`);
      }
    }
    expect(unlisted).toEqual([]);
  });
});
