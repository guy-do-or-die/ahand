import { payeeProblem, type PayeeProblem } from "@ahand/sdk";
import { getAddress, isAddress, type Address } from "viem";

/**
 * The reading of what someone typed into an amount or an address field. Pure functions, so the
 * rules are tested without a browser; the inputs (MoneyInput, AddressInput) only show them.
 */

// ── Money ────────────────────────────────────────────────────────────────

export type MoneyReading =
  | { status: "empty" }
  | { status: "ok"; amount: bigint }
  /**
   * Not an amount. `hint: "thousands"` is a comma that reads as a thousands separator ("1,000",
   * "$1,500"): refused rather than guessed, with `plain` the same figure written without it.
   */
  | { status: "invalid"; hint?: "thousands"; plain?: string }
  | { status: "too-much"; amount: bigint };

/**
 * A comma followed by exactly three digits, after a whole part that does not start with 0:
 * "1,000", "12,500.5", "1,000,000". An English reader writes a thousand so; a Russian one may
 * write 1,5 for one and a half. The two cannot be told apart, so the field asks (C-3).
 */
const THOUSANDS = /^[1-9][0-9]{0,2}(?:,[0-9]{3})+(?:\.[0-9]*)?$/;

/**
 * Reads an amount typed by a person: "40", "12.5", "12,5", "$1 000", ".5". Zero is an amount
 * (Core takes a reward of zero). More digits after the point than the token has is invalid:
 * nothing is rounded behind the person's back. A comma with one or two digits after it is a
 * decimal comma; one with exactly three is refused with a hint, since "1,000" was read as $1.
 */
export function readMoney(text: string, decimals: number, max?: bigint): MoneyReading {
  const spaced = text.replace(/[\s  $_]/g, "");
  if (THOUSANDS.test(spaced)) return { status: "invalid", hint: "thousands", plain: spaced.replace(/,/g, "") };
  const cleaned = spaced.replace(",", ".");
  if (cleaned === "") return { status: "empty" };
  const match = /^([0-9]*)(?:\.([0-9]*))?$/.exec(cleaned);
  if (!match) return { status: "invalid" };
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (whole === "" && fraction === "") return { status: "invalid" };
  if (fraction.length > decimals) return { status: "invalid" };
  const amount = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (max !== undefined && amount > max) return { status: "too-much", amount };
  return { status: "ok", amount };
}

// ── Addresses ────────────────────────────────────────────────────────────

export interface PayeeContext {
  core: Address;
  raiser: Address;
  token: Address;
}

export type AddressReading =
  | { status: "empty" }
  /** Not 0x and forty hex characters yet. */
  | { status: "incomplete" }
  /** Mixed case whose checksum does not match: a slip while copying. */
  | { status: "typo" }
  /** The zero address or Core's own: never a payee. */
  | { status: "refused"; problem: "zero" | "core"; address: Address }
  /** The asker's or the token's own address: allowed, shown with a question. */
  | { status: "flagged"; problem: "raiser" | "token"; address: Address }
  | { status: "ok"; address: Address };

/** Reads a pasted address and asks the SDK's `payeeProblem` what is wrong with it as a payee. */
export function readAddress(text: string, ctx: PayeeContext): AddressReading {
  const value = text.trim();
  if (value === "") return { status: "empty" };
  if (!isAddress(value, { strict: false })) return { status: "incomplete" };
  const body = value.slice(2);
  const mixedCase = body !== body.toLowerCase() && body !== body.toUpperCase();
  if (mixedCase && !isAddress(value, { strict: true })) return { status: "typo" };
  const address = getAddress(value);
  const problem: PayeeProblem = payeeProblem(address, ctx);
  if (problem === "zero" || problem === "core") return { status: "refused", problem, address };
  if (problem === "raiser" || problem === "token") return { status: "flagged", problem, address };
  return { status: "ok", address };
}

/** The address a reading lets through as a payee: an accepted or a flagged one. */
export function payeeOf(reading: AddressReading): Address | undefined {
  return reading.status === "ok" || reading.status === "flagged" ? reading.address : undefined;
}

// ── The asker's words ────────────────────────────────────────────────────
//
// The title and details of a Hand are the asker's own words: Core keeps only their hash. They
// are shown, never altered: everything below is for display, and the stored or hashed text is
// never touched. Characters that change how text is drawn without being seen (direction
// controls, zero-width characters, line and paragraph separators) are shown as small visible
// tokens such as ⟨RLO⟩; words that mix alphabets, and digits or signs in compatibility forms
// (＄５０００, 𝟱𝟶𝟶𝟶), are marked; and amounts of money in the words are found, so the card can
// say when they differ from the reward Core holds (E-8, H-2).

/** Invisible and direction-changing characters, by the short name a token shows. */
// The names are the OG card's (apps/face/src/bidi.ts NAMES), so the card and the app read alike.
export const HIDDEN_CHARS: Readonly<Record<string, string>> = {
  "‪": "LRE",
  "‫": "RLE",
  "‬": "PDF",
  "‭": "LRO",
  "‮": "RLO",
  "⁦": "LRI",
  "⁧": "RLI",
  "⁨": "FSI",
  "⁩": "PDI",
  "‎": "LRM",
  "‏": "RLM",
  "؜": "ALM",
  "​": "ZWSP",
  "‌": "ZWNJ",
  "‍": "ZWJ",
  "⁠": "WJ",
  "﻿": "ZWNBSP",
  "­": "SHY",
  "᠎": "MVS",
  " ": "LS",
  " ": "PS",
};

const HIDDEN = new RegExp(`[${Object.keys(HIDDEN_CHARS).join("")}]`, "u");
const DIRECTION = new Set(["LRE", "RLE", "PDF", "LRO", "RLO", "LRI", "RLI", "FSI", "PDI", "LRM", "RLM", "ALM"]);
const PICTURE = /\p{Extended_Pictographic}/u;
/** A word of letters (with the digits and marks inside it). */
const WORD = /[\p{L}\p{M}\p{Nd}]+/gu;
const LATIN = /\p{Script=Latin}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const GREEK = /\p{Script=Greek}/u;

export type WordsPiece =
  | { kind: "text"; text: string }
  /** A character drawn as a token: `name` is its short name, `char` the character itself. */
  | { kind: "hidden"; char: string; name: string; direction: boolean }
  /** Text that imitates something else: a word mixing alphabets, or digits in another form. */
  | { kind: "odd"; text: string; why: "mixed-script" | "compat" };

export interface WordsReading {
  pieces: WordsPiece[];
  /** What was found, for the note under the words; empty when nothing was. */
  found: ("direction" | "invisible" | "mixed-script" | "compat")[];
}

/** Whether a ZWJ joins two pictographs (👩‍💻): part of an emoji, not a trick. */
function joinsEmoji(text: string, at: number): boolean {
  const before = text.slice(0, at).replace(/[️\u{1F3FB}-\u{1F3FF}]+$/u, "");
  const last = Array.from(before).pop();
  const next = Array.from(text.slice(at + 1))[0];
  return !!last && !!next && PICTURE.test(last) && PICTURE.test(next);
}

/** A character whose compatibility form differs and reads as a digit or a money sign. */
function compatDigit(char: string): boolean {
  const folded = char.normalize("NFKC");
  return folded !== char && /^[0-9$€£.,%]+$/.test(folded);
}

/** Plain text, with runs of digits and signs in compatibility forms marked where they stand. */
function markCompat(text: string, out: WordsPiece[], found: Set<WordsReading["found"][number]>): void {
  let run = "";
  let plain = "";
  for (const char of text) {
    if (compatDigit(char)) {
      if (plain) out.push({ kind: "text", text: plain });
      plain = "";
      run += char;
    } else {
      if (run) {
        out.push({ kind: "odd", text: run, why: "compat" });
        found.add("compat");
      }
      run = "";
      plain += char;
    }
  }
  if (run) {
    out.push({ kind: "odd", text: run, why: "compat" });
    found.add("compat");
  }
  if (plain) out.push({ kind: "text", text: plain });
}

/** Words that mix Latin, Cyrillic or Greek letters are marked whole; the rest is scanned for compatibility digits. */
function markWords(text: string, out: WordsPiece[], found: Set<WordsReading["found"][number]>): void {
  let at = 0;
  for (const match of text.matchAll(WORD)) {
    const word = match[0];
    const start = match.index ?? 0;
    const scripts = [LATIN, CYRILLIC, GREEK].filter((script) => script.test(word)).length;
    if (scripts < 2) continue;
    markCompat(text.slice(at, start), out, found);
    out.push({ kind: "odd", text: word, why: "mixed-script" });
    found.add("mixed-script");
    at = start + word.length;
  }
  markCompat(text.slice(at), out, found);
}

/**
 * The asker's words as pieces to draw: plain text, tokens for characters that are not seen,
 * and marked runs that imitate other letters or digits. Joining the pieces' characters gives
 * back the text exactly, so nothing is dropped or altered: only drawn differently.
 */
export function readAskerWords(text: string): WordsReading {
  const pieces: WordsPiece[] = [];
  const found = new Set<WordsReading["found"][number]>();
  let chunk = "";
  const flush = () => {
    if (chunk) {
      const marked: WordsPiece[] = [];
      markWords(chunk, marked, found);
      pieces.push(...marked);
    }
    chunk = "";
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const name = HIDDEN.test(char) ? HIDDEN_CHARS[char] : undefined;
    if (name && !(name === "ZWJ" && joinsEmoji(text, index))) {
      flush();
      const direction = DIRECTION.has(name);
      pieces.push({ kind: "hidden", char, name, direction });
      found.add(direction ? "direction" : "invisible");
    } else {
      chunk += char;
    }
  }
  flush();
  // Join neighbouring text pieces, so a reader's DOM holds one node per run.
  const joined: WordsPiece[] = [];
  for (const piece of pieces) {
    const last = joined[joined.length - 1];
    if (piece.kind === "text" && last?.kind === "text") last.text += piece.text;
    else joined.push(piece.kind === "text" ? { ...piece } : piece);
  }
  const order: WordsReading["found"] = ["direction", "invisible", "mixed-script", "compat"];
  return { pieces: joined, found: order.filter((kind) => found.has(kind)) };
}

/** The text a reading's pieces stand for: always the text it was made from. */
export function piecesText(pieces: readonly WordsPiece[]): string {
  return pieces.map((piece) => (piece.kind === "hidden" ? piece.char : piece.text)).join("");
}

/** An amount of money the words mention: as it is written there, and in the token's units. */
export interface MentionedAmount {
  /** The figure as written, folded (＄５０００ → $5000) and with hidden characters taken out. */
  written: string;
  amount: bigint;
}

const SIGN = String.raw`(?:\$|usdc?\b|us\s?dollars?\b|dollars?\b|bucks?\b|долл\p{L}*|бакс\p{L}*)`;
// The thousands word ends where no letter or digit follows: \b, even with the u flag, knows only
// ASCII word characters, so it never ends after "тыс" and "5 тыс. долларов" went unflagged.
const FIGURE = String.raw`(\d{1,3}(?:[,  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(\s?(?:k|thousand|тыс(?:яч[аиу]?|\.)?)(?![\p{L}\p{N}]))?`;
const BEFORE = new RegExp(String.raw`(?:\$|\busdc?\b)\s?${FIGURE}`, "giu");
const AFTER = new RegExp(String.raw`${FIGURE}\s?${SIGN}`, "giu");

/** "5,000" → 5000, "1 500" → 1500, "1,5" → 1.5, "12.50" → 12.5: a figure as a decimal string. */
function figureOf(text: string): string | undefined {
  let figure = text.replace(/[  ]/g, " ");
  if (/^\d{1,3}(?:[, ]\d{3})+(?:[.,]\d+)?$/.test(figure)) {
    // Groups of three after a comma or a space are thousands; what follows a point is a fraction.
    const [whole, fraction] = figure.split(/\.(?=\d+$)|,(?=\d{1,2}$)/);
    figure = whole!.replace(/[, ]/g, "") + (fraction ? `.${fraction}` : "");
  } else {
    figure = figure.replace(",", ".");
  }
  return /^\d+(?:\.\d+)?$/.test(figure) ? figure : undefined;
}

function unitsOf(figure: string, thousand: boolean, decimals: number): bigint {
  const [whole, fraction = ""] = figure.split(".");
  const scale = 10n ** BigInt(decimals);
  const cut = fraction.slice(0, decimals).padEnd(decimals, "0");
  const amount = BigInt(whole!) * scale + BigInt(cut || "0");
  return thousand ? amount * 1000n : amount;
}

/**
 * Amounts of money that the words mention: "$5,000", "5000 USD", "500 долларов", "$5k". Only
 * for finding them: the words are folded with NFKC so ＄５０００ and 𝟱𝟶𝟶𝟶 count, and hidden
 * characters are taken out. Each distinct amount once, in the order first written.
 */
export function amountsIn(text: string, decimals: number): MentionedAmount[] {
  const folded = Array.from(text)
    .filter((char) => !HIDDEN.test(char))
    .join("")
    .normalize("NFKC");
  const found: { at: number; written: string; amount: bigint }[] = [];
  for (const pattern of [BEFORE, AFTER]) {
    for (const match of folded.matchAll(pattern)) {
      const figure = figureOf(match[1]!);
      if (figure === undefined) continue;
      const at = match.index ?? 0;
      if (found.some((other) => at < other.at + other.written.length && other.at < at + match[0].length)) continue;
      found.push({ at, written: match[0].trim(), amount: unitsOf(figure, !!match[2], decimals) });
    }
  }
  found.sort((a, b) => a.at - b.at);
  const seen = new Set<bigint>();
  const out: MentionedAmount[] = [];
  for (const item of found) {
    if (seen.has(item.amount)) continue;
    seen.add(item.amount);
    out.push({ written: item.written, amount: item.amount });
  }
  return out;
}
