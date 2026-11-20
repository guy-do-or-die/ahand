import {
  CORE_ABI,
  carryFor,
  domain,
  encodeLive,
  expiryAfter,
  openAddress,
  packAttachments,
  passesLeft,
  readDescription,
  toAddress,
  type AddressShape,
  type Described,
  type Hand,
  type LinkOptions,
  type ReadDescription,
} from "@ahand/sdk";
import { decodeEventLog, isAddressEqual, slice, zeroAddress, zeroHash, type Address, type Hex, type TransactionReceipt } from "viem";
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

/** The Hand this receipt raised: the `Raised` log Core wrote in this very transaction. */
export function raisedIn(receipt: Pick<TransactionReceipt, "logs">, core: Address): Raised {
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, core)) continue;
    try {
      const event = decodeEventLog({ abi: CORE_ABI, data: log.data, topics: log.topics });
      if (event.eventName !== "Raised") continue;
      const { handId, raiser, token, reward, expiry, rootKey, payoutGasK, minClaimBps, dataHash } = event.args;
      return { hand: { handId, raiser, token, rootKey, payoutGasK, minClaimBps, dataHash }, reward, expiry };
    } catch {
      // another event of Core's: keep looking
    }
  }
  throw new Error("this receipt holds no Raised event of this contract");
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
