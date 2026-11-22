/**
 * The envelope a gift wrap carries, the keys that address it, and the checks a received one must pass.
 * Nothing here touches the network.
 */
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

export type Hex = `0x${string}`;

/** Which Hand a message is about. */
export interface HandRef {
  chainId: number;
  core: Hex;
  handId: string;
}

/** What travels inside a gift wrap. A give link holds no secret by format. */
export interface Envelope {
  v: 1;
  kind: "give" | "note";
  hand: HandRef;
  giveLink?: string;
  text?: string;
  /** The x-only public key that answers reach: the sender's own chat key (checked on arrival). */
  replyTo: Hex;
}

/** A chat key: the secret that signs and reads one thread, and its x-only public key. */
export interface ChatKey {
  secret: Hex;
  pub: Hex;
}

const HEX32 = /^(0x)?[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HAND_ID = /^[0-9]{1,78}$/;

/** A 32-byte key as Nostr writes it: 64 lowercase hex digits, no prefix. Throws on anything else. */
export function bare(key: string, what = "key"): string {
  if (typeof key !== "string" || !HEX32.test(key)) throw new Error(`${what}: expected 32 bytes of hex`);
  return key.replace(/^0x/, "").toLowerCase();
}

export function prefixed(key: string): Hex {
  return `0x${bare(key)}`;
}

export function secretBytes(secret: string): Uint8Array {
  return hexToBytes(bare(secret, "secret"));
}

/** A fresh random chat key: a new one per Give for the giver; it can sign no Shake and no Give. */
export function newChatKey(): ChatKey {
  const sk = generateSecretKey();
  return { secret: `0x${bytesToHex(sk)}`, pub: `0x${getPublicKey(sk)}` };
}

/** The x-only public key of a secret, 0x-prefixed. */
export function publicKeyOf(secret: string): Hex {
  return `0x${getPublicKey(secretBytes(secret))}`;
}

/**
 * Whether two references name the same Hand: the same chain, the same Core (any letter case) and
 * the same Hand id (as a number, so "07" is 7). A reader checks a received envelope's `hand`
 * against the Hand it is waiting on: the sender chose that field, nothing else binds it.
 */
export function sameHand(a: HandRef, b: HandRef): boolean {
  if (a.chainId !== b.chainId || a.core.toLowerCase() !== b.core.toLowerCase()) return false;
  try {
    return BigInt(a.handId) === BigInt(b.handId);
  } catch {
    return false;
  }
}

/**
 * Returns a clean copy of `value` if it is a well-formed envelope, or throws saying what is wrong.
 * Unknown fields are dropped, so what reaches the app is exactly the documented shape.
 */
export function checkEnvelope(value: unknown): Envelope {
  const e = value as Partial<Envelope> | null;
  if (!e || typeof e !== "object") throw new Error("envelope: not an object");
  if (e.v !== 1) throw new Error("envelope: unknown version");
  if (e.kind !== "give" && e.kind !== "note") throw new Error("envelope: unknown kind");
  const h = e.hand as Partial<HandRef> | undefined;
  if (!h || typeof h !== "object") throw new Error("envelope: no hand");
  if (!Number.isSafeInteger(h.chainId) || (h.chainId as number) <= 0) throw new Error("envelope: bad chainId");
  if (typeof h.core !== "string" || !ADDRESS.test(h.core)) throw new Error("envelope: bad core");
  if (typeof h.handId !== "string" || !HAND_ID.test(h.handId)) throw new Error("envelope: bad handId");
  if (e.giveLink !== undefined && typeof e.giveLink !== "string") throw new Error("envelope: bad giveLink");
  if (e.text !== undefined && typeof e.text !== "string") throw new Error("envelope: bad text");
  if (e.kind === "give" && !e.giveLink) throw new Error("envelope: a give carries a give link");
  if (e.kind === "note" && !e.text) throw new Error("envelope: a note carries text");
  if (typeof e.replyTo !== "string" || !HEX32.test(e.replyTo)) throw new Error("envelope: bad replyTo");
  const out: Envelope = {
    v: 1,
    kind: e.kind,
    hand: { chainId: h.chainId as number, core: h.core as Hex, handId: h.handId },
    replyTo: prefixed(e.replyTo),
  };
  if (e.giveLink !== undefined) out.giveLink = e.giveLink;
  if (e.text !== undefined) out.text = e.text;
  return out;
}
