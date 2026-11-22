import { expect, test } from "bun:test";

import { atLeast, money, moneyExact } from "./format";
import { receiptAmounts } from "./receipt";
import { WORDS } from "./words";

// Core pays each pass mulDiv(reward, margin, 10 000) rounded down and the helper the rest,
// so the helper's least is the ceiling. Hand B of the early review: reward 1 unit, claim 1 bp.
test("the helper's 'at least' is the ceiling: reward 1, claim 1 is 1, not 0", () => {
  expect(atLeast(1n, 1)).toBe(1n);
  expect(money(atLeast(1n, 1), 6, "en")).toBe("under $0.01");
  expect(atLeast(40_000_000n, 7000)).toBe(28_000_000n);
  expect(atLeast(0n, 7000)).toBe(0n);
  expect(atLeast(1_000_001n, 9_999)).toBe(999_901n);
  // It is never above what Core pays: the reward less every margin, rounded down one by one.
  for (const [reward, margins] of [
    [1n, [9_999]],
    [1_000_001n, [1, 1, 1, 1, 1, 1]],
    [330_000n, [5_000, 1]],
    [900_000_000_007n, [3_333, 3_333, 3_333]],
  ] as [bigint, number[]][]) {
    const paid = margins.reduce((rest, margin) => rest - (reward * BigInt(margin)) / 10_000n, reward);
    const claim = 10_000 - margins.reduce((sum, margin) => sum + margin, 0);
    expect(atLeast(reward, claim) <= paid).toBe(true);
  }
});

test("every digit, in each language", () => {
  expect(moneyExact(165_000n, 6, "en")).toBe("$0.165");
  expect(moneyExact(33n, 6, "en")).toBe("$0.000033");
  expect(moneyExact(40_000_000n, 6, "en")).toBe("$40.00");
  expect(moneyExact(1_234_500_001n, 6, "ru")).toBe("$1 234,500001");
  expect(moneyExact(7n, 0, "en")).toBe("$7");
});

// Hand E of the early review, 165 000 + 33 + 164 967 units under a reward of 330 000.
test("receipt rows that would not add up in cents are written with every digit", () => {
  const e = receiptAmounts([165_000n, 33n, 164_967n], 330_000n, 6, "en");
  expect(e).toEqual({ rows: ["$0.165", "$0.000033", "$0.164967"], total: "$0.33", exact: true });
  const a = receiptAmounts([100n, 100n, 100n, 100n, 100n, 100n, 999_401n], 1_000_001n, 6, "en");
  expect(a.exact).toBe(true);
  expect(a.rows[0]).toBe("$0.0001");
  expect(a.total).toBe("$1.000001");
  // Whole cents stay in cents.
  expect(receiptAmounts([800_000n, 0n, 1_200_000n, 38_000_000n], 40_000_000n, 6, "ru")).toEqual({
    rows: ["$0,80", "$0,00", "$1,20", "$38,00"],
    total: "$40,00",
    exact: false,
  });
});

test("a zero share is written one way in each language", () => {
  expect(WORDS.en.receipt.keptNothing).toBe("kept nothing");
  expect(WORDS.ru.receipt.keptNothing).toBe("не оставили себе ничего");
});
