/**
 * The carrier: gift wraps published to, and read from, a configured list of relays (NIP-01 over
 * WebSocket). No relay is built in; the caller names every one.
 */
import type { NostrEvent } from "nostr-tools/pure";
import { bare, newChatKey, prefixed, publicKeyOf, type Envelope, type Hex } from "./envelope.ts";
import { GIFT_WRAP_KIND, WRAP_BACKDATE, unwrapEnvelope, wrapEnvelope } from "./wrap.ts";

/** How many relays acknowledged (answered OK true), of how many were asked. */
export interface Delivery {
  acks: number;
  of: number;
}

/** A send's result: the acknowledgements, the chat key that signed (keep it to read answers), the message id. */
export interface Sent extends Delivery {
  key: Hex;
  id: string;
}

/** What a listener learns besides the envelope: the rumor's id (one per message, retries included) and time. */
export interface Meta {
  id: string;
  at: number;
}

export interface GiveTransport {
  /**
   * Wraps `envelope` to the 32-byte x-only key `to` and publishes it to every relay. `from` is the
   * chat key's secret; without one a new random key is made, and returned in `key` for the caller to
   * keep. The envelope's `replyTo` must be that key's public key; it may be left empty when the key
   * is new, and is then filled in. `at` (seconds) fixes the message's time, so a retry keeps its id.
   */
  send(to: Hex, envelope: Envelope | Omit<Envelope, "replyTo">, from?: Hex, at?: number): Promise<Sent>;
  /**
   * Reads every relay for gift wraps to `secret`'s key whose messages are from `since` (seconds, the
   * machine's clock) on, and calls `onEnvelope` once per message that opens and passes every check.
   * Keeps listening and reconnects until the returned function is called.
   */
  listen(secret: Hex, onEnvelope: (envelope: Envelope, from: Hex, meta: Meta) => void, since?: number): () => void;
}

export interface TransportOptions {
  /** How long a relay has to answer OK, connection included. Default 3 000 ms. */
  timeoutMs?: number;
  /** Longest wait between reconnection attempts of a listener. Default 30 000 ms. */
  maxBackoffMs?: number;
  /** The WebSocket constructor; the global one by default. */
  WebSocket?: typeof WebSocket;
}

const RELAY_URL = /^wss?:\/\/[^\s/?#]+(\/[^\s#]*)?$/;

function checkRelays(relays: string[]): string[] {
  if (!Array.isArray(relays)) throw new Error("relays: expected a list");
  for (const url of relays) if (typeof url !== "string" || !RELAY_URL.test(url)) throw new Error(`relays: not a WebSocket address (scheme ws or wss): ${url}`);
  return [...new Set(relays)];
}

/** Publishes one event to one relay; true only on ["OK", id, true] within the time limit. */
function publish(WS: typeof WebSocket, url: string, event: NostrEvent, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let ws: WebSocket | undefined;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // already closed
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      ws = new WS(url);
    } catch {
      finish(false);
      return;
    }
    ws.onopen = () => ws!.send(JSON.stringify(["EVENT", event]));
    ws.onmessage = (m) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (Array.isArray(msg) && msg[0] === "OK" && msg[1] === event.id) finish(msg[2] === true);
    };
    ws.onerror = () => finish(false);
    ws.onclose = () => finish(false);
  });
}

/** One relay subscription that reconnects with growing pauses until stopped. */
function subscribe(
  WS: typeof WebSocket,
  url: string,
  filter: Record<string, unknown>,
  onEvent: (event: NostrEvent) => void,
  maxBackoffMs: number,
): () => void {
  const subId = `ahand-${Math.random().toString(36).slice(2, 10)}`;
  let ws: WebSocket | undefined;
  let stopped = false;
  let pause = 500;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    if (stopped) return;
    try {
      ws = new WS(url);
    } catch {
      again();
      return;
    }
    ws.onopen = () => {
      pause = 500;
      ws!.send(JSON.stringify(["REQ", subId, filter]));
    };
    ws.onmessage = (m) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (Array.isArray(msg) && msg[0] === "EVENT" && msg[1] === subId && msg[2] && typeof msg[2] === "object") {
        onEvent(msg[2] as NostrEvent);
      }
    };
    ws.onclose = () => again();
    ws.onerror = () => {
      // onclose follows and schedules the reconnection
    };
  };
  const again = () => {
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = undefined;
      connect();
    }, pause);
    pause = Math.min(pause * 2, maxBackoffMs);
  };
  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (ws) {
      ws.onclose = null;
      try {
        if (ws.readyState === 1) ws.send(JSON.stringify(["CLOSE", subId]));
        ws.close();
      } catch {
        // already closed
      }
    }
  };
}

/** A transport over these relays (WebSocket URLs, scheme ws or wss, as configured; none is built in). */
export function nostrTransport(relays: string[], options: TransportOptions = {}): GiveTransport {
  const urls = checkRelays(relays);
  const WS = options.WebSocket ?? globalThis.WebSocket;
  const timeoutMs = options.timeoutMs ?? 3000;
  const maxBackoffMs = options.maxBackoffMs ?? 30_000;

  return {
    async send(to, envelope, from, at) {
      const key = from ? prefixed(from) : newChatKey().secret;
      const pub = publicKeyOf(key);
      const full = { ...envelope, replyTo: (envelope as Envelope).replyTo ?? pub } as Envelope;
      const { wrap, id } = wrapEnvelope(to, full, key, at ?? Math.floor(Date.now() / 1000));
      const results = await Promise.all(urls.map((url) => publish(WS, url, wrap, timeoutMs)));
      return { acks: results.filter(Boolean).length, of: urls.length, key, id };
    },

    listen(secret, onEnvelope, since) {
      const me = bare(publicKeyOf(secret));
      const filter: Record<string, unknown> = { kinds: [GIFT_WRAP_KIND], "#p": [me] };
      if (since !== undefined) filter.since = Math.max(0, Math.floor(since) - WRAP_BACKDATE);
      const seenWraps = new Set<string>();
      const seenMessages = new Set<string>();
      const onEvent = (event: NostrEvent) => {
        if (typeof event.id !== "string" || seenWraps.has(event.id)) return;
        seenWraps.add(event.id);
        let opened;
        try {
          opened = unwrapEnvelope(event, secret);
        } catch {
          return; // not for this key, forged or malformed: a stranger's bytes, not a message
        }
        if (since !== undefined && opened.at < since) return;
        if (seenMessages.has(opened.id)) return;
        seenMessages.add(opened.id);
        onEnvelope(opened.envelope, opened.from, { id: opened.id, at: opened.at });
      };
      const stops = urls.map((url) => subscribe(WS, url, filter, onEvent, maxBackoffMs));
      return () => stops.forEach((stop) => stop());
    },
  };
}
