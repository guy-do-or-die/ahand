import { describe, expect, test } from "bun:test";

import { logWindowOf, LOG_WINDOW } from "@ahand/sdk";

import { pollMsOf } from "../config/schema";
import { chainOf, publicClientOf } from "./clients";

/**
 * The viem chain a wallet is handed (wallet_addEthereumChain): the public test network's explorer
 * goes with it as blockExplorerUrls, and a public test network is marked a testnet (review of the
 * public test deployment: Base Sepolia was added with no explorer and testnet false).
 */
describe("chainOf", () => {
  const base = { id: 84532, name: "Base Sepolia", rpcUrls: ["https://sepolia.base.org"], blockTimeMs: 200, local: false, hasL1: true };

  test("a configured explorer becomes the chain's default block explorer", () => {
    const chain = chainOf({ ...base, testnet: true, explorer: "https://sepolia.basescan.org" });
    expect(chain.blockExplorers?.default).toEqual({ name: "sepolia.basescan.org", url: "https://sepolia.basescan.org" });
    expect(chain.testnet).toBe(true);
    expect(chain.name).toBe("Base Sepolia");
  });

  test("no explorer, no block explorers; testnet follows local when not set", () => {
    expect(chainOf(base).blockExplorers).toBeUndefined();
    expect(chainOf(base).testnet).toBe(false);
    expect(chainOf({ ...base, id: 31337, local: true, hasL1: false }).testnet).toBe(true);
  });
});

/**
 * Base makes a block every 200 ms (blocks 61 429 229 and 61 441 608, 2 476 s apart, on 2026-11-21),
 * and its public RPC takes `eth_getLogs` over at most 200 blocks. The chain's pace goes to viem's
 * `blockTime` (the SDK's findBlockAt guesses with it); how often the app asks is `pollMs`; the log
 * window the client starts at is `logWindow`.
 */
describe("pace, polling and the log window", () => {
  const sepolia = { id: 84532, name: "Base Sepolia", rpcUrls: ["https://sepolia.base.org"], blockTimeMs: 200, pollMs: 2_000, logWindow: 200, local: false, hasL1: true };

  test("the block time is the chain's pace; polling is pollMs, else the block time but at least a second", () => {
    expect(chainOf(sepolia).blockTime).toBe(200);
    expect(pollMsOf(sepolia)).toBe(2_000);
    expect(publicClientOf(sepolia).pollingInterval).toBe(2_000);
    const { pollMs: _, ...unset } = sepolia;
    expect(pollMsOf(unset)).toBe(1_000);
    expect(pollMsOf({ blockTimeMs: 2_000 })).toBe(2_000);
    expect(publicClientOf({ ...unset, blockTimeMs: 1_000, id: 31337, local: true }).pollingInterval).toBe(1_000);
  });

  test("a configured logWindow is where the client's log reads start; without one they start at 2 000", () => {
    expect(logWindowOf(publicClientOf(sepolia))).toBe(200);
    const { logWindow: _, ...unset } = sepolia;
    expect(logWindowOf(publicClientOf(unset))).toBe(LOG_WINDOW);
  });
});
