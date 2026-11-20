import "fake-indexeddb/auto";

import { describe, expect, test } from "bun:test";
import { CORE_ABI } from "@ahand/sdk";
import { encodeAbiParameters, encodeEventTopics, keccak256, stringToBytes, TransactionNotFoundError, TransactionReceiptNotFoundError, type Address, type Hex } from "viem";

import { configureDb, get, put, type HandRecord } from "../store/db";
import { resumeRaise, unfinished, type RaiseContext } from "../screens/raise/flow";
import { raisedProbe } from "../wallet/effects";
import { resume } from "../wallet/send";
import { testChain, type TxIn } from "../wallet/testchain";
import { DroppedError, follow } from "./finality";

/**
 * FINDINGS E-2 (ported from early-review/scratch/verify-drop/drop.test.ts): a raise whose hash
 * never gets a receipt. At 74b7af7 and de1d968 `follow()` looked for that one receipt for ever,
 * never asked the account's nonce or the pool, and /raise stayed on "still on its way" with no
 * form, on every visit. Now the account's nonce and the raise's own `Raised` log decide.
 */

const CORE: Address = "0x65ac707E2AE7392583de5d6192C619F1D8862309";
const RAISER: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const HASH: Hex = "0x161f7a8163430dd3a20d52ea21294bdfa65dceb29b8fabc8b152275646886059";
const ROOT_KEY: Address = "0x00000000000000000000000000000000000000ab";
const DATA_HASH = keccak256(stringToBytes("dropped"));

let run = 0;
function freshDb() {
  configureDb({ name: `finality-${process.pid}-${++run}` });
}

function record(extra: Partial<HandRecord> = {}): HandRecord {
  return {
    intent: `i-${run}`,
    raiser: RAISER.toLowerCase(),
    chainId: 31337,
    core: CORE.toLowerCase(),
    book: `0x${"11".repeat(8)}`,
    n: 0,
    mode: "unlisted",
    title: "dropped",
    status: "sent",
    txHash: HASH,
    from: RAISER,
    nonce: 1,
    fromBlock: 900,
    rootKey: ROOT_KEY,
    dataHash: DATA_HASH,
    ...extra,
  };
}

describe("E-2: a raise whose hash never lands", () => {
  test("the nonce has moved on and no Raised is found: dropped, and /raise is free again", async () => {
    freshDb();
    const stored = record();
    await put("hands", stored);

    const calls: Record<string, number> = {};
    const client = new Proxy(
      {},
      {
        get: (_t, m: string) => async (args: { hash?: Hex }) => {
          calls[m] = (calls[m] ?? 0) + 1;
          if (m === "getTransactionReceipt") throw new TransactionReceiptNotFoundError({ hash: args.hash! });
          if (m === "getTransaction") throw new TransactionNotFoundError({ hash: args.hash! });
          if (m === "getTransactionCount") return 99; // the account's nonce is long past the raise's
          if (m === "getBlockNumber") return 1000n;
          if (m === "getLogs") return [];
          throw new Error("unexpected " + m);
        },
      },
    );
    const stop = new AbortController();
    let ticks = 0;
    const env = {
      client,
      chainId: 31337,
      signal: stop.signal,
      tick: async () => {
        if (++ticks >= 500) stop.abort(new Error("gave up after 500 ticks"));
      },
    };
    const ctx = { client, chainId: 31337, core: CORE, token: CORE, maxExpiryPeriod: 0, site: "http://x", options: {} } as unknown as RaiseContext;

    // 1. /raise opens: the sent record is unfinished.
    expect((await unfinished(ctx))?.intent).toBe(stored.intent);
    // 2. Following it ends by itself: the nonce is asked, the Raised log looked for.
    const out = await resumeRaise(stored, ctx, (intent, options) => resume(env as never, intent, options));
    expect(ticks).toBeLessThan(500);
    expect(calls.getTransactionCount ?? 0).toBeGreaterThan(0);
    expect(calls.getLogs ?? 0).toBeGreaterThan(0);
    expect(out).toEqual({ ok: false, problem: { id: "raise.error.dropped" } });
    // 3. The device knows: the record is dropped, and the next /raise opens on the form.
    expect((await get("hands", stored.intent))?.status).toBe("dropped");
    expect(await unfinished(ctx)).toBeUndefined();
  });

  test("replaced by a speed-up: the page knows only the first hash; the Raised of the replacement lands it", async () => {
    freshDb();
    const chain = testChain({ automine: false });
    const raised = (tx: TxIn) => ({
      logs: [
        {
          address: CORE,
          topics: encodeEventTopics({ abi: CORE_ABI, eventName: "Raised", args: { handId: 7n, raiser: tx.from, token: CORE } }) as Hex[],
          data: encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint40" }, { type: "address" }, { type: "uint16" }, { type: "uint16" }, { type: "bytes32" }],
            [50_000_000n, 1_900_000_000, ROOT_KEY, 250, 7000, DATA_HASH],
          ),
        },
      ],
    });
    chain.effect = raised;
    // Nonce 0 is some earlier transaction; the raise goes at nonce 1.
    chain.broadcast({ from: RAISER, to: CORE, data: "0x" });
    chain.effect = () => ({});
    chain.mine();
    chain.effect = raised;
    const fromBlock = chain.tip();
    const first = chain.broadcast({ from: RAISER, to: CORE, data: "0x01" });
    const second = chain.replace(first);
    chain.mine();

    const probe = raisedProbe(CORE, { rootKey: ROOT_KEY, dataHash: DATA_HASH });
    let ticks = 0;
    const stop = new AbortController();
    const result = await follow(chain.client, first, {
      tick: async () => {
        chain.mine();
        if (++ticks > 30) stop.abort(new Error("followed for ever"));
      },
      signal: stop.signal,
      until: "in-block",
      sent: { from: RAISER, nonce: 1, fromBlock },
      probe,
    });
    expect(result.receipt.transactionHash).toBe(second);
    expect(ticks).toBeLessThan(30);
  });

  test("follow() on a hash nobody knows ends in DroppedError, and always stops on its signal", async () => {
    const chain = testChain({ automine: false });
    const fromBlock = chain.tip();
    const hash = chain.broadcast({ from: RAISER, to: CORE, data: "0x02" });
    chain.drop(hash);
    let ticks = 0;
    const thrown = await follow(chain.client, hash, {
      tick: async () => {
        chain.mine();
        ticks++;
      },
      sent: { from: RAISER, nonce: 0, fromBlock },
      probe: raisedProbe(CORE, { rootKey: ROOT_KEY, dataHash: DATA_HASH }),
    }).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(DroppedError);
    expect(ticks).toBeLessThan(30);

    // Without the account's nonce (an older record), only the signal ends it.
    const stop = new AbortController();
    const stopped = await follow(chain.client, hash, {
      tick: async () => {
        chain.mine();
        if (++ticks > 40) stop.abort(new Error("stopped by the screen"));
      },
      signal: stop.signal,
    }).catch((error: unknown) => error);
    expect((stopped as Error).message).toBe("stopped by the screen");
  });
});
