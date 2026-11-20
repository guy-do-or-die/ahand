import type { Address, Hex, PublicClient } from "viem";

import type { AccountSetup } from "./tx.js";
import type { Hand, SignedGive, SignedShake } from "./types.js";
import type { RouteEnd } from "./verify.js";

// Wave 1 stub: the signatures are the contract between packages (ARCHITECTURE §4);
// the module `sdk-chain` writes the bodies in wave 2.

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
}

/** The seconds kept below Core's cap when an expiry is chosen. */
export const EXPIRY_MARGIN = 600;

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

function notBuilt(name: string): never {
  throw new Error(`${name}: not built`);
}

/** Reads `hands(id)`. `stateAt(now)` takes a block's timestamp, never the device's clock. */
export function readHand(
  _client: PublicClient,
  _core: Address,
  _handId: bigint,
): Promise<{ view: HandView; hand: Hand; stateAt(now: number): HandState }> {
  return notBuilt("readHand");
}

/** The latest block: the one clock of the whole system. */
export function chainNow(_client: PublicClient): Promise<{ number: bigint; timestamp: number }> {
  return notBuilt("chainNow");
}

/** min(now + seconds, now + maxExpiryPeriod - margin); `now` is `chainNow().timestamp`. */
export function expiryAfter(_now: number, _seconds: number, _maxExpiryPeriod: number, _margin = EXPIRY_MARGIN): number {
  return notBuilt("expiryAfter");
}

export function readThank(_client: PublicClient, _core: Address, _handId: bigint): Promise<{ giveHash: Hex; dataHash: Hex }> {
  return notBuilt("readThank");
}

export function readPending(_client: PublicClient, _core: Address, _token: Address, _payee: Address): Promise<bigint> {
  return notBuilt("readPending");
}

export function readLimits(
  _client: PublicClient,
  _core: Address,
): Promise<{ maxExpiryPeriod: number; name: string; version: string }> {
  return notBuilt("readLimits");
}

/** A `getHand` for `openAddress` that fails closed: any other chain or Core throws `UntrustedCore`. */
export function getHandFor(
  _clients: Record<number, PublicClient>,
  _trusted: TrustedCore[],
): (named: { chainId?: number; core?: Address; handId?: bigint }) => Promise<Hand> {
  return notBuilt("getHandFor");
}

/** Core's own `checkRoute` by `eth_call`. Throws `CoreRefusal`. */
export function checkRouteOnChain(
  _client: PublicClient,
  _core: Address,
  _handId: bigint,
  _signedShakes: readonly SignedShake[],
): Promise<RouteEnd> {
  return notBuilt("checkRouteOnChain");
}

/**
 * Core's own `checkGive` by `eth_call`. Throws `CoreRefusal`. With `setup`, one `eth_call` to the
 * forwarder runs the account's setup call, then Core's `checkGive` with the inner signature.
 */
export function checkGiveOnChain(
  _client: PublicClient,
  _core: Address,
  _handId: bigint,
  _signedShakes: readonly SignedShake[],
  _signedGive: SignedGive,
  _setup?: AccountSetup,
): Promise<void> {
  return notBuilt("checkGiveOnChain");
}

/** The first block at or after `timestamp`; a binary search of about 25 reads. */
export function findBlockAt(_client: PublicClient, _timestamp: number): Promise<bigint> {
  return notBuilt("findBlockAt");
}

export function handLogs(
  _client: PublicClient,
  _core: Address,
  _handId: bigint,
  _range: { fromBlock: bigint; toBlock?: bigint; chunk?: number },
): Promise<HandLog[]> {
  return notBuilt("handLogs");
}

/** The Hand's logs in the blocks that carry this second. */
export function handLogsAt(_client: PublicClient, _core: Address, _handId: bigint, _timestamp: number): Promise<HandLog[]> {
  return notBuilt("handLogsAt");
}

/** Receipt rows in Core's event order. */
export function receiptOf(_logs: HandLog[]): Receipt {
  return notBuilt("receiptOf");
}

/**
 * Later Hands by the same raiser (R-27): `Raised` filtered by the raiser topic, in at most
 * `maxWindows` (default 216) windows of 2 000 blocks. `requests` is known before any is made.
 */
export function findLaterHands(
  _client: PublicClient,
  _core: Address,
  _raiser: Address,
  _range: { fromBlock: bigint; toBlock: bigint; maxWindows?: number; chunk?: number },
): {
  requests: number;
  run(onProgress?: (found: { handId: bigint; block: bigint }[], done: number) => void): Promise<{ handId: bigint; block: bigint }[]>;
} {
  return notBuilt("findLaterHands");
}

export function finalityOf(_client: PublicClient, _blockNumber: bigint): Promise<"in-block" | "safe" | "final"> {
  return notBuilt("finalityOf");
}
