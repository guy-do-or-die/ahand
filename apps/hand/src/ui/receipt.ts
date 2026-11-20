import type { ReceiptRow } from "@ahand/sdk";
import type { Address } from "viem";

import type { Lang } from "./ambient";
import { money, moneyExact } from "./format";

/**
 * Turns the SDK's receipt rows (Core's events, in Core's order) into the lines a person reads.
 * Core logs a thank as: Thanked; for each Shake, Shaken and then its payout; Given and then
 * the giver's payout. A payout is Paid or Pending, and one of zero is not logged. A refund is
 * Refunded and then its payout. So each line here is one Shaken, Given or Refunded together
 * with the payout that follows it, if any. Amounts come only from Paid and Pending: the table
 * shows money that moved, never a figure worked out on the side.
 */

export type ReceiptLineKind = "passed" | "helped" | "back" | "paid";

export interface ReceiptLine {
  kind: ReceiptLineKind;
  /** A Shake's position on the route, for "passed". */
  position?: number;
  payee?: Address;
  /** What the payout moved; undefined when Core logged no payout (an amount of zero). */
  amount?: bigint;
  /** True when the payout is Pending: it waits in Core for its payee. */
  waiting: boolean;
  /** Indexes of the SDK rows this line stands for (its event and its payout). */
  rows: number[];
}

export interface ReceiptLines {
  lines: ReceiptLine[];
  /** The whole reward, from Thanked or Refunded; else the sum of the payouts. */
  total: bigint;
}

export function receiptLines(rows: readonly ReceiptRow[]): ReceiptLines {
  const lines: ReceiptLine[] = [];
  let stated: bigint | undefined;
  let paid = 0n;
  let open: ReceiptLine | undefined; // the line still waiting for its payout

  rows.forEach((row, index) => {
    switch (row.eventName) {
      case "Thanked":
        stated = row.amount ?? stated;
        open = undefined;
        break;
      case "Refunded":
        stated = row.amount ?? stated;
        open = { kind: "back", payee: row.payee, waiting: false, rows: [index] };
        lines.push(open);
        break;
      case "Shaken":
        open = { kind: "passed", position: row.position, payee: row.payee, waiting: false, rows: [index] };
        lines.push(open);
        break;
      case "Given":
        open = { kind: "helped", payee: row.payee, waiting: false, rows: [index] };
        lines.push(open);
        break;
      case "Paid":
      case "Pending": {
        const amount = row.amount ?? 0n;
        paid += amount;
        if (open) {
          open.amount = amount;
          open.payee = row.payee ?? open.payee;
          open.waiting = row.eventName === "Pending";
          open.rows.push(index);
          open = undefined;
        } else {
          lines.push({ kind: "paid", payee: row.payee, amount, waiting: row.eventName === "Pending", rows: [index] });
        }
        break;
      }
      default:
        break; // Raised, Funded, Extended: not part of what was sent to whom
    }
  });

  return { lines, total: stated ?? paid };
}

/** Whether every SDK row behind a line has been read; with no flags, everything has. */
export function lineLanded(line: ReceiptLine, landed: readonly boolean[] | undefined): boolean {
  return landed === undefined || line.rows.every((index) => landed[index] === true);
}

// ── Writing the amounts ──────────────────────────────────────────────────

export interface ReceiptAmounts {
  /** Each amount as the receipt writes it, in the order given. */
  rows: string[];
  total: string;
  /** True when the amounts are written with every digit, because cents would not add up. */
  exact: boolean;
}

/**
 * How a receipt writes its amounts so that the rows a person reads add up to the total they
 * read (M-4). Cut to cents when that adds up; otherwise every amount, the total too, with every
 * digit: $0.165 + $0.000033 + $0.164967 = $0.33, where cents read $0.16 + under $0.01 + $0.16.
 * A zero row is written as words by the caller ("kept nothing"), never as "$0".
 *
 * Shared by the receipt, the thank screen's prediction and the passport.
 */
export function receiptAmounts(amounts: readonly bigint[], total: bigint, decimals: number, lang: Lang): ReceiptAmounts {
  const unit = 10n ** BigInt(decimals);
  const cents = (amount: bigint) => (amount * 100n) / unit;
  const cutSum = amounts.reduce((sum, amount) => sum + cents(amount), 0n);
  const exact = cutSum !== cents(total) || amounts.some((amount) => amount > 0n && cents(amount) === 0n);
  const write = (amount: bigint) => (exact ? moneyExact(amount, decimals, lang) : money(amount, decimals, lang, { cents: true }));
  return { rows: amounts.map(write), total: write(total), exact };
}
