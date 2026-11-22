/**
 * Delivery of a give link and of the short thread after it (docs/delivery.md): NIP-17 gift wraps
 * (kind 14 → 13 → 1059, NIP-44 v2) to the Hand's `inbox.n1` key, over a configured list of relays.
 * The SDK stays free of Nostr; everything about it lives here.
 *
 * - `nostrTransport(relays)`: wrap and publish an envelope, with each relay's answer; listen for them.
 * - `openOutbox(transport, store)`: write down before sending, republish the same wrap with growing
 *   pauses, count it delivered at `DELIVERED_ACKS` relays, never drop silently.
 * - `RECOMMENDED_RELAYS`: the measured public relays a configuration starts from.
 * - `newChatKey()`: the giver's random per-Give key, returned to the caller to keep.
 * - `wrapEnvelope` / `unwrapEnvelope`: the NIP-17 layers alone, with every check on the way in.
 *
 * Timestamps here are the machine's (Nostr's), never the chain's; nothing here reads a Hand's expiry.
 */

export type { Envelope, HandRef, Hex, ChatKey } from "./envelope.ts";
export { checkEnvelope, newChatKey, publicKeyOf, sameHand } from "./envelope.ts";
export type { Opened } from "./wrap.ts";
export { GIFT_WRAP_KIND, MAX_WRAP_CHARS, RUMOR_KIND, SEAL_KIND, WRAP_BACKDATE, unwrapEnvelope, verifiedWrap, wrapEnvelope } from "./wrap.ts";
export type { Delivery, GiveTransport, ListenOptions, Meta, RelayAnswer, RelayRead, Sent, TransportOptions, Wrapped } from "./transport.ts";
export { CLOCK_MARGIN, MAX_CHALLENGE_CHARS, isFinalRefusal, nostrTransport, reasonPrefix } from "./transport.ts";
export type { RelayNote } from "./relays.ts";
export { DELIVERED_ACKS, RECOMMENDED_RELAYS, UNSUITABLE_RELAYS, acksNeeded } from "./relays.ts";
export type { Outbox, OutboxEntry, OutboxOptions, OutboxStore, RelayMark } from "./outbox.ts";
export { openOutbox } from "./outbox.ts";
