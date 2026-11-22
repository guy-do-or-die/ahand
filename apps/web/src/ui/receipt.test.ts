import { expect, test } from "bun:test";

import type { HandEventName, ReceiptRow } from "@ahand/sdk";
import type { Address } from "viem";

import { lineLanded, receiptLines } from "./receipt";

const A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
const HELPER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;
const ASKER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;

function row(eventName: HandEventName, more: Partial<ReceiptRow> = {}, logIndex = 0): ReceiptRow {
  return {
    eventName,
    ...more,
    log: { eventName, args: {}, blockNumber: 1234n, blockHash: "0x00", transactionHash: "0x00", logIndex },
  };
}

test("a thank reads as one line per hand, each with the payout that followed it", () => {
  const rows = [
    row("Thanked", { amount: 40_000_000n }),
    row("Shaken", { position: 0, payee: A, amount: 800_000n }),
    row("Paid", { payee: A, amount: 800_000n }),
    row("Shaken", { position: 1, payee: B, amount: 0n }),
    row("Shaken", { position: 2, payee: B, amount: 1_200_000n }),
    row("Pending", { payee: B, amount: 1_200_000n }),
    row("Given", { payee: HELPER, amount: 38_000_000n }),
    row("Paid", { payee: HELPER, amount: 38_000_000n }),
  ];
  const { lines, total } = receiptLines(rows);
  expect(total).toBe(40_000_000n);
  expect(lines).toEqual([
    { kind: "passed", position: 0, payee: A, amount: 800_000n, waiting: false, rows: [1, 2] },
    { kind: "passed", position: 1, payee: B, waiting: false, rows: [3] },
    { kind: "passed", position: 2, payee: B, amount: 1_200_000n, waiting: true, rows: [4, 5] },
    { kind: "helped", payee: HELPER, amount: 38_000_000n, waiting: false, rows: [6, 7] },
  ]);
});

test("amounts come from payouts only: a Shaken's own figure is never shown as money moved", () => {
  const { lines } = receiptLines([row("Thanked", { amount: 10n }), row("Shaken", { position: 0, payee: A, amount: 5n })]);
  expect(lines[0]!.amount).toBeUndefined();
});

test("a thank with no reward has lines and no money", () => {
  const { lines, total } = receiptLines([row("Thanked", { amount: 0n }), row("Shaken", { position: 0, payee: A }), row("Given", { payee: HELPER })]);
  expect(total).toBe(0n);
  expect(lines.map((line) => line.amount)).toEqual([undefined, undefined]);
});

test("a refund is one line back to the asker", () => {
  const { lines, total } = receiptLines([row("Refunded", { amount: 40_000_000n }), row("Paid", { payee: ASKER, amount: 40_000_000n })]);
  expect(total).toBe(40_000_000n);
  expect(lines).toEqual([{ kind: "back", payee: ASKER, amount: 40_000_000n, waiting: false, rows: [0, 1] }]);
});

test("payouts with nothing before them still show, and add up to the total", () => {
  const { lines, total } = receiptLines([row("Paid", { payee: A, amount: 3n }), row("Pending", { payee: B, amount: 4n })]);
  expect(total).toBe(7n);
  expect(lines.map((line) => [line.kind, line.waiting])).toEqual([
    ["paid", false],
    ["paid", true],
  ]);
});

test("events that pay nobody are left out", () => {
  expect(receiptLines([row("Raised"), row("Funded", { amount: 5n }), row("Extended")]).lines).toEqual([]);
});

test("a line has landed when every row behind it has", () => {
  const { lines } = receiptLines([row("Thanked"), row("Shaken", { position: 0, payee: A }), row("Paid", { payee: A, amount: 1n })]);
  const line = lines[0]!;
  expect(lineLanded(line, undefined)).toBe(true);
  expect(lineLanded(line, [true, true, false])).toBe(false);
  expect(lineLanded(line, [false, true, true])).toBe(true);
  expect(lineLanded(line, [true, true])).toBe(false);
});
