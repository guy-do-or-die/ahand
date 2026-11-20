import {
  decodeEventLog,
  decodeFunctionResult,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  isAddressEqual,
  numberToHex,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { CoreRefused, decodeCoreError, refusalOfData } from "./errors.js";
import { CORE_ABI, FORWARDER_ABI, forCore, keySigForCore, type AccountSetup } from "./tx.js";
import type { Hand, SignedGive, SignedShake } from "./types.js";
import type { RouteEnd } from "./verify.js";

/**
 * Reads from the chain. Three rules hold throughout:
 *
 * - The one clock is the chain's: "now" is a block's timestamp (`chainNow`), never the device's.
 * - A Hand's state comes from Core's views (`hands`, `thanks`, `pending`); logs are history.
 * - Logs are read only in bounded windows of at most 2 000 blocks, filtered by the Hand (or, for
 *   `findLaterHands`, by its raiser), and never scanned from Core's deployment.
 */

/** A Hand's state at a block's time. "expired": still open on chain, but its time is up. */
export type HandState = "missing" | "open" | "expired" | "thanked" | "refunded";

/** Every field of Core's `hands(id)`, typed. */
export interface HandView {
  handId: bigint;
  raiser: Address;
  expiry: number;
  openedAt: number;
  closedAt: number;
  token: Address;
  payoutGasK: number;
  minClaimBps: number;
  reward: bigint;
  rootKey: Address;
  dataHash: Hex;
}

/** The names of Core's events that concern one Hand. */
export type HandEventName =
  | "Raised"
  | "Funded"
  | "Extended"
  | "Shaken"
  | "Given"
  | "Thanked"
  | "Refunded"
  | "Paid"
  | "Pending";

/** One decoded event of a Hand, with where it stands on chain. */
export interface HandLog {
  eventName: HandEventName;
  args: Record<string, bigint | number | Address | Hex>;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
}

/** One row of a receipt, in Core's event order (R-56, R-70). */
export interface ReceiptRow {
  eventName: HandEventName;
  /** Who the row pays or names, where it pays or names someone. */
  payee?: Address;
  amount?: bigint;
  /** A Shake's position on the route. */
  position?: number;
  log: HandLog;
}

export interface Receipt {
  handId: bigint;
  rows: ReceiptRow[];
  /** How the Hand was closed; absent while the logs hold no closing. */
  closedBy?: "thank" | "refund";
}

/** The seconds kept below Core's cap when an expiry is chosen. */
export const EXPIRY_MARGIN = 600;

/** Base's advice for one `eth_getLogs`: fewer than 2 000 blocks (brief 08 §6). No read here asks for more. */
export const LOG_WINDOW = 2_000;

/** One day of Base at 200 ms blocks, in windows of 2 000 blocks: how far `findLaterHands` looks by default. */
export const LATER_HANDS_WINDOWS = 216;

/** A Core the build trusts on one chain. */
export interface TrustedCore {
  chainId: number;
  core: Address;
}

/** A link named a chain or a Core outside the configured list. Not a LinkError: its own class. */
export class UntrustedCore extends Error {
  constructor(
    readonly chainId: number,
    readonly core: Address,
  ) {
    super(`chain ${chainId}, Core ${core} is not one this build reads`);
    this.name = "UntrustedCore";
  }
}

const HAND_EVENTS: readonly HandEventName[] = [
  "Raised",
  "Funded",
  "Extended",
  "Shaken",
  "Given",
  "Thanked",
  "Refunded",
  "Paid",
  "Pending",
];

/** Each Hand event's first topic (its signature): every one of them indexes `handId` second. */
const HAND_EVENT_TOPICS: Hex[] = HAND_EVENTS.map(
  (eventName) => encodeEventTopics({ abi: CORE_ABI, eventName })[0] as Hex,
);
const RAISED_TOPIC = HAND_EVENT_TOPICS[0]!;

const topicOf = (value: bigint): Hex => numberToHex(value, { size: 32 });
const addressTopic = (address: Address): Hex => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;

/** The latest block: the one clock of the whole system. */
export async function chainNow(client: PublicClient): Promise<{ number: bigint; timestamp: number }> {
  const block = await client.getBlock({ blockTag: "latest" });
  return { number: block.number, timestamp: Number(block.timestamp) };
}

/** min(now + seconds, now + maxExpiryPeriod - margin); `now` is `chainNow().timestamp`. */
export function expiryAfter(now: number, seconds: number, maxExpiryPeriod: number, margin = EXPIRY_MARGIN): number {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new RangeError("expiryAfter takes a block time and a positive number of seconds");
  }
  if (maxExpiryPeriod <= margin) throw new RangeError("Core's cap is not above the margin");
  return Math.min(now + seconds, now + maxExpiryPeriod - margin);
}

/** A Hand's state at `now`, a block's timestamp, from its view and whether a Give was thanked. */
function stateOf(view: HandView, thanked: boolean, now: number): HandState {
  if (view.openedAt === 0) return "missing";
  if (view.closedAt !== 0) return thanked ? "thanked" : "refunded";
  return now >= view.expiry ? "expired" : "open";
}

/** Reads `hands(id)`. `stateAt(now)` takes a block's timestamp, never the device's clock. */
export async function readHand(
  client: PublicClient,
  core: Address,
  handId: bigint,
): Promise<{ view: HandView; hand: Hand; stateAt(now: number): HandState }> {
  const [raiser, expiry, openedAt, closedAt, token, payoutGasK, minClaimBps, reward, rootKey, dataHash] =
    await client.readContract({ address: core, abi: CORE_ABI, functionName: "hands", args: [handId] });
  const view: HandView = {
    handId,
    raiser,
    expiry,
    openedAt,
    closedAt,
    token,
    payoutGasK,
    minClaimBps,
    reward,
    rootKey,
    dataHash,
  };
  // A closed Hand was thanked if `thanks` keeps a Give, refunded if not.
  const thanked = closedAt !== 0 && (await readThank(client, core, handId)).giveHash !== zeroHash;
  const hand: Hand = { handId, raiser, token, rootKey, payoutGasK, minClaimBps, dataHash };
  return { view, hand, stateAt: (now: number) => stateOf(view, thanked, now) };
}

export async function readThank(client: PublicClient, core: Address, handId: bigint): Promise<{ giveHash: Hex; dataHash: Hex }> {
  const [giveHash, dataHash] = await client.readContract({
    address: core,
    abi: CORE_ABI,
    functionName: "thanks",
    args: [handId],
  });
  return { giveHash, dataHash };
}

export function readPending(client: PublicClient, core: Address, token: Address, payee: Address): Promise<bigint> {
  return client.readContract({ address: core, abi: CORE_ABI, functionName: "pending", args: [token, payee] });
}

export async function readLimits(
  client: PublicClient,
  core: Address,
): Promise<{ maxExpiryPeriod: number; name: string; version: string }> {
  const [period, domain] = await Promise.all([
    client.readContract({ address: core, abi: CORE_ABI, functionName: "MAX_EXPIRY_PERIOD" }),
    client.readContract({ address: core, abi: CORE_ABI, functionName: "eip712Domain" }),
  ]);
  return { maxExpiryPeriod: Number(period), name: domain[1], version: domain[2] };
}

/**
 * A `getHand` for `openAddress` and `faceOf` that fails closed: any chain or Core outside
 * `trusted`, or a chain without a client, throws `UntrustedCore`; a Hand never raised throws
 * Core's own `NotRaised`. The terms come from `hands(id)`, as Core judges signatures by them.
 */
export function getHandFor(
  clients: Record<number, PublicClient>,
  trusted: TrustedCore[],
): (named: { chainId?: number; core?: Address; handId?: bigint }) => Promise<Hand> {
  return async ({ chainId, core, handId }) => {
    if (chainId === undefined || core === undefined || handId === undefined) {
      throw new Error("getHandFor: the link names no chain, Core and Hand number");
    }
    const known = trusted.some((entry) => entry.chainId === chainId && isAddressEqual(entry.core, core));
    const client = clients[chainId];
    if (!known || !client) throw new UntrustedCore(chainId, getAddress(core));
    const { view, hand } = await readHand(client, core, handId);
    if (view.openedAt === 0) throw new CoreRefused({ name: "NotRaised" });
    return hand;
  };
}

/** Rethrows Core's refusal as `CoreRefused`, anything else as it came. */
function asRefusal(error: unknown): never {
  const refusal = decodeCoreError(error);
  if (refusal) throw new CoreRefused(refusal);
  throw error;
}

/** Core's own `checkRoute` by `eth_call`. Throws `CoreRefused`. */
export async function checkRouteOnChain(
  client: PublicClient,
  core: Address,
  handId: bigint,
  signedShakes: readonly SignedShake[],
): Promise<RouteEnd> {
  try {
    const [lastKey, claimBps, routeHash] = await client.readContract({
      address: core,
      abi: CORE_ABI,
      functionName: "checkRoute",
      args: [handId, signedShakes.map(({ shake, keySig }) => ({ shake, keySig: keySigForCore(keySig) }))],
    });
    return { lastKey, claimBps, routeHash };
  } catch (error) {
    return asRefusal(error);
  }
}

/**
 * Core's own `checkGive` by `eth_call`, asked with the bytes `thankCall` would write (`forCore`:
 * link keys' signatures in Core's 65-byte form, the giver's unwrapped from ERC-6492). Throws
 * `CoreRefused`. With `setup`, one `eth_call` to the forwarder runs the account's setup call, then
 * Core's `checkGive`. Without it an account that is not deployed yet has no code, so Core refuses
 * its signature: it has no ERC-6492 (R-28).
 */
export async function checkGiveOnChain(
  client: PublicClient,
  core: Address,
  handId: bigint,
  signedShakes: readonly SignedShake[],
  signedGive: SignedGive,
  setup?: AccountSetup,
): Promise<void> {
  const written = forCore(signedShakes, signedGive);
  if (!setup) {
    try {
      await client.readContract({
        address: core,
        abi: CORE_ABI,
        functionName: "checkGive",
        args: [handId, written.signedShakes, written.signedGive],
      });
      return;
    } catch (error) {
      return asRefusal(error);
    }
  }

  const check = encodeFunctionData({
    abi: CORE_ABI,
    functionName: "checkGive",
    args: [handId, written.signedShakes, written.signedGive],
  });
  // Both calls may fail without failing the batch, so Core's own answer comes back in the result
  // instead of the forwarder's "call failed". A failed setup leaves no code: Core then refuses.
  const data = encodeFunctionData({
    abi: FORWARDER_ABI,
    functionName: "aggregate3",
    args: [
      [
        { target: setup.factory, allowFailure: true, callData: setup.factoryData },
        { target: core, allowFailure: true, callData: check },
      ],
    ],
  });
  const { data: returned } = await client.call({ to: setup.forwarder, data });
  if (!returned) throw new Error(`the forwarder at ${setup.forwarder} returned nothing: no forwarder there`);
  const results = decodeFunctionResult({ abi: FORWARDER_ABI, functionName: "aggregate3", data: returned });
  const answer = results[1];
  if (!answer) throw new Error("the forwarder returned fewer results than calls");
  if (answer.success) return;
  const refusal = refusalOfData(answer.returnData);
  if (refusal) throw new CoreRefused(refusal);
  throw new Error(`checkGive through the forwarder failed without one of Core's errors: ${answer.returnData}`);
}

/**
 * The first block at or after `timestamp`; a binary search of about 25 reads. Where several
 * blocks share one second, this is the first of them. Throws when no block has reached the time.
 */
export async function findBlockAt(client: PublicClient, timestamp: number): Promise<bigint> {
  const latest = await client.getBlock({ blockTag: "latest" });
  if (Number(latest.timestamp) < timestamp) {
    throw new RangeError(`no block at or after ${timestamp} yet: the latest is ${latest.timestamp}`);
  }
  let low = 0n;
  let high = latest.number; // invariant: block `high` is at or after the time
  while (low < high) {
    const middle = (low + high) / 2n;
    const block = await client.getBlock({ blockNumber: middle });
    if (Number(block.timestamp) < timestamp) low = middle + 1n;
    else high = middle;
  }
  return high;
}

/** Decodes raw logs of Core into a Hand's logs, in chain order. */
function decodeHandLogs(raw: RawLog[]): HandLog[] {
  const logs: HandLog[] = [];
  for (const log of raw) {
    if (log.removed) continue;
    const decoded = decodeEventLog({ abi: CORE_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    if (!HAND_EVENTS.includes(decoded.eventName as HandEventName)) continue;
    logs.push({
      eventName: decoded.eventName as HandEventName,
      args: decoded.args as unknown as HandLog["args"],
      blockNumber: BigInt(log.blockNumber),
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      logIndex: Number(log.logIndex),
    });
  }
  return logs.sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
}

interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: Hex;
  removed?: boolean;
}

/** One `eth_getLogs` over `[from, to]`, by Core's address and topics. */
function getLogs(client: PublicClient, core: Address, from: bigint, to: bigint, topics: (Hex | Hex[] | null)[]) {
  return client.request({
    method: "eth_getLogs",
    params: [{ address: core, fromBlock: numberToHex(from), toBlock: numberToHex(to), topics }],
  }) as Promise<RawLog[]>;
}

/** The window size actually used: at most `LOG_WINDOW` blocks. */
function windowOf(chunk: number | undefined): bigint {
  const size = chunk ?? LOG_WINDOW;
  if (!Number.isInteger(size) || size < 1) throw new RangeError("a window is at least one block");
  return BigInt(Math.min(size, LOG_WINDOW));
}

/** A Hand's events from `fromBlock` to `toBlock` (default: the latest), window by window, in chain order. */
export async function handLogs(
  client: PublicClient,
  core: Address,
  handId: bigint,
  range: { fromBlock: bigint; toBlock?: bigint; chunk?: number },
): Promise<HandLog[]> {
  const size = windowOf(range.chunk);
  const to = range.toBlock ?? (await client.getBlockNumber({ cacheTime: 0 }));
  const topics = [HAND_EVENT_TOPICS, topicOf(handId)];
  const raw: RawLog[] = [];
  for (let from = range.fromBlock; from <= to; from += size) {
    const end = from + size - 1n < to ? from + size - 1n : to;
    raw.push(...(await getLogs(client, core, from, end, topics)));
  }
  return decodeHandLogs(raw);
}

/**
 * The Hand's logs in one block named by its hash (`eth_getLogs` with `blockHash`), in log order.
 * A block hash names one block on one branch, so a saved log can be re-read exactly where it was;
 * a hash the node does not know is an error from the node.
 */
export async function handLogsInBlock(client: PublicClient, core: Address, handId: bigint, blockHash: Hex): Promise<HandLog[]> {
  const raw = (await client.request({
    method: "eth_getLogs",
    params: [{ address: core, blockHash, topics: [HAND_EVENT_TOPICS, topicOf(handId)] }],
  })) as RawLog[];
  return decodeHandLogs(raw);
}

/**
 * The Hand's logs in the blocks that carry this second: `openedAt` holds the raise, `closedAt`
 * the whole thank or refund. On Base several blocks share one second; all of them are read.
 */
export async function handLogsAt(client: PublicClient, core: Address, handId: bigint, timestamp: number): Promise<HandLog[]> {
  const first = await findBlockAt(client, timestamp);
  const start = await client.getBlock({ blockNumber: first });
  if (Number(start.timestamp) !== timestamp) return [];
  const latest = await client.getBlockNumber({ cacheTime: 0 });
  let last = first;
  while (last < latest) {
    const next = await client.getBlock({ blockNumber: last + 1n });
    if (Number(next.timestamp) !== timestamp) break;
    last += 1n;
  }
  return handLogs(client, core, handId, { fromBlock: first, toBlock: last });
}

const isPayout = (row: ReceiptRow | undefined) => row?.eventName === "Paid" || row?.eventName === "Pending";

/**
 * Receipt rows in Core's event order: a thank is `Thanked`, then for each Shake `Shaken` and its
 * `Paid` or `Pending`, then `Given` and the giver's payout; a refund is `Refunded` and one payout.
 * A zero amount has no payout event (R-56, R-70). Raised, Funded and Extended are history, not
 * receipt rows. Throws if the logs break that order: a receipt is shown only when it holds.
 */
export function receiptOf(logs: HandLog[]): Receipt {
  if (logs.length === 0) throw new Error("receiptOf: no logs, so no Hand");
  const handId = logs[0]!.args.handId as bigint;
  const sorted = [...logs].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
  if (sorted.some((log) => log.args.handId !== handId)) throw new Error("receiptOf: logs of more than one Hand");

  const closingAt = sorted.findIndex((log) => log.eventName === "Thanked" || log.eventName === "Refunded");
  if (closingAt < 0) return { handId, rows: [] };
  const closing = sorted[closingAt]!;
  const rows: ReceiptRow[] = sorted
    .slice(closingAt)
    .filter((log) => log.transactionHash === closing.transactionHash)
    .map((log) => {
      const a = log.args;
      switch (log.eventName) {
        case "Thanked":
        case "Refunded":
          return { eventName: log.eventName, amount: a.reward as bigint, log };
        case "Shaken":
          return { eventName: log.eventName, payee: a.payee as Address, amount: a.margin as bigint, position: Number(a.position), log };
        case "Given":
        case "Paid":
        case "Pending":
          return { eventName: log.eventName, payee: a.payee as Address, amount: a.amount as bigint, log };
        default:
          throw new Error(`receiptOf: ${log.eventName} inside a closing`);
      }
    });

  // Check the order Core writes: each nonzero amount is followed by exactly one payout to the same payee.
  const fail = (why: string): never => {
    throw new Error(`receiptOf: not Core's order: ${why}`);
  };
  let at = 1;
  const payout = (payee: Address | undefined, amount: bigint) => {
    if (amount === 0n) {
      if (isPayout(rows[at])) fail(`a payout after a zero amount at row ${at}`);
      return;
    }
    const row = rows[at];
    if (!row || !isPayout(row)) return fail(`no payout at row ${at}`);
    if (row.amount !== amount || (payee && !isAddressEqual(row.payee!, payee))) fail(`payout at row ${at} differs`);
    at++;
  };
  if (closing.eventName === "Refunded") {
    payout(undefined, rows[0]!.amount!);
    if (at !== rows.length) fail("rows after a refund's payout");
    // `Refunded` names no one; its payout goes to the raiser, so the row names whom it pays.
    if (rows[1]) rows[0]!.payee = rows[1].payee;
    return { handId, rows, closedBy: "refund" };
  }
  let expected = 0;
  let paid = 0n;
  while (rows[at]?.eventName === "Shaken") {
    const shaken = rows[at]!;
    if (shaken.position !== expected++) fail(`Shake ${shaken.position} out of place`);
    at++;
    payout(shaken.payee, shaken.amount!);
    paid += shaken.amount!;
  }
  const given = rows[at];
  if (!given || given.eventName !== "Given") return fail("no Given after the Shakes");
  at++;
  payout(given.payee, given.amount!);
  if (at !== rows.length) fail("rows after the giver's payout");
  if (paid + given.amount! !== rows[0]!.amount) fail("the rows do not add up to the reward");
  return { handId, rows, closedBy: "thank" };
}

/**
 * Later Hands by the same raiser (R-27): `Raised` filtered by the raiser topic, in at most
 * `maxWindows` (default 216) windows of 2 000 blocks. `requests` is known before any is made, and
 * `run` makes exactly that many. `onProgress` returning `false` stops the look; what was found
 * so far is returned.
 */
export function findLaterHands(
  client: PublicClient,
  core: Address,
  raiser: Address,
  range: { fromBlock: bigint; toBlock: bigint; maxWindows?: number; chunk?: number },
): {
  requests: number;
  run(onProgress?: (found: { handId: bigint; block: bigint }[], done: number) => void | boolean): Promise<{ handId: bigint; block: bigint }[]>;
} {
  const size = windowOf(range.chunk);
  const maxWindows = range.maxWindows ?? LATER_HANDS_WINDOWS;
  if (!Number.isInteger(maxWindows) || maxWindows < 1) throw new RangeError("maxWindows is at least one");
  const span = range.toBlock >= range.fromBlock ? range.toBlock - range.fromBlock + 1n : 0n;
  const windows = Number((span + size - 1n) / size);
  const requests = Math.min(windows, maxWindows);
  const topics = [RAISED_TOPIC, null, addressTopic(raiser)];

  return {
    requests,
    async run(onProgress) {
      const found: { handId: bigint; block: bigint }[] = [];
      for (let done = 0; done < requests; ) {
        const from = range.fromBlock + BigInt(done) * size;
        const end = from + size - 1n < range.toBlock ? from + size - 1n : range.toBlock;
        for (const log of decodeHandLogs(await getLogs(client, core, from, end, topics))) {
          found.push({ handId: log.args.handId as bigint, block: log.blockNumber });
        }
        done++;
        if (onProgress?.([...found], done) === false) break;
      }
      return found;
    },
  };
}

/**
 * How settled a block is, by the chain's own tags: "final" at or below `finalized`, "safe" at or
 * below `safe` (on Base: its batch is recorded on Ethereum), otherwise "in-block". A chain that
 * does not know the tags answers "in-block".
 */
export async function finalityOf(client: PublicClient, blockNumber: bigint): Promise<"in-block" | "safe" | "final"> {
  const tagged = (blockTag: "safe" | "finalized") =>
    client.getBlock({ blockTag }).then(
      (block) => block.number,
      () => undefined,
    );
  const [safe, finalized] = await Promise.all([tagged("safe"), tagged("finalized")]);
  if (finalized !== undefined && finalized !== null && blockNumber <= finalized) return "final";
  if (safe !== undefined && safe !== null && blockNumber <= safe) return "safe";
  return "in-block";
}
