import type { Lang } from "./ambient";
import { WORDS } from "./words";

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
  if (amount > 0n && centsTotal === 0n) return WORDS[lang].underCent;
  const whole = centsTotal / 100n;
  const cents = Number(centsTotal % 100n);
  const showCents = opts.cents ?? cents !== 0;
  const wholeText = new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 0 }).format(whole);
  if (!showCents) return `$${wholeText}`;
  const point = lang === "ru" ? "," : ".";
  return `$${wholeText}${point}${String(cents).padStart(2, "0")}`;
}

/**
 * Every digit, in the human layer's form: "$0.165", "$0.000033", "$1,000.000001" ("$0,165" in
 * Russian). At least two digits after the point, so it sits beside `money(…, { cents: true })`.
 * For amounts that cutting to cents would misstate: rows that must add up to their total.
 */
export function moneyExact(amount: bigint, decimals: number, lang: Lang): string {
  const [whole = "0", fraction = ""] = unitsText(amount, decimals).split(".");
  const wholeText = new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 0 }).format(BigInt(whole));
  const digits = fraction.padEnd(Math.min(2, decimals), "0");
  return digits ? `$${wholeText}${lang === "ru" ? "," : "."}${digits}` : `$${wholeText}`;
}

/**
 * The least a helper is paid at a place on the route where `claimBps` is left. Core pays each
 * pass `Math.mulDiv(reward, claimBps − nextClaimBps, 10 000)`, rounded down, and the helper gets
 * the rest (AHandCore.sol `_payShakers`), so the helper's share is never below
 * ⌈reward × claimBps / 10 000⌉. Rounding down here promised one unit less than Core pays.
 */
export function atLeast(reward: bigint, claimBps: number): bigint {
  return (reward * BigInt(claimBps) + 9_999n) / 10_000n;
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

/**
 * How far off a moment is, as a person counts it on the calendar of their own zone: "1 month and
 * 7 days" (24 Dec to 31 Jan), "12 days", and under a day whole hours ("5 hours"). Under an hour,
 * or when the moment is not ahead, there is nothing to count: undefined, and the caller says so in
 * its own words. Both moments are in seconds, and both come from the chain's clock.
 */
export function span(from: number, to: number, lang: Lang, timeZone?: string): string | undefined {
  if (to - from < 3600) return undefined;
  const unit = (count: number, name: "month" | "day" | "hour") => new Intl.NumberFormat(LOCALE[lang], { style: "unit", unit: name, unitDisplay: "long" }).format(count);
  if (to - from < 86_400) return unit(Math.floor((to - from) / 3600), "hour");
  const parts = (seconds: number) => {
    const found = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(seconds * 1000));
    const read = (type: string) => Number(found.find((part) => part.type === type)!.value);
    return { year: read("year"), month: read("month"), day: read("day") };
  };
  const a = parts(from);
  const b = parts(to);
  const lastOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Whole months first, counted from the earlier date's own day (the 31st of a short month is its
  // last day), then the days left over.
  let months = (b.year - a.year) * 12 + (b.month - a.month);
  const leftAfter = (count: number) => {
    const at = new Date(Date.UTC(a.year, a.month - 1 + count, 1));
    const anchor = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), Math.min(a.day, lastOf(at.getUTCFullYear(), at.getUTCMonth() + 1)));
    return Math.round((Date.UTC(b.year, b.month - 1, b.day) - anchor) / 86_400_000);
  };
  let days = leftAfter(months);
  if (days < 0) {
    months -= 1;
    days = leftAfter(months);
  }
  const said = [...(months > 0 ? [unit(months, "month")] : []), ...(days > 0 ? [unit(days, "day")] : [])];
  if (said.length === 0) return unit(1, "day");
  return new Intl.ListFormat(LOCALE[lang], { style: "long", type: "conjunction" }).format(said);
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
