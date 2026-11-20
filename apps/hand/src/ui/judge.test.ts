import { expect, test } from "bun:test";

import { payeeOf, readAddress, readMoney } from "./judge";

const ctx = {
  core: "0x65ac707E2AE7392583de5d6192C619F1D8862309",
  raiser: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  token: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
} as const;
const OTHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

test("zero is a valid amount", () => {
  expect(readMoney("0", 6)).toEqual({ status: "ok", amount: 0n });
  expect(readMoney("0.00", 6)).toEqual({ status: "ok", amount: 0n });
  expect(readMoney("$0", 6)).toEqual({ status: "ok", amount: 0n });
});

test("amounts are read exactly, with a point or a comma", () => {
  expect(readMoney("40", 6)).toEqual({ status: "ok", amount: 40_000_000n });
  expect(readMoney("12.5", 6)).toEqual({ status: "ok", amount: 12_500_000n });
  expect(readMoney("12,5", 6)).toEqual({ status: "ok", amount: 12_500_000n });
  expect(readMoney(".5", 6)).toEqual({ status: "ok", amount: 500_000n });
  expect(readMoney("5.", 6)).toEqual({ status: "ok", amount: 5_000_000n });
  expect(readMoney(" $1 000 ", 6)).toEqual({ status: "ok", amount: 1_000_000_000n });
  expect(readMoney("0.000001", 6)).toEqual({ status: "ok", amount: 1n });
  expect(readMoney("7", 0)).toEqual({ status: "ok", amount: 7n });
});

test("an empty field is empty, not zero", () => {
  expect(readMoney("", 6)).toEqual({ status: "empty" });
  expect(readMoney("  ", 6)).toEqual({ status: "empty" });
});

test("what is not an amount is refused, and nothing is rounded", () => {
  for (const text of ["abc", "-5", "1.2.3", "1,2,3", ".", "1e6", "0x10", "0.0000001", "１２"]) {
    expect(readMoney(text, 6)).toEqual({ status: "invalid" });
  }
  expect(readMoney("1.5", 0)).toEqual({ status: "invalid" });
});

// C-3, ported from the early review (scratch/code-correctness/app-tests/money.test.ts): an
// English reader writes a thousand as "1,000", and the field read it as $1, "$1,500" as $1.50.
test("'1,000' is not read as one dollar: a comma before three digits is refused with a hint", () => {
  const r = readMoney("1,000", 6);
  expect(r.status === "ok" && r.amount === 1_000_000n).toBe(false);
  expect(r).toEqual({ status: "invalid", hint: "thousands", plain: "1000" });
});

test("'$1,500' is refused the same way, never read as $1.50", () => {
  expect(readMoney("$1,500", 6)).toEqual({ status: "invalid", hint: "thousands", plain: "1500" });
  expect(readMoney("12,345,678", 6)).toEqual({ status: "invalid", hint: "thousands", plain: "12345678" });
  expect(readMoney("1,000.50", 6)).toEqual({ status: "invalid", hint: "thousands", plain: "1000.50" });
  expect(readMoney("$ 1,000 ", 6)).toEqual({ status: "invalid", hint: "thousands", plain: "1000" });
});

test("a comma with one, two or more than three digits after it stays a decimal comma", () => {
  expect(readMoney("1,5", 6)).toEqual({ status: "ok", amount: 1_500_000n });
  expect(readMoney("1,50", 6)).toEqual({ status: "ok", amount: 1_500_000n });
  expect(readMoney("1,0000", 6)).toEqual({ status: "ok", amount: 1_000_000n });
  // A whole part of 0 is never a thousand: 0,500 is half a dollar.
  expect(readMoney("0,500", 6)).toEqual({ status: "ok", amount: 500_000n });
  expect(readMoney(",500", 6)).toEqual({ status: "ok", amount: 500_000n });
});

test("an amount above the limit says so", () => {
  expect(readMoney("41", 6, 40_000_000n)).toEqual({ status: "too-much", amount: 41_000_000n });
  expect(readMoney("40", 6, 40_000_000n)).toEqual({ status: "ok", amount: 40_000_000n });
});

test("the zero address and the contract's own address are refused", () => {
  expect(readAddress("0x0000000000000000000000000000000000000000", ctx)).toEqual({
    status: "refused",
    problem: "zero",
    address: "0x0000000000000000000000000000000000000000",
  });
  expect(readAddress(ctx.core, ctx)).toEqual({ status: "refused", problem: "core", address: ctx.core });
  expect(readAddress(ctx.core.toLowerCase(), ctx)).toEqual({ status: "refused", problem: "core", address: ctx.core });
  expect(payeeOf(readAddress(ctx.core, ctx))).toBeUndefined();
});

test("the asker's and the token's addresses are flagged and let through", () => {
  expect(readAddress(ctx.raiser, ctx)).toEqual({ status: "flagged", problem: "raiser", address: ctx.raiser });
  expect(readAddress(ctx.token, ctx)).toEqual({ status: "flagged", problem: "token", address: ctx.token });
  expect(payeeOf(readAddress(ctx.raiser, ctx))).toBe(ctx.raiser);
});

test("any other address is accepted, in its checksummed spelling", () => {
  expect(readAddress(`  ${OTHER.toLowerCase()} `, ctx)).toEqual({ status: "ok", address: OTHER });
  expect(readAddress(OTHER, ctx)).toEqual({ status: "ok", address: OTHER });
});

test("half an address is incomplete; a wrong capital letter is a slip", () => {
  expect(readAddress("", ctx)).toEqual({ status: "empty" });
  expect(readAddress("0x7099", ctx)).toEqual({ status: "incomplete" });
  expect(readAddress("vitalik.eth", ctx)).toEqual({ status: "incomplete" });
  expect(readAddress(OTHER.replace("C5", "c5"), ctx)).toEqual({ status: "typo" });
});
