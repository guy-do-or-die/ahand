/**
 * Which public relays to use, and when a message counts as delivered. The app's configuration names
 * the relays it actually uses; this package builds none in. What is here is the measured
 * recommendation that configuration starts from (docs/delivery.md has the same table).
 */

/**
 * Acknowledgements that make a message delivered: 2, or every relay when fewer are configured.
 *
 * Why 2. A reader asks every configured relay, so one copy is enough to be read; a second copy, on
 * a relay of another operator, is what keeps the message when one operator loses or drops what it
 * kept (public relays announce no retention, a well-known one keeps events only in memory, and a
 * large one has wiped its database before). And with relays of three or more operators, one that
 * is down or refuses does not hold "delivered" back. More than 2 would make "delivered" wait on the
 * slowest relays for little gain: the outbox keeps publishing the same wrap to the relays that have
 * not acknowledged yet, with growing pauses, after the message counts as delivered.
 */
export const DELIVERED_ACKS = 2;

/** The acknowledgements that count as delivered over `relays` relays, when `need` are asked for. Never below 1. */
export function acksNeeded(relays: number, need: number = DELIVERED_ACKS): number {
  if (!Number.isInteger(need) || need < 1) throw new Error("need: expected a whole number of at least 1");
  return Math.max(1, Math.min(need, relays));
}

/** What was measured about one public relay. */
export interface RelayNote {
  url: string;
  /**
   * Who runs it, by its NIP-11 document's operator key and its public listings. Relays that share an
   * operator key (or an address) count as one operator, however many domains they have.
   */
  operator: string;
  /** The network its address belongs to (by its autonomous system). */
  hosting: string;
  /** Relay program and version, as its NIP-11 document said. */
  software: string;
  /** Where it keeps events: `memory` loses them when it restarts. */
  storage: "disk" | "memory";
  /**
   * The longest message (a whole `EVENT` frame) its NIP-11 document allows, in bytes. A relay may
   * still refuse a smaller event: one announcing 131 072 refused an 87 769-byte event. A 2 000-byte
   * give link wraps to about 5 kB.
   */
  maxMessageBytes: number;
  /** Measured from one machine: publish (EVENT to OK) and read (REQ by `#p` to EOSE, on a new connection), ms. */
  publishMs: number;
  readMs: number;
  /** Anything else a configuration should know. */
  notes: string;
}

/**
 * Five public relays of five operators, on three hosting networks, in two relay programs; all keep
 * events on disk, none asks for authentication. Measured from one machine on 2026-11-22 with what
 * delivery sends: one NIP-17 gift wrap (kind 1059, 4 605 bytes, back-dated up to two days as NIP-59
 * does, random payload, to a fresh recipient key) published to each anonymously, then read back on
 * a new connection by `ids` and by `{kinds: [1059], "#p": [recipient]}` (the listener's filter),
 * opened, and its payload compared: intact everywhere, and again 5 minutes later. With five, losing
 * any two still leaves three operators. Provisional until the retention checks at one day and one
 * week: a relay that loses a probe there leaves the list. Not measured: per-IP daily limits.
 *
 * Spares that passed the same measurement: wss://nostr.data.haus, wss://relay.angor.io,
 * wss://nostr.azzamo.net, wss://relay.nostr.wirednet.jp. wss://nostr.mom passed too but is run by
 * the operator of nos.lol (the same NIP-11 key and address), so it adds no second operator.
 */
export const RECOMMENDED_RELAYS: readonly RelayNote[] = [
  {
    url: "wss://relay.primal.net",
    operator: "Primal",
    hosting: "Cloudflare",
    software: "strfry 1.1.3",
    storage: "disk",
    maxMessageBytes: 1_000_000,
    publishMs: 185,
    readMs: 102,
    notes: "at most 20 subscriptions per connection; took a 262 144-byte test event on 2026-11-21",
  },
  {
    url: "wss://nos.lol",
    operator: "nos.lol (NIP-11 key c5fadeb5…, which also runs nostr.mom)",
    hosting: "Hetzner",
    software: "strfry 1.1.3",
    storage: "disk",
    maxMessageBytes: 131_072,
    publishMs: 191,
    readMs: 92,
    notes: "refused an 87 769-byte test event as too large on 2026-11-21 (16 384 bytes passed)",
  },
  {
    url: "wss://relay.nos.social",
    operator: "Nos",
    hosting: "DigitalOcean",
    software: "strfry 1.0.3",
    storage: "disk",
    maxMessageBytes: 262_144,
    publishMs: 191,
    readMs: 191,
    notes: "",
  },
  {
    url: "wss://relay.ditto.pub",
    operator: "Soapbox",
    hosting: "Cloudflare",
    software: "ditto-relay 2.5.1",
    storage: "disk",
    maxMessageBytes: 4_000_000,
    publishMs: 387,
    readMs: 206,
    notes: "the one relay program here other than strfry, so one strfry fault or policy change cannot take out every relay",
  },
  {
    url: "wss://relay.coinos.io",
    operator: "Coinos",
    hosting: "Cloudflare",
    software: "strfry 1.1.0-beta5",
    storage: "disk",
    maxMessageBytes: 2_097_152,
    publishMs: 378,
    readMs: 294,
    notes: "",
  },
];

/** Relays measured and found unable to carry this delivery, with why (2026-11-22 unless said otherwise). */
export const UNSUITABLE_RELAYS: readonly { url: string; why: string }[] = [
  {
    url: "wss://relay.damus.io",
    why: "refuses WebSocket connections from non-browser clients (HTTP 503 on every upgrade); from a browser it accepted a gift wrap, but reading it back by id or by #p needs NIP-42 authentication, which it refuses even when signed by the recipient key (\"relay needs serviceUrl to be configured before AUTH can work\"), so it serves gift wraps to nobody",
  },
  {
    url: "wss://relay.nostr.net",
    why: "accepts gift wraps, but reading them back needs NIP-42 authentication, which it refuses with the same message as relay.damus.io",
  },
  {
    url: "wss://relay.snort.social",
    why: "keeps events in memory (memlay): the gift wrap read back at once was gone 5 minutes later",
  },
  {
    url: "wss://relay.fountain.fm",
    why: "accepts gift wraps, but a read of kind 1059 is answered \"kinds not supported\"",
  },
  {
    url: "wss://relay.noswhere.com",
    why: "accepts gift wraps and never serves them back, by id or by #p",
  },
  {
    url: "wss://auth.nostr1.com",
    why: "takes and serves gift wraps only after NIP-42 authentication, on publishing and on reading; this package would authenticate, but each read would prove possession of the inbox key to the relay, and none of the recommended relays asks for that",
  },
];
