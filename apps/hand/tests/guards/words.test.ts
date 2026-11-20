import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { compileMessage } from "@lingui/message-utils/compileMessage";

import { mergeCatalogue, type Catalogue, type CatalogueModules } from "../../src/i18n/catalogue";
import { SRC } from "./files";

/**
 * The words guard (UX-SPEC §5, D-53): every catalogue has the same keys in English and Russian,
 * each key lives in one catalogue only and starts with its screen's name, every message compiles
 * as ICU with the same placeholders in both languages, and no banned word stands on the human
 * layer.
 *
 * The specialist layer is exempt from the banned words: keys with a `lens` segment
 * (`common.lens.cap`, `proof.lens.gas`), where Core's own names stand in mono, and the local-only
 * dev wallet page. Allowed phrases: "Connect a wallet" / «Подключить кошелёк» anywhere; "No fee"
 * / «Без комиссии» in the footer line; "safe" / «в безопасности» only on /waiting (PLAN, feat-waiting).
 */

interface Place {
  name: string; // "common" or the screen's folder
  en: Catalogue;
  ru: Catalogue;
}

async function load(dir: string): Promise<Catalogue> {
  return ((await import(join(SRC, dir))) as { default: Catalogue }).default;
}

const screenNames = readdirSync(join(SRC, "screens")).filter((name) => !name.startsWith(".")).sort();
const places: Place[] = [
  { name: "common", en: await load("i18n/common/en.ts"), ru: await load("i18n/common/ru.ts") },
  ...(await Promise.all(
    screenNames.map(async (name) => ({ name, en: await load(`screens/${name}/en.ts`), ru: await load(`screens/${name}/ru.ts`) })),
  )),
];

const BANNED_EN: [string, RegExp][] = [
  ["wallet", /\bwallets?\b/i],
  ["gas", /\bgas\b/i],
  ["transaction", /\btransactions?\b/i],
  ["sign", /\b(sign|signs|signed|signing|signature|signatures|signer|signers)\b/i],
  ["escrow", /\bescrows?\b/i],
  ["custody", /\b(custody|custodial|custodian)\b/i],
  ["donation", /\b(donations?|donate|donated)\b/i],
  ["bounty", /\b(bounty|bounties)\b/i],
  ["fee", /\bfees?\b/i],
  ["pot", /\bpots?\b/i],
  ["pocket", /\bpockets?\b/i],
  ["hop", /\bhops?\b/i],
  ["recipient", /\brecipients?\b/i],
  ["safe", /\bsafe(ly|ty)?\b/i],
];
// Russian stems, matched at a word start (\p{L} boundaries: \b does not see Cyrillic).
const ru = (stem: string, endings = "\\p{L}*") => new RegExp(`(?<!\\p{L})${stem}${endings}`, "iu");
const BANNED_RU: [string, RegExp][] = [
  ["кошелёк", ru("кошел[её]?к|кошельк")],
  ["газ", ru("газ", "(?:а|у|ом|е)?(?!\\p{L})")],
  ["транзакция", ru("транзакци")],
  ["подпись", ru("подпи[сш]")],
  ["эскроу", ru("эскроу")],
  ["кастоди", ru("кастоди")],
  ["донат", ru("донат|пожертвовани")],
  ["баунти", ru("баунти")],
  ["комиссия", ru("комисси")],
  ["безопасность", ru("безопасн")],
];

const ALWAYS_ALLOWED = [/connect a wallet/gi, /подключить кошел[её]к/gi];
const ALLOWED_BY_KEY: [RegExp, RegExp[]][] = [
  [/^common\.footer$/, [/\bno fee\b/gi, /без комиссии/gi]],
  [/^waiting\./, [/\bsafe\b/gi, /в безопасности/gi]],
];

function specialist(key: string, place: string): boolean {
  return place === "dev-wallet" || key.split(".").includes("lens");
}

/** The banned words left in a message after the allowed phrases are taken out. */
export function bannedIn(key: string, message: string, lang: "en" | "ru"): string[] {
  let text = message;
  for (const phrase of ALWAYS_ALLOWED) text = text.replace(phrase, " ");
  for (const [keys, phrases] of ALLOWED_BY_KEY) if (keys.test(key)) for (const phrase of phrases) text = text.replace(phrase, " ");
  return (lang === "en" ? BANNED_EN : BANNED_RU).filter(([, pattern]) => pattern.test(text)).map(([word]) => word);
}

/** The top-level ICU argument names of a message: `{core}`, `{n, plural, …}` → ["core", "n"]. */
function argumentsOf(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z_][\w]*)\s*[,}]/g)].map((m) => m[1]!).sort();
}

describe("words: two languages, one key set, no banned word", () => {
  test("every screen folder has both catalogues", () => {
    expect(places.length).toBe(screenNames.length + 1);
    expect(screenNames.length).toBeGreaterThan(10);
  });

  for (const place of places) {
    test(`${place.name}: English and Russian have the same keys`, () => {
      const en = Object.keys(place.en).sort();
      const ru = Object.keys(place.ru).sort();
      expect({ onlyEnglish: en.filter((k) => !(k in place.ru)), onlyRussian: ru.filter((k) => !(k in place.en)) }).toEqual({
        onlyEnglish: [],
        onlyRussian: [],
      });
    });

    test(`${place.name}: keys carry the catalogue's own name`, () => {
      const prefix = place.name === "common" ? /^(common|link|core)\./ : new RegExp(`^${place.name.replace(/[-]/g, "\\-")}\\.`);
      expect(Object.keys(place.en).filter((key) => !prefix.test(key))).toEqual([]);
    });

    test(`${place.name}: every message compiles, with the same placeholders in both languages`, () => {
      const broken: string[] = [];
      for (const [key, en] of Object.entries(place.en)) {
        const russian = place.ru[key] ?? "";
        for (const [lang, message] of [["en", en], ["ru", russian]] as const) {
          try {
            const compiled = compileMessage(message);
            // A message without arguments must come out exactly as written (an ICU apostrophe can eat text).
            const flat = Array.isArray(compiled) && compiled.every((part) => typeof part === "string") ? compiled.join("") : compiled;
            if (!message.includes("{") && flat !== message) broken.push(`${key} (${lang}): compiles to ${JSON.stringify(compiled)}`);
          } catch (error) {
            broken.push(`${key} (${lang}): ${(error as Error).message}`);
          }
          if (message.trim() === "") broken.push(`${key} (${lang}): empty`);
        }
        if (argumentsOf(en).join() !== argumentsOf(russian).join()) broken.push(`${key}: placeholders ${argumentsOf(en)} vs ${argumentsOf(russian)}`);
      }
      expect(broken).toEqual([]);
    });

    test(`${place.name}: no banned word on the human layer`, () => {
      const found: string[] = [];
      for (const lang of ["en", "ru"] as const) {
        for (const [key, message] of Object.entries(place[lang])) {
          if (specialist(key, place.name)) continue;
          for (const word of bannedIn(key, message, lang)) found.push(`${key} (${lang}): "${word}" in ${JSON.stringify(message)}`);
        }
      }
      expect(found).toEqual([]);
    });
  }

  test("no key is defined by two catalogues (the loader would refuse to start)", () => {
    const modules: CatalogueModules = {};
    for (const place of places.slice(1)) {
      modules[`../screens/${place.name}/en.ts`] = { default: place.en };
      modules[`../screens/${place.name}/ru.ts`] = { default: place.ru };
    }
    expect(() => mergeCatalogue("en", places[0]!.en, modules)).not.toThrow();
    expect(() => mergeCatalogue("ru", places[0]!.ru, modules)).not.toThrow();
    expect(() => mergeCatalogue("en", { "hand.title": "x" }, modules)).toThrow(/defined by both/);
  });

  test("the banned-word check catches each word and spares the allowed phrases", () => {
    expect(bannedIn("raise.x", "Sign here", "en")).toEqual(["sign"]);
    expect(bannedIn("raise.x", "The gas fee", "en")).toEqual(["gas", "fee"]);
    expect(bannedIn("raise.x", "Design a signal", "en")).toEqual([]);
    expect(bannedIn("raise.x", "Connect a wallet", "en")).toEqual([]);
    expect(bannedIn("raise.x", "your wallet", "en")).toEqual(["wallet"]);
    expect(bannedIn("common.footer", "Unaudited · No fee", "en")).toEqual([]);
    expect(bannedIn("raise.x", "It is safe", "en")).toEqual(["safe"]);
    expect(bannedIn("waiting.safe", "Your money is safe where it is.", "en")).toEqual([]);
    expect(bannedIn("raise.x", "Подпиши транзакцию", "ru")).toEqual(["транзакция", "подпись"]);
    expect(bannedIn("raise.x", "Подключить кошелёк", "ru")).toEqual([]);
    expect(bannedIn("raise.x", "в кошельке", "ru")).toEqual(["кошелёк"]);
    expect(bannedIn("raise.x", "Газета и газон", "ru")).toEqual([]);
    expect(bannedIn("raise.x", "за газ", "ru")).toEqual(["газ"]);
  });

  test("the RU catalogue speaks as «ты», not «вы»", () => {
    const formal = /(?<!\p{L})(вы|вас|вам|ваш\p{L}*)(?!\p{L})/iu;
    const found = places.flatMap((place) =>
      Object.entries(place.ru)
        .filter(([key, message]) => !specialist(key, place.name) && formal.test(message))
        .map(([key, message]) => `${key}: ${message}`),
    );
    expect(found).toEqual([]);
  });
});
