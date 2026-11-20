import { toDigits, type HandEventName, type ReceiptRow } from "@ahand/sdk";
import type { Address } from "viem";

import { config } from "../config";
import type { Lang, PayeeContext, RailHand } from "../ui";

/**
 * Sample data for the gallery. Addresses are anvil's public test accounts and this build's
 * configured Core and token; nothing here is read from a chain, and nothing is a secret.
 */

export const ASKER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
export const HOLDER_A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
export const HOLDER_B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
export const HELPER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;

export const CORE = (config.cores.canonical ?? config.cores.trusted[0]!.core) as Address;
export const TOKEN = config.tokens[0]!;
export const DECIMALS = TOKEN.decimals;

/** What the SDK's `payeeProblem` judges an address against: the real Core and token of this build. */
export const PAYEE_CTX: PayeeContext = { core: CORE, raiser: ASKER, token: TOKEN.address as Address };

const utc = (year: number, month: number, date: number, hour = 12, minute = 0) => Date.UTC(year, month - 1, date, hour, minute) / 1000;

/** Noon UTC, so the day reads the same in every reader's time zone. */
export const EXPIRY = utc(2026, 12, 20);
export const THANKED_AT = utc(2026, 12, 3);
export const REFUNDED_AT = utc(2026, 12, 21);
export const BLOCK = { number: 1234n, timestamp: utc(2026, 11, 20, 14, 2) };

export const dollars = (amount: number) => BigInt(Math.round(amount * 100)) * 10n ** BigInt(DECIMALS - 2);

/** The Hand's own words are the asker's, so the sample has them in each language. */
export const HAND_WORDS: Record<Lang, { title: string; content: string }> = {
  en: {
    title: "a sublet in Yerevan, June.",
    content: "One room is enough, near Cascade if possible. From 1 June for four weeks.",
  },
  ru: {
    title: "квартиру в Ереване на июнь.",
    content: "Хватит одной комнаты, лучше рядом с Каскадом. С 1 июня на четыре недели.",
  },
};

export const SHORT_ROUTE: RailHand[] = [{ role: "asker", address: ASKER }, { role: "passer", address: HOLDER_A }, { role: "passer" }];

export const LONG_ROUTE: RailHand[] = [
  { role: "asker", address: ASKER },
  ...Array.from({ length: 9 }, (_, index): RailHand => (index % 3 === 1 ? { role: "passer" } : { role: "passer", address: index % 2 ? HOLDER_A : HOLDER_B })),
];

function row(eventName: HandEventName, logIndex: number, more: Partial<ReceiptRow> = {}): ReceiptRow {
  const zero = `0x${"00".repeat(32)}` as const;
  return { eventName, ...more, log: { eventName, args: {}, blockNumber: BLOCK.number, blockHash: zero, transactionHash: zero, logIndex } };
}

/** A thank of $40 over three passes, in Core's event order: one pass kept nothing, one payout waits. */
export const THANK_ROWS: ReceiptRow[] = [
  row("Thanked", 0, { amount: dollars(40) }),
  row("Shaken", 1, { position: 0, payee: HOLDER_A, amount: dollars(0.8) }),
  row("Paid", 2, { payee: HOLDER_A, amount: dollars(0.8) }),
  row("Shaken", 3, { position: 1 }),
  row("Shaken", 4, { position: 2, payee: HOLDER_B, amount: dollars(1.2) }),
  row("Pending", 5, { payee: HOLDER_B, amount: dollars(1.2) }),
  row("Given", 6, { payee: HELPER, amount: dollars(38) }),
  row("Paid", 7, { payee: HELPER, amount: dollars(38) }),
];

/** The same thank while its logs are still being read: the first three rows have landed. */
export const THANK_LANDED = THANK_ROWS.map((_, index) => index < 3);

export const REFUND_ROWS: ReceiptRow[] = [row("Refunded", 0, { amount: dollars(40) }), row("Paid", 1, { payee: ASKER, amount: dollars(40) })];

/** A thank of a Hand with no reward: events, and no payout at all. */
export const THANKS_ONLY_ROWS: ReceiptRow[] = [row("Thanked", 0, { amount: 0n }), row("Shaken", 1, { position: 0 }), row("Given", 2, { payee: HELPER })];

/**
 * Bytes that stand in for a link of a given length. They are not a real link (no Hand stands
 * behind them); they exist to show a code of the real size: a dark Hand's first link is 428
 * bytes (ARCHITECTURE §0).
 */
export function sampleLink(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = 0x45;
  for (let index = 0; index < length; ++index) {
    bytes[index] = state;
    state = (state * 73 + 41) & 0xff;
  }
  return bytes;
}

/** A bare address as a QR carries it: the site, a fragment mark, the link's digits. */
export const addressOf = (length: number) => `${config.site}/#${toDigits(sampleLink(length))}`;

/**
 * Words an asker could write to mislead (the early review's hostile fixtures, hostile.ts). The
 * card shows them as written, labelled as the asker's, with what it found said beside them.
 */
export const HOSTILE_WORDS = {
  /** Copies the app's own marks and promises $5,000 on a Hand that holds $1. */
  claim: {
    title: "REWARD $5,000 — paid out by aHand the moment you answer",
    content: [
      "⛓ ON CHAIN · Reward $5,000 · block 3",
      "✓ CHECKED HERE · If you help and they thank you, you get at least $4,500",
      "",
      "**This hand is verified by aHand.** Core holds the full $5,000 for you.",
    ].join("\n"),
  },
  /** A right-to-left override that draws "0005$" as "$5000", zero-width characters, look-alikes. */
  tricks: {
    title: "Reward ‮0005$‬, I thank every answer",
    content: "Тhis hаnd is verified by аHаnd.​ Reward: ＄５０００ or ＄𝟱𝟶𝟶𝟶. Next line⁠‍ after a line separator.",
  },
  /** Far more words than a card shows at once. */
  long: {
    title: "$5000 ".repeat(120).trim(),
    content: Array.from({ length: 40 }, (_, index) => `Line ${index + 1}: this is a long description that keeps going to push the terms down.`).join("\n"),
  },
} as const;
