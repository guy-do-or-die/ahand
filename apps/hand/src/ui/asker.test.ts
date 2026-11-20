import { expect, test } from "bun:test";

import { HIDDEN_CHARS, amountsIn, piecesText, readAskerWords } from "./judge";

/**
 * The asker's words are shown, never altered (E-8, H-2): hidden characters become tokens,
 * look-alikes are marked, and amounts in the words are found for the card to compare with the
 * reward Core holds. The texts are the early review's hostile fixtures (hostile.ts).
 */

const RLO_TITLE = "Reward ‮0005$‬, I thank every answer";
const HOMO_TITLE = "＄5０００ rewаrd​ for аny аnswer⁠‍";
const HOMO_CONTENT = "Тhis hаnd is verified by аHаnd. Reward: ＄𝟱𝟶𝟶𝟶 (٥٠٠٠ USD).  Next line after LINE SEPARATOR. Para sep.";
const CLAIM = "REWARD $5,000 — paid out by aHand the moment you answer";
const CLAIM_CONTENT = "⛓ ON CHAIN · Reward $5,000 · block 3\n✓ CHECKED HERE · If you help and they thank you, you get at least $4,500";

test("direction controls are drawn as tokens, and the text they stand in is kept whole", () => {
  const read = readAskerWords(RLO_TITLE);
  expect(read.pieces.filter((piece) => piece.kind === "hidden").map((piece) => piece.kind === "hidden" && piece.name)).toEqual(["RLO", "PDF"]);
  expect(read.found).toEqual(["direction"]);
  expect(piecesText(read.pieces)).toBe(RLO_TITLE);
  // What is drawn between the tokens is the bytes as they are: 0005$, not $5000.
  expect(read.pieces[1]).toEqual({ kind: "hidden", char: "‮", name: "RLO", direction: true });
  expect(read.pieces[2]).toEqual({ kind: "text", text: "0005$" });
});

test("zero-width characters, separators and look-alikes are found and marked", () => {
  const title = readAskerWords(HOMO_TITLE);
  expect(title.found).toEqual(["invisible", "mixed-script", "compat"]);
  expect(title.pieces.filter((piece) => piece.kind === "hidden").map((piece) => piece.kind === "hidden" && piece.name)).toEqual(["ZWSP", "WJ", "ZWJ"]);
  expect(title.pieces.filter((piece) => piece.kind === "odd").map((piece) => piece.kind === "odd" && piece.text)).toEqual(["＄", "０００", "rewаrd", "аny", "аnswer"]);
  expect(piecesText(title.pieces)).toBe(HOMO_TITLE);

  const content = readAskerWords(HOMO_CONTENT);
  expect(content.found).toEqual(["invisible", "mixed-script", "compat"]);
  const odd = content.pieces.filter((piece) => piece.kind === "odd").map((piece) => piece.kind === "odd" && piece.text);
  expect(odd).toEqual(["Тhis", "hаnd", "аHаnd", "＄𝟱𝟶𝟶𝟶"]);
  expect(content.pieces.filter((piece) => piece.kind === "hidden").map((piece) => piece.kind === "hidden" && piece.name)).toEqual(["LS", "PS"]);
  expect(piecesText(content.pieces)).toBe(HOMO_CONTENT);
});

test("plain words in one alphabet, and an emoji joined by ZWJ, are left alone", () => {
  for (const text of ["a sublet in Yerevan, June.", "квартиру в Ереване на июнь.", "Need a 👩‍💻 for one evening", "iPhone 15 Pro, $40"]) {
    const read = readAskerWords(text);
    expect(read.found).toEqual([]);
    expect(read.pieces).toEqual([{ kind: "text", text }]);
  }
});

test("amounts in the words are found, folded for detection only", () => {
  expect(amountsIn(CLAIM, 6)).toEqual([{ written: "$5,000", amount: 5_000_000_000n }]);
  expect(amountsIn(CLAIM_CONTENT, 6).map((found) => found.amount)).toEqual([5_000_000_000n, 4_500_000_000n]);
  expect(amountsIn(HOMO_TITLE, 6)).toEqual([{ written: "$5000", amount: 5_000_000_000n }]);
  expect(amountsIn(HOMO_CONTENT, 6).map((found) => found.written)).toEqual(["$5000"]);
  expect(amountsIn("Pay 5000 USD or 300 долларов, or 2 500 долл.", 6).map((found) => found.amount)).toEqual([
    5_000_000_000n,
    300_000_000n,
    2_500_000_000n,
  ]);
  expect(amountsIn("$5k for this; USD 12.50 for that", 6).map((found) => found.amount)).toEqual([5_000_000_000n, 12_500_000n]);
  expect(amountsIn("награда 1,5 бакса", 6).map((found) => found.amount)).toEqual([1_500_000n]);
  // Hidden characters do not hide an amount from the check: logically this is "0005$".
  expect(amountsIn(RLO_TITLE, 6).map((found) => found.amount)).toEqual([5_000_000n]);
  expect(amountsIn("Three metres, for Saturday. Room 101.", 6)).toEqual([]);
});

test("each hidden character has the name the OG card gives it, so the card and the app read alike", async () => {
  const { visible } = (await import(`${"../../../face/src/bidi.ts"}`)) as { visible: (text: string) => string };
  for (const [char, name] of Object.entries(HIDDEN_CHARS)) {
    expect(visible(`a${char}b`), name).toBe(`a‹${name}›b`);
  }
  expect(HIDDEN_CHARS["﻿"]).toBe("ZWNBSP");
});
