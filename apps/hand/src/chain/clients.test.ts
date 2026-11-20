import { describe, expect, test } from "bun:test";

import { chainOf } from "./clients";

/**
 * The viem chain a wallet is handed (wallet_addEthereumChain): the public test network's explorer
 * goes with it as blockExplorerUrls, and a public test network is marked a testnet (review of the
 * public test deployment: Base Sepolia was added with no explorer and testnet false).
 */
describe("chainOf", () => {
  const base = { id: 84532, name: "Base Sepolia", rpcUrls: ["https://sepolia.base.org"], blockTimeMs: 2000, local: false, hasL1: true };

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
