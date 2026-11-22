import { useLang, type Lang } from "./ambient";
import { WORDS, type Words } from "./words.data";

export { WORDS, type Words };

/**
 * The kit's words live in words.data.ts, free of React, so a test or a script can read them
 * (the demo engine's checks do); this file adds the hooks.
 */
export function wordsOf(lang: Lang): Words {
  return WORDS[lang];
}

/** The kit's words in the page's language, or in the one a component was handed. */
export function useWords(lang?: Lang): Words {
  const ambient = useLang();
  return WORDS[lang ?? ambient];
}
