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
 * - Logs are read only in bounded windows of at most 2 000 blocks, filtered by the Hand, and never
 *   scanned from Core's deployment. A window the node refuses for its size is halved until the
 *   node takes it (`readLogWindows`). Later Hands are found by their numbers, not by logs
 *   (`findLaterHands`).
 */

/** A Hand's state at a block's time. "expired": still open on chain, but its time is up. */
export type HandState = "missing" | "open" | "expired" | "thanked" | "refunded";

/** Every field of Core's `hands(id)`, typed. */
export interface CoreHand {
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

/** One row of a receipt, in Core's event order (see `receiptOf`). */
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

/**
 * Base's advice for one `eth_getLogs`: fewer than 2 000 blocks. No read here asks for
 * more. It is where a read starts: a node that takes less (Base Sepolia's public RPC refuses more
 * than 200 blocks) makes the window shrink (`readLogWindows`).
 */
export const LOG_WINDOW = 2_000;

/** How many Hands one request of `findLaterHands` reads through the forwarder. */
export const LATER_HANDS_BATCH = 200;

/** How many of the Hands raised after a Hand `findLaterHands` reads at most: the newest ones. */
export const LATER_HANDS_CAP = 20_000;

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

const topicOf = (value: bigint): Hex => numberToHex(value, { size: 32 });

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

/** A Hand's state at `now`, a block's timestamp, from `hands(id)` and whether a Give was thanked. */
function stateOf(coreHand: CoreHand, thanked: boolean, now: number): HandState {
  if (coreHand.openedAt === 0) return "missing";
  if (coreHand.closedAt !== 0) return thanked ? "thanked" : "refunded";
  return now >= coreHand.expiry ? "expired" : "open";
}

/** Reads `hands(id)`. `stateAt(now)` takes a block's timestamp, never the device's clock. */
export async function readHand(
  client: PublicClient,
  core: Address,
  handId: bigint,
): Promise<{ coreHand: CoreHand; hand: Hand; stateAt(now: number): HandState }> {
  const [raiser, expiry, openedAt, closedAt, token, payoutGasK, minClaimBps, reward, rootKey, dataHash] =
    await client.readContract({ address: core, abi: CORE_ABI, functionName: "hands", args: [handId] });
  const coreHand: CoreHand = {
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
  return { coreHand, hand, stateAt: (now: number) => stateOf(coreHand, thanked, now) };
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
 * A `getHand` for `openAddress` and `viewOf` that fails closed: any chain or Core outside
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
    const { coreHand, hand } = await readHand(client, core, handId);
    if (coreHand.openedAt === 0) throw new CoreRefused({ name: "NotRaised" });
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
 * its signature: Core does not implement ERC-6492.
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
 * The first block at or after `timestamp`. Where several blocks share one second, this is the
 * first of them. Throws when no block has reached the time.
 *
 * Searched from the latest block backwards, never from genesis: a public node keeps only recent
 * history (Base Sepolia's public RPC refused every block before 47 500 000 on 2026-11-20, "pruned
 * history unavailable"), and a Hand's blocks are recent. The first guess is the time's distance
 * divided by the chain's pace (its viem chain's `blockTime`); from there the bracket grows by
 * doubling steps toward the time, then a binary search inside it. On a chain with an even pace
 * (Base: 200 ms) the guess lands on the block or next to it, so the search takes a handful of reads,
 * and no read is ever further from the time than twice the guess's error.
 */
export async function findBlockAt(client: PublicClient, timestamp: number): Promise<bigint> {
  const latest = await client.getBlock({ blockTag: "latest" });
  if (Number(latest.timestamp) < timestamp) {
    throw new RangeError(`no block at or after ${timestamp} yet: the latest is ${latest.timestamp}`);
  }
  const timeOf = async (blockNumber: bigint) => Number((await client.getBlock({ blockNumber })).timestamp);
  // The chain's pace as its viem chain states it (the app's chains carry Base's real 200 ms), else a second.
  const pace = Math.max((client.chain?.blockTime ?? 1_000) / 1_000, 0.001);
  const distance = BigInt(Math.floor((Number(latest.timestamp) - timestamp) / pace));
  const guess = latest.number > distance ? latest.number - distance : 0n;

  // Invariants: block `high` is at or after the time; block `low` (once known) is before it.
  let high: bigint = latest.number;
  let low: bigint = guess;
  if ((await timeOf(guess)) >= timestamp) {
    high = guess;
    for (let step = 1n; ; step *= 2n) {
      if (high === 0n) return 0n;
      const at: bigint = high > step ? high - step : 0n;
      if ((await timeOf(at)) < timestamp) {
        low = at;
        break;
      }
      high = at;
    }
  } else {
    for (let step = 1n; ; step *= 2n) {
      const at: bigint = low + step < latest.number ? low + step : latest.number;
      if (at === latest.number || (await timeOf(at)) >= timestamp) {
        high = at;
        break;
      }
      low = at;
    }
  }
  while (high - low > 1n) {
    const middle = (low + high) / 2n;
    if ((await timeOf(middle)) < timestamp) low = middle;
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

/**
 * The window each client's log reads start at, where it is not `LOG_WINDOW`: set from a chain's
 * configuration (`setLogWindow`) or learnt from a node that refused a larger one. Kept per client
 * object, so a client that is dropped takes its size with it.
 */
const logWindows = new WeakMap<object, number>();

/** A window size: a whole number of blocks, at least one, at most `LOG_WINDOW`. */
function checkedWindow(size: number): number {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("a window is at least one block");
  return Math.min(size, LOG_WINDOW);
}

/**
 * Makes a client's log reads start at `size` blocks: a chain whose RPCs are known to take less than
 * `LOG_WINDOW` (the app's `chain.logWindow`). A smaller size learnt later from a refusal replaces it.
 */
export function setLogWindow(client: object, size: number): void {
  logWindows.set(client, checkedWindow(size));
}

/**
 * The window a client's next log read starts at: `window` when it is asked (at most `LOG_WINDOW`),
 * but never above what the client was set to or has learnt.
 */
export function logWindowOf(client: object, window?: number): number {
  const asked = window === undefined ? LOG_WINDOW : checkedWindow(window);
  return Math.min(asked, logWindows.get(client) ?? LOG_WINDOW);
}

/** The requests a read of `[fromBlock, toBlock]` takes at the client's window, while no node refuses it. */
export function logWindowsOver(client: object, fromBlock: bigint, toBlock: bigint, window?: number): number {
  const size = BigInt(logWindowOf(client, window));
  const span = toBlock >= fromBlock ? toBlock - fromBlock + 1n : 0n;
  return Number((span + size - 1n) / size);
}

/** Words nodes use when an `eth_getLogs` asks for too many blocks. */
const RANGE_WORDS =
  /block range|range limit|limited to|too many blocks|range (?:is )?too (?:large|wide|big)|exceed(?:s|ed)?\b.*\brange|max(?:imum)? (?:block )?range/i;
/** Words nodes use when the blocks asked hold too many logs: a limit of the data, not of the range. */
const RESULT_WORDS = /too many (?:results|logs)|more than \d[\d,]* (?:results|logs)|response size|returned more than/i;
/** Words of a rate limit: not a refusal of the range, so a smaller window would not help. */
const RATE_WORDS = /rate.?limit|too many requests|requests per|capacity/i;
/**
 * Words of a node that does not have the blocks asked (yet): "block range extends beyond current
 * head block" (reth), "header not found", "unknown block". They say "block range" but no smaller
 * window would help, and the size must not be learnt from them.
 */
const MISSING_WORDS = /beyond (?:the )?(?:current |latest )?(?:head|tip|chain)|header not found|unknown block|block (?:is )?not found|not (?:yet )?(?:been )?(?:synced|mined|available)/i;
/** A limit a node names in its refusal: "limited to a 200 range", "a 2000 block range", "maximum block range of 500". */
const NAMED_LIMITS = [/limited to (?:a )?(\d[\d,]*)/i, /(\d[\d,]*)[ -]block range/i, /max(?:imum)? (?:block )?range (?:of |is )?(\d[\d,]*)/i];

/**
 * A node's refusal of an `eth_getLogs` for its size: "range" when the node limits how many blocks
 * one request may span (a fact about the node, worth remembering), "results" when the blocks asked
 * hold more logs than it returns at once (a fact about those blocks only). `limit` is the largest
 * range the node named, if it named one.
 */
export interface LogRangeRefusal {
  kind: "range" | "results";
  limit?: number;
}

/**
 * Whether an error is a node refusing an `eth_getLogs` for its size, and how. Walked down the
 * `cause` chain, since viem wraps the node's answer:
 *
 * - JSON-RPC code -32614, Base's own. Base Sepolia's public RPC answers HTTP 413 with the body
 *   `{"code":-32614,"message":"eth_getLogs is limited to a 200 range"}`; viem reads a JSON-RPC
 *   error out of a failed response, so this arrives as an `RpcRequestError` with `code` -32614 and
 *   the node's message in `details`, not as an HTTP error. The code check is what catches Base;
 *   the status check below does not.
 * - HTTP 413 with a body that is not JSON-RPC (viem's `HttpRequestError` with `status` 413). viem
 *   retries those three times before this sees them.
 * - Any other code (-32005 "limit exceeded", -32602 "invalid params", -32000…) whose message says
 *   so: "block range", "range limit", "limited to" (kind "range"); "too many results", "more than
 *   10000 results", "response size" (kind "results").
 *
 * A rate limit is not a refusal of the size, and neither is a node that lacks the blocks asked
 * ("block range extends beyond current head block", "header not found"). Only the node's own words
 * are read (viem's `details`, or the message of an error viem did not make): viem's own sentences
 * ("Request exceeds defined limit.") say nothing about the range.
 */
export function logRangeRefusal(error: unknown): LogRangeRefusal | undefined {
  const seen = new Set<unknown>();
  const words: string[] = [];
  let refused = false;
  for (let node: unknown = error; node && typeof node === "object" && !seen.has(node); node = (node as { cause?: unknown }).cause) {
    seen.add(node);
    const { status, code, details, message, name } = node as { status?: unknown; code?: unknown; details?: unknown; message?: unknown; name?: unknown };
    if (status === 413 || code === -32614) refused = true;
    const viemMade = typeof details === "string" || (typeof name === "string" && /Error$/.test(name) && "shortMessage" in node);
    if (typeof details === "string") words.push(details);
    else if (!viemMade && typeof message === "string") words.push(message);
  }
  const text = words.join("\n");
  if (!refused) {
    if (RATE_WORDS.test(text) || MISSING_WORDS.test(text)) return undefined;
    if (RESULT_WORDS.test(text)) return { kind: "results" };
    if (!RANGE_WORDS.test(text)) return undefined;
  }
  for (const pattern of NAMED_LIMITS) {
    const named = pattern.exec(text)?.[1];
    const limit = named === undefined ? NaN : Number(named.replace(/,/g, ""));
    if (Number.isInteger(limit) && limit >= 1) return { kind: "range", limit };
  }
  return { kind: "range" };
}

/** Windows in a row the node takes before a window shrunk for its results grows back (doubling). */
const GROW_AFTER = 2;

/**
 * Reads `[fromBlock, toBlock]` window by window with `read`, in chain order, and returns every
 * window's items in that order. The first window is the client's (`logWindowOf`).
 *
 * - When the node refuses a window for its range (kind "range"), the same blocks are asked again
 *   in a window of the size the node named, or else half the size, and no window of this read is
 *   larger again. Once a window of that size is taken, the size is kept for the client, so its
 *   later reads start there; a size is never kept from a refusal alone.
 * - When the node refuses a window for the logs it holds (kind "results"), the window is halved
 *   for those blocks only: after `GROW_AFTER` windows taken in a row it doubles back, and nothing
 *   is kept for the client.
 *
 * Any other error, or a refusal of a single block, is thrown as it came.
 */
export async function readLogWindows<T>(
  client: object,
  range: { fromBlock: bigint; toBlock: bigint; window?: number },
  read: (fromBlock: bigint, toBlock: bigint) => Promise<readonly T[]>,
): Promise<T[]> {
  /** The largest window this read asks: the client's, lowered by a node's range limit. */
  let ceiling = logWindowOf(client, range.window);
  /** A range limit learnt in this read and not yet confirmed by a window of that size taken. */
  let unconfirmed = false;
  let size = ceiling;
  let taken = 0;
  const found: T[] = [];
  for (let from = range.fromBlock; from <= range.toBlock; ) {
    const end = from + BigInt(size) - 1n < range.toBlock ? from + BigInt(size) - 1n : range.toBlock;
    const span = Number(end - from + 1n);
    try {
      found.push(...(await read(from, end)));
      from = end + 1n;
      if (unconfirmed && span === ceiling) {
        unconfirmed = false;
        if (ceiling < (logWindows.get(client) ?? LOG_WINDOW)) logWindows.set(client, ceiling);
      }
      if (size < ceiling && ++taken >= GROW_AFTER) {
        size = Math.min(ceiling, size * 2);
        taken = 0;
      }
    } catch (error) {
      const refusal = logRangeRefusal(error);
      if (!refusal || span <= 1) throw error;
      taken = 0;
      if (refusal.kind === "range") {
        ceiling = refusal.limit !== undefined && refusal.limit < span ? refusal.limit : Math.max(1, Math.floor(span / 2));
        unconfirmed = true;
        size = ceiling;
      } else {
        size = Math.max(1, Math.floor(span / 2));
      }
    }
  }
  return found;
}

/**
 * A Hand's events from `fromBlock` to `toBlock` (default: the latest), window by window, in chain
 * order. `chunk` is the window to start at (at most 2 000 blocks); a node's refusal shrinks it.
 */
export async function handLogs(
  client: PublicClient,
  core: Address,
  handId: bigint,
  range: { fromBlock: bigint; toBlock?: bigint; chunk?: number },
): Promise<HandLog[]> {
  const toBlock = range.toBlock ?? (await client.getBlockNumber({ cacheTime: 0 }));
  const topics = [HAND_EVENT_TOPICS, topicOf(handId)];
  const raw = await readLogWindows(client, { fromBlock: range.fromBlock, toBlock, ...(range.chunk === undefined ? {} : { window: range.chunk }) }, (from, to) =>
    getLogs(client, core, from, to, topics),
  );
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
 * A zero amount has no payout event. Raised, Funded and Extended are history, not
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

/** A Hand found by `findLaterHands`: its number and when it was raised (the chain's time). */
export interface LaterHand {
  handId: bigint;
  openedAt: number;
}

/** A planned look for later Hands: what it will read, said before it reads, so a screen can ask first. */
export interface LaterLook {
  /** Core's `handsCount` when the look was planned: the number of the newest Hand. */
  handsCount: bigint;
  /** How many Hands were raised after this one. */
  after: bigint;
  /** How many of them the look reads: all of them, or the newest `cap`. */
  reads: number;
  /** Whether more Hands were raised after this one than the look reads. */
  capped: boolean;
  /** The requests `run` makes: one `eth_call` per batch. */
  requests: number;
  /**
   * Reads the Hands, newest first. `onProgress` sees what was found so far and how many requests
   * are done; returning `false` stops the look after that request. Returns what was found, by number.
   */
  run(onProgress?: (found: LaterHand[], done: number) => void | boolean): Promise<LaterHand[]>;
}

/**
 * Later Hands by the same raiser, found by Hand numbers rather than by logs. Core
 * numbers its Hands 1, 2, 3… (`handsCount` is the newest), so every Hand raised after this one has
 * a larger number, and `hands(id).raiser` says whose it is. "Later" means raised after this one:
 * a Hand raised while this one was still open counts too.
 *
 * Planning reads `handsCount` once. `run` then reads `hands(id)` for the numbers after `handId`,
 * newest first, `batch` (default 200) in one `eth_call` to the forwarder (Multicall3's `aggregate3`
 * on real networks), at most `cap` (default 20 000) of them: the newest, since a newer Hand is what
 * the look is for. With no forwarder given, the client's chain's Multicall3 is used when viem knows
 * one; without either, each Hand is its own `eth_call`. `requests` is known before
 * `run` makes any, and `run` makes exactly that many. No log is read, so no node's limit on log
 * ranges applies, and how long ago this Hand ended does not change the cost.
 */
export async function findLaterHands(
  client: PublicClient,
  core: Address,
  handId: bigint,
  raiser: Address,
  options: { forwarder?: Address | null; batch?: number; cap?: number } = {},
): Promise<LaterLook> {
  const forwarder = options.forwarder ?? client.chain?.contracts?.multicall3?.address ?? null;
  const batch = forwarder ? (options.batch ?? LATER_HANDS_BATCH) : 1;
  const cap = options.cap ?? LATER_HANDS_CAP;
  if (!Number.isInteger(batch) || batch < 1) throw new RangeError("a batch is at least one Hand");
  if (!Number.isInteger(cap) || cap < 1) throw new RangeError("the cap is at least one Hand");

  const handsCount = await client.readContract({ address: core, abi: CORE_ABI, functionName: "handsCount" });
  const after = handsCount > handId ? handsCount - handId : 0n;
  const reads = after < BigInt(cap) ? Number(after) : cap;
  const requests = Math.ceil(reads / batch);

  /** `hands(id)` for each number, in one request: through the forwarder, or alone without one. */
  async function readBatch(ids: bigint[]): Promise<LaterHand[]> {
    if (!forwarder) {
      const [owner, , openedAt] = await client.readContract({ address: core, abi: CORE_ABI, functionName: "hands", args: [ids[0]!] });
      return isAddressEqual(owner, raiser) ? [{ handId: ids[0]!, openedAt }] : [];
    }
    const data = encodeFunctionData({
      abi: FORWARDER_ABI,
      functionName: "aggregate3",
      args: [ids.map((id) => ({ target: core, allowFailure: false, callData: encodeFunctionData({ abi: CORE_ABI, functionName: "hands", args: [id] }) }))],
    });
    const { data: returned } = await client.call({ to: forwarder, data });
    if (!returned || returned === "0x") throw new Error(`the forwarder at ${forwarder} returned nothing: no forwarder there`);
    const results = decodeFunctionResult({ abi: FORWARDER_ABI, functionName: "aggregate3", data: returned });
    if (results.length !== ids.length) throw new Error(`the forwarder returned ${results.length} results for ${ids.length} calls`);
    const found: LaterHand[] = [];
    results.forEach((result, at) => {
      const [owner, , openedAt] = decodeFunctionResult({ abi: CORE_ABI, functionName: "hands", data: result.returnData });
      if (isAddressEqual(owner, raiser)) found.push({ handId: ids[at]!, openedAt });
    });
    return found;
  }

  return {
    handsCount,
    after,
    reads,
    capped: after > BigInt(reads),
    requests,
    async run(onProgress) {
      const found: LaterHand[] = [];
      const byNumber = () => [...found].sort((a, b) => (a.handId < b.handId ? -1 : a.handId > b.handId ? 1 : 0));
      for (let done = 0; done < requests; ) {
        const newest = handsCount - BigInt(done * batch);
        const count = Math.min(batch, reads - done * batch);
        const ids = Array.from({ length: count }, (_, at) => newest - BigInt(at));
        found.push(...(await readBatch(ids)));
        done++;
        if (onProgress?.(byNumber(), done) === false) break;
      }
      return byNumber();
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
