import { i18n } from "@lingui/core";
import { useSyncExternalStore } from "react";

import { setPref } from "../store/db";
import { compileCatalogue, deviceLang, LANGS, mergeCatalogue, type CatalogueModules, type Lang } from "./catalogue";
import commonEn from "./common/en";
import commonRu from "./common/ru";

/**
 * The app's words (ARCHITECTURE §7, D-53). Ids are dotted keys (`raise.title`); each screen owns
 * `screens/<name>/en.ts` and `ru.ts`, collected here by glob; `common/` holds the shared words and
 * every error sentence. Messages are compiled at start with `compileMessage`, so a production
 * build renders ICU values (lingui compiles raw strings on the fly only in development). A
 * missing id falls back to the id itself, so nothing renders blank; the key-parity guard keeps
 * that from happening.
 *
 * Language: the device's (navigator.language) unless this device chose another, which is kept
 * in the `prefs` store (not a secret).
 */

export type { Lang } from "./catalogue";
export { LANGS } from "./catalogue";

const screens = import.meta.glob<{ default: Record<string, string> }>("../screens/*/{en,ru}.ts", { eager: true }) as CatalogueModules;

for (const lang of LANGS) {
  i18n.load(lang, compileCatalogue(mergeCatalogue(lang, lang === "en" ? commonEn : commonRu, screens)));
}

function apply(lang: Lang): void {
  i18n.activate(lang);
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

apply(deviceLang(typeof navigator === "undefined" ? undefined : navigator));

/** Starts in the language this device chose before, or the device's own. Called once at boot. */
export function initLang(saved: Lang | undefined): void {
  apply(saved && LANGS.includes(saved) ? saved : deviceLang(typeof navigator === "undefined" ? undefined : navigator));
}

/** Switches the language now and remembers the choice on this device. */
export function setLang(lang: Lang): void {
  apply(lang);
  void setPref("lang", lang).catch(() => undefined); // a private window may refuse storage; the switch still holds for this tab
}

/** The active language. */
export function currentLang(): Lang {
  return i18n.locale as Lang;
}

/** The Intl locale for dates and money in the active language. */
export function intlLocale(lang: Lang = currentLang()): string {
  return lang === "ru" ? "ru-RU" : "en-GB";
}

function subscribe(onChange: () => void): () => void {
  return i18n.on("change", onChange);
}

/** The active language, re-rendering the caller when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, currentLang, currentLang);
}

/** Translate: t("raise.title"), t("common.footer", { core }). */
export function t(id: string, values?: Record<string, unknown>): string {
  return i18n._(id, values);
}

export { i18n };
