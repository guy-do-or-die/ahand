import { i18n } from "@lingui/core";
import { useSyncExternalStore } from "react";

import { setPref } from "../store/db";
import { compileCatalogue, deviceLang, LANGS, type Catalogue, type Lang } from "./catalogue";

/**
 * The app's words. Ids are dotted keys (`raise.title`); each screen owns
 * `screens/<name>/en.ts` and `ru.ts`, `common/` holds the shared words and every error sentence.
 * `lang-en.ts` and `lang-ru.ts` merge one language each and are imported on demand, so the entry
 * chunk carries no catalogue: a reader downloads the language they read at start and the other
 * one only if they switch (review round 1). Messages are compiled once, when their language
 * arrives, with `compileMessage`, so a production build renders ICU values (lingui compiles raw
 * strings on the fly only in development). A missing id falls back to the id itself, so nothing
 * renders blank; the key-parity guard keeps that from happening.
 *
 * Language: the device's (navigator.language) unless this device chose another, which is kept
 * in the `prefs` store (not a secret). No language is active until `initLang` has loaded one;
 * boot awaits it before the first render.
 */

export type { Lang } from "./catalogue";
export { LANGS } from "./catalogue";

const CATALOGUES: Record<Lang, () => Promise<{ default: Catalogue }>> = {
  en: () => import("./lang-en"),
  ru: () => import("./lang-ru"),
};

const loading = new Map<Lang, Promise<void>>();

/** Loads and compiles a language's words, once. A load that fails is tried again on the next call. */
function load(lang: Lang): Promise<void> {
  let pending = loading.get(lang);
  if (!pending) {
    pending = CATALOGUES[lang]().then((module) => {
      i18n.load(lang, compileCatalogue(module.default));
    });
    const mine = pending;
    mine.catch(() => {
      if (loading.get(lang) === mine) loading.delete(lang);
    });
    loading.set(lang, pending);
  }
  return pending;
}

function device(): Lang {
  return deviceLang(typeof navigator === "undefined" ? undefined : navigator);
}

function apply(lang: Lang): void {
  i18n.activate(lang);
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

/**
 * Starts fetching the device's language at once, so the catalogue arrives while boot is still
 * reading this device's preferences. `initLang` then uses it, or loads the one chosen before.
 */
export function preloadLang(): void {
  load(device()).catch(() => undefined);
}

/**
 * Loads and starts the language this device chose before, or the device's own. Called once at
 * boot, awaited before the first render. When that language's words cannot be fetched, the other
 * language is tried; when neither can, the ids show (nothing renders blank).
 */
export async function initLang(saved: Lang | undefined): Promise<void> {
  const wanted = saved && LANGS.includes(saved) ? saved : device();
  for (const lang of [wanted, ...LANGS.filter((other) => other !== wanted)]) {
    try {
      await load(lang);
      apply(lang);
      return;
    } catch {
      // try the next language
    }
  }
  apply(wanted);
}

let latest = 0;

/**
 * Switches the language once its words are here, and remembers the choice on this device.
 * Resolves true when it switched; false when the words could not be fetched (the page stays in
 * its language) or a later switch overtook this one.
 */
export async function setLang(lang: Lang): Promise<boolean> {
  const mine = ++latest;
  try {
    await load(lang);
  } catch {
    return false;
  }
  if (mine !== latest) return false;
  apply(lang);
  void setPref("lang", lang).catch(() => undefined); // a private window may refuse storage; the switch still holds for this tab
  return true;
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

/** Translate: t("raise.title"), t("common.lens.core", { core }). */
export function t(id: string, values?: Record<string, unknown>): string {
  return i18n._(id, values);
}

export { i18n };
