import { BPS, normalizeText, unwrap6492 } from "@ahand/sdk";
import { size, type Address, type Hex } from "viem";

/**
 * The give screen's small rules, pure so they are tested without a browser (flow.test.ts).
 * The words travel by message and never into the Give; delivery is judged from the outbox's own
 * entry; a reply in the thread counts only when it comes from the Hand's inbox key.
 */

/** The longest answer a giver types: a few paragraphs, far below what one gift wrap carries. */
export const MAX_WORDS = 1000;

/** What the giver typed, as it travels: NFC, LF line ends, no white space around, at most MAX_WORDS. */
export function wordsOf(input: string): string {
  return Array.from(normalizeText(input).trim()).slice(0, MAX_WORDS).join("");
}

/** The claim in money: what Core would pay at this place on the route, rounded down as Core does. */
export function claimAmount(reward: bigint, claimBps: number): bigint {
  return (reward * BigInt(claimBps)) / BigInt(BPS);
}

/** What "Share" sends: the words, then the address alone on its own line, so no full stop can join it. */
export function shareText(words: string, address: string): string {
  return words ? `${words}\n\n${address}\n` : `${address}\n`;
}

export type DeliveryState = "sending" | "delivered" | "fallback";

/**
 * Where the delivery of a give stands. With no inbox in the Hand's description or no relay in
 * the configuration there is nobody to deliver to: the fallback at once. Otherwise one relay's
 * acknowledgement is "delivered" (ARCHITECTURE §8); a try that none acknowledged is the fallback,
 * while the outbox keeps retrying.
 */
export function deliveryState(inbox: string | undefined, relays: number, entry: { acks: number; of: number; tries: number } | undefined): DeliveryState {
  if (!inbox || relays === 0) return "fallback";
  if (!entry || entry.tries === 0) return "sending";
  if (entry.acks >= 1) return "delivered";
  return "fallback";
}

/** A message in the thread is the asker's only when its sender is the Hand's own inbox key. */
export function fromInbox(from: Hex, inbox: Hex | undefined): boolean {
  if (!inbox) return false;
  const bare = (key: string) => key.replace(/^0x/i, "").toLowerCase();
  return bare(from) === bare(inbox);
}

export type SignatureKind = { kind: "key" } | { kind: "wrapped"; factory: Address; bytes: number } | { kind: "code"; bytes: number };

/** What kind of confirmation the giver's answer carries, for the lens. */
export function signatureKind(signature: Hex): SignatureKind {
  const wrapped = unwrap6492(signature);
  if (wrapped) return { kind: "wrapped", factory: wrapped.factory, bytes: size(signature) };
  return size(signature) === 65 ? { kind: "key" } : { kind: "code", bytes: size(signature) };
}

/**
 * The optional "Keep this answer's key" file (D-22): the one-time key that confirmed this answer,
 * handed to the person as a download. The app never keeps it; this text exists only on its way
 * into the file.
 */
export function keyFileOf(k: { address: Address; privateKey: Hex; chainId: number; core: Address; handId: bigint }): string {
  return `${JSON.stringify(
    {
      note:
        "The key that confirmed your aHand answer. Whoever holds this file can act as that address: keep it like any other key. Future receipts would belong to it. Any app that imports a private key opens it.",
      address: k.address,
      privateKey: k.privateKey,
      hand: { chainId: k.chainId, core: k.core, handId: k.handId.toString() },
    },
    null,
    2,
  )}\n`;
}
