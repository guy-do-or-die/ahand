/**
 * Delivery of a give link and of the short chat after it (ARCHITECTURE §8): NIP-17 gift wraps
 * (kind 14 → 13 → 1059, NIP-44 v2) to the Hand's `inbox.n1` key, over a configured list of relays.
 * The SDK stays free of Nostr; everything about it lives here.
 *
 * Wave 1 stub: these types are the contract between packages. The module `deliver-relay` writes
 * `nostrTransport` and the outbox in wave 2.
 */

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
  /** The x-only public key that answers reach: the sender's per-Give chat key. */
  replyTo: Hex;
}

/** How many relays acknowledged (answered OK true), of how many were asked. */
export interface Delivery {
  acks: number;
  of: number;
}

export interface GiveTransport {
  /** Wraps `envelope` to the 32-byte x-only key `to`, signed by `from` (a chat key, never a link key). */
  send(to: Hex, envelope: Envelope, from: Hex): Promise<Delivery>;
  /** Unwraps what arrives for `secret`'s key since `since` (seconds); returns an unsubscribe. */
  listen(secret: Hex, onEnvelope: (envelope: Envelope, from: Hex) => void, since?: number): () => void;
}

/** A transport over these relays (ws:// or wss:// URLs). */
export function nostrTransport(_relays: string[]): GiveTransport {
  throw new Error("nostrTransport: not built");
}
