/**
 * Delivery of a give link and of the short chat after it (ARCHITECTURE §8): NIP-17 gift wraps
 * (kind 14 → 13 → 1059, NIP-44 v2) to the Hand's `inbox.n1` key, over a configured list of relays.
 * The SDK stays free of Nostr; everything about it lives here.
 *
 * - `nostrTransport(relays)`: send an envelope, counting relays that answered OK true; listen for them.
 * - `openOutbox(transport, store)`: write down before sending, retry every 30 s, never drop silently.
 * - `newChatKey()`: the giver's random per-Give key (D-42), returned to the caller to keep.
 * - `wrapEnvelope` / `unwrapEnvelope`: the NIP-17 layers alone, with every check on the way in.
 *
 * Timestamps here are the machine's (Nostr's), never the chain's; nothing here reads a Hand's expiry.
 */

export type { Envelope, HandRef, Hex, ChatKey } from "./envelope.ts";
export { checkEnvelope, newChatKey, publicKeyOf } from "./envelope.ts";
export type { Opened } from "./wrap.ts";
export { GIFT_WRAP_KIND, MAX_WRAP_CHARS, RUMOR_KIND, SEAL_KIND, WRAP_BACKDATE, unwrapEnvelope, wrapEnvelope } from "./wrap.ts";
export type { Delivery, GiveTransport, Meta, Sent, TransportOptions } from "./transport.ts";
export { nostrTransport } from "./transport.ts";
export type { Outbox, OutboxEntry, OutboxOptions, OutboxStore } from "./outbox.ts";
export { openOutbox } from "./outbox.ts";
