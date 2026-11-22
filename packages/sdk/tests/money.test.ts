import { serializeTransaction, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PRICES } from "../src/app.js";
import { GAS_PRICE_ORACLE, costOf, l1FeeOf, usdText, type PriceSnapshot } from "../src/money.js";
import { startChain, type Chain } from "./helpers/anvil.js";

const prices: PriceSnapshot = PRICES;

describe("the application's price snapshot", () => {
  it("is the fee study of 2026-11-10, dated and sourced", () => {
    expect(prices.date).toBe("2026-11-10");
    expect(prices.ethUsd).toBe(2400);
    expect(prices.base.gwei).toBe(0.006);
    expect(prices.ethereum.gwei).toBe(0.3);
    expect(prices.source).toMatch(/fee study of 2026-11-10/);
  });
});

describe("costOf", () => {
  it("reproduces the fee study's table (Base now, Ethereum's 2026 average)", () => {
    // Rows of the fee study of 2026-11-10: gas, Base now, Ethereum average.
    const rows: [bigint, string, string][] = [
      [207_528n, "0.003", "0.15"], // raise, first Hand in this token: $0.0030 · $0.149
      [128_585n, "0.0019", "0.093"], // raise without a reward
      [113_083n, "0.0016", "0.081"], // thank, direct route
      [566_319n, "0.0082", "0.41"], // thank, 10 Shakes: $0.0082 · $0.408
      [1_472_491n, "0.021", "1.06"], // thank, 30 Shakes
      [67_744n, "0.00098", "0.049"], // withdraw: the study rounds $0.000976 to $0.0010
    ];
    for (const [gas, base, ethereum] of rows) {
      const cost = costOf(gas, prices);
      expect([gas, cost.base.usd, cost.ethereum.usd]).toEqual([gas, base, ethereum]);
    }
  });

  it("gives ETH exactly, in wei-precise decimals", () => {
    const cost = costOf(207_528n, prices);
    expect(cost.base.eth).toBe("0.000001245168"); // 207 528 × 6 000 000 wei
    expect(cost.ethereum.eth).toBe("0.0000622584"); // 207 528 × 300 000 000 wei
  });

  it("adds the L1 data fee to Base only", () => {
    const without = costOf(100_000n, prices);
    const withFee = costOf(100_000n, prices, 1_000_000_000_000n);
    expect(withFee.ethereum).toEqual(without.ethereum);
    expect(withFee.base.eth).toBe("0.0000016"); // 100 000 × 6e6 + 1e12 wei
    expect(withFee.base.usd).toBe("0.0038");
  });

  it("costs nothing for no gas, and refuses negatives", () => {
    expect(costOf(0n, prices)).toEqual({ base: { eth: "0", usd: "0" }, ethereum: { eth: "0", usd: "0" } });
    expect(() => costOf(-1n, prices)).toThrow();
    expect(() => costOf(1n, prices, -1n)).toThrow();
    expect(() => costOf(1n, { ...prices, base: { gwei: -1 } })).toThrow();
  });
});

describe("usdText", () => {
  it("shows cents from a dollar up and two significant figures below, never rounding to nothing", () => {
    expect(usdText(17.6712)).toBe("17.67");
    expect(usdText(1)).toBe("1.00");
    expect(usdText(0.999)).toBe("1.00");
    expect(usdText(0.149)).toBe("0.15");
    expect(usdText(0.0029887)).toBe("0.003");
    expect(usdText(0.00000012)).toBe("0.00000012");
    expect(usdText(0)).toBe("0");
  });
});

describe("l1FeeOf, on the helper chain", () => {
  let chain: Chain;
  beforeAll(async () => {
    chain = await startChain({ port: process.env.SDK_TEST_PORT_BASE ? Number(process.env.SDK_TEST_PORT_BASE) + 0 : 15051 });
  }, 60_000);
  afterAll(async () => {
    await chain?.stop();
  });

  const tx: Hex = serializeTransaction({ chainId: 31337, type: "eip1559", to: "0x65ac707E2AE7392583de5d6192C619F1D8862309".toLowerCase() as Hex, data: "0x12345678", nonce: 0, gas: 100_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n });

  it("is undefined where the chain has no GasPriceOracle (anvil, like Ethereum)", async () => {
    expect(await l1FeeOf(chain.client, tx)).toBeUndefined();
  });

  it("reads getL1Fee(bytes) from the predeploy address where code is there", async () => {
    // A stand-in at the predeploy address that answers 12 345 to any call (PUSH2 0x3039, MSTORE, RETURN 32):
    // it checks the read path and the decoding, not Base's own fee formula.
    await chain.client.request({ method: "anvil_setCode" as never, params: [GAS_PRICE_ORACLE, "0x61303960005260206000f3"] as never });
    expect(await l1FeeOf(chain.client, tx)).toBe(12_345n);
    await chain.client.request({ method: "anvil_setCode" as never, params: [GAS_PRICE_ORACLE, "0x"] as never });
    expect(await l1FeeOf(chain.client, tx)).toBeUndefined();
  });
});
