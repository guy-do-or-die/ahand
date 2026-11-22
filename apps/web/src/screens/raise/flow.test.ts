import "fake-indexeddb/auto";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { openAddress, readDescription } from "@ahand/sdk";
import { createWalletClient, custom, erc20Abi, http, numberToHex, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { ANVIL_KEYS, startChain, type Chain } from "../../../../../packages/sdk/tests/helpers/anvil";
import { all, bookOf, closeDb, configureDb, lockedIntents, openSeed } from "../../store/db";
import { resume, sendCalls, type SendEnv, type SignedInWallet } from "../../wallet/send";
import { raise, resumeRaise, unfinished, type Draft, type Ports, type RaiseContext, type RaiseRecord } from "./flow";

/**
 * The raise flow with a wallet that takes [approve, raise] as one EIP-5792 batch, on a real anvil,
 * through the real sending engine (wallet/send.ts) and the device store on fake-indexeddb.
 * The wallet is a test double: it signs with an anvil key, lands a batch's calls in one block, and
 * answers `wallet_getCallsStatus` as told (pending, landed, failed). Review round 1's finding:
 * a batch whose follow stopped before its hash was known lost its record and its locked seed.
 *
 * The chain's port comes from RAISE_TEST_PORT; left out, the system picks a free one.
 */

const USD = 1_000_000n;
const DAY = 86_400;
const PORT = process.env.RAISE_TEST_PORT ? Number(process.env.RAISE_TEST_PORT) : undefined;

let chain: Chain;
let client: PublicClient;
let usd: Address;
let ctx: RaiseContext;
let run = 0;

const rpc = (method: string, params: unknown[] = []) =>
  (client.request as (args: { method: string; params: unknown[] }) => Promise<unknown>)({ method, params });
const mine = () => rpc("evm_mine").then(() => undefined);

type Report = "pending" | "landed" | "failed";

interface Double {
  wallet: SignedInWallet;
  address: Address;
  /** The key's own signature of typed data: the keys confirmation of an account that repeats. */
  signTyped: (typed: Parameters<ReturnType<typeof privateKeyToAccount>["signTypedData"]>[0]) => Promise<Hex>;
  /** What `wallet_getCallsStatus` answers from now on. */
  report(as: Report): void;
  batches: () => number;
  statusAsks: () => number;
}

/** A batching wallet for `key`. `refuse` makes it answer the batch with the person's "no" (4001). */
function batchingWallet(key: Hex, opts: { refuse?: boolean } = {}): Double {
  const account = privateKeyToAccount(key);
  const signer = createWalletClient({ account, chain: foundry, transport: http(chain.rpc) });
  const sent = new Map<string, Hex[]>();
  let reporting: Report = "pending";
  let statusAsks = 0;
  const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    const list = (params ?? []) as unknown[];
    switch (method) {
      case "eth_chainId":
        return numberToHex(foundry.id);
      case "eth_accounts":
      case "eth_requestAccounts":
        return [account.address];
      case "wallet_getCapabilities":
        return { [numberToHex(foundry.id)]: { atomic: { status: "supported" } } };
      case "wallet_sendCalls": {
        if (opts.refuse) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
        const [{ calls }] = list as [{ calls: { to: Address; data: Hex }[] }];
        await rpc("evm_setAutomine", [false]);
        const hashes: Hex[] = [];
        try {
          for (const call of calls) hashes.push(await signer.sendTransaction({ to: call.to, data: call.data, gas: 3_000_000n }));
          await mine();
        } finally {
          await rpc("evm_setAutomine", [true]);
        }
        const id = `0x${(sent.size + 1).toString(16).padStart(64, "0")}`;
        sent.set(id, hashes);
        return { id };
      }
      case "wallet_getCallsStatus": {
        statusAsks++;
        const base = { version: "2.0.0", id: list[0], chainId: numberToHex(foundry.id), atomic: true };
        if (reporting === "pending") return { ...base, status: 100 };
        if (reporting === "failed") return { ...base, status: 400 };
        const hashes = sent.get(list[0] as string);
        if (!hashes) throw new Error("this wallet holds no such batch");
        const receipts = await Promise.all(hashes.map((hash) => client.getTransactionReceipt({ hash })));
        return {
          ...base,
          status: 200,
          receipts: receipts.map((r) => ({
            logs: [],
            status: "0x1",
            blockHash: r.blockHash,
            blockNumber: numberToHex(r.blockNumber),
            gasUsed: numberToHex(r.gasUsed),
            transactionHash: r.transactionHash,
          })),
        };
      }
      default:
        return rpc(method, list);
    }
  };
  return {
    wallet: createWalletClient({ account: account.address, chain: foundry, transport: custom({ request }) }) as SignedInWallet,
    address: account.address,
    signTyped: (typed) => account.signTypedData(typed),
    report: (as) => {
      reporting = as;
    },
    batches: () => sent.size,
    statusAsks: () => statusAsks,
  };
}

const env = (signal?: AbortSignal, tick: () => Promise<void> = mine): SendEnv => ({ client, chainId: foundry.id, tick, ...(signal ? { signal } : {}) });

/** The ports of a raise by `double`; `repeats` false is an account whose confirmations differ (its seed is locked). */
function portsOf(double: Double, opts: { repeats: boolean; signal?: AbortSignal; tick?: () => Promise<void> }): Ports & { sent: RaiseRecord[] } {
  let n = 0;
  const sent: RaiseRecord[] = [];
  return {
    raiser: double.address,
    account: async () => double.address,
    confirmKeys: async () => true,
    // An account that repeats signs with its key (keys are made only from a key's signature that
    // recovers to the raiser); one that differs answers differently each time.
    signKeys: async (typed) =>
      opts.repeats
        ? { ok: true, signature: await double.signTyped(typed), kind: "key", wrapped: false }
        : { ok: true, signature: `0x${(++n + 16 * ++run).toString(16).padStart(2, "0").repeat(65)}` as Hex, kind: "code", wrapped: false },
    send: (calls, options) => sendCalls(env(opts.signal, opts.tick), double.wallet, calls, options),
    onStep: () => undefined,
    onSent: (record) => void sent.push(record),
    sent,
  };
}

const draft = (title: string, reward = 5n * USD): Draft => ({ title, content: "Sent as one batch.", reward, days: 7, mode: "unlisted", minClaimBps: 7000, payoutGasK: 250 });

const balance = (who: Address) => client.readContract({ address: usd, abi: erc20Abi, functionName: "balanceOf", args: [who] });
const handsCount = () =>
  client.readContract({ address: chain.core, abi: [{ type: "function", name: "handsCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }], functionName: "handsCount" });

beforeAll(async () => {
  chain = await startChain({ ...(PORT ? { port: PORT } : {}), slotsInAnEpoch: 1 });
  client = chain.client;
  usd = chain.tokens.find((token) => token.kind === "usd")!.address;
  ctx = { client, chainId: foundry.id, core: chain.core, token: usd, maxExpiryPeriod: 180 * DAY, site: "http://127.0.0.1:24501", options: { canonicalCore: chain.core } };
}, 60_000);

afterAll(async () => {
  await chain?.stop();
});

beforeEach(async () => {
  // A fresh device for every case.
  configureDb({ name: `ahand-raise-flow-${run++}` });
  await rpc("evm_setAutomine", [true]);
});

/** A raise whose follow is stopped (the screen is left) while the wallet still calls the batch pending. */
async function stoppedBatch(key: Hex, repeats: boolean, title: string) {
  const double = batchingWallet(key);
  const left = new AbortController();
  // The first look finds the batch pending; then the screen is left.
  const tick = async () => {
    left.abort(new Error("the screen was left"));
  };
  const before = await balance(double.address);
  const count = await handsCount();
  const ports = portsOf(double, { repeats, signal: left.signal, tick });
  const outcome = await raise(draft(title), ctx, ports);
  return { double, ports, outcome, moved: before - (await balance(double.address)), count };
}

describe("a raise sent as one wallet batch, its follow stopped before the batch's hash is known", () => {
  test("the money is in the contract, and the device keeps the record and the locked seed", async () => {
    const { double, ports, outcome, moved, count } = await stoppedBatch(ANVIL_KEYS[1]!, false, "A batch, stopped");
    expect(double.batches()).toBe(1);
    expect(moved).toBe(5n * USD);
    expect(await handsCount()).toBe(count + 1n);

    expect(outcome).toMatchObject({ ok: false, problem: { id: "raise.error.lostSight", pending: true } });
    const kept = (await all("hands")) as RaiseRecord[];
    expect(kept.length).toBe(1);
    expect(kept[0]).toMatchObject({ status: "sent", batchId: `0x${"1".padStart(64, "0")}`, raiser: double.address.toLowerCase(), title: "A batch, stopped" });
    expect(kept[0]!.txHash).toBeUndefined();
    expect(ports.sent.length).toBe(1);
    // The locked copy of the seed is still there and still opens.
    expect(await lockedIntents()).toEqual([kept[0]!.intent]);
    expect(await openSeed(kept[0]!.intent)).toMatch(/^0x[0-9a-f]{32}$/);
  });

  test("after a reload it is found, resumed by its batch id through the wallet, and its link comes back from the locked copy", async () => {
    const { double, count } = await stoppedBatch(ANVIL_KEYS[2]!, false, "A batch, resumed");
    closeDb(); // the reload: the same device, a new tab

    const record = await unfinished(ctx);
    expect(record).toMatchObject({ status: "sent", title: "A batch, resumed" });
    if (!record) throw new Error("unreachable");

    // No account connected yet (nothing is kept of a wallet across a reload): the screen asks for it.
    const asks = double.statusAsks();
    expect(await resumeRaise(record, ctx, () => Promise.reject(new Error("must not look without the account")), undefined)).toEqual({
      ok: false,
      problem: { id: "raise.error.connectToLook", pending: true, connect: true },
    });
    // Another account cannot know this batch.
    expect(await resumeRaise(record, ctx, () => Promise.reject(new Error("must not look with another account")), privateKeyToAccount(ANVIL_KEYS[3]!).address)).toEqual({
      ok: false,
      problem: { id: "raise.error.otherAccount", pending: true, connect: true, code: double.address },
    });
    expect(double.statusAsks()).toBe(asks);

    // The right account: the wallet now knows the batch's hash.
    double.report("landed");
    const outcome = await resumeRaise(record, ctx, (intent, options) => resume(env(), intent, { ...options, wallet: double.wallet }), double.address);
    if (!outcome.ok) throw new Error(`not resumed: ${outcome.problem.id}`);
    expect(outcome.up.locked).toBe(true);
    expect(outcome.up.raised.reward).toBe(5n * USD);
    expect(outcome.up.raised.hand.raiser).toBe(double.address);
    expect(await handsCount()).toBe(count + 1n); // nothing was sent again
    expect(double.batches()).toBe(1);

    const written = outcome.up.written!;
    const opened = await openAddress(written.address, async () => outcome.up.raised.hand, ctx.options);
    expect(opened.hand.handId).toBe(outcome.up.raised.hand.handId);
    expect(readDescription(opened)).toMatchObject({ status: "attached", title: "A batch, resumed", content: "Sent as one batch." });

    const [kept] = (await all("hands")) as RaiseRecord[];
    expect(kept).toMatchObject({ status: "up", handId: outcome.up.raised.hand.handId.toString() });
    expect(kept!.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    // Up and not yet saved: still found after another reload, with the same link.
    closeDb();
    const again = await unfinished(ctx);
    expect(again?.intent).toBe(kept!.intent);
    const reopened = await resumeRaise(again!, ctx, () => Promise.reject(new Error("an up hand needs no look")), undefined);
    expect(reopened.ok && reopened.up.written?.address).toBe(written.address);
  });

  test("an account that repeats: the record is kept and resumed the same way (its link is rebuilt later, not here)", async () => {
    const { double, outcome } = await stoppedBatch(ANVIL_KEYS[4]!, true, "A batch by a key");
    expect(outcome).toMatchObject({ ok: false, problem: { id: "raise.error.lostSight", pending: true } });
    expect(await lockedIntents()).toEqual([]);
    const record = await unfinished(ctx);
    expect(record).toMatchObject({ status: "sent", title: "A batch by a key" });
    double.report("landed");
    const resumed = await resumeRaise(record!, ctx, (intent, options) => resume(env(), intent, { ...options, wallet: double.wallet }), double.address);
    if (!resumed.ok) throw new Error(`not resumed: ${resumed.problem.id}`);
    expect(resumed.up.locked).toBe(false);
    expect(resumed.up.written).toBeUndefined();
    expect(resumed.up.raised.hand.raiser).toBe(double.address);
  });

  test("a wallet that reports the batch failed: nothing is deleted on its word, the record waits", async () => {
    const double = batchingWallet(ANVIL_KEYS[5]!);
    double.report("failed");
    const outcome = await raise(draft("A batch the wallet calls failed"), ctx, portsOf(double, { repeats: false }));
    expect(outcome).toMatchObject({ ok: false, problem: { id: "raise.error.lostSight", pending: true } });
    const kept = (await all("hands")) as RaiseRecord[];
    expect(kept.map((record) => record.status)).toEqual(["sent"]);
    expect(await lockedIntents()).toEqual([kept[0]!.intent]);
  });
});

describe("a batch that never reached the wallet's hands", () => {
  test("the person says no to the batch: nothing moved, and nothing is kept but the spent number", async () => {
    const double = batchingWallet(ANVIL_KEYS[1]!, { refuse: true });
    const before = await balance(double.address);
    const count = await handsCount();
    const ports = portsOf(double, { repeats: false });
    const outcome = await raise(draft("A batch, refused"), ctx, ports);
    expect(outcome).toEqual({ ok: false, problem: { id: "common.error.refused" } });
    expect(await balance(double.address)).toBe(before);
    expect(await handsCount()).toBe(count);
    expect(await all("hands")).toEqual([]);
    expect(await lockedIntents()).toEqual([]);
    expect(ports.sent).toEqual([]);
    expect(await unfinished(ctx)).toBeUndefined();
  });

  test("a batch that lands while this tab watches: up, with its link, the batch id and the hash kept", async () => {
    const double = batchingWallet(ANVIL_KEYS[2]!);
    double.report("landed");
    const count = await handsCount();
    const outcome = await raise(draft("A batch, landed", 20n * USD), ctx, portsOf(double, { repeats: false }));
    if (!outcome.ok) throw new Error(`not raised: ${outcome.problem.id}`);
    expect(await handsCount()).toBe(count + 1n);
    expect(outcome.up.raised.reward).toBe(20n * USD);
    expect(outcome.up.written?.description).toMatchObject({ status: "attached", title: "A batch, landed" });
    const [kept] = (await all("hands")) as RaiseRecord[];
    expect(kept).toMatchObject({ status: "up", batchId: `0x${"1".padStart(64, "0")}` });
    expect(kept!.txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("words that do not fit", () => {
  test("are refused before the account is asked anything, and no hand number is spent", async () => {
    const double = batchingWallet(ANVIL_KEYS[1]!);
    const ports: Ports = {
      ...portsOf(double, { repeats: true }),
      confirmKeys: () => Promise.reject(new Error("the keys card must not open")),
      send: () => Promise.reject(new Error("nothing may be sent")),
    };
    expect(await raise(draft("т".repeat(161)), ctx, ports)).toEqual({
      ok: false,
      problem: { id: "raise.what.tooLong", values: { n: "161", max: "160" }, nothingSent: true },
    });
    expect(await raise({ ...draft("A title"), content: "д".repeat(1001) }, ctx, ports)).toEqual({
      ok: false,
      problem: { id: "raise.details.tooLong", values: { n: "1001", max: "1000" }, nothingSent: true },
    });
    // A public hand whose words would stand before # in an address no server takes.
    const far = { ...ctx, site: `https://${"a".repeat(2000)}.example` };
    expect(await raise({ ...draft("🙌".repeat(160)), content: "🙏".repeat(1000), mode: "public" }, far, ports)).toEqual({
      ok: false,
      problem: { id: "raise.who.tooLong", nothingSent: true },
    });
    expect(await all("hands")).toEqual([]);
    expect(await bookOf(double.address)).toBeUndefined();
    expect(double.batches()).toBe(0);
  });
});
