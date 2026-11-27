import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { aHandCoreAbi, DEPLOYMENTS, NETWORKS, coreOf, networkOf, parseDeployment, usdcOf } from "./index.js";

const RECORDS = join(import.meta.dirname, "../../../contracts/deployments");

describe("networks", () => {
  // What the two USDC contracts answered on chain on 2026-11-22 (see networks.ts).
  test("Base: Circle's USDC, and no Core yet", () => {
    expect(usdcOf(8453)).toEqual({ address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", name: "USD Coin", version: "2", decimals: 6 });
    expect(networkOf(8453)?.deployment).toBeUndefined();
    expect(coreOf(8453)).toBeUndefined();
    expect(8453 in DEPLOYMENTS).toBe(false);
  });

  test("Base Sepolia: Circle's test USDC, and the Core its deployment record names", () => {
    expect(usdcOf(84532)).toEqual({ address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", symbol: "USDC", name: "USDC", version: "2", decimals: 6 });
    const record = parseDeployment(readFileSync(join(RECORDS, "84532.json"), "utf-8"));
    expect(NETWORKS[84532].deployment).toEqual(record);
    expect(coreOf(84532)).toBe("0x0f0555972388151D2C187f636A0855b6eE9B9685");
  });

  test("a chain aHand does not run on has nothing", () => {
    for (const chainId of [1, 10, 31337, 0]) {
      expect(networkOf(chainId)).toBeUndefined();
      expect(coreOf(chainId)).toBeUndefined();
      expect(usdcOf(chainId)).toBeUndefined();
    }
  });

  test("the records and the networks are frozen: no importer can redirect coreOf", () => {
    const record = DEPLOYMENTS[84532];
    for (const value of [DEPLOYMENTS, record, record.tokens, NETWORKS, NETWORKS[8453], NETWORKS[84532], NETWORKS[8453].usdc, NETWORKS[84532].usdc]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(NETWORKS[84532].deployment).toBe(record);
    expect(() => {
      (record as { core: string }).core = "0x0000000000000000000000000000000000000001";
    }).toThrow(TypeError);
    expect(coreOf(84532)).toBe("0x0f0555972388151D2C187f636A0855b6eE9B9685");
  });

  test("Core's ABI is the protocol's: 20 functions, 11 events, 26 errors", () => {
    const count = (type: string) => aHandCoreAbi.filter((item) => item.type === type).length;
    expect([count("function"), count("event"), count("error")]).toEqual([20, 11, 26]);
  });
});
