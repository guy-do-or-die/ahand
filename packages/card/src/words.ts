/**
 * Every word the link's preview says, in English and Russian: the card's lines and the title and
 * description a messenger sets beside it. The sentences are the receiver's card's own
 * (apps/web/src/ui/words.ts, `deal` and `spine`), so a person meets the same words in the chat
 * and on the page; `apps/web/tests/card-words.test.ts` fails when the two drift apart.
 *
 * Dates are written in UTC: a preview robot has no time zone of its reader, and a day written in
 * UTC is the same for every robot that fetches it. Russian speaks as «ты».
 */

export type Lang = "en" | "ru";

/** Every language the preview speaks. */
export const LANGS: readonly Lang[] = ["en", "ru"];

const LOCALE: Record<Lang, string> = { en: "en-GB", ru: "ru-RU" };

/** "20 Dec" / "20 дек", in UTC; `timestamp` is in seconds. A date is never cut from its month. */
export function day(timestamp: number, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(timestamp * 1000))
    .replace(/\.$/, "")
    .replace(" ", " ");
}

/** A token amount with every digit it has: 40000000 at 6 decimals is "40". */
export function unitsText(amount: bigint, decimals: number): string {
  const text = amount.toString().padStart(decimals + 1, "0");
  const whole = text.slice(0, text.length - decimals);
  const fraction = decimals > 0 ? text.slice(-decimals).replace(/0+$/, "") : "";
  return fraction ? `${whole}.${fraction}` : whole;
}

/** A token the app lists: what it is called and whether it is a dollar, by the configuration's word. */
export interface TokenFacts {
  symbol: string;
  decimals: number;
  dollar: boolean;
}

/**
 * The token kinds of the app's configuration that are dollars: the preview writes "$" only for
 * these, and only by this word of the configuration (VIEW_TOKENS on the view server, the app's own
 * configuration on the raise screen).
 */
export const DOLLAR_KINDS: readonly string[] = ["usd", "usdc", "blacklist"];

/**
 * The reward as people read it, in a token the app lists. A dollar token reads "$40" or "$0.80"
 * ("$0,80" in Russian), cents cut and never rounded up, as the app writes money (`money` in
 * apps/web/src/ui/format.ts); any other listed token reads "40 WETH". Whether a token is a dollar
 * is the configuration's word, never the token's own `symbol()`: a token anyone deploys can call
 * itself "USDC".
 */
export function amountText(amount: bigint, token: TokenFacts, lang: Lang): string {
  if (!token.dollar) {
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

/** A Hand's state by the chain's clock. */
export type CardState = "open" | "expired" | "thanked" | "refunded";

/** What the preview says about one Hand's terms. */
export interface Terms {
  state: CardState;
  /** The reward in a listed token, already written; undefined for a Hand with no reward. */
  amount?: string;
  /** A reward in a token the app does not list: no amount is written, and no "$". */
  unknownToken?: boolean;
  /** The expiry, or the closing time of a closed Hand: a block's timestamp, in seconds. */
  date: number;
}

/** One line of the card in three parts; the amount, when there is one, stands on amber. */
export interface Line {
  before: string;
  amount?: string;
  after: string;
}

export interface CardWords {
  /** Over the asker's words: whose they are (the receiver's card's `deal.intro`). */
  intro: string;
  /** A Hand whose words the address does not carry (`deal.bare`). */
  bare: string;
  /** An address that says nothing about any Hand. */
  genericLine: string;
  /** At the foot of an open Hand's card: what opening the link is for. Words, not a button: a picture in a chat cannot be pressed, and the whole preview opens the link. */
  invite: string;
  /** The whole reward (`spine.reward`), the amount on amber. */
  reward(amount: string): Line;
  noReward: string;
  unknownToken: string;
  openUntil(date: string): string;
  wasOpenUntil(date: string): string;
  timeUp: string;
  thanked(date: string): string;
  refunded(date: string): string;
  closed(date: string): string;
  /** The asker's details after the terms in a messenger's description; `words` is already one isolated line. */
  quoted(words: string): string;
  /** The asker's title in the image's alt text. */
  quote(words: string): string;
  siteName: string;
}

export const WORDS: Record<Lang, CardWords> = {
  en: {
    intro: "Someone raised a hand:",
    bare: "Someone raised a hand.",
    genericLine: "Open to see.",
    invite: "Open it to help or pass it on.",
    reward: (amount) => ({ before: "Reward ", amount, after: "" }),
    noReward: "No reward: a thank-you only",
    unknownToken: "A reward in a token aHand does not list",
    openUntil: (date) => `open until ${date}`,
    wasOpenUntil: (date) => `was open until ${date}`,
    timeUp: "Time's up.",
    thanked: (date) => `Thanked on ${date}.`,
    refunded: (date) => `The reward went back on ${date}.`,
    closed: (date) => `This hand closed on ${date}.`,
    quoted: (words) => `The asker wrote: “${words}”`,
    quote: (words) => `“${words}”`,
    siteName: "aHand",
  },
  ru: {
    intro: "Кто-то поднял руку:",
    bare: "Кто-то поднял руку.",
    genericLine: "Открой и посмотри.",
    invite: "Открой, чтобы помочь или передать дальше.",
    reward: (amount) => ({ before: "Награда ", amount, after: "" }),
    noReward: "Без награды: только спасибо",
    unknownToken: "Награда в токене, которого aHand не знает",
    openUntil: (date) => `рука открыта до ${date}`,
    wasOpenUntil: (date) => `рука была открыта до ${date}`,
    timeUp: "Срок вышел.",
    thanked: (date) => `Спасибо сказано ${date}.`,
    refunded: (date) => `Награда вернулась ${date}.`,
    closed: (date) => `Рука закрылась ${date}.`,
    quoted: (words) => `Слова автора: «${words}»`,
    quote: (words) => `«${words}»`,
    siteName: "aHand",
  },
};

/**
 * The terms in the receiver's card's order: the whole reward, then until when, in one quiet line
 * ("Reward $40 · open until 20 Dec"). The date stands without how far off it is: a preview is
 * fetched once and then kept in the chat, so "in 5 days" would go on saying five days after they
 * passed, while the date stays true. A closed Hand's line has no date: its last line says it.
 */
export function termsLine({ state, amount, unknownToken, date }: Terms, lang: Lang): Line {
  const w = WORDS[lang];
  const d = day(date, lang);
  const when = state === "open" ? w.openUntil(d) : state === "expired" ? w.wasOpenUntil(d) : undefined;
  const tail = when ? ` · ${when}` : "";
  if (amount) {
    const reward = w.reward(amount);
    return { ...reward, after: `${reward.after}${tail}` };
  }
  return { before: `${unknownToken ? w.unknownToken : w.noReward}${tail}`, after: "" };
}

/** What a Hand that is over came to, as the receiver's card's last line says it; undefined while it is open. */
export function endLine({ state, amount, unknownToken, date }: Terms, lang: Lang): string | undefined {
  const w = WORDS[lang];
  const d = day(date, lang);
  switch (state) {
    case "open":
      return undefined;
    case "expired":
      return w.timeUp;
    case "thanked":
      return w.thanked(d);
    case "refunded":
      return amount || unknownToken ? w.refunded(d) : w.closed(d);
  }
}

/** A line as plain text. */
export function lineText(line: Line): string {
  return `${line.before}${line.amount ?? ""}${line.after}`;
}
