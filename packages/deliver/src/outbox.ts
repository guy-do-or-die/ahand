/**
 * The giver's outbox: every envelope is written down before it is sent, and stays written down.
 * Undelivered ones are retried every 30 seconds while the outbox is open. Nothing is dropped unless
 * the caller forgets it by id. The entry also keeps the chat key, so the thread survives a reload (D-42).
 */
import { checkEnvelope, newChatKey, prefixed, publicKeyOf, type Envelope, type Hex } from "./envelope.ts";
import type { GiveTransport } from "./transport.ts";

/** The small key-value store the outbox lives in: a Map in tests, IndexedDB in the app. */
export interface OutboxStore {
  get(key: string): OutboxEntry | undefined | Promise<OutboxEntry | undefined>;
  set(key: string, value: OutboxEntry): unknown;
  delete(key: string): unknown;
  keys(): Iterable<string> | Promise<Iterable<string>>;
}

/** One envelope on its way. Plain data, so IndexedDB can clone it. */
export interface OutboxEntry {
  /** The outbox's own id for this entry (not secret, not the message id). */
  key: string;
  to: Hex;
  envelope: Envelope;
  /** The chat key's secret. Not a link key: it can sign no Shake and no Give. */
  chatKey: Hex;
  /** The message's time (seconds, this machine's clock); every retry reuses it, so the message id stays. */
  at: number;
  /** The message id (the rumor's), known after the first attempt. */
  id?: string;
  /** Best acknowledgement count seen so far, of how many relays. */
  acks: number;
  of: number;
  tries: number;
  lastTry?: number;
  deliveredAt?: number;
  /** Why the last attempt could not even be made (for example an envelope too large for a relay). */
  error?: string;
}

export interface OutboxOptions {
  /** Pause between retry rounds while open. Default 30 000 ms. */
  everyMs?: number;
  /** Acknowledgements that count as delivered. Default 1. */
  need?: number;
  /** Called after every change of an entry. */
  onChange?: (entry: OutboxEntry) => void;
  /** The machine's clock in milliseconds; Date.now by default. */
  now?: () => number;
}

export interface Outbox {
  /**
   * Writes `envelope` down for `to`, then tries it once. Without `chatKey` a new one is made and kept
   * in the entry. A missing `replyTo` is filled with the chat key's public key. A malformed envelope is
   * refused (rejects) before anything is written.
   */
  send(to: Hex, envelope: Envelope | Omit<Envelope, "replyTo">, chatKey?: Hex): Promise<OutboxEntry>;
  /** Tries every undelivered entry now; resolves with the entries after the round. */
  flush(): Promise<OutboxEntry[]>;
  list(): Promise<OutboxEntry[]>;
  /** Removes one entry. The only way an entry leaves the outbox. */
  forget(key: string): Promise<void>;
  /** Stops the retry timer. The store keeps everything. */
  close(): void;
}

const delivered = (e: OutboxEntry, need: number) => e.acks >= need;

/** Opens an outbox over `store`, sending through `transport`, and starts its retry timer. */
export function openOutbox(transport: GiveTransport, store: OutboxStore, options: OutboxOptions = {}): Outbox {
  const everyMs = options.everyMs ?? 30_000;
  const need = options.need ?? 1;
  const now = options.now ?? Date.now;
  const inFlight = new Map<string, Promise<OutboxEntry>>();
  let open = true;

  const save = async (entry: OutboxEntry) => {
    await store.set(entry.key, entry);
    options.onChange?.(entry);
    return entry;
  };

  const attempt = (entry: OutboxEntry): Promise<OutboxEntry> => {
    const running = inFlight.get(entry.key);
    if (running) return running;
    const run = (async () => {
      const next: OutboxEntry = { ...entry, tries: entry.tries + 1, lastTry: Math.floor(now() / 1000) };
      try {
        const sent = await transport.send(entry.to, entry.envelope, entry.chatKey, entry.at);
        next.id = sent.id;
        next.of = sent.of;
        next.acks = Math.max(entry.acks, sent.acks);
        delete next.error;
        if (delivered(next, need) && next.deliveredAt === undefined) next.deliveredAt = next.lastTry;
      } catch (err) {
        next.error = err instanceof Error ? err.message : String(err);
      }
      // The entry may have been forgotten meanwhile; do not bring it back.
      if ((await store.get(entry.key)) === undefined) return next;
      return save(next);
    })().finally(() => inFlight.delete(entry.key));
    inFlight.set(entry.key, run);
    return run;
  };

  const list = async () => {
    const out: OutboxEntry[] = [];
    for (const key of await store.keys()) {
      const entry = await store.get(key);
      if (entry) out.push(entry);
    }
    return out.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  };

  const flush = async () => {
    const entries = await list();
    return Promise.all(entries.map((e) => (delivered(e, need) ? e : attempt(e))));
  };

  const timer = setInterval(() => {
    if (open) void flush();
  }, everyMs);
  void flush();

  return {
    async send(to, envelope, chatKey) {
      const key = chatKey ? prefixed(chatKey) : newChatKey().secret;
      const pub = publicKeyOf(key);
      // Refuse what could never be sent before writing it down, so the outbox holds only real messages.
      const full = checkEnvelope({ ...envelope, replyTo: (envelope as Envelope).replyTo ?? pub });
      if (full.replyTo !== pub) throw new Error("envelope: replyTo must be the sender's own chat key");
      const entry: OutboxEntry = {
        key: crypto.randomUUID(),
        to: prefixed(to),
        envelope: full,
        chatKey: key,
        at: Math.floor(now() / 1000),
        acks: 0,
        of: 0,
        tries: 0,
      };
      await save(entry);
      return attempt(entry);
    },
    flush,
    list,
    async forget(key) {
      await store.delete(key);
    },
    close() {
      open = false;
      clearInterval(timer);
    },
  };
}
