import "fake-indexeddb/auto";

import { describe, expect, test } from "bun:test";
import type { Address, Hex } from "viem";

import { all, configureDb, lockedIntents } from "../../store/db";
import type { Intent, SendResult } from "../../wallet";
import { raise, unfinished, type Draft, type Ports, type RaiseContext } from "./flow";

/**
 * The raise flow's answers when the send does not simply land (FINDINGS E-1, W-3, W-5, E-7), with
 * a stub chain for the reads and a stub sender. What is under test is what the device keeps and
 * which sentence the screen gets, never "Nothing was sent" when that is not known. (The fix round
 * wrote this as flow.test.ts; the build's own flow.test.ts, a batching wallet on anvil, kept that name.)
 */

const CORE: Address = "0x65ac707E2AE7392583de5d6192C619F1D8862309";
const TOKEN: Address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const RAISER: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OTHER: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const SIG = `0x${"11".repeat(32)}${"22".repeat(32)}1b` as Hex;

const client = new Proxy(
  {},
  {
    get: (_t, method: string) => async (args: { functionName?: string }) => {
      if (method === "readContract") return args.functionName === "allowance" ? 0n : 1_000_000_000n;
      if (method === "getBalance") return 10n ** 18n;
      if (method === "getBlock") return { number: 100n, timestamp: 1_800_000_000n };
      throw new Error(`unexpected ${method}`);
    },
  },
);

const ctx = { client, chainId: 31337, core: CORE, token: TOKEN, maxExpiryPeriod: 180 * 86_400, site: "http://127.0.0.1", options: {} } as unknown as RaiseContext;
const draft = (extra: Partial<Draft> = {}): Draft => ({ title: "A ladder for Sunday", content: "", reward: 20_000_000n, days: 30, mode: "unlisted", minClaimBps: 7000, payoutGasK: 250, ...extra });

let run = 0;
function ports(send: Ports["send"], extra: Partial<Ports> = {}): Ports {
  configureDb({ name: `raise-flow-${process.pid}-${++run}` });
  return {
    raiser: RAISER,
    account: async () => RAISER,
    confirmKeys: async () => true,
    // A signer whose two answers differ: the seed is made fresh and locked on the device.
    signKeys: (() => {
      let n = 0;
      return async () => ({ ok: true as const, signature: (n++ % 2 ? SIG.replace("11", "33") : SIG) as Hex, kind: "key" as const, wrapped: false });
    })(),
    send,
    onStep: () => undefined,
    onSent: () => undefined,
    ...extra,
  };
}

const asked = (of: number, step: number): Intent => ({ kind: "tx", chainId: 31337, step, of, from: RAISER, nonce: 7 + step, fromBlock: 100, action: step === of - 1 ? "raise" : "approve" });

describe("E-1: the raise's answer is lost", () => {
  test("the record is kept with its nonce, the problem is 'unknown' and pending, the locked copy stays", async () => {
    const p = ports(async (_calls, options) => {
      await options.onIntent(asked(2, 0));
      await options.onIntent({ ...asked(2, 0), hash: `0x${"aa".repeat(32)}` });
      await options.between(1, 2);
      await options.onIntent(asked(2, 1));
      return { ok: false, reason: "unknown", step: 1, sent: [`0x${"aa".repeat(32)}`], intent: asked(2, 1), message: "HTTP request failed." } as SendResult;
    });
    const out = await raise(draft(), ctx, p);
    expect(out).toMatchObject({ ok: false, problem: { id: "raise.error.unknown", pending: true } });
    const [record] = await all("hands");
    expect(record).toMatchObject({ status: "asked", nonce: 8, from: RAISER, fromBlock: 100 });
    expect(record!.rootKey).toBeDefined();
    expect(record!.dataHash).toBeDefined();
    expect(await lockedIntents()).toEqual([record!.intent]);
    expect((await unfinished(ctx))?.intent).toBe(record!.intent);
  });
});

describe("W-3: the permission step landed and the raise did not", () => {
  test("says so, never 'Nothing was sent'", async () => {
    const p = ports(async (_calls, options) => {
      await options.onIntent({ ...asked(2, 0), hash: `0x${"bb".repeat(32)}` });
      return { ok: false, reason: "rejected", step: 1, sent: [`0x${"bb".repeat(32)}`] } as SendResult;
    });
    const out = await raise(draft(), ctx, p);
    expect(out).toMatchObject({ ok: false, problem: { id: "raise.error.allowSent", code: "REJECTED" } });
    expect(await all("hands")).toEqual([]);
  });
});

describe("W-5: the account changes in the middle", () => {
  test("before the first send: stopped, both accounts named, nothing sent", async () => {
    let sends = 0;
    const p = ports(
      async () => {
        sends++;
        throw new Error("must not send");
      },
      { account: async () => OTHER },
    );
    const out = await raise(draft(), ctx, p);
    expect(sends).toBe(0);
    expect(out).toMatchObject({ ok: false, problem: { id: "raise.error.accountChanged", values: { was: "0x7099…79C8", now: "0x90F7…b906" } } });
  });

  test("after the permission step: stopped before the raise, and it says the permission went from the first", async () => {
    let now: Address = RAISER;
    const p = ports(
      async (_calls, options) => {
        await options.onIntent({ ...asked(2, 0), hash: `0x${"cc".repeat(32)}` });
        now = OTHER;
        const go = await options.between(1, 2);
        return (go ? { ok: true } : { ok: false, reason: "stopped", step: 1, sent: [`0x${"cc".repeat(32)}`] }) as SendResult;
      },
      { account: async () => now },
    );
    const out = await raise(draft(), ctx, p);
    expect(out).toMatchObject({ ok: false, problem: { id: "raise.error.accountChangedAllow" } });
  });
});

describe("E-7: a public Hand whose address would be too long", () => {
  test("is refused before anything is kept or sent", async () => {
    let sends = 0;
    const p = ports(async () => {
      sends++;
      throw new Error("must not send");
    });
    const out = await raise(draft({ mode: "public", content: "x".repeat(12_000) }), ctx, p);
    // Merged with the build's caps (link.ts weigh): the details' own cap refuses it first, before the
    // SDK's limit of d is reached, and says nothing was sent.
    expect(out).toMatchObject({ ok: false, problem: { id: "raise.details.tooLong", nothingSent: true } });
    expect(sends).toBe(0);
    expect(await all("hands")).toEqual([]);
  });
});
