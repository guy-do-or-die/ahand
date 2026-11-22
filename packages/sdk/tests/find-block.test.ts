import { describe, expect, it } from "vitest";
import { createPublicClient, custom, defineChain, numberToHex, type PublicClient } from "viem";

import { findBlockAt } from "../src/index.js";

/**
 * findBlockAt on a node that keeps only recent history, as Base Sepolia's public RPC does
 * ("pruned history unavailable: requested 30688057, earliest available 47500000", 2026-11-20).
 * A search from genesis asked for block 30 688 057 first and failed; the search from the head
 * must never ask for a block the node no longer keeps, and must take a handful of reads.
 */

const HEAD = 61_376_000n;
const PRUNED_BELOW = 47_500_000n;
const GENESIS_TIME = 1_695_768_288;

/** A chain of `HEAD + 1` blocks, two seconds apart except where `sameSecond` repeats a second. */
function prunedChain(options: { blockTimeMs?: number; sameSecond?: [bigint, bigint] } = {}) {
  const asked: bigint[] = [];
  const timeOf = (n: bigint): number => {
    const [from, to] = options.sameSecond ?? [0n, -1n];
    // Blocks from..to share the second of `from`; the ones after keep their two-second pace.
    const effective = n >= from && n <= to ? from : n;
    return GENESIS_TIME + Number(effective) * 2;
  };
  const block = (n: bigint) => ({
    number: numberToHex(n),
    hash: `0x${n.toString(16).padStart(64, "0")}`,
    parentHash: `0x${(n - 1n).toString(16).padStart(64, "0")}`,
    timestamp: numberToHex(timeOf(n)),
    transactions: [],
    logsBloom: `0x${"0".repeat(512)}`,
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    baseFeePerGas: "0x1",
    difficulty: "0x0",
    extraData: "0x",
    miner: "0x4200000000000000000000000000000000000011",
    nonce: "0x0000000000000000",
    size: "0x1",
    uncles: [],
  });
  const chain = defineChain({
    id: 84532,
    name: "pruned",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["http://pruned.invalid"] } },
    ...(options.blockTimeMs ? { blockTime: options.blockTimeMs } : {}),
  });
  const client = createPublicClient({
    chain,
    transport: custom({
      async request({ method, params }: { method: string; params?: unknown[] }) {
        if (method !== "eth_getBlockByNumber") throw new Error(`unexpected ${method}`);
        const tag = (params as [string])[0];
        const n = tag === "latest" ? HEAD : BigInt(tag);
        asked.push(n);
        if (n < PRUNED_BELOW) throw new Error(`pruned history unavailable: requested ${n}, earliest available ${PRUNED_BELOW}`);
        return block(n);
      },
    }, { retryCount: 0 }),
  }) as PublicClient;
  return { client, asked, timeOf };
}

describe("findBlockAt on a node with pruned history", () => {
  it("finds a recent block from the head on Base's two-second pace, in a few reads", async () => {
    const { client, asked, timeOf } = prunedChain({ blockTimeMs: 2_000 });
    const target = 61_100_123n;
    expect(await findBlockAt(client, timeOf(target))).toBe(target);
    expect(asked.every((n) => n >= PRUNED_BELOW)).toBe(true);
    expect(asked.length).toBeLessThanOrEqual(5);
  });

  it("finds the first of several blocks that share one second, with the pace unknown (a second assumed)", async () => {
    const { client, asked, timeOf } = prunedChain({ sameSecond: [61_200_000n, 61_200_003n] });
    expect(await findBlockAt(client, timeOf(61_200_002n))).toBe(61_200_000n);
    expect(asked.every((n) => n >= PRUNED_BELOW)).toBe(true);
    expect(asked.length).toBeLessThanOrEqual(2 + 2 * 25);
  });

  it("a time between two blocks gives the later one; the head's own second gives the head", async () => {
    const { client, timeOf } = prunedChain({ blockTimeMs: 2_000 });
    expect(await findBlockAt(client, timeOf(61_300_000n) - 1)).toBe(61_300_000n);
    expect(await findBlockAt(client, timeOf(HEAD))).toBe(HEAD);
    await expect(findBlockAt(client, timeOf(HEAD) + 1)).rejects.toThrow(RangeError);
  });
});
