/**
 * The app's own sentences, for scenarios that check what a person reads: every screen's English
 * (or, with DEMO_LANG=ru, Russian) dictionary (apps/web/src/screens/<screen>/en.ts), the shared one (i18n/common/en.ts) and the
 * kit's (ui/words.data.ts, `kit.<path>`). A scenario names a key, never a sentence, so a reworded
 * sentence is followed and a removed key does not compile.
 */
import common from "../../../apps/web/src/i18n/common/en";
import commonRu from "../../../apps/web/src/i18n/common/ru";
import care from "../../../apps/web/src/screens/care/en";
import careRu from "../../../apps/web/src/screens/care/ru";
import check from "../../../apps/web/src/screens/check/en";
import checkRu from "../../../apps/web/src/screens/check/ru";
import give from "../../../apps/web/src/screens/give/en";
import giveRu from "../../../apps/web/src/screens/give/ru";
import hand from "../../../apps/web/src/screens/hand/en";
import handRu from "../../../apps/web/src/screens/hand/ru";
import my from "../../../apps/web/src/screens/my/en";
import myRu from "../../../apps/web/src/screens/my/ru";
import pass from "../../../apps/web/src/screens/pass/en";
import passRu from "../../../apps/web/src/screens/pass/ru";
import print from "../../../apps/web/src/screens/print/en";
import printRu from "../../../apps/web/src/screens/print/ru";
import proof from "../../../apps/web/src/screens/proof/en";
import proofRu from "../../../apps/web/src/screens/proof/ru";
import raise from "../../../apps/web/src/screens/raise/en";
import raiseRu from "../../../apps/web/src/screens/raise/ru";
import thank from "../../../apps/web/src/screens/thank/en";
import thankRu from "../../../apps/web/src/screens/thank/ru";
import waiting from "../../../apps/web/src/screens/waiting/en";
import waitingRu from "../../../apps/web/src/screens/waiting/ru";
import { WORDS } from "../../../apps/web/src/ui/words.data";
import { LANG } from "./lang";

const SCREENS = { ...common, ...care, ...check, ...give, ...hand, ...my, ...pass, ...print, ...proof, ...raise, ...thank, ...waiting };
/** The same keys in Russian, for a show with DEMO_LANG=ru (the app opens in Russian then). */
const SCREENS_RU = { ...commonRu, ...careRu, ...checkRu, ...giveRu, ...handRu, ...myRu, ...passRu, ...printRu, ...proofRu, ...raiseRu, ...thankRu, ...waitingRu } as Record<string, unknown>;
const screen = (key: string): unknown => (LANG === "ru" ? SCREENS_RU[key] : (SCREENS as Record<string, unknown>)[key]);

type KitWords = typeof WORDS.en;
type StringPaths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends (...args: never[]) => string ? `${P}${K}` : T[K] extends object ? StringPaths<T[K], `${P}${K}.`> : never;
}[keyof T & string];

/** A sentence's key: a screen or common key ("raise.up"), or a kit path ("kit.hand.timeUp"). */
export type WordKey = keyof typeof SCREENS | `kit.${StringPaths<KitWords>}`;

/**
 * The sentence of a key as it can be matched on the page: a template's longest fixed part (the
 * text between its `{placeholders}`), or for a kit function, the part before its argument.
 */
export function phrase(key: WordKey): string {
  let value: unknown;
  if (key.startsWith("kit.")) {
    value = key
      .slice(4)
      .split(".")
      .reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], WORDS[LANG]);
    if (typeof value === "function") value = (value as (...args: string[]) => string)("\u0000", "\u0000");
  } else value = screen(key);
  if (typeof value !== "string") throw new Error(`no sentence at ${key}`);
  return value
    .split(/\{[^}]*\}|\u0000/)
    .map((part) => part.trim())
    .sort((a, b) => b.length - a.length)[0]!;
}

/** A screen or common sentence with its `{placeholders}` filled in, as the page shows it. */
export function sentence(key: WordKey, values: Record<string, string>): string {
  if (key.startsWith("kit.")) throw new Error(`${key}: a kit sentence is a function; match its phrase instead`);
  const template = screen(key) as string;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    if (!(name in values)) throw new Error(`${key} needs a value for {${name}}`);
    return values[name]!;
  });
}
