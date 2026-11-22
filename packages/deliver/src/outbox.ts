/**
 * The giver's outbox: every envelope is written down before it is sent, and stays written down.
 *
 * The gift wrap is made once, on the first attempt, kept in the entry, and republished unchanged
 * on every retry, only to the relays that have not acknowledged it and have not refused it for
 * good (`isFinalRefusal`). Retries wait `retryMs` after the first attempt, then twice as long each
 * time, up to `maxRetryMs`, while the outbox is open. An entry counts as delivered once
 * `acksNeeded(relays, need)` relays acknowledged it (`DELIVERED_ACKS`, 2 by default); the rest are
 * still tried for `restMs` after that moment (`deliveredAt`). Nothing is dropped unless the caller forgets it by id. The
 * entry also keeps the chat key, so the thread survives a reload (a random key per Give).
 */
import type { NostrEvent } from "nostr-tools/pure";
import { checkEnvelope, newChatKey, prefixed, publicKeyOf, type Envelope, type Hex } from "./envelope.ts";
import { DELIVERED_ACKS, acksNeeded } from "./relays.ts";
import { isFinalRefusal, type GiveTransport } from "./transport.ts";

/** The small key-value store the outbox lives in: a Map in tests, IndexedDB in the app. */
export interface OutboxStore {
  get(key: string): OutboxEntry | undefined | Promise<OutboxEntry | undefined>;
  set(key: string, value: OutboxEntry): unknown;
  delete(key: string): unknown;
  keys(): Iterable<string> | Promise<Iterable<string>>;
}

/** One relay's last answer about an entry. */
export interface RelayMark {
  ok: boolean;
  /** The relay's reason, or the transport's (`timeout:`, `unreachable:`, `closed:`). */
  reason: string;
  /** A refusal that would repeat: the relay is not tried again for this entry. */
  final: boolean;
}

/** One envelope on its way. Plain data, so IndexedDB can clone it. */
export interface OutboxEntry {
  /** The outbox's own id for this entry (not secret, not the message id). */
  key: string;
  to: Hex;
  envelope: Envelope;
  /** The chat key's secret. Not a link key: it can sign no Shake and no Give. */
  chatKey: Hex;
  /** The message's time (seconds, this machine's clock). */
  at: number;
  /** The message id (the rumor's), known after the first attempt. */
  id?: string;
  /** The gift wrap (plain event fields), made on the first attempt and republished unchanged on every retry. */
  wrap?: NostrEvent;
  /** Each relay's last answer, by URL. */
  relays: Record<string, RelayMark>;
  /** Relays that acknowledged, of how many (the configured ones and any that answered before). */
  acks: number;
  of: number;
  tries: number;
  /** Seconds, this machine's clock. */
  lastTry?: number;
  /** When the next retry is due (milliseconds, this machine's clock); none when nothing is left to try. */
  nextTryMs?: number;
  /** Seconds, this machine's clock: when the entry first counted as delivered. */
  deliveredAt?: number;
  /** Why the last attempt could not be made, or why no relay is left to try. */
  error?: string;
}

export interface OutboxOptions {
  /** Acknowledgements that count as delivered (capped at the number of relays). Default `DELIVERED_ACKS` (2). */
  need?: number;
  /** The pause after the first attempt; each later pause doubles. Default 10 000 ms. */
  retryMs?: number;
  /** The longest pause between attempts. Default 600 000 ms (10 minutes). */
  maxRetryMs?: number;
  /** How long after the entry first counted as delivered (`deliveredAt`) the relays that have not acknowledged are still tried. Default one day. */
  restMs?: number;
  /** How often the outbox looks for retries that are due. Default 1 000 ms. */
  tickMs?: number;
  /** Called after every change of an entry. */
  onChange?: (entry: OutboxEntry) => void;
  /** Called when a background round fails (the store threw, for example). Default: console.warn. */
  onError?: (error: unknown) => void;
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
  /**
   * Tries every entry with a relay left to try, now, without waiting for its pause; resolves with
   * every entry after the round. An entry whose attempt is already running is tried once more after
   * it, so a flush when the network comes back is a fresh try, not that older attempt's result.
   */
  flush(): Promise<OutboxEntry[]>;
  list(): Promise<OutboxEntry[]>;
  /** Whether an entry counts as delivered under this outbox's rule. */
  isDelivered(entry: OutboxEntry): boolean;
  /** Removes one entry. The only way an entry leaves the outbox. */
  forget(key: string): Promise<void>;
  /** Stops the retry timer. The store keeps everything. */
  close(): void;
}

/** Opens an outbox over `store`, sending through `transport`, tries what is left, and starts its retry timer. */
export function openOutbox(transport: GiveTransport, store: OutboxStore, options: OutboxOptions = {}): Outbox {
  const need = options.need ?? DELIVERED_ACKS;
  acksNeeded(1, need); // refuses a need below 1 now, not at the first send
  const retryMs = options.retryMs ?? 10_000;
  const maxRetryMs = options.maxRetryMs ?? 600_000;
  const restMs = options.restMs ?? 24 * 60 * 60 * 1000;
  const tickMs = options.tickMs ?? 1000;
  const now = options.now ?? Date.now;
  const onError = options.onError ?? ((error: unknown) => console.warn("outbox:", error));
  const inFlight = new Map<string, Promise<OutboxEntry | undefined>>();
  /** A fresh attempt queued behind the running one, per entry (one at most: later flushes share it). */
  const queued = new Map<string, Promise<OutboxEntry | undefined>>();
  let open = true;

  const isDelivered = (e: OutboxEntry) => e.acks >= acksNeeded(e.of, need);

  /** Relays still worth a try for this entry: configured, not acknowledged, not refused for good. */
  const left = (e: OutboxEntry): string[] => {
    if (isDelivered(e) && now() > (e.deliveredAt ?? e.at) * 1000 + restMs) return [];
    return transport.relays.filter((url) => {
      const mark = e.relays?.[url];
      return !mark || (!mark.ok && !mark.final);
    });
  };

  const save = async (entry: OutboxEntry) => {
    await store.set(entry.key, entry);
    options.onChange?.(entry);
    return entry;
  };

  /**
   * One attempt for one entry. Attempts on an entry run one at a time, and each starts from what
   * the store holds then, so a round that listed the entry earlier cannot write back an older state.
   * While one runs, a plain call shares it; a `fresh` one (a flush) gets a new attempt after it.
   */
  const attempt = (key: string, fresh = false): Promise<OutboxEntry | undefined> => {
    const running = inFlight.get(key);
    if (running && fresh) {
      let next = queued.get(key);
      if (!next) {
        next = running.then(() => attempt(key)).finally(() => queued.delete(key));
        queued.set(key, next);
      }
      return next;
    }
    if (running) return running;
    const run = (async () => {
      const entry = await store.get(key);
      if (!entry) return undefined;
      const targets = left(entry);
      if (targets.length === 0) return entry;
      const next: OutboxEntry = { ...entry, relays: { ...entry.relays }, tries: entry.tries + 1, lastTry: Math.floor(now() / 1000) };
      try {
        if (!next.wrap) {
          const made = transport.wrap(next.to, next.envelope, next.chatKey, next.at);
          next.wrap = made.wrap;
          next.id = made.id;
        }
        for (const answer of await transport.publish(next.wrap, targets)) {
          next.relays[answer.url] = { ok: answer.ok, reason: answer.reason, final: !answer.ok && isFinalRefusal(answer.reason) };
        }
        delete next.error;
      } catch (err) {
        next.error = err instanceof Error ? err.message : String(err);
      }
      const marks = Object.entries(next.relays);
      next.acks = marks.filter(([, mark]) => mark.ok).length;
      next.of = new Set([...transport.relays, ...marks.map(([url]) => url)]).size;
      if (isDelivered(next) && next.deliveredAt === undefined) next.deliveredAt = next.lastTry;
      if (left(next).length > 0) {
        next.nextTryMs = now() + Math.min(retryMs * 2 ** Math.min(next.tries - 1, 30), maxRetryMs);
      } else {
        delete next.nextTryMs;
        if (!isDelivered(next) && next.error === undefined) {
          const refused = marks.filter(([, mark]) => !mark.ok).map(([url, mark]) => `${url} (${mark.reason})`).join(", ");
          next.error =
            next.acks === 0
              ? `refused by every relay: ${refused}`
              : `acknowledged by ${next.acks} of ${next.of}, ${acksNeeded(next.of, need)} needed; the others refused for good: ${refused}`;
        }
      }
      // The entry may have been forgotten meanwhile; do not bring it back.
      if ((await store.get(key)) === undefined) return undefined;
      return save(next);
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, run);
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

  /**
   * Tries the entries that have a relay left, all of them or only those whose pause is over. A
   * `fresh` round (a flush) does not settle for an attempt already running; the others share it.
   */
  const round = async (dueOnly: boolean, fresh = false) => {
    const entries = await list();
    const after = await Promise.all(
      entries.map(async (e) => {
        if (left(e).length === 0 || (dueOnly && e.nextTryMs !== undefined && e.nextTryMs > now())) return e;
        return (await attempt(e.key, fresh)) ?? e;
      }),
    );
    return after;
  };

  let ticking = false;
  const tick = () => {
    if (!open || ticking) return;
    ticking = true;
    round(true)
      .catch(onError)
      .finally(() => {
        ticking = false;
      });
  };
  const timer = setInterval(tick, tickMs);
  round(false).catch(onError);

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
        relays: {},
        acks: 0,
        of: transport.relays.length,
        tries: 0,
      };
      await save(entry);
      return (await attempt(entry.key)) ?? entry;
    },
    flush: () => round(false, true),
    list,
    isDelivered,
    async forget(key) {
      await store.delete(key);
    },
    close() {
      open = false;
      clearInterval(timer);
    },
  };
}
