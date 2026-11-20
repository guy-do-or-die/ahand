import { compileMessage } from "@lingui/message-utils/compileMessage";

/**
 * The pure half of the loader: merges the common catalogue with every screen's, refuses a key
 * that two catalogues both define, and compiles each ICU message once. Kept free of Vite's
 * `import.meta.glob` so the guards can run it under `bun test`.
 */

export type Lang = "en" | "ru";
export const LANGS: readonly Lang[] = ["en", "ru"];

export type Catalogue = Record<string, string>;

/** A screen catalogue as the glob delivers it: path → module with a default export. */
export type CatalogueModules = Record<string, { default: Catalogue }>;

/** `../screens/raise/en.ts` → `{ screen: "raise", lang: "en" }`; anything else → undefined. */
export function placeOf(path: string): { screen: string; lang: Lang } | undefined {
  const match = /\/screens\/([^/]+)\/(en|ru)\.ts$/.exec(path);
  return match ? { screen: match[1]!, lang: match[2] as Lang } : undefined;
}

/** One language's whole catalogue. Throws when two catalogues define the same key. */
export function mergeCatalogue(lang: Lang, common: Catalogue, screens: CatalogueModules): Catalogue {
  const merged: Catalogue = { ...common };
  const owner = new Map<string, string>(Object.keys(common).map((key) => [key, "i18n/common"]));
  for (const path of Object.keys(screens).sort()) {
    const place = placeOf(path);
    if (!place || place.lang !== lang) continue;
    for (const [key, message] of Object.entries(screens[path]!.default)) {
      const before = owner.get(key);
      if (before) throw new Error(`i18n: the key "${key}" is defined by both ${before} and screens/${place.screen}`);
      owner.set(key, `screens/${place.screen}`);
      merged[key] = message;
    }
  }
  return merged;
}

/** Compiles every message with @lingui/message-utils, so a production build renders ICU values. */
export function compileCatalogue(catalogue: Catalogue): Record<string, ReturnType<typeof compileMessage>> {
  return Object.fromEntries(Object.entries(catalogue).map(([id, message]) => [id, compileMessage(message)]));
}

/** The device's language: the first of navigator.languages; anything that is not Russian reads English. */
export function deviceLang(nav: { languages?: readonly string[]; language?: string } | undefined): Lang {
  const first = nav?.languages?.[0] ?? nav?.language ?? "en";
  return first.toLowerCase().startsWith("ru") ? "ru" : "en";
}
