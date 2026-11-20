import {
  CORE_ABI,
  DescriptionTooLarge,
  carryFor,
  domain,
  describeHand,
  encodeLive,
  expiryAfter,
  normalizeText,
  openAddress,
  packAttachments,
  passesLeft,
  readDescription,
  toAddress,
  toText,
  type AddressShape,
  type Described,
  type Hand,
  type LinkOptions,
  type ReadDescription,
} from "@ahand/sdk";
import { decodeEventLog, isAddressEqual, pad, slice, zeroAddress, zeroHash, type Address, type Hex, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * The pure half of /raise (UX-SPEC §7.2, ARCHITECTURE §6 steps 3–4): the expiry by the network's
 * clock, the Hand's terms from the `Raised` log of the raise's own receipt, the first link in the
 * mode's shape and the QR's bare digits, read back here as a holder will open them.
 */

const DAY = 86_400;

/** `expiryAfter(block time, days, cap)`: the chip's date, counted from the network's clock, capped at Core's cap less ten minutes. */
export function expiryFor(chainTime: number, days: number, maxExpiryPeriod: number): number {
  return expiryAfter(chainTime, days * DAY, maxExpiryPeriod);
}

/** How many paid passes a fresh route still has room for at worst, with this room per payout. */
export function passesAt(payoutGasK: number): number {
  const hand: Hand = { handId: 1n, raiser: zeroAddress, token: zeroAddress, rootKey: zeroAddress, payoutGasK, minClaimBps: 7000, dataHash: zeroHash };
  return passesLeft(hand, []);
}

/* ───────────────────────────── how much a hand's words may weigh ── */

/** The title's cap, in characters (code points of the normalised text). */
export const MAX_TITLE = 160;
/** The details' cap, in characters: the same as an answer's words on /give. */
export const MAX_DETAILS = 1000;
/**
 * The most that may stand before `#` in an address. A public Hand carries its words there (`?d=`),
 * where servers and link-preview robots read them, and servers refuse a request line much beyond
 * 8 KB (the stand's own front answered 431 to a 23 499-character address in review round 1).
 * What stands after `#` is never sent, so the dark shape has no such limit.
 */
export const MAX_BEFORE_HASH = 8000;
/** A Hand's number is a counter; twenty digits hold any 64-bit one. Counted before the number is known. */
const HAND_DIGITS = 20;

/** A text's length as its reader counts it: characters of the normalised text, not UTF-16 units. */
export function lengthOf(text: string): number {
  return Array.from(normalizeText(text)).length;
}

export interface Weighed {
  title: number;
  details: number;
  /** Characters before `#` in the address this draft would get, at most. */
  beforeHash: number;
  /** What does not fit, the first that applies; undefined when everything does. */
  over?: "title" | "details" | "address";
}

/**
 * Weighs a draft before anything is asked of the person: the title and the details against their
 * caps, and what the address would show before `#` in this mode against `MAX_BEFORE_HASH`. The
 * shown part is packed exactly as the real address packs it (the same statements with a stand-in
 * inbox key and salt of the same sizes), so the count differs from the real one only by the
 * Hand's number, which is counted at its longest.
 */
export function weigh(draft: { title: string; content: string; mode: "public" | "unlisted" | "dark" }, where: { site: string; chainId: number; core: Address; options: LinkOptions }): Weighed {
  const title = lengthOf(draft.title);
  const details = lengthOf(draft.content.trim());
  let beforeHash = where.site.length + 1;
  if (draft.mode !== "dark" && title > 0) {
    const content = draft.content.trim();
    const canonical = where.options.canonicalCore !== undefined && isAddressEqual(where.options.canonicalCore, where.core);
    const path = canonical ? `${where.chainId}/` : `${where.chainId}/${where.core}/`;
    let shown: number;
    try {
      const described = describeHand({ mode: draft.mode, title: draft.title, ...(content ? { content } : {}), inbox: pad("0x01", { size: 32 }) });
      shown = described.outside ? toText(packAttachments(described.outside)).length : 0;
    } catch (error) {
      // The SDK itself refuses a public description past its limit of `d` (E-7): it is counted at what it would take.
      if (!(error instanceof DescriptionTooLarge)) throw error;
      shown = error.bytes;
    }
    beforeHash += path.length + HAND_DIGITS + (shown > 0 ? "?d=".length + shown : 0);
  }
  const over = title > MAX_TITLE ? "title" : details > MAX_DETAILS ? "details" : beforeHash > MAX_BEFORE_HASH ? "address" : undefined;
  return { title, details, beforeHash, ...(over ? { over } : {}) };
}

/** The derived root key must be new on this device (ARCHITECTURE §5): equal to none it already used. */
export function assertNewRoot(rootKey: Address, known: readonly Address[]): void {
  if (known.some((key) => isAddressEqual(key, rootKey))) throw new Error("this device already raised a hand with this link key");
}

/**
 * The Hand's inbox key (`inbox.n1`) from its secret: the 32-byte x-only public key, as Nostr writes
 * it (packages/deliver's `publicKeyOf`, which the test compares). Computed with viem's curve here,
 * because the app's dev server cannot load nostr-tools from source (see the build note).
 */
export function inboxKeyOf(secret: Hex): Hex {
  return slice(privateKeyToAccount(secret).publicKey, 1, 33);
}

export interface Raised {
  hand: Hand;
  reward: bigint;
  expiry: number;
}

/**
 * The Hand this receipt raised: a `Raised` log Core wrote in this very transaction. With `by`, the
 * one this raiser raised (a wallet's batch can share its transaction with other accounts' calls),
 * and among those the one with this root key when there is one.
 */
export function raisedIn(receipt: Pick<TransactionReceipt, "logs">, core: Address, by: { raiser?: Address; rootKey?: Address } = {}): Raised {
  const found: Raised[] = [];
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, core)) continue;
    try {
      const event = decodeEventLog({ abi: CORE_ABI, data: log.data, topics: log.topics });
      if (event.eventName !== "Raised") continue;
      const { handId, raiser, token, reward, expiry, rootKey, payoutGasK, minClaimBps, dataHash } = event.args;
      if (by.raiser && !isAddressEqual(raiser, by.raiser)) continue;
      found.push({ hand: { handId, raiser, token, rootKey, payoutGasK, minClaimBps, dataHash }, reward, expiry });
    } catch {
      // another event of Core's: keep looking
    }
  }
  const raised = (by.rootKey && found.find((each) => isAddressEqual(each.hand.rootKey, by.rootKey!))) || found[0];
  if (!raised) throw new Error("this receipt holds no Raised event of this contract" + (by.raiser ? " by this account" : ""));
  return raised;
}

export interface WriteInput {
  site: string;
  chainId: number;
  core: Address;
  hand: Hand;
  /** The root key's seed: kept in memory only (or, for a signer that does not repeat, in the locked copy). */
  seed: Hex;
  described: Described;
  options: LinkOptions;
}

export interface Written {
  /** The address in the mode's shape: what the raiser sends. */
  address: string;
  shape: AddressShape;
  /** The QR's address: bare, everything inside, the link as digits. */
  qr: string;
  linkBytes: number;
  qrBytes: number;
  /** The words as a holder reads them from `address`. */
  description: ReadDescription;
}

/**
 * Writes the first link (no Shakes, with the pin that binds it to these terms) in the shape the
 * description asks for, reads it back as a holder will, and writes the bare QR form from what was
 * read. Throws if the link does not open as this Hand with its words: nothing unopenable is shown.
 */
export async function writeLinks(input: WriteInput): Promise<Written> {
  const { site, hand, seed, described, options } = input;
  const chain = domain(input.chainId, input.core);
  const outside = described.outside && packAttachments(described.outside);
  const link = await encodeLive({ domain: chain, hand, signedShakes: [], seed, attachments: described.inside }, { ...options, outside });
  const address = toAddress({ site, link, shape: described.shape, outside: described.outside }, options);

  const opened = await openAddress(address, async () => hand, options);
  const description = readDescription(opened);
  if (hand.dataHash !== zeroHash && description.status !== "attached") throw new Error("the link does not carry its words");

  const carry = carryFor(opened, "bare");
  const bare = await encodeLive({ domain: chain, hand, signedShakes: [], seed, attachments: carry.attachments }, options);
  const qr = toAddress({ site, link: bare, shape: "bare", form: "digits" }, options);
  return { address, shape: described.shape, qr, linkBytes: link.length, qrBytes: bare.length, description };
}
