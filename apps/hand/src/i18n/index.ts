import { i18n } from "@lingui/core";
import { compileMessage } from "@lingui/message-utils/compileMessage";

import commonEn from "./common/en";
import commonRu from "./common/ru";

/**
 * Lingui runtime setup, carried over from apps/web (macro-less: explicit ids, hand-kept
 * catalogues). Ids are dotted keys (`raise.title`); each screen owns `en.ts` and `ru.ts`, and
 * `common/` holds the shared words. A missing entry falls back to the id, so nothing renders
 * blank.
 *
 * Messages are compiled here with `compileMessage` rather than by @lingui/cli: lingui only
 * compiles raw strings on the fly in development, so a production build would render ICU
 * placeholders literally ("{amount}" instead of the value).
 */

export type Lang = "en" | "ru";
export const LANGS: readonly Lang[] = ["en", "ru"];

type Catalogue = Record<string, string>;

const screens = import.meta.glob<{ default: Catalogue }>("../screens/*/{en,ru}.ts", { eager: true });

function catalogue(lang: Lang): Catalogue {
  const merged: Catalogue = { ...(lang === "en" ? commonEn : commonRu) };
  for (const [path, module] of Object.entries(screens)) {
    if (path.endsWith(`/${lang}.ts`)) Object.assign(merged, module.default);
  }
  return merged;
}

for (const lang of LANGS) {
  i18n.load(
    lang,
    Object.fromEntries(Object.entries(catalogue(lang)).map(([id, message]) => [id, compileMessage(message)])),
  );
}

/** The device's language first; anything that is not Russian reads English. */
export function deviceLang(): Lang {
  const first = typeof navigator === "undefined" ? "en" : (navigator.languages?.[0] ?? navigator.language ?? "en");
  return first.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function setLang(lang: Lang): void {
  i18n.activate(lang);
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

setLang(deviceLang());

/** Translate helper: t("raise.title"), t("common.footer", { core }). */
export function t(id: string, values?: Record<string, unknown>): string {
  return i18n._(id, values);
}

export { i18n };
