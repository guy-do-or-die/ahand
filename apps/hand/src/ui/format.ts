import type { Lang } from "./ambient";

/**
 * How the kit writes money, dates and addresses. Numbers and dates go through Intl in the
 * reader's language and time zone; nothing here reads the clock.
 */

const LOCALE: Record<Lang, string> = { en: "en-GB", ru: "ru-RU" };

/** A token amount as a decimal string with every digit: 40000000 at 6 decimals is "40". */
export function unitsText(amount: bigint, decimals: number): string {
  const text = amount.toString().padStart(decimals + 1, "0");
  const whole = text.slice(0, text.length - decimals);
  const fraction = decimals > 0 ? text.slice(-decimals).replace(/0+$/, "") : "";
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * Dollars for the human layer: "$40" for a whole amount, "$0.80" otherwise ("$0,80" in
 * Russian). Cents are cut, never rounded up, so the screen never promises more than the
 * chain holds. An amount above zero and under one cent reads "under $0.01".
 */
export function money(amount: bigint, decimals: number, lang: Lang, opts: { cents?: boolean } = {}): string {
  const unit = 10n ** BigInt(decimals);
  const centsTotal = (amount * 100n) / unit;
  if (amount > 0n && centsTotal === 0n) return lang === "ru" ? "меньше $0,01" : "under $0.01";
  const whole = centsTotal / 100n;
  const cents = Number(centsTotal % 100n);
  const showCents = opts.cents ?? cents !== 0;
  const wholeText = new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 0 }).format(whole);
  if (!showCents) return `$${wholeText}`;
  const point = lang === "ru" ? "," : ".";
  return `$${wholeText}${point}${String(cents).padStart(2, "0")}`;
}

/** Basis points as a percentage: 7000 is "70%", 250 is "2.5%". */
export function percent(bps: number, lang: Lang): string {
  return `${new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 2 }).format(bps / 100)}%`;
}

/** "20 Dec" / "20 дек" in the reader's own time zone; `timestamp` is in seconds. */
export function day(timestamp: number, lang: Lang, timeZone?: string): string {
  const text = new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "short", timeZone }).format(new Date(timestamp * 1000));
  return text.replace(/\.$/, "");
}

/** "20 Nov 14:02" for the lens; `timestamp` is in seconds. */
export function minute(timestamp: number, lang: Lang, timeZone?: string): string {
  const clock = new Intl.DateTimeFormat(LOCALE[lang], { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(
    new Date(timestamp * 1000),
  );
  return `${day(timestamp, lang, timeZone)} ${clock}`;
}

/**
 * "20 Dec 2026, 16:00:00 GMT+4" for evidence: one second of the chain's clock with its date, its
 * time and the zone it is written in; `timestamp` is in seconds.
 */
export function second(timestamp: number, lang: Lang, timeZone?: string): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(timestamp * 1000));
}

/** The same second in the reader's zone and in UTC; one line where the two read alike. */
export function inBothZones(timestamp: number, lang: Lang, timeZone?: string): string[] {
  const here = second(timestamp, lang, timeZone);
  const utc = second(timestamp, lang, "UTC");
  return here === utc ? [utc] : [here, utc];
}

/**
 * A whole number for a mono line (a block, a gas count): digits in threes with a space that
 * does not break, the same in both languages, as the lens writes them: "1 234".
 */
export function count(value: bigint | number): string {
  return BigInt(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
}

/** 0x71C7…976F: the first six and last four characters of an address. */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
