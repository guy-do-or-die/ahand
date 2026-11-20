import { CORE_ABI, messageIdOf, type CoreRefusal } from "@ahand/sdk";
import { decodeEventLog, getAddress, isAddress, isAddressEqual, type Address, type Hex } from "viem";

/**
 * The rules of /waiting (UX-SPEC §9) without React, so they are tested without a browser: whose
 * money the page looks at, which Hands this device knows, what each failed withdraw means for the
 * person, and the Withdrawn event read back from a receipt.
 */

/** The address in `?for=`: the link a payee sends to a friend. Anything else is ignored. */
export function addressFromSearch(search: string): Address | undefined {
  // Read only (the secrets guard allows building a query from nothing but location.search).
  const raw = /(?:^\?|&)for=([^&]*)/.exec(search)?.[1];
  let value: string | undefined;
  try {
    value = raw === undefined ? undefined : decodeURIComponent(raw).trim();
  } catch {
    return undefined;
  }
  if (!value || !isAddress(value, { strict: false })) return undefined;
  const body = value.slice(2);
  // Mixed case is a checksum: a slip while copying must not open someone else's page.
  if (body !== body.toLowerCase() && body !== body.toUpperCase() && !isAddress(value, { strict: true })) return undefined;
  const address = getAddress(value);
  return BigInt(address) === 0n ? undefined : address;
}

/** The path that opens this page for one address. Only the public address goes in the query. */
export function pathFor(payee: Address): string {
  return `/waiting?for=${payee}`;
}

/** Whose money the page shows: an address in the page's own link first, else the connected account. */
export function payeeOfPage(fromLink: Address | undefined, connected: Address | undefined): Address | undefined {
  return fromLink ?? connected;
}

/** Who may do what with the money waiting for `payee`, as Core's `withdraw` allows it. */
export interface Offer {
  /** "Take it out": only the payee may send it somewhere else (NotPayee otherwise). */
  takeOut: boolean;
  /** "Deliver": anyone may push it to the payee's own address; the payee uses "Take it out" instead. */
  deliver: boolean;
  /** Nobody connected, or the account can't pay the cost: the money stays where it is, and the page says so. */
  cannotPay: boolean;
}

export function offerOf(payee: Address, account: { address?: Address; canSend: boolean; balance?: bigint }): Offer {
  const connected = account.address !== undefined && account.canSend;
  const isPayee = connected && isAddressEqual(account.address!, payee);
  const cannotPay = !connected || account.balance === 0n;
  return { takeOut: isPayee, deliver: connected && !isPayee, cannotPay };
}

/** A Hand this device knows, from the `hands` (raised here) and `passed` (passed on here) stores. */
export interface KnownHand {
  key: string;
  chainId: number;
  core: Address;
  handId: bigint;
}

interface StoredHand {
  chainId: number;
  core: string;
  handId?: string;
}

/**
 * The Hands of both stores on this build's chain and trusted Cores, once each, in Hand order.
 * A raise that never got its number (no `handId`) is left out: it has no events to read.
 */
export function knownHands(stores: readonly (readonly StoredHand[])[], chainId: number, cores: readonly Address[]): KnownHand[] {
  const found = new Map<string, KnownHand>();
  for (const records of stores) {
    for (const record of records) {
      if (record.chainId !== chainId || record.handId === undefined || !/^[0-9]+$/.test(record.handId)) continue;
      if (!isAddress(record.core, { strict: false })) continue;
      const core = cores.find((trusted) => isAddressEqual(trusted, record.core as Address));
      if (!core) continue;
      const handId = BigInt(record.handId);
      const key = `${chainId}:${core.toLowerCase()}:${handId}`;
      if (!found.has(key)) found.set(key, { key, chainId, core, handId });
    }
  }
  return [...found.values()].sort((a, b) => (a.handId < b.handId ? -1 : a.handId > b.handId ? 1 : 0));
}

/**
 * What a withdraw that did not go means, in one of the page's sentences.
 *  - "token": the token would not move the money to that address (a blocked payee, an issuer's
 *    freeze): the money stays waiting, nothing was lost.
 *  - "core": Core said no, with its own reason (`id` is the sentence's key in i18n/common).
 *  - "rejected", "offline", "needs-wallet", "cannot-send": the usual ways a send does not start.
 *  - "unknown": anything else; nothing was sent or, if it was, it reverted and nothing moved.
 */
export type Failure =
  | { kind: "token" }
  | { kind: "core"; id: string; refusal: CoreRefusal }
  | { kind: "rejected" | "offline" | "needs-wallet" | "cannot-send" | "unknown" };

/** Core's refusals that mean the token itself did not move the money. */
const TOKEN_REFUSALS = new Set(["SafeERC20FailedOperation", "InexactTransfer"]);

interface FailedSend {
  reason: string;
  refusal?: CoreRefusal;
  message?: string;
}

export function failureOf(result: FailedSend): Failure {
  switch (result.reason) {
    case "refused":
      return refusalFailure(result.refusal!);
    case "failed-check":
      // The simulation reverted with an error that is not Core's: in withdraw only the token's
      // transfer can do that (BlacklistToken's "BLACKLISTED", USDC's "Blacklistable: account is blacklisted").
      return { kind: "token" };
    case "reverted":
      // Mined and reverted: the whole withdraw was undone, so pending is what it was.
      return result.refusal && !TOKEN_REFUSALS.has(result.refusal.name) ? refusalFailure(result.refusal) : { kind: "token" };
    case "rejected":
    case "offline":
    case "needs-wallet":
    case "cannot-send":
      return { kind: result.reason };
    default:
      return { kind: "unknown" };
  }
}

/** The same reading for a cost check that came back refused before anything was pressed. */
export function refusalFailure(refusal: CoreRefusal): Failure {
  if (TOKEN_REFUSALS.has(refusal.name)) return { kind: "token" };
  return { kind: "core", id: messageIdOf(refusal), refusal };
}

/** The `Withdrawn` event of a withdraw, read back from its receipt: the proof the money moved. */
export interface WithdrawnEvent {
  token: Address;
  payee: Address;
  amount: bigint;
  to: Address;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}

interface ReceiptLike {
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex; blockNumber: bigint | null; transactionHash: Hex | null; logIndex: number | null }[];
}

export function withdrawnIn(receipt: ReceiptLike, core: Address): WithdrawnEvent[] {
  const found: WithdrawnEvent[] = [];
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, core) || log.topics.length === 0) continue;
    try {
      const decoded = decodeEventLog({ abi: CORE_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (decoded.eventName !== "Withdrawn") continue;
      const args = decoded.args as { token: Address; payee: Address; amount: bigint; to: Address };
      found.push({
        token: args.token,
        payee: args.payee,
        amount: args.amount,
        to: args.to,
        blockNumber: log.blockNumber ?? 0n,
        transactionHash: log.transactionHash ?? "0x",
        logIndex: log.logIndex ?? 0,
      });
    } catch {
      // another event of Core
    }
  }
  return found;
}
