/**
 * The asker's words next to face's own, so that no character in them can turn ours around
 * (early review H-2).
 *
 * In text a reader's program lays out (the page's <title>, the tags a messenger reads), the words
 * go inside a first-strong isolate: U+2068 FSI before, U+2069 PDI after. PDI closes every
 * embedding and override the words left open, so an unclosed RLO in a title cannot reverse
 * " · aHand" or the terms around it.
 *
 * On the card face draws itself (satori, which has no bidi algorithm), direction controls and
 * invisible characters are drawn as visible tokens, ‹RLO›, ‹ZWSP›: the picture shows the bytes in
 * the order they are stored, and nothing in it is hidden or reversed. The brackets are U+2039 and
 * U+203A, which every font on the card has.
 */

const FSI = "⁨";
const PDI = "⁩";

/** The words as one isolated run. */
export function isolate(text: string): string {
  return `${FSI}${text}${PDI}`;
}

/** The common short names of the characters a reader cannot see or that change direction. */
const NAMES: Record<number, string> = {
  0x00ad: "SHY",
  0x061c: "ALM",
  0x180e: "MVS",
  0x200b: "ZWSP",
  0x200c: "ZWNJ",
  0x200d: "ZWJ",
  0x200e: "LRM",
  0x200f: "RLM",
  0x2028: "LS",
  0x2029: "PS",
  0x202a: "LRE",
  0x202b: "RLE",
  0x202c: "PDF",
  0x202d: "LRO",
  0x202e: "RLO",
  0x2060: "WJ",
  0x2066: "LRI",
  0x2067: "RLI",
  0x2068: "FSI",
  0x2069: "PDI",
  0xfeff: "ZWNBSP",
};

/**
 * Every format character (direction controls, zero-width characters, U+FEFF…), line and paragraph
 * separator, and control character other than a tab or a line end, written as a token: its short
 * name, or U+XXXX for one without.
 */
export function visible(text: string): string {
  return text.replace(/[\p{Cf}\p{Zl}\p{Zp}\p{Cc}]/gu, (char) => {
    if (char === "\n" || char === "\t" || char === "\r") return char;
    const code = char.codePointAt(0)!;
    return `‹${NAMES[code] ?? `U+${code.toString(16).toUpperCase().padStart(4, "0")}`}›`;
  });
}
