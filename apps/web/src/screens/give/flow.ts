import { acksNeeded } from "@ahand/deliver/relays";
import { BPS, normalizeText, unwrapErc6492 } from "@ahand/sdk";
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

/**
 * The claim in money: the least Core pays the giver at this place on the route, ⌈reward ×
 * claimBps / 10 000⌉. Core rounds each passer's margin down (`Math.mulDiv`, AHandCore
 * `_payShakers`) and pays the giver what is left, so the margins' dust goes to the giver: with one
 * pass the giver gets exactly this, with more never less.
 */
export function claimAmount(reward: bigint, claimBps: number): bigint {
  return (reward * BigInt(claimBps) + BigInt(BPS) - 1n) / BigInt(BPS);
}

/**
 * The claim as the screen writes it: "$28" or "$0.80" when it is whole cents (the kit's `money`),
 * else every digit, "$0.000001", so a claim below a cent never reads "$0" or "under $0.01" next to
 * "at least". `money` is the kit's formatter, passed in to keep this file pure.
 */
export function claimText(amount: bigint, decimals: number, lang: "en" | "ru", money: (amount: bigint, decimals: number, lang: "en" | "ru") => string): string {
  const centUnit = decimals >= 2 ? 10n ** BigInt(decimals - 2) : 1n;
  if (amount % centUnit === 0n) return money(amount, decimals, lang);
  const unit = 10n ** BigInt(decimals);
  const whole = new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-GB", { maximumFractionDigits: 0 }).format(amount / unit);
  const fraction = (amount % unit).toString().padStart(decimals, "0").replace(/0+$/, "").padEnd(2, "0");
  return `$${whole}${lang === "ru" ? "," : "."}${fraction}`;
}

/** What "Share" sends: the words, then the address alone on its own line, so no full stop can join it. */
export function shareText(words: string, address: string): string {
  return words ? `${words}\n\n${address}\n` : `${address}\n`;
}

/**
 * Whether the wallet is on the app's network before the giver is asked to confirm:
 * true at once when it is, else the switch's own answer. A wallet that will not switch stops the
 * answer before anything is asked or sent.
 */
export async function onAppChain(current: number | undefined, wanted: number, switchTo: () => Promise<boolean>): Promise<boolean> {
  if (current === wanted) return true;
  return switchTo();
}

export type DeliveryState = "sending" | "delivered" | "fallback";

/**
 * Where the delivery of a give stands, by the outbox's own rule (@ahand/deliver `acksNeeded`: two
 * relays, or every relay when fewer are configured). With no inbox in the Hand's description or no
 * relay in the configuration there is nobody to deliver to: the fallback at once. Enough
 * acknowledgements are "delivered"; fewer but at least one is still "sending" while the outbox has a
 * relay left to try, and "delivered" once none is left (one copy can be read); a try that none
 * acknowledged is the fallback, while the outbox keeps retrying.
 */
export function deliveryState(
  inbox: string | undefined,
  relays: number,
  entry: { acks: number; of: number; tries: number; nextTryMs?: number } | undefined,
): DeliveryState {
  if (!inbox || relays === 0) return "fallback";
  if (!entry || entry.tries === 0) return "sending";
  if (entry.acks >= acksNeeded(entry.of)) return "delivered";
  if (entry.acks >= 1) return entry.nextTryMs === undefined ? "delivered" : "sending";
  return "fallback";
}

/**
 * Whether one of the giver's own lines in the thread still waits to be delivered: until
 * `deliveryState` says "delivered", the same rule as the give's own status, so a line one relay took
 * while the outbox still tries the others reads as waiting, as the give does.
 */
export function awaitsDelivery(
  inbox: string | undefined,
  relays: number,
  entry: { acks: number; of: number; tries: number; nextTryMs?: number } | undefined,
): boolean {
  return deliveryState(inbox, relays, entry) !== "delivered";
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
  const wrapped = unwrapErc6492(signature);
  if (wrapped) return { kind: "wrapped", factory: wrapped.factory, bytes: size(signature) };
  return size(signature) === 65 ? { kind: "key" } : { kind: "code", bytes: size(signature) };
}

/**
 * The optional "Keep this answer's key" file: the one-time key that confirmed this answer,
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
