import { describe, expect, test } from "bun:test";

import { exactMoney } from "./exact";

describe("exactMoney", () => {
  test("an amount with digits below a cent is written to its last digit", () => {
    expect(exactMoney(2_000_003n, 6, "en")).toBe("$2.000003");
    expect(exactMoney(2_000_003n, 6, "ru")).toBe("$2,000003");
    expect(exactMoney(1n, 6, "en")).toBe("$0.000001");
    expect(exactMoney(1_234_000_005n, 6, "en")).toBe("$1,234.000005");
  });

  test("whole dollars and cents read as money does elsewhere", () => {
    expect(exactMoney(2_000_000n, 6, "en")).toBe("$2");
    expect(exactMoney(2_500_000n, 6, "en")).toBe("$2.50");
    expect(exactMoney(2_500_000n, 6, "ru")).toBe("$2,50");
  });
});
