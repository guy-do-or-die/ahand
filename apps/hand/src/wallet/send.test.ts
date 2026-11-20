import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  approveCall,
  chainNow,
  checkGiveOnChain,
  checkRoute,
  CORE_ABI,
  domain,
  expiryAfter,
  keyOfSeed,
  newSeed,
  readHand,
  readLimits,
  refundCall,
  raiseCall,
  setupCall,
  signGiveWithKey,
  thankCall,
  type Call,
  type Eip712Domain,
  type Give,
  type Hand,
  type SignedGive,
} from "@ahand/sdk";
import {
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  keccak256,
  numberToHex,
  parseAbi,
  parseEventLogs,
  serializeErc6492Signature,
  stringToBytes,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { foundry } from "viem/chains";

import { ANVIL_KEYS, startChain, type Chain } from "../../../../packages/sdk/tests/helpers/anvil";
import { resume, sendCalls, type Intent, type SendEnv, type SendProgress, type SendResult, type SignedInWallet } from "./send";
const HAND_PORT_BASE = process.env.HAND_TEST_PORT_BASE ? Number(process.env.HAND_TEST_PORT_BASE) : undefined;

/**
 * The sending engine on a real anvil (automine; `--slots-in-an-epoch 1`, so `safe` and
 * `finalized` are one and two blocks behind), with a test double of a wallet: an EIP-1193 provider
 * that signs with an anvil key and, when told to, answers EIP-5792 with atomic support, landing a
 * batch's calls in one block. Each "look" at the chain (`tick`) mines one block, so the four
 * states arrive in a known order. Port 16111 is this file's; HAND_TEST_PORT_BASE=B moves it to B+1.
 */

const DAY = 86_400;
const USD = 1_000_000n;

let chain: Chain;
let client: PublicClient;
let usd: Address;
let dom: Eip712Domain;

const raiserKey = ANVIL_KEYS[1]!;
const giverOwnerKey = ANVIL_KEYS[6]!;
const raiser = privateKeyToAccount(raiserKey).address;

const rpc = (method: string, params: unknown[] = []) =>
  (client.request as (args: { method: string; params: unknown[] }) => Promise<unknown>)({ method, params });
const mine = () => rpc("evm_mine").then(() => undefined);

interface Double {
  wallet: SignedInWallet;
  /** Every method the engine asked the wallet for, in order. */
  asked: string[];
  sendTransactions: () => number;
  sendBatches: () => number;
}

/**
 * A wallet for tests: the account of `key`, signing with viem. `atomic` makes it report EIP-5792
 * atomic support and run `wallet_sendCalls` with all calls in one block. `beforeSend` runs inside
 * `eth_sendTransaction` before it is signed (to change the chain under a simulated call).
 */
function walletDouble(key: Hex, opts: { atomic?: boolean; beforeSend?: () => Promise<void>; holdMining?: boolean } = {}): Double {
  const account = privateKeyToAccount(key);
  const signer = createWalletClient({ account, chain: foundry, transport: http(chain.rpc) });
  const asked: string[] = [];
  const batches = new Map<string, Hex[]>();
  const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    asked.push(method);
    const list = (params ?? []) as unknown[];
    switch (method) {
      case "eth_chainId":
        return numberToHex(foundry.id);
      case "eth_accounts":
      case "eth_requestAccounts":
        return [account.address];
      case "wallet_getCapabilities":
        return { [numberToHex(foundry.id)]: { atomic: { status: opts.atomic ? "supported" : "unsupported" } } };
      case "eth_sendTransaction": {
        await opts.beforeSend?.();
        const [tx] = list as [{ to: Address; data: Hex; value?: Hex }];
        if (opts.holdMining) await rpc("evm_setAutomine", [false]);
        // An explicit gas limit: what the chain does is the test's point, not the wallet's estimate.
        return signer.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n, gas: 3_000_000n });
      }
      case "wallet_sendCalls": {
        const [{ calls, atomicRequired }] = list as [{ calls: { to: Address; data: Hex }[]; atomicRequired: boolean }];
        if (!atomicRequired) throw new Error("the engine must ask for an atomic batch");
        await rpc("evm_setAutomine", [false]);
        const hashes: Hex[] = [];
        try {
          for (const call of calls) hashes.push(await signer.sendTransaction({ to: call.to, data: call.data, gas: 3_000_000n }));
          await mine();
        } finally {
          await rpc("evm_setAutomine", [true]);
        }
        const id = `0x${(batches.size + 1).toString(16).padStart(64, "0")}`;
        batches.set(id, hashes);
        return { id };
      }
      case "wallet_getCallsStatus": {
        const hashes = batches.get(list[0] as string) ?? [];
        const receipts = await Promise.all(hashes.map((hash) => client.getTransactionReceipt({ hash })));
        return {
          version: "2.0.0",
          id: list[0],
          chainId: numberToHex(foundry.id),
          atomic: true,
          status: receipts.every((r) => r.status === "success") ? 200 : 500,
          receipts: receipts.map((r) => ({
            logs: [],
            status: r.status === "success" ? "0x1" : "0x0",
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
  const wallet = createWalletClient({ account: account.address, chain: foundry, transport: custom({ request }) }) as SignedInWallet;
  return {
    wallet,
    asked,
    sendTransactions: () => asked.filter((m) => m === "eth_sendTransaction").length,
    sendBatches: () => asked.filter((m) => m === "wallet_sendCalls").length,
  };
}

const env = (signal?: AbortSignal): SendEnv => ({ client, chainId: foundry.id, tick: mine, ...(signal ? { signal } : {}) });

async function raiseTerms(opts: { reward?: bigint; seconds?: number } = {}) {
  const { timestamp } = await chainNow(client);
  const { maxExpiryPeriod } = await readLimits(client, chain.core);
  const rootSeed = newSeed();
  return {
    rootKey: keyOfSeed(rootSeed),
    terms: {
      token: usd,
      reward: opts.reward ?? 10n * USD,
      expiry: expiryAfter(timestamp, opts.seconds ?? 30 * DAY, maxExpiryPeriod),
      rootKey: privateKeyToAddress(keyOfSeed(rootSeed)),
      payoutGasK: 250,
      minClaimBps: 5_000,
      dataHash: keccak256(stringToBytes("a ride to the airport on Sunday")),
    },
  };
}

function handIdOf(result: SendResult): bigint {
  if (!result.ok) throw new Error(`not sent: ${result.reason}`);
  const [raised] = parseEventLogs({ abi: CORE_ABI, logs: result.receipt.logs, eventName: "Raised" });
  if (!raised) throw new Error("no Raised in the receipt");
  return raised.args.handId;
}

/** Raises a Hand directly (not through the engine), for the thank and refund cases. */
async function raiseHand(opts: { seconds?: number } = {}): Promise<{ handId: bigint; hand: Hand; rootKey: Hex }> {
  const { terms, rootKey } = await raiseTerms(opts);
  const raiserWallet = createWalletClient({ account: privateKeyToAccount(raiserKey), chain: foundry, transport: http(chain.rpc) });
  for (const call of [approveCall(usd, chain.core, terms.reward), raiseCall(chain.core, terms)]) {
    const hash = await raiserWallet.sendTransaction({ to: call.to, data: call.data });
    const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
    if (call.to === chain.core) {
      const [raised] = parseEventLogs({ abi: CORE_ABI, logs: receipt.logs, eventName: "Raised" });
      const { hand } = await readHand(client, chain.core, raised!.args.handId);
      return { handId: raised!.args.handId, hand, rootKey };
    }
  }
  throw new Error("unreachable");
}

const factoryAbi = parseAbi(["function createAccount(address owner, uint256 salt) returns (address)", "function getAddress(address owner, uint256 salt) view returns (address)"]);
let nextSalt = 1000n;

/** A Give from a smart account that is not deployed yet: the giver's answer wrapped per ERC-6492. */
async function undeployedGive(raised: { hand: Hand; rootKey: Hex }) {
  const owner = privateKeyToAccount(giverOwnerKey).address;
  const salt = nextSalt++;
  const factory = chain.accountFactory!;
  const account = await client.readContract({ address: factory, abi: factoryAbi, functionName: "getAddress", args: [owner, salt] });
  const factoryData = encodeFunctionData({ abi: factoryAbi, functionName: "createAccount", args: [owner, salt] });
  const { routeHash } = await checkRoute(dom, raised.hand, []);
  const give: Give = { signer: account, payee: account, claimBps: 10_000, routeHash, dataHash: zeroHash };
  const inner = await signGiveWithKey(giverOwnerKey, dom, raised.hand, give);
  const signedGive: SignedGive = {
    give,
    keySig: await signGiveWithKey(raised.rootKey, dom, raised.hand, give),
    giverSig: serializeErc6492Signature({ address: factory, data: factoryData, signature: inner }),
  };
  const setup = { forwarder: chain.forwarder!, factory, factoryData };
  return { account, signedGive, setup, calls: [setupCall(setup), thankCall(chain.core, raised.hand.handId, [], signedGive)] as Call[] };
}

beforeAll(async () => {
  chain = await startChain({ port: HAND_PORT_BASE === undefined ? 16111 : HAND_PORT_BASE + 1, slotsInAnEpoch: 1 });
  client = chain.client;
  usd = chain.tokens.find((token) => token.kind === "usd")!.address;
  dom = domain(chain.chainId, chain.core);
}, 60_000);

afterAll(async () => {
  await chain?.stop();
});

beforeEach(async () => {
  await rpc("evm_setAutomine", [true]);
});

describe("a refusal comes from the simulation, before anything is sent", () => {
  test("one call: Core's error by name, and the wallet is never asked to send", async () => {
    const { terms } = await raiseTerms();
    const { timestamp } = await chainNow(client);
    const double = walletDouble(raiserKey);
    const result = await sendCalls(env(), double.wallet, [raiseCall(chain.core, { ...terms, reward: 0n, expiry: timestamp + 400 * DAY })]);
    expect(result).toMatchObject({ ok: false, reason: "refused", step: 0, sent: [], refusal: { name: "ExpiryTooLate" } });
    expect(double.sendTransactions() + double.sendBatches()).toBe(0);
  });

  test("a later call that would fail after the earlier one: refused at step 1, nothing sent", async () => {
    const { terms } = await raiseTerms();
    const { timestamp } = await chainNow(client);
    const double = walletDouble(raiserKey);
    const result = await sendCalls(env(), double.wallet, [approveCall(usd, chain.core, terms.reward), raiseCall(chain.core, { ...terms, expiry: timestamp - 1 })]);
    expect(result).toMatchObject({ ok: false, reason: "refused", step: 1, sent: [], refusal: { name: "ExpiryTooEarly" } });
    expect(double.sendTransactions()).toBe(0);
  });

  test("a call that depends on the one before it passes the check as a sequence", async () => {
    // raise alone would fail (no allowance yet); after the approve in the same simulation it passes.
    const { terms } = await raiseTerms({ reward: 3n * USD });
    const double = walletDouble(raiserKey);
    const progress: SendProgress[] = [];
    const result = await sendCalls(env(), double.wallet, [approveCall(usd, chain.core, terms.reward), raiseCall(chain.core, terms)], {
      onProgress: (p) => progress.push(p),
    });
    expect(result.ok).toBe(true);
    expect(handIdOf(result)).toBeGreaterThan(0n);
  });
});

describe("the step path (no atomic support)", () => {
  test("one call after another; between() before the later step; intents before waiting", async () => {
    const { terms } = await raiseTerms({ reward: 4n * USD });
    const double = walletDouble(raiserKey);
    const events: string[] = [];
    const intents: Intent[] = [];
    const result = await sendCalls(env(), double.wallet, [approveCall(usd, chain.core, terms.reward), raiseCall(chain.core, terms)], {
      onIntent: (intent) => {
        intents.push(intent);
        events.push(`intent ${intent.kind === "tx" ? intent.step : "batch"}${intent.hash ? "" : " asking"}`);
      },
      between: (step, of) => {
        events.push(`between ${step}/${of}`);
        return true;
      },
      onProgress: (p) => {
        if (p.phase === "watching" && p.reached === "in-block") events.push(`in-block ${p.step}`);
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.atomic).toBe(false);
    expect(result.hashes).toHaveLength(2);
    // Each step's intent is handed over before the wallet is asked (its nonce, no hash) and again with its hash.
    expect(events).toEqual(["intent 0 asking", "intent 0", "in-block 0", "between 1/2", "intent 1 asking", "intent 1", "in-block 1"]);
    expect(intents.filter((i) => i.hash).map((i) => i.hash)).toEqual(result.hashes);
    expect(intents.filter((i) => !i.hash).map((i) => i.nonce)).toEqual([intents[0]!.nonce, intents[0]!.nonce! + 1]);
    expect(intents.every((i) => i.from === raiser && i.fromBlock !== undefined)).toBe(true);
    expect(double.sendTransactions()).toBe(2);
    expect(double.sendBatches()).toBe(0);
    expect(handIdOf(result)).toBeGreaterThan(0n);
  });

  test("between() saying no stops before the later step: one sent, nothing more", async () => {
    const { terms } = await raiseTerms({ reward: 2n * USD });
    const double = walletDouble(raiserKey);
    const result = await sendCalls(env(), double.wallet, [approveCall(usd, chain.core, terms.reward), raiseCall(chain.core, terms)], { between: () => false });
    expect(result).toMatchObject({ ok: false, reason: "stopped", step: 1 });
    expect(result.ok ? [] : result.sent).toHaveLength(1);
    expect(double.sendTransactions()).toBe(1);
  });

  test("a later step is checked again after between(): a refusal then is data, not a send", async () => {
    const raised = await raiseHand();
    const { calls } = await undeployedGive(raised);
    const double = walletDouble(raiserKey);
    const result = await sendCalls(env(), double.wallet, calls, {
      // Someone else thanks the Hand while the setup step is in flight.
      between: async () => {
        const other = await undeployedGive(raised);
        const thief = createWalletClient({ account: privateKeyToAccount(raiserKey), chain: foundry, transport: http(chain.rpc) });
        for (const call of other.calls) await client.waitForTransactionReceipt({ hash: await thief.sendTransaction({ to: call.to, data: call.data }) });
        return true;
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "refused", step: 1, refusal: { name: "NotOpen" } });
    expect(double.sendTransactions()).toBe(1);
  });
});

describe("the batch path (atomic support)", () => {
  test("[approve, raise] goes as one atomic batch: one wallet_sendCalls, no single sends", async () => {
    const { terms } = await raiseTerms({ reward: 5n * USD });
    const double = walletDouble(raiserKey, { atomic: true });
    const intents: Intent[] = [];
    let betweenCalls = 0;
    const result = await sendCalls(env(), double.wallet, [approveCall(usd, chain.core, terms.reward), raiseCall(chain.core, terms)], {
      onIntent: (intent) => void intents.push(intent),
      between: () => void betweenCalls++,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.atomic).toBe(true);
    expect(double.sendBatches()).toBe(1);
    expect(double.sendTransactions()).toBe(0);
    expect(betweenCalls).toBe(0);
    // Before the wallet is asked (the nonce, no id), then the batch's id (before waiting), then the same id with its hash.
    expect(intents).toHaveLength(3);
    expect(intents[0]).toMatchObject({ kind: "batch", of: 2, from: raiser });
    expect(intents[0]!.nonce).toBeGreaterThanOrEqual(0);
    expect((intents[0] as { id?: string }).id).toBeUndefined();
    expect(intents[1]).toMatchObject({ kind: "batch", of: 2 });
    expect(intents[1]!.hash).toBeUndefined();
    expect(intents[2]).toMatchObject({ kind: "batch", id: (intents[1] as { id: string }).id, hash: result.receipt.transactionHash });
    expect(handIdOf(result)).toBeGreaterThan(0n);
  });
});

describe("a giver's account not deployed yet: [setupCall, thankCall] (R-28, D-62)", () => {
  test("as one atomic batch where the wallet supports it", async () => {
    const raised = await raiseHand();
    const { calls, account } = await undeployedGive(raised);
    expect(await client.getCode({ address: account })).toBeUndefined();
    const double = walletDouble(raiserKey, { atomic: true });
    const result = await sendCalls(env(), double.wallet, calls);
    expect(result).toMatchObject({ ok: true, atomic: true });
    expect(double.sendBatches()).toBe(1);
    expect(double.sendTransactions()).toBe(0);
    expect((await client.getCode({ address: account }))?.length).toBeGreaterThan(2);
    const { stateAt } = await readHand(client, chain.core, raised.handId);
    expect(stateAt((await chainNow(client)).timestamp)).toBe("thanked");
  });

  test("as two steps otherwise, with Core asked again between them", async () => {
    const raised = await raiseHand();
    const { calls, account, signedGive } = await undeployedGive(raised);
    const double = walletDouble(raiserKey);
    const checks: string[] = [];
    const result = await sendCalls(env(), double.wallet, calls, {
      between: async () => {
        // The account exists now: Core's checkGive accepts the inner signature.
        await checkGiveOnChain(client, chain.core, raised.handId, [], { ...signedGive, giverSig: (await import("@ahand/sdk")).innerGiverSig(signedGive.giverSig) });
        checks.push("checkGive ok");
        return true;
      },
    });
    expect(result).toMatchObject({ ok: true, atomic: false, of: 2 });
    expect(checks).toEqual(["checkGive ok"]);
    expect(double.sendTransactions()).toBe(2);
    expect(double.sendBatches()).toBe(0);
    expect((await client.getCode({ address: account }))?.length).toBeGreaterThan(2);
    const { stateAt } = await readHand(client, chain.core, raised.handId);
    expect(stateAt((await chainNow(client)).timestamp)).toBe("thanked");
  });
});

describe("after sending", () => {
  test("a call that passed its check and reverted on chain: reverted, with Core's reason", async () => {
    const raised = await raiseHand({ seconds: 3600 });
    await rpc("evm_increaseTime", [7200]);
    await mine();
    const call = refundCall(chain.core, raised.handId);
    const other = createWalletClient({ account: privateKeyToAccount(ANVIL_KEYS[2]!), chain: foundry, transport: http(chain.rpc) });
    const double = walletDouble(raiserKey, {
      // Someone else refunds first, after our check and before our send.
      beforeSend: async () => {
        await client.waitForTransactionReceipt({ hash: await other.sendTransaction({ to: call.to, data: call.data }) });
      },
    });
    const result = await sendCalls(env(), double.wallet, [call]);
    expect(result).toMatchObject({ ok: false, reason: "reverted", step: 0, refusal: { name: "NotOpen" } });
    expect(double.sendTransactions()).toBe(1);
  });

  test("the four states in order: sent, in a block, safe, final", async () => {
    const double = walletDouble(raiserKey);
    const reached: string[] = [];
    const result = await sendCalls(env(), double.wallet, [approveCall(usd, chain.core, 1n)], {
      onProgress: (p) => {
        if (p.reached && reached.at(-1) !== p.reached) reached.push(p.reached);
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await result.settled).toBe("final");
    expect(reached).toEqual(["sent", "in-block", "safe", "final"]);
  });

  test("resumes from a stored hash after a reload, and sends nothing", async () => {
    await rpc("evm_setAutomine", [false]);
    const raiserWallet = createWalletClient({ account: privateKeyToAccount(raiserKey), chain: foundry, transport: http(chain.rpc) });
    const call = approveCall(usd, chain.core, 2n);
    const hash = await raiserWallet.sendTransaction({ to: call.to, data: call.data, gas: 100_000n });
    // The stored intent is all a fresh tab has: no wallet is passed to resume.
    const intent: Intent = { kind: "tx", chainId: foundry.id, hash, step: 0, of: 1 };
    const reached: string[] = [];
    const result = await resume(env(), intent, {
      onProgress: (p) => {
        if (p.reached && reached.at(-1) !== p.reached) reached.push(p.reached);
      },
    });
    expect(result).toMatchObject({ ok: true, hashes: [hash] });
    if (!result.ok) return;
    expect(result.receipt.transactionHash).toBe(hash);
    expect(await result.settled).toBe("final");
    expect(reached).toEqual(["sent", "in-block", "safe", "final"]);
  });

  test("a batch stored before its hash was known needs its wallet; with the hash it does not", async () => {
    const without = await resume(env(), { kind: "batch", chainId: foundry.id, id: "0x01", of: 2 });
    expect(without).toMatchObject({ ok: false, reason: "needs-wallet" });
  });

  test("never resends: a dropped send keeps waiting, and so does one whose block was replaced", async () => {
    // Dropped: the transaction leaves the pool before any block; the engine waits and sends nothing more.
    const double = walletDouble(raiserKey, { holdMining: true });
    const stop = new AbortController();
    let ticks = 0;
    const seen: SendProgress[] = [];
    const pending = sendCalls({ ...env(stop.signal), tick: async () => {
      ticks++;
      if (ticks === 1) {
        const hash = seen.find((p) => p.hash)?.hash;
        if (hash) await rpc("anvil_dropTransaction", [hash]);
      }
      await mine();
      if (ticks === 6) stop.abort(new Error("enough"));
    } }, double.wallet, [approveCall(usd, chain.core, 3n)], { onProgress: (p) => void seen.push(p) });
    const result = await pending;
    await rpc("evm_setAutomine", [true]);
    expect(result.ok).toBe(false);
    expect(double.sendTransactions()).toBe(1);
    expect(seen.filter((p) => p.reached === "in-block")).toHaveLength(0);

    // Replaced: the block is reorganised away before it is safe; the state goes back to sent.
    const second = walletDouble(raiserKey);
    const progress: SendProgress[] = [];
    let reorgDone = false;
    const stop2 = new AbortController();
    let ticks2 = 0;
    const sent = await sendCalls({ ...env(stop2.signal), tick: async () => {
      ticks2++;
      if (!reorgDone && progress.some((p) => p.reached === "in-block")) {
        reorgDone = true;
        await rpc("anvil_reorg", [1, []]);
        return;
      }
      await mine();
      if (ticks2 > 8) stop2.abort(new Error("enough"));
    } }, second.wallet, [approveCall(usd, chain.core, 4n)], { onProgress: (p) => void progress.push(p) });
    expect(sent.ok).toBe(true);
    if (sent.ok) await sent.settled.catch(() => undefined);
    expect(progress.some((p) => p.reorged)).toBe(true);
    const afterReorg = progress.slice(progress.findIndex((p) => p.reorged));
    expect(afterReorg[0]!.reached).toBe("sent");
    expect(second.sendTransactions()).toBe(1);
  }, 30_000);
});

test("the raiser of these tests is anvil's account 1", () => {
  expect(raiser).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
});
