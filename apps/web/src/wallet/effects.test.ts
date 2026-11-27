import { describe, expect, test } from "bun:test";
import { RpcRequestError, type Address, type Hex, type PublicClient } from "viem";

import { PROBE_REREAD, refundedProbe } from "./effects";

/**
 * The send-fate probes on Base Sepolia's public RPC, which refuses `eth_getLogs` over more than
 * 200 blocks (HTTP 413, -32614 "eth_getLogs is limited to a 200 range", 2026-11-21). The probes
 * read in windows of 2 000 and failed for any send more than 200 blocks (40 s) old, so a speed-up,
 * a cancel or a lost wallet answer was never settled. Now their windows shrink until the node
 * takes them.
 */

const CORE: Address = "0x0f0555972388151D2C187f636A0855b6eE9B9685";
const FROM: Address = "0x830bc5551e429DDbc4E9Ac78436f8Bf13Eca8434";
const REFUND: Hex = `0x${"ab".repeat(32)}`;
const SENT_AT = 61_440_000n;
const TIP = SENT_AT + 1_000n;
const LANDED = SENT_AT + 700n;

/** A node like Base Sepolia's public one, as viem's client hands its answers on. */
function baseLike(refuse: (span: bigint, from: bigint) => Error | undefined, landed: bigint | null = LANDED) {
  const windows: [bigint, bigint][] = [];
  const client = new Proxy(
    {},
    {
      get: (_t, method: string) => async (args: { fromBlock: bigint; toBlock: bigint }) => {
        if (method === "getBlockNumber") return TIP;
        if (method !== "getLogs") throw new Error(`unexpected ${method}`);
        windows.push([args.fromBlock, args.toBlock]);
        const refusal = refuse(args.toBlock - args.fromBlock + 1n, args.fromBlock);
        if (refusal) throw refusal;
        return landed !== null && args.fromBlock <= landed && landed <= args.toBlock ? [{ transactionHash: REFUND, args: { handId: 2n } }] : [];
      },
    },
  ) as unknown as PublicClient;
  return { client, windows };
}

const limited = () => new RpcRequestError({ body: { method: "eth_getLogs" }, error: { code: -32614, message: "eth_getLogs is limited to a 200 range" }, url: "https://sepolia.base.org" });

describe("send-fate probes on a node that limits log ranges", () => {
  test("a refund 700 blocks after the send is found: the 2 000-block window shrinks to the node's 200", async () => {
    const { client, windows } = baseLike((span) => (span > 200n ? limited() : undefined));
    expect(await refundedProbe(CORE, 2n)(client, { fromBlock: SENT_AT, from: FROM })).toBe(REFUND);
    expect(windows[0]).toEqual([SENT_AT, TIP]);
    const taken = windows.slice(1);
    for (const [from, to] of taken) expect(to - from + 1n).toBeLessThanOrEqual(200n);
    expect(taken[0]![0]).toBe(SENT_AT);
    // It stops at the window that holds the refund: the blocks after it are not read.
    expect(taken.at(-1)![0]).toBeLessThanOrEqual(LANDED);
    expect(taken.at(-1)![1]).toBeGreaterThanOrEqual(LANDED);
    expect(taken.at(-1)![1]).toBeLessThan(TIP);

    // The client keeps the size it learnt: the next probe is never refused.
    windows.length = 0;
    await refundedProbe(CORE, 2n)(client, { fromBlock: SENT_AT, from: FROM });
    expect(windows.every(([from, to]) => to - from + 1n <= 200n)).toBe(true);
  });

  test("any other failure of the node is the probe's failure, unchanged", async () => {
    const broken = new RpcRequestError({ body: { method: "eth_getLogs" }, error: { code: -32000, message: "header not found" }, url: "https://sepolia.base.org" });
    const { client, windows } = baseLike(() => broken);
    expect(await refundedProbe(CORE, 2n)(client, { fromBlock: SENT_AT, from: FROM }).catch((e: unknown) => e)).toBe(broken);
    expect(windows).toHaveLength(1);
  });

  test("a probe asked again goes on from where it stopped, less the blocks that could still be replaced", async () => {
    const busy = new RpcRequestError({ body: { method: "eth_getLogs" }, error: { code: -32016, message: "over rate limit" }, url: "https://sepolia.base.org" });
    let failAt: bigint | undefined = SENT_AT + 600n;
    const { client, windows } = baseLike((span, from) => (span > 200n ? limited() : from === failAt ? busy : undefined), null);
    const probe = refundedProbe(CORE, 2n);
    // The node fails partway (a rate limit on the fourth window): the probe fails, as before.
    expect(await probe(client, { fromBlock: SENT_AT, from: FROM }).catch((e: unknown) => e)).toBe(busy);
    failAt = undefined;
    windows.length = 0;
    expect(await probe(client, { fromBlock: SENT_AT, from: FROM })).toBeUndefined();
    // The second read starts where the first stopped, less PROBE_REREAD, and reads to the tip.
    expect(windows[0]![0]).toBe(SENT_AT + 600n - PROBE_REREAD);
    expect(windows.at(-1)![1]).toBe(TIP);
    // A third, with nothing new on the chain, reads only the last blocks again.
    windows.length = 0;
    await probe(client, { fromBlock: SENT_AT, from: FROM });
    expect(windows).toEqual([[TIP - PROBE_REREAD + 1n, TIP]]);
    // Another send (another block) starts from its own block.
    windows.length = 0;
    await probe(client, { fromBlock: SENT_AT + 900n, from: FROM });
    expect(windows[0]![0]).toBe(SENT_AT + 900n);
  });
});
