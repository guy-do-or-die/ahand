/**
 * Every word face writes, in English and Russian (UX-SPEC §4, §5, §11). Russian speaks as «ты».
 * Dates are written in UTC: a preview robot has no time zone of its reader, and a day written in
 * UTC is the same for every robot that fetches it.
 */

export type Lang = "en" | "ru";

/** Every language face speaks. */
export const LANGS: readonly Lang[] = ["en", "ru"];

const LOCALE: Record<Lang, string> = { en: "en-GB", ru: "ru-RU" };

/** "20 Dec" / "20 дек", in UTC; `timestamp` is in seconds. */
export function day(timestamp: number, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(timestamp * 1000))
    .replace(/\.$/, "");
}

/** A token amount with every digit it has: 40000000 at 6 decimals is "40". */
export function unitsText(amount: bigint, decimals: number): string {
  const text = amount.toString().padStart(decimals + 1, "0");
  const whole = text.slice(0, text.length - decimals);
  const fraction = decimals > 0 ? text.slice(-decimals).replace(/0+$/, "") : "";
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * The reward as people read it. A dollar token reads "$40" or "$0.80" ("$0,80" in Russian), cents
 * cut and never rounded up, as the app writes money; any other token reads "40 WETH".
 */
export function amountText(amount: bigint, token: { symbol: string; decimals: number }, lang: Lang): string {
  if (!/usd/i.test(token.symbol)) {
    const [whole, fraction] = unitsText(amount, token.decimals).split(".");
    const grouped = new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 0 }).format(BigInt(whole!));
    const point = lang === "ru" ? "," : ".";
    return `${grouped}${fraction ? point + fraction : ""} ${token.symbol}`;
  }
  const unit = 10n ** BigInt(token.decimals);
  const centsTotal = (amount * 100n) / unit;
  if (centsTotal === 0n) return lang === "ru" ? "меньше $0,01" : "under $0.01";
  const whole = new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 0 }).format(centsTotal / 100n);
  const cents = Number(centsTotal % 100n);
  if (cents === 0) return `$${whole}`;
  return `$${whole}${lang === "ru" ? "," : "."}${String(cents).padStart(2, "0")}`;
}

export type CardState = "open" | "expired" | "thanked" | "refunded";

/** What a card says about one Hand's terms. `amount` is undefined for a Hand with no reward. */
export interface Terms {
  state: CardState;
  amount?: string;
  /** The expiry, or the closing time for a closed Hand: a block's timestamp. */
  date: number;
}

interface Words {
  genericTitle: string;
  genericLine: string;
  /** The amber band. */
  asking: string;
  closed: string;
  /** The pill on the band. */
  cta: string;
  siteName: string;
  terms(t: Terms): { before: string; amount?: string; after: string };
  /** The small line over the title on the card: the title is the asker's, not face's. */
  askersWords: string;
  /** The asker's words in quotes, after a label; `words` is already one isolated line. */
  quoted(words: string): string;
  /** The image's alt: the asker's title quoted (when it matched), then the terms. */
  imageAlt(title: string | undefined, terms: string): string;
  /** The generic card's alt. */
  genericAlt: string;
  /** The title quoted on the card. */
  openQuote: string;
  closeQuote: string;
}

export const WORDS: Record<Lang, Words> = {
  en: {
    genericTitle: "Someone raised a hand.",
    genericLine: "Open to see.",
    asking: "someone is asking",
    closed: "this hand is closed",
    cta: "see how you can help →",
    siteName: "aHand",
    terms({ state, amount, date }) {
      const d = day(date, "en");
      switch (state) {
        case "open":
          return amount
            ? { before: "", amount, after: ` reward on chain · open until ${d}` }
            : { before: `No reward on chain: a thank-you only · open until ${d}`, after: "" };
        case "expired":
          return amount
            ? { before: "", amount, after: ` reward on chain · time's up on ${d}` }
            : { before: `No reward on chain: a thank-you only · time's up on ${d}`, after: "" };
        case "thanked":
          return amount
            ? { before: `Thanked on ${d} · `, amount, after: " reward" }
            : { before: `Thanked on ${d} · a thank-you only`, after: "" };
        case "refunded":
          return amount
            ? { before: `The `, amount, after: ` reward went back on ${d}` }
            : { before: `Closed on ${d} · nobody was thanked`, after: "" };
      }
    },
    askersWords: "in the asker's words",
    quoted: (words) => `The asker wrote: “${words}”`,
    imageAlt: (title, terms) => `${title === undefined ? "Someone raised a hand." : `The asker wrote: “${title}”.`} ${terms} · aHand`,
    genericAlt: "Someone raised a hand on aHand.",
    openQuote: "“",
    closeQuote: "”",
  },
  ru: {
    genericTitle: "Кто-то поднял руку.",
    genericLine: "Открой и посмотри.",
    asking: "кто-то просит",
    closed: "эта рука закрыта",
    cta: "посмотри, чем помочь →",
    siteName: "aHand",
    terms({ state, amount, date }) {
      const d = day(date, "ru");
      switch (state) {
        case "open":
          return amount
            ? { before: "Награда ", amount, after: ` в сети · открыта до ${d}` }
            : { before: `В сети нет награды: только спасибо · открыта до ${d}`, after: "" };
        case "expired":
          return amount
            ? { before: "Награда ", amount, after: ` в сети · срок вышел ${d}` }
            : { before: `В сети нет награды: только спасибо · срок вышел ${d}`, after: "" };
        case "thanked":
          return amount
            ? { before: `Поблагодарили ${d} · награда `, amount, after: "" }
            : { before: `Поблагодарили ${d} · только спасибо`, after: "" };
        case "refunded":
          return amount
            ? { before: "Награда ", amount, after: ` вернулась автору ${d}` }
            : { before: `Закрыта ${d} · никого не поблагодарили`, after: "" };
      }
    },
    askersWords: "словами автора",
    quoted: (words) => `Слова автора: «${words}»`,
    imageAlt: (title, terms) => `${title === undefined ? "Кто-то поднял руку." : `Слова автора: «${title}».`} ${terms} · aHand`,
    genericAlt: "Кто-то поднял руку на aHand.",
    openQuote: "«",
    closeQuote: "»",
  },
};

/** The terms as one line of plain text, for og:description. */
export function termsLine(terms: Terms, lang: Lang): string {
  const { before, amount, after } = WORDS[lang].terms(terms);
  return `${before}${amount ?? ""}${after}`;
}

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
