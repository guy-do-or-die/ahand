import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  stringToBytes,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { foundry } from "viem/chains";

import {
  CORE_ABI,
  CoreRefused,
  EXPIRY_MARGIN,
  LinkError,
  LOG_WINDOW,
  UntrustedCore,
  approveCall,
  chainNow,
  checkGive,
  checkGiveOnChain,
  checkRoute,
  checkRouteOnChain,
  domain,
  encodeLive,
  expiryAfter,
  extendCall,
  findBlockAt,
  findLaterHands,
  finalityOf,
  getHandFor,
  giveHash,
  handLogs,
  handLogsAt,
  keyOfSeed,
  messageIdOf,
  newSeed,
  openLink,
  raiseCall,
  readHand,
  readLimits,
  readPending,
  readThank,
  receiptOf,
  refundCall,
  signGiveWithKey,
  signShake,
  simulate,
  thankCall,
  withdrawCall,
  type Call,
  type Eip712Domain,
  type Hand,
  type HandLog,
  type Shake,
  type SignedGive,
  type SignedShake,
} from "../src/index.js";
import { ANVIL_KEYS, startChain, type Chain } from "./helpers/anvil.js";

/**
 * Reads of the chain, on a chain of this file's own: anvil 40 days ahead of this machine, so every
 * "now" below is a block's time. `safe` and `finalized` trail `latest` by one and two blocks.
 */

const DAY = 86_400;
const BLOCKING_ABI = parseAbi(["function setBlocked(address account, bool isBlocked)"]);
const USD = 1_000_000n; // MockUSD has six decimals

let chain: Chain;
let client: PublicClient;
let usd: Address;
let blacklist: Address;
let dom: Eip712Domain;

const raiserKey = ANVIL_KEYS[1]!;
const otherRaiserKey = ANVIL_KEYS[2]!;
const giverKey = ANVIL_KEYS[3]!;
const raiser = privateKeyToAccount(raiserKey).address;
const giver = privateKeyToAccount(giverKey).address;

/** anvil's own methods, which viem's public client does not type. */
const rpc = (method: string, params: unknown[] = []) =>
  (client.request as (args: { method: string; params: unknown[] }) => Promise<unknown>)({ method, params });
const mineAt = async (timestamp: number) => {
  await rpc("evm_setNextBlockTimestamp", [timestamp]);
  await rpc("evm_mine");
};

function walletOf(key: Hex) {
  return createWalletClient({ account: privateKeyToAccount(key), chain: foundry, transport: http(chain.rpc) });
}

/** Sends a call from the key's account and waits for it: the way an application sends `{to, data}`. */
async function send(key: Hex, call: Call) {
  const hash = await walletOf(key).sendTransaction({ to: call.to, data: call.data, value: call.value ?? 0n });
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
  if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
  return receipt;
}

const balanceOf = (token: Address, who: Address) =>
  client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

const fresh = () => privateKeyToAddress(generatePrivateKey());

interface Raised {
  handId: bigint;
  hand: Hand;
  rootKey: Hex;
  seed: Hex;
  block: bigint;
}

/** Approves (unless the reward is zero) and raises; the expiry follows the chain's clock. */
async function raise(
  key: Hex,
  opts: { reward?: bigint; seconds?: number; minClaimBps?: number; token?: Address; dataHash?: Hex } = {},
): Promise<Raised> {
  const reward = opts.reward ?? 100n * USD;
  const token = opts.token ?? usd;
  const seed = newSeed();
  const rootKey = keyOfSeed(seed);
  if (reward > 0n) await send(key, approveCall(token, chain.core, reward));
  const { timestamp } = await chainNow(client);
  const { maxExpiryPeriod } = await readLimits(client, chain.core);
  const receipt = await send(
    key,
    raiseCall(chain.core, {
      token,
      reward,
      expiry: expiryAfter(timestamp, opts.seconds ?? 30 * DAY, maxExpiryPeriod),
      rootKey: privateKeyToAddress(rootKey),
      payoutGasK: 250,
      minClaimBps: opts.minClaimBps ?? 5_000,
      dataHash: opts.dataHash ?? keccak256(stringToBytes("who can fix a 1978 Vespa?")),
    }),
  );
  const [raised] = parseEventLogs({ abi: CORE_ABI, logs: receipt.logs, eventName: "Raised" });
  const handId = raised!.args.handId;
  const { hand } = await readHand(client, chain.core, handId);
  return { handId, hand, rootKey, seed, block: receipt.blockNumber };
}

/** Signs a route of Shakes from the root key; each hop keeps `keep` basis points for `payee`. */
async function route(hand: Hand, rootKey: Hex, hops: { payee: Address; keep: number }[]) {
  const signedShakes: SignedShake[] = [];
  let key = rootKey;
  let claim = 10_000;
  for (const hop of hops) {
    const next = generatePrivateKey();
    const shake: Shake = {
      nextKey: privateKeyToAddress(next),
      payee: hop.payee,
      claimBps: claim,
      nextClaimBps: claim - hop.keep,
      dataHash: zeroHash,
    };
    signedShakes.push({ shake, keySig: await signShake(key, dom, hand, shake) });
    key = next;
    claim -= hop.keep;
  }
  return { signedShakes, lastKey: key, claim };
}

/** The Give at the end of a route, signed by the route's last key and by the giver's key. */
async function give(hand: Hand, path: Awaited<ReturnType<typeof route>>, payee: Address, signerKey = giverKey) {
  const { routeHash } = await checkRoute(dom, hand, path.signedShakes);
  const g = { signer: privateKeyToAddress(signerKey), payee, claimBps: path.claim, routeHash, dataHash: zeroHash };
  const signedGive: SignedGive = {
    give: g,
    keySig: await signGiveWithKey(path.lastKey, dom, hand, g),
    giverSig: await signGiveWithKey(signerKey, dom, hand, g),
  };
  return signedGive;
}

/** A client that writes down every request it makes, to count reads and check log windows. */
function recording() {
  const requests: { method: string; params: unknown }[] = [];
  const counted = createPublicClient({
    chain: foundry,
    transport: custom({
      request: ({ method, params }) => {
        requests.push({ method, params });
        return (client.request as (a: { method: string; params: unknown }) => Promise<unknown>)({ method, params });
      },
    }),
  }) as PublicClient;
  return { client: counted, requests };
}

beforeAll(async () => {
  chain = await startChain({ slotsInAnEpoch: 1 });
  client = chain.client;
  usd = chain.tokens.find((token) => token.kind === "usd")!.address;
  blacklist = chain.tokens.find((token) => token.kind === "blacklist")!.address;
  dom = domain(chain.chainId, chain.core);
}, 60_000);

afterAll(async () => {
  await chain?.stop();
});

describe("the clock and the limits", () => {
  it("reads the chain's time, which runs ahead of this machine's", async () => {
    const now = await chainNow(client);
    const block = await client.getBlock({ blockTag: "latest" });
    expect(now).toEqual({ number: block.number, timestamp: Number(block.timestamp) });
    expect(chain.aheadSeconds).toBe(40 * DAY);
  });

  it("reads Core's cap and signing domain", async () => {
    expect(await readLimits(client, chain.core)).toEqual({ maxExpiryPeriod: 180 * DAY, name: "aHand", version: "core" });
  });

  it("keeps an expiry ten minutes below the cap", () => {
    expect(EXPIRY_MARGIN).toBe(600);
    expect(expiryAfter(1_000, 30 * DAY, 180 * DAY)).toBe(1_000 + 30 * DAY);
    expect(expiryAfter(1_000, 180 * DAY, 180 * DAY)).toBe(1_000 + 180 * DAY - 600);
    expect(expiryAfter(1_000, 365 * DAY, 180 * DAY, 60)).toBe(1_000 + 180 * DAY - 60);
    expect(() => expiryAfter(1_000, 0, 180 * DAY)).toThrow(RangeError);
  });

  it("raises at expiryAfter(chainNow, 180 days, cap) without a revert; cap + 1 and a past time are refused", async () => {
    const { timestamp } = await chainNow(client);
    const { maxExpiryPeriod } = await readLimits(client, chain.core);
    const terms = {
      token: usd,
      reward: 0n,
      rootKey: privateKeyToAddress(generatePrivateKey()),
      payoutGasK: 250,
      minClaimBps: 7_000,
      dataHash: zeroHash,
    };

    const tooLate = await simulate(client, raiseCall(chain.core, { ...terms, expiry: timestamp + maxExpiryPeriod + 1 }), raiser);
    expect(tooLate).toEqual({ ok: false, refusal: { name: "ExpiryTooLate", args: [] } });
    const past = await simulate(client, raiseCall(chain.core, { ...terms, expiry: timestamp - 1 }), raiser);
    expect(past).toEqual({ ok: false, refusal: { name: "ExpiryTooEarly", args: [] } });
    // eth_call judges by the latest block's time: the cap itself still passes there.
    expect((await simulate(client, raiseCall(chain.core, { ...terms, expiry: timestamp + maxExpiryPeriod }), raiser)).ok).toBe(true);

    const longest = expiryAfter(timestamp, 180 * DAY, maxExpiryPeriod);
    const call = raiseCall(chain.core, { ...terms, expiry: longest });
    const simulated = await simulate(client, call, raiser);
    expect(simulated.ok).toBe(true);
    const receipt = await send(raiserKey, call);
    const [raised] = parseEventLogs({ abi: CORE_ABI, logs: receipt.logs, eventName: "Raised" });
    expect(raised!.args.expiry).toBe(longest);
  });
});

describe("a Hand's whole way, proven from its logs", () => {
  it("raises, passes twice, gives and thanks; the receipt matches balances, hands() and thanks()", async () => {
    const reward = 100n * USD;
    const { handId, hand, rootKey, block } = await raise(raiserKey, { reward });
    const first = fresh();
    const second = fresh();
    const payee = fresh();
    const path = await route(hand, rootKey, [
      { payee: first, keep: 1_000 },
      { payee: second, keep: 500 },
    ]);
    const signedGive = await give(hand, path, payee);

    // Core's own answers agree with the SDK's offline ones.
    expect(await checkRouteOnChain(client, chain.core, handId, path.signedShakes)).toEqual(
      await checkRoute(dom, hand, path.signedShakes),
    );
    await expect(checkGiveOnChain(client, chain.core, handId, path.signedShakes, signedGive)).resolves.toBeUndefined();
    const expectedHash = await checkGive(dom, hand, path.signedShakes, signedGive);

    const coreBefore = await balanceOf(usd, chain.core);
    const call = thankCall(chain.core, handId, path.signedShakes, signedGive);
    expect((await simulate(client, call, raiser)).ok).toBe(true);
    const receipt = await send(raiserKey, call);

    const view = (await readHand(client, chain.core, handId)).view;
    const logs = await handLogs(client, chain.core, handId, { fromBlock: await findBlockAt(client, view.openedAt) });
    expect(logs[0]!.eventName).toBe("Raised");
    expect(logs[0]!.blockNumber).toBe(block);
    const { rows, closedBy } = receiptOf(logs);
    expect(closedBy).toBe("thank");
    expect(rows.map((row) => row.eventName)).toEqual(["Thanked", "Shaken", "Paid", "Shaken", "Paid", "Given", "Paid"]);
    expect(rows.every((row) => row.log.transactionHash === receipt.transactionHash)).toBe(true);
    // A receipt is shown only in Core's order: a missing payout or a reordered Shake is refused.
    const withoutPayout = logs.filter((log) => !(log.eventName === "Paid" && log.args.payee === first));
    expect(() => receiptOf(withoutPayout)).toThrow(/not Core's order/);
    const swapped = logs.map((log) => (log.eventName === "Shaken" ? { ...log, args: { ...log.args, position: 1n - (log.args.position as bigint) } } : log));
    expect(() => receiptOf(swapped)).toThrow(/out of place/);

    // Row by row against the chain's balances.
    const [thanked, shaken0, paid0, shaken1, paid1, given, paidGiver] = rows;
    expect(thanked!.amount).toBe(reward);
    expect(shaken0).toMatchObject({ payee: first, amount: 10n * USD, position: 0 });
    expect(paid0).toMatchObject({ payee: first, amount: 10n * USD });
    expect(shaken1).toMatchObject({ payee: second, amount: 5n * USD, position: 1 });
    expect(paid1).toMatchObject({ payee: second, amount: 5n * USD });
    expect(given).toMatchObject({ payee, amount: 85n * USD });
    expect(paidGiver).toMatchObject({ payee, amount: 85n * USD });
    for (const row of [paid0, paid1, paidGiver]) expect(await balanceOf(usd, row!.payee!)).toBe(row!.amount);
    expect(coreBefore - (await balanceOf(usd, chain.core))).toBe(reward);

    // Against hands() and thanks().
    expect(view.closedAt).toBe(Number((await client.getBlock({ blockNumber: receipt.blockNumber })).timestamp));
    expect(view.reward).toBe(thanked!.amount);
    expect(await readThank(client, chain.core, handId)).toEqual({ giveHash: expectedHash, dataHash: zeroHash });
    expect(giveHash(hand, signedGive.give)).toBe(expectedHash);
    const { stateAt } = await readHand(client, chain.core, handId);
    expect(stateAt((await chainNow(client)).timestamp)).toBe("thanked");
    // Core's checkGive looks neither at closedAt nor at the expiry: it still passes after the thank.
    await expect(checkGiveOnChain(client, chain.core, handId, path.signedShakes, signedGive)).resolves.toBeUndefined();
    expect(await simulate(client, call, raiser)).toEqual({ ok: false, refusal: { name: "NotOpen", args: [] } });
  });

  it("shows a blocked payee's share as Pending, which withdraw delivers", async () => {
    const reward = 40n * USD;
    const { handId, hand, rootKey } = await raise(raiserKey, { reward, token: blacklist });
    const blocked = fresh();
    const payee = fresh();
    await send(raiserKey, {
      to: blacklist,
      data: encodeFunctionData({
        abi: BLOCKING_ABI,
        functionName: "setBlocked",
        args: [blocked, true],
      }),
    });
    const path = await route(hand, rootKey, [{ payee: blocked, keep: 2_500 }]);
    await send(raiserKey, thankCall(chain.core, handId, path.signedShakes, await give(hand, path, payee)));
    const view = (await readHand(client, chain.core, handId)).view;
    const rows = receiptOf(await handLogsAt(client, chain.core, handId, view.closedAt)).rows;
    expect(rows.map((row) => row.eventName)).toEqual(["Thanked", "Shaken", "Pending", "Given", "Paid"]);
    expect(rows[2]).toMatchObject({ payee: blocked, amount: 10n * USD });
    expect(await readPending(client, chain.core, blacklist, blocked)).toBe(10n * USD);
    expect(await balanceOf(blacklist, blocked)).toBe(0n);

    // Anyone may push it to the payee once the payee is free again.
    await send(raiserKey, {
      to: blacklist,
      data: encodeFunctionData({
        abi: BLOCKING_ABI,
        functionName: "setBlocked",
        args: [blocked, false],
      }),
    });
    await send(giverKey, withdrawCall(chain.core, blacklist, blocked, blocked));
    expect(await readPending(client, chain.core, blacklist, blocked)).toBe(0n);
    expect(await balanceOf(blacklist, blocked)).toBe(10n * USD);
  });
});

describe("state by block time", () => {
  it("is open one second before the expiry and expired at it; refunded after the refund", async () => {
    const { handId, hand, rootKey } = await raise(raiserKey, { reward: 7n * USD, seconds: 3_600 });
    const read = await readHand(client, chain.core, handId);
    const expiry = read.view.expiry;
    expect(read.stateAt((await chainNow(client)).timestamp)).toBe("open");

    await mineAt(expiry - 1);
    const before = await chainNow(client);
    expect(before.timestamp).toBe(expiry - 1);
    expect(read.stateAt(before.timestamp)).toBe("open");
    expect(read.stateAt(expiry)).toBe("expired");

    await mineAt(expiry);
    const at = await chainNow(client);
    expect(read.stateAt(at.timestamp)).toBe("expired");
    // At the expiry second Core agrees: extend and thank are refused, refund passes.
    const path = await route(hand, rootKey, []);
    const late = thankCall(chain.core, handId, [], await give(hand, path, fresh()));
    expect(await simulate(client, late, raiser)).toEqual({ ok: false, refusal: { name: "Expired", args: [] } });
    expect(await simulate(client, extendCall(chain.core, handId, expiry + 100), raiser)).toEqual({
      ok: false,
      refusal: { name: "Expired", args: [] },
    });
    expect((await simulate(client, refundCall(chain.core, handId), giver)).ok).toBe(true);

    await send(giverKey, refundCall(chain.core, handId));
    const after = await readHand(client, chain.core, handId);
    expect(after.stateAt((await chainNow(client)).timestamp)).toBe("refunded");
    const receipt = receiptOf(await handLogsAt(client, chain.core, handId, after.view.closedAt));
    expect(receipt.closedBy).toBe("refund");
    expect(receipt.rows.map((row) => [row.eventName, row.payee, row.amount])).toEqual([
      ["Refunded", raiser, 7n * USD],
      ["Paid", raiser, 7n * USD],
    ]);
  });

  it("reads a number never raised as missing", async () => {
    const { view, stateAt } = await readHand(client, chain.core, 999_999n);
    expect(view.openedAt).toBe(0);
    expect(stateAt((await chainNow(client)).timestamp)).toBe("missing");
  });
});

describe("where a Hand's events sit", () => {
  it("finds the raise block, and reads every event of a thanked Hand at openedAt and closedAt alone", async () => {
    // The raise opens a second that two more blocks share; the thank closes a second after two empty blocks.
    const start = (await chainNow(client)).timestamp + 5;
    await rpc("evm_setNextBlockTimestamp", [start]);
    await rpc("anvil_setBlockTimestampInterval", [0]);
    let raised: Raised;
    try {
      raised = await raise(raiserKey, { reward: 0n }); // one block: no approve at zero
      await rpc("evm_mine");
      await rpc("evm_mine");
    } finally {
      await rpc("anvil_removeBlockTimestampInterval");
    }
    const { handId, hand, rootKey, block } = raised!;
    const openedAt = (await readHand(client, chain.core, handId)).view.openedAt;
    expect(openedAt).toBe(start);
    expect(Number((await client.getBlock({ blockNumber: block + 2n })).timestamp)).toBe(start);
    expect(Number((await client.getBlock({ blockNumber: block - 1n })).timestamp)).toBeLessThan(start);

    const counted = recording();
    expect(await findBlockAt(counted.client, openedAt)).toBe(block);
    expect(counted.requests.length).toBeLessThanOrEqual(2 + Math.ceil(Math.log2(Number(block) + 1)));

    const path = await route(hand, rootKey, [
      { payee: fresh(), keep: 0 },
      { payee: zeroAddress, keep: 0 },
    ]);
    const signedGive = await give(hand, path, fresh());
    const close = (await chainNow(client)).timestamp + 5;
    await rpc("evm_setNextBlockTimestamp", [close]);
    await rpc("anvil_setBlockTimestampInterval", [0]);
    try {
      await rpc("evm_mine");
      await rpc("evm_mine");
      await send(raiserKey, thankCall(chain.core, handId, path.signedShakes, signedGive));
    } finally {
      await rpc("anvil_removeBlockTimestampInterval");
    }
    const view = (await readHand(client, chain.core, handId)).view;
    expect(view.closedAt).toBe(close);

    const atOpen = await handLogsAt(client, chain.core, handId, view.openedAt);
    const atClose = await handLogsAt(client, chain.core, handId, view.closedAt);
    const all = await handLogs(client, chain.core, handId, { fromBlock: BigInt(chain.deployBlock) });
    const key = (log: HandLog) => `${log.blockNumber}:${log.logIndex}`;
    expect([...atOpen, ...atClose].map(key)).toEqual(all.map(key));
    expect(all.map((log) => log.eventName)).toEqual(["Raised", "Thanked", "Shaken", "Shaken", "Given"]);
    // A reward of zero pays nothing, so no payout event follows any row.
    expect(receiptOf(all).rows.map((row) => [row.eventName, row.amount])).toEqual([
      ["Thanked", 0n],
      ["Shaken", 0n],
      ["Shaken", 0n],
      ["Given", 0n],
    ]);
    expect(await handLogsAt(client, chain.core, handId, view.openedAt + 1)).toEqual([]);
  });

  it("never asks for more than 2 000 blocks in one call", async () => {
    const { handId, hand, rootKey, block } = await raise(raiserKey, { reward: 3n * USD });
    await rpc("anvil_mine", ["0x1194"]); // 4 500 empty blocks
    const path = await route(hand, rootKey, [{ payee: fresh(), keep: 3_000 }]);
    await send(raiserKey, thankCall(chain.core, handId, path.signedShakes, await give(hand, path, fresh())));
    const latest = await client.getBlockNumber({ cacheTime: 0 });

    for (const chunk of [undefined, 5_000, 700]) {
      const counted = recording();
      const logs = await handLogs(counted.client, chain.core, handId, { fromBlock: block, toBlock: latest, chunk });
      expect(logs.map((log) => log.eventName)).toEqual(["Raised", "Thanked", "Shaken", "Paid", "Given", "Paid"]);
      const windows = counted.requests.filter((r) => r.method === "eth_getLogs");
      const size = Math.min(chunk ?? LOG_WINDOW, LOG_WINDOW);
      expect(windows.length).toBe(Math.ceil(Number(latest - block + 1n) / size));
      let next = block;
      for (const request of windows) {
        const [{ fromBlock, toBlock, topics }] = request.params as [{ fromBlock: Hex; toBlock: Hex; topics: unknown[] }];
        expect(BigInt(fromBlock)).toBe(next);
        expect(BigInt(toBlock) - BigInt(fromBlock) + 1n).toBeLessThanOrEqual(BigInt(LOG_WINDOW));
        expect(topics[1]).toBe(`0x${handId.toString(16).padStart(64, "0")}`);
        next = BigInt(toBlock) + 1n;
      }
      expect(next).toBe(latest + 1n);
    }
  });

  it("finds a later Hand of the same raiser in exactly the requests it announced", async () => {
    const earlier = await raise(raiserKey, { reward: 0n });
    await rpc("anvil_mine", ["0xbb8"]); // 3 000 empty blocks
    await raise(otherRaiserKey, { reward: 0n }); // another raiser: not a match
    await rpc("anvil_mine", ["0x3e8"]);
    const later = await raise(raiserKey, { reward: 0n });
    const latest = await client.getBlockNumber({ cacheTime: 0 });

    const counted = recording();
    const look = findLaterHands(counted.client, chain.core, raiser, { fromBlock: earlier.block + 1n, toBlock: latest });
    const span = Number(latest - earlier.block);
    expect(look.requests).toBe(Math.ceil(span / 2_000));
    expect(counted.requests).toHaveLength(0);
    const progress: number[] = [];
    const found = await look.run((_, done) => {
      progress.push(done);
    });
    expect(found).toEqual([{ handId: later.handId, block: later.block }]);
    expect(counted.requests).toHaveLength(look.requests);
    expect(progress).toEqual(Array.from({ length: look.requests }, (_, i) => i + 1));

    // Bounded: one window does not reach the later Hand, and stopping early keeps what was found.
    const capped = recording();
    const short = findLaterHands(capped.client, chain.core, raiser, { fromBlock: earlier.block + 1n, toBlock: latest, maxWindows: 1 });
    expect(short.requests).toBe(1);
    expect(await short.run()).toEqual([]);
    expect(capped.requests).toHaveLength(1);
    // A window asked larger than 2 000 blocks is cut to 2 000, and the count announced follows it.
    const wide = recording();
    const big = findLaterHands(wide.client, chain.core, raiser, { fromBlock: earlier.block + 1n, toBlock: latest, chunk: 1_000_000, maxWindows: 2 });
    expect(big.requests).toBe(Math.min(2, Math.ceil(span / 2_000)));
    await big.run();
    expect(wide.requests).toHaveLength(big.requests);
    for (const request of wide.requests) {
      const [{ fromBlock, toBlock }] = request.params as [{ fromBlock: Hex; toBlock: Hex }];
      expect(BigInt(toBlock) - BigInt(fromBlock) + 1n).toBeLessThanOrEqual(2_000n);
    }
    const stopped = recording();
    const stoppable = findLaterHands(stopped.client, chain.core, raiser, { fromBlock: earlier.block + 1n, toBlock: latest });
    await stoppable.run(() => false);
    expect(stopped.requests).toHaveLength(1);
  });
});

describe("which Core a link may name", () => {
  it("answers for a trusted Core, refuses an untrusted Core, an unknown chain and a Hand never raised", async () => {
    const { handId, hand, seed: raisedSeed } = await raise(raiserKey, { reward: 0n });
    const trusted = [{ chainId: chain.chainId, core: chain.core }];
    const getHand = getHandFor({ [chain.chainId]: client }, trusted);
    expect(await getHand({ chainId: chain.chainId, core: chain.core, handId })).toEqual(hand);

    const elsewhere = fresh();
    const untrusted = await getHand({ chainId: chain.chainId, core: elsewhere, handId }).catch((e) => e);
    expect(untrusted).toBeInstanceOf(UntrustedCore);
    expect(untrusted).not.toBeInstanceOf(LinkError);
    expect(untrusted).toMatchObject({ chainId: chain.chainId, core: elsewhere });
    const unknown = await getHand({ chainId: 8453, core: chain.core, handId }).catch((e) => e);
    expect(unknown).toBeInstanceOf(UntrustedCore);
    expect(unknown.chainId).toBe(8453);
    // Trusted on paper, but this build has no client for the chain: still refused.
    const noClient = await getHandFor({}, trusted)({ chainId: chain.chainId, core: chain.core, handId }).catch((e) => e);
    expect(noClient).toBeInstanceOf(UntrustedCore);

    const never = await getHand({ chainId: chain.chainId, core: chain.core, handId: 999_999n }).catch((e) => e);
    expect(never).toBeInstanceOf(CoreRefused);
    expect(never.name).toBe("NotRaised");
    expect(messageIdOf(never)).toBe("core.NotRaised");

    // openLink lets UntrustedCore through unchanged, and it reads as "a contract this site doesn't read".
    const seed = newSeed();
    const link = await encodeLive({ domain: dom, hand: { ...hand, rootKey: privateKeyToAddress(keyOfSeed(seed)) }, signedShakes: [], seed });
    const other = getHandFor({ [chain.chainId]: client }, [{ chainId: chain.chainId, core: fresh() }]);
    const thrown = await openLink(link, other).catch((e) => e);
    expect(thrown).toBeInstanceOf(UntrustedCore);
    expect(messageIdOf(thrown)).toBe("link.untrusted");
    // The Hand's own link opens through the trusted adapter.
    const own = await encodeLive({ domain: dom, hand, signedShakes: [], seed: raisedSeed });
    expect((await openLink(own, getHand)).hand).toEqual(hand);
  });

  it("asks Core's checkRoute and checkGive and turns a refusal into CoreRefused with its position", async () => {
    const { handId, hand, rootKey } = await raise(raiserKey, { reward: USD });
    const path = await route(hand, rootKey, [
      { payee: fresh(), keep: 100 },
      { payee: fresh(), keep: 100 },
    ]);
    const broken = [path.signedShakes[0]!, { ...path.signedShakes[1]!, keySig: path.signedShakes[0]!.keySig }];
    const refused = await checkRouteOnChain(client, chain.core, handId, broken).catch((e) => e);
    expect(refused).toBeInstanceOf(CoreRefused);
    expect(refused).toMatchObject({ name: "InvalidKeySig", position: 1 });
    expect(messageIdOf(refused)).toBe("core.InvalidKeySig");

    const notRaised = await checkRouteOnChain(client, chain.core, 999_999n, []).catch((e) => e);
    expect(notRaised).toMatchObject({ name: "NotRaised" });

    const signedGive = await give(hand, path, fresh());
    const tampered = { ...signedGive, give: { ...signedGive.give, payee: fresh() } };
    const wrongKey = await checkGiveOnChain(client, chain.core, handId, path.signedShakes, tampered).catch((e) => e);
    expect(wrongKey).toMatchObject({ name: "InvalidKeySig", position: 2 });
  });
});

describe("how settled a block is", () => {
  it("is in a block, then safe one block later, then final two blocks later", async () => {
    const receipt = await send(raiserKey, approveCall(usd, chain.core, 0n));
    expect(await finalityOf(client, receipt.blockNumber)).toBe("in-block");
    await rpc("evm_mine");
    expect(await finalityOf(client, receipt.blockNumber)).toBe("safe");
    await rpc("evm_mine");
    expect(await finalityOf(client, receipt.blockNumber)).toBe("final");
  });
});
