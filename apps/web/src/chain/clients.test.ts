import { describe, expect, test } from "bun:test";

import { logWindowOf, LOG_WINDOW } from "@ahand/sdk";

import { baseSepolia, mainnet } from "viem/chains";

import { chainConfigOf } from "../config/chains";
import { pollMsOf } from "../config/schema";
import { chainOf, publicClientOf } from "./clients";

/**
 * The viem chain a wallet is handed (wallet_addEthereumChain) is viem's own description of the
 * configured id: its explorer goes with it as blockExplorerUrls, a test network is marked a testnet,
 * and only the RPC URLs are the configuration's.
 */
describe("chainOf", () => {
  test("Base Sepolia is viem's, with the configuration's RPC and Base's real pace", () => {
    const chain = chainOf({ id: 84532, rpcUrls: ["https://rpc.example"] });
    expect(chain.name).toBe(baseSepolia.name);
    expect(chain.blockExplorers?.default.url).toBe("https://sepolia.basescan.org");
    expect(chain.testnet).toBe(true);
    expect(chain.sourceId).toBe(11_155_111);
    expect(chain.contracts?.multicall3?.address).toBe(baseSepolia.contracts.multicall3.address);
    expect(chain.formatters).toBe(baseSepolia.formatters);
    expect(chain.rpcUrls).toEqual({ default: { http: ["https://rpc.example"] } });
    expect(chain.blockTime).toBe(200);
  });

  test("Ethereum, Sepolia and Base are viem's too; the stand's anvil is a test network with no explorer", () => {
    expect(chainOf({ id: 1, rpcUrls: ["https://rpc.example"] }).name).toBe(mainnet.name);
    expect(chainOf({ id: 11_155_111, rpcUrls: ["https://rpc.example"] }).testnet).toBe(true);
    expect(chainOf({ id: 8453, rpcUrls: ["https://rpc.example"] }).testnet).toBeUndefined();
    const local = chainOf({ id: 31337, rpcUrls: ["http://127.0.0.1:8545"] });
    expect(local.testnet).toBe(true);
    expect(local.blockExplorers).toBeUndefined();
    expect(local.rpcUrls).toEqual({ default: { http: ["http://127.0.0.1:8545"] } });
  });

  test("an id aHand does not know is refused", () => {
    expect(() => chainOf({ id: 10, rpcUrls: ["https://rpc.example"] })).toThrow(/chain 10 is not one aHand knows/);
  });
});

/**
 * Base makes a block every 200 ms (blocks 61 429 229 and 61 441 608, 2 476 s apart, on 2026-11-21),
 * and its public RPC takes `eth_getLogs` over at most 200 blocks. The chain's pace goes to viem's
 * `blockTime` (the SDK's findBlockAt guesses with it); how often the app asks is `pollMs`; the log
 * window the client starts at is `logWindow`.
 */
describe("pace, polling and the log window", () => {
  const sepolia = chainConfigOf({ id: 84532, rpcUrls: ["https://sepolia.base.org"], pollMs: 2_000, logWindow: 200, local: false });

  test("the block time is the chain's pace; polling is pollMs, else the block time but at least a second", () => {
    expect(chainOf(sepolia).blockTime).toBe(200);
    expect(pollMsOf(sepolia)).toBe(2_000);
    expect(publicClientOf(sepolia).pollingInterval).toBe(2_000);
    const { pollMs: _, ...unset } = sepolia;
    expect(pollMsOf(unset)).toBe(1_000);
    expect(pollMsOf({ blockTimeMs: 2_000 })).toBe(2_000);
    expect(publicClientOf(chainConfigOf({ id: 31337, rpcUrls: ["http://127.0.0.1:8545"], local: true })).pollingInterval).toBe(1_000);
  });

  test("a configured logWindow is where the client's log reads start; without one they start at 2 000", () => {
    expect(logWindowOf(publicClientOf(sepolia))).toBe(200);
    const { logWindow: _, ...unset } = sepolia;
    expect(logWindowOf(publicClientOf(unset))).toBe(LOG_WINDOW);
  });
});
