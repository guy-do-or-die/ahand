/**
 * The service's own part of the words: which language a robot is answered in. Every word the
 * preview says, on the card and in the tags, is the shared card's (packages/card/src/words.ts),
 * so the raise screen shows the same sentences.
 */

import type { Lang } from "@ahand/card";

export { amountText, day, LANGS, unitsText, WORDS, type CardState, type Lang, type Terms } from "@ahand/card";

/**
 * The reader's language: `l=ru` or `l=en` in the query first (the app may add it to a shared
 * address; addresses skip parameters that are not `d`), then the best of en and ru in
 * Accept-Language, then English.
 */
export function langOf(query: URLSearchParams, acceptLanguage: string | undefined): Lang {
  const asked = query.get("l");
  if (asked === "ru" || asked === "en") return asked;
  let best: { lang: Lang; q: number } | undefined;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const [tag, ...params] = part.trim().toLowerCase().split(";");
    const base = tag?.split("-")[0];
    if (base !== "en" && base !== "ru") continue;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    if (!Number.isFinite(q) || q <= 0) continue;
    if (!best || q > best.q) best = { lang: base, q };
  }
  return best?.lang ?? "en";
}
