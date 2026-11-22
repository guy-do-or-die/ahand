/**
 * The carrier: gift wraps published to, and read from, a configured list of relays (NIP-01 over
 * WebSocket). No relay is built in; the caller names every one (see `relays.ts` for the measured
 * public ones).
 *
 * NIP-42: a relay that asks for authentication gets it, once per connection, and only when it
 * refuses without it (`auth-required:`), whether its challenge came before or after the refusal. A
 * reader signs the AUTH event with the key it reads for, the same key its filter already names in
 * `#p`: the relay then holds a signed proof that this connection has that key's secret, which it
 * could keep and show to others. A publisher signs with a fresh throwaway key. A challenge longer
 * than `MAX_CHALLENGE_CHARS` or with other than printable ASCII is ignored, never signed. A relay
 * that still refuses is reported as failed.
 */
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from "nostr-tools/pure";
import { bare, newChatKey, prefixed, publicKeyOf, sameHand, secretBytes, type Envelope, type HandRef, type Hex } from "./envelope.ts";
import { GIFT_WRAP_KIND, WRAP_BACKDATE, unwrapEnvelope, verifiedWrap, wrapEnvelope } from "./wrap.ts";

/** How many relays acknowledged (answered OK true, or OK false "duplicate:"), of how many were asked. */
export interface Delivery {
  acks: number;
  of: number;
}

/**
 * One relay's answer to a publish. `reason` is the relay's own message from its OK (NIP-01 prefixes
 * such as `duplicate:`, `blocked:`, `rate-limited:`, `invalid:`, `auth-required:`), or one of ours
 * when it gave none: `timeout:`, `unreachable:`, `closed:`.
 */
export interface RelayAnswer {
  url: string;
  ok: boolean;
  reason: string;
}

/** A send's result: the acknowledgements, each relay's answer, the chat key that signed (keep it to read answers), the message id. */
export interface Sent extends Delivery {
  key: Hex;
  id: string;
  relays: RelayAnswer[];
}

/** A gift wrap ready to publish, the rumor (message) id inside it, and the chat key that signed it. */
export interface Wrapped {
  wrap: NostrEvent;
  id: string;
  key: Hex;
}

/** What a listener learns besides the envelope: the rumor's id (one per message, retries included) and time. */
export interface Meta {
  id: string;
  at: number;
}

/**
 * How one relay's read of an inbox stands. `read`: it sent everything it keeps (EOSE) and now
 * pushes new messages. `failed`: it could not be reached, refused the subscription (CLOSED, with
 * its reason), wanted authentication it would not accept, did not finish within the time limit, or
 * dropped the connection before finishing. The listener keeps retrying a failed relay with growing
 * pauses, and reports `read` if a later attempt succeeds.
 */
export type RelayRead = { url: string; state: "read" } | { url: string; state: "failed"; reason: string };

export interface ListenOptions {
  /** Only envelopes about this Hand reach `onEnvelope` (`sameHand`); others are dropped. */
  hand?: HandRef;
  /** Called whenever a relay's read changes (see `RelayRead`). */
  onRelay?: (read: RelayRead) => void;
  /**
   * Seconds a sender's clock may lag behind this machine's and its message still count as on or
   * after `since`. Default `CLOCK_MARGIN`.
   */
  clockMargin?: number;
}

export interface GiveTransport {
  /** The relays this transport publishes to and reads from, as configured, without repeats. */
  readonly relays: readonly string[];
  /**
   * Wraps `envelope` to the 32-byte x-only key `to`, without touching the network. `from` is the
   * chat key's secret; without one a new random key is made, and returned in `key` for the caller
   * to keep. The envelope's `replyTo` must be that key's public key; it may be left empty, and is
   * then filled in. `at` (seconds) fixes the message's time, so a retry keeps its id.
   */
  wrap(to: Hex, envelope: Envelope | Omit<Envelope, "replyTo">, from?: Hex, at?: number): Wrapped;
  /** Publishes a gift wrap, unchanged, to `relays` (default: all of them); one answer per relay. */
  publish(wrap: NostrEvent, relays?: readonly string[]): Promise<RelayAnswer[]>;
  /** `wrap` then `publish` to every relay. */
  send(to: Hex, envelope: Envelope | Omit<Envelope, "replyTo">, from?: Hex, at?: number): Promise<Sent>;
  /**
   * Reads every relay for gift wraps to `secret`'s key whose messages are from `since` (seconds, the
   * machine's clock, less `clockMargin`) on, and calls `onEnvelope` once per message that opens and
   * passes every check. Keeps listening and reconnects until the returned function is called.
   */
  listen(secret: Hex, onEnvelope: (envelope: Envelope, from: Hex, meta: Meta) => void, since?: number, options?: ListenOptions): () => void;
}

export interface TransportOptions {
  /** How long a relay has to answer a publish (OK), and a read (EOSE), connection included. Default 3 000 ms. */
  timeoutMs?: number;
  /** Longest wait between reconnection attempts of a listener. Default 30 000 ms. */
  maxBackoffMs?: number;
  /**
   * How long a listener's connection must stay open after a complete read (EOSE) for the next
   * reconnection to wait only the first pause again. Shorter-lived connections keep the pauses
   * growing. Default 30 000 ms.
   */
  stableMs?: number;
  /** The WebSocket constructor; the global one by default. */
  WebSocket?: typeof WebSocket;
}

/**
 * Seconds a sender's clock may lag behind the reader's. Without a margin, an answer written on a
 * phone whose clock is a few minutes slow would fall before the reader's `since` and be skipped.
 */
export const CLOCK_MARGIN = 15 * 60;

/** NIP-42's kind for the client's authentication event. */
const AUTH_KIND = 22242;
const FIRST_PAUSE_MS = 500;
/** The longest NIP-42 challenge signed; real ones are a few dozen characters. */
export const MAX_CHALLENGE_CHARS = 256;
const CHALLENGE = /^[\x20-\x7e]+$/;

/** A relay's AUTH challenge if it is one worth signing: a short string of printable ASCII. */
function challengeOf(msg: unknown[]): string | undefined {
  const c = msg[1];
  return typeof c === "string" && c.length <= MAX_CHALLENGE_CHARS && CHALLENGE.test(c) ? c : undefined;
}
const RELAY_URL = /^wss?:\/\/[^\s/?#]+(\/[^\s#]*)?$/;

function checkRelays(relays: readonly string[]): string[] {
  if (!Array.isArray(relays)) throw new Error("relays: expected a list");
  for (const url of relays) if (typeof url !== "string" || !RELAY_URL.test(url)) throw new Error(`relays: not a WebSocket address (scheme ws or wss): ${url}`);
  return [...new Set(relays)];
}

/**
 * The machine-readable prefix of a relay's message (NIP-01: `prefix: text`), lower case. strfry
 * writes some as `ERROR: auth-required: …`; the inner prefix is the one that says why.
 */
export function reasonPrefix(reason: string): string {
  const m = /^\s*([a-z][a-z0-9-]*):\s*(?:([a-z][a-z0-9-]*):)?/i.exec(reason);
  if (!m) return "";
  const first = m[1]!.toLowerCase();
  return first === "error" && m[2] ? m[2].toLowerCase() : first;
}

/**
 * Whether a refusal will repeat for the same event: the relay judged the event itself (`invalid:`,
 * `blocked:`, `pow:`, `restricted:`) or wants authentication it did not accept (`auth-required:`).
 * Rate limits, errors, timeouts and lost connections may pass on a later try.
 */
export function isFinalRefusal(reason: string): boolean {
  return ["invalid", "blocked", "pow", "restricted", "auth-required"].includes(reasonPrefix(reason));
}

function frame(data: unknown): unknown[] | undefined {
  try {
    const msg: unknown = JSON.parse(String(data));
    return Array.isArray(msg) ? msg : undefined;
  } catch {
    return undefined;
  }
}

function authEvent(url: string, challenge: string, sk: Uint8Array): NostrEvent {
  return finalizeEvent(
    { kind: AUTH_KIND, created_at: Math.floor(Date.now() / 1000), tags: [["relay", url], ["challenge", challenge]], content: "" },
    sk,
  );
}

function closeQuietly(ws: WebSocket | undefined) {
  if (!ws) return;
  ws.onclose = null;
  try {
    ws.close();
  } catch {
    // already closed
  }
}

/** Publishes one event to one relay and reports its answer within the time limit. */
function publishOne(WS: typeof WebSocket, url: string, event: NostrEvent, timeoutMs: number): Promise<RelayAnswer> {
  return new Promise((resolve) => {
    let ws: WebSocket | undefined;
    let done = false;
    let challenge: string | undefined;
    let authId: string | undefined;
    /** The relay answered auth-required before sending its challenge: authenticate when it comes. */
    let wantsAuth = false;
    let authed = false;
    const finish = (ok: boolean, reason: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      closeQuietly(ws);
      resolve({ url, ok, reason });
    };
    const authenticate = () => {
      // A throwaway key: the relay learns no one's identity from it.
      const auth = authEvent(url, challenge!, generateSecretKey());
      authId = auth.id;
      ws!.send(JSON.stringify(["AUTH", auth]));
    };
    const timer = setTimeout(() => {
      const why =
        wantsAuth && authId === undefined
          ? " (the relay wants NIP-42 authentication and sent no challenge)"
          : authId !== undefined && !authed
            ? " (the relay did not answer the NIP-42 authentication)"
            : challenge !== undefined
              ? " (the relay asked for NIP-42 authentication)"
              : "";
      // `timeout:`, so the outbox tries again: an unanswered authentication is not a refusal.
      finish(false, `timeout: no answer within ${timeoutMs} ms${why}`);
    }, timeoutMs);
    try {
      ws = new WS(url);
    } catch (err) {
      finish(false, `unreachable: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    ws.onopen = () => ws!.send(JSON.stringify(["EVENT", event]));
    ws.onmessage = (m) => {
      const msg = frame(m.data);
      if (!msg) return;
      if (msg[0] === "AUTH") {
        challenge = challengeOf(msg) ?? challenge;
        if (wantsAuth && challenge !== undefined && authId === undefined) authenticate();
        return;
      }
      if (msg[0] !== "OK") return;
      const reason = typeof msg[3] === "string" ? msg[3] : "";
      if (authId !== undefined && msg[1] === authId) {
        if (msg[2] === true) {
          authed = true;
          ws!.send(JSON.stringify(["EVENT", event]));
        } else finish(false, `auth-required: the relay refused authentication${reason ? `: ${reason}` : ""}`);
        return;
      }
      if (msg[1] !== event.id) return;
      if (msg[2] === true || reasonPrefix(reason) === "duplicate") return finish(true, reason);
      if (reasonPrefix(reason) === "auth-required" && authId === undefined) {
        // NIP-42 lets the challenge come before or after the refusal: answer it now, or when it comes.
        wantsAuth = true;
        if (challenge !== undefined) authenticate();
        return;
      }
      finish(false, reason || "refused: no reason given");
    };
    ws.onerror = () => {
      // onclose follows
    };
    ws.onclose = () => finish(false, "closed: the connection closed before an answer");
  });
}

/**
 * One relay subscription that reconnects with growing pauses until stopped. The pause goes back to
 * its first length only when a connection that completed its read (EOSE) then stayed open for
 * `stableMs`, so neither a relay that accepts the connection and refuses the subscription, nor one
 * that answers in full and then hangs up at once, is hammered. The time limit runs from the moment
 * the socket is made: a relay that does not connect, or that closed the subscription and waits on
 * an authentication that never completes, is failed, closed and retried; one that is connected and
 * serving but slow to finish is only reported, and a late EOSE reports it read.
 */
function subscribe(
  WS: typeof WebSocket,
  url: string,
  filter: Record<string, unknown>,
  sk: Uint8Array,
  onEvent: (event: unknown) => void,
  onRead: (read: RelayRead) => void,
  timeoutMs: number,
  maxBackoffMs: number,
  stableMs: number,
): () => void {
  const subId = `ahand-${Math.random().toString(36).slice(2, 10)}`;
  let ws: WebSocket | undefined;
  let stopped = false;
  let pause = FIRST_PAUSE_MS;
  let retry: ReturnType<typeof setTimeout> | undefined;
  /** Silences the current connection's timers. */
  let quiet: (() => void) | undefined;
  let last: string | undefined;
  const report = (read: RelayRead) => {
    if (stopped) return;
    const key = read.state === "read" ? "read" : `failed ${read.reason}`;
    if (key === last) return;
    last = key;
    onRead(read);
  };

  const connect = () => {
    if (stopped) return;
    let challenge: string | undefined;
    let authId: string | undefined;
    let wantsAuth = false;
    let opened = false;
    let finished = false;
    let dead = false;
    /** When this connection completed its read (EOSE), ms. */
    let readAt: number | undefined;
    /** The relay's CLOSED reason while the subscription is closed and waits on authentication. */
    let closedFor: string | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    /** Runs while the subscription is closed and waits on authentication, which may come after `deadline`. */
    let authWait: ReturnType<typeof setTimeout> | undefined;
    const socket = (() => {
      try {
        return new WS(url);
      } catch (err) {
        report({ url, state: "failed", reason: `unreachable: ${err instanceof Error ? err.message : String(err)}` });
        again();
        return undefined;
      }
    })();
    if (!socket) return;
    ws = socket;
    quiet = () => {
      dead = true;
      clearTimeout(deadline);
      clearTimeout(authWait);
    };
    /** The connection is over: the pause starts afresh only if it read in full and then held. */
    const ended = () => {
      dead = true;
      clearTimeout(deadline);
      clearTimeout(authWait);
      if (readAt !== undefined && Date.now() - readAt >= stableMs) pause = FIRST_PAUSE_MS;
      again();
    };
    const fail = (reason: string) => {
      if (dead) return;
      report({ url, state: "failed", reason });
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // already closed
      }
      ended();
    };
    const authenticate = () => {
      const auth = authEvent(url, challenge!, sk);
      authId = auth.id;
      socket.send(JSON.stringify(["AUTH", auth]));
    };
    /** The relay closed the subscription, so no EOSE can come on this connection: start again. */
    const authStuck = () => {
      const why = authId === undefined ? "it sent no NIP-42 challenge" : "it did not answer the NIP-42 authentication";
      fail(`${closedFor} (${why} within ${timeoutMs} ms)`);
    };
    deadline = setTimeout(() => {
      if (finished || dead) return;
      if (!opened) return fail(`timeout: no connection within ${timeoutMs} ms`);
      if (closedFor !== undefined) return authStuck();
      // The subscription is open: what the relay sends later is still heard, and a late EOSE reports it read.
      report({ url, state: "failed", reason: `timeout: the relay did not finish its answer within ${timeoutMs} ms` });
    }, timeoutMs);
    socket.onopen = () => {
      opened = true;
      socket.send(JSON.stringify(["REQ", subId, filter]));
    };
    socket.onmessage = (m) => {
      const msg = frame(m.data);
      if (!msg) return;
      const [type] = msg;
      if (type === "EVENT" && msg[1] === subId) {
        onEvent(msg[2]);
      } else if (type === "EOSE" && msg[1] === subId) {
        finished = true;
        readAt = Date.now();
        clearTimeout(deadline);
        report({ url, state: "read" });
      } else if (type === "AUTH") {
        challenge = challengeOf(msg) ?? challenge;
        if (wantsAuth && challenge !== undefined && authId === undefined) authenticate();
      } else if (type === "OK" && authId !== undefined && msg[1] === authId) {
        if (msg[2] === true) {
          closedFor = undefined;
          clearTimeout(authWait);
          socket.send(JSON.stringify(["REQ", subId, filter]));
        } else {
          fail(`auth-required: the relay refused authentication${typeof msg[3] === "string" && msg[3] ? `: ${msg[3]}` : ""}`);
        }
      } else if (type === "CLOSED" && msg[1] === subId) {
        const reason = typeof msg[2] === "string" && msg[2] ? msg[2] : "closed: the relay closed the subscription";
        if (reasonPrefix(reason) === "auth-required" && !wantsAuth) {
          // Once per connection: answer the challenge (now, or when it comes) and ask again.
          wantsAuth = true;
          closedFor = reason;
          authWait = setTimeout(() => {
            if (!dead && closedFor !== undefined) authStuck();
          }, timeoutMs);
          if (challenge !== undefined) authenticate();
          return;
        }
        fail(reason);
      }
    };
    socket.onerror = () => {
      // onclose follows and schedules the reconnection
    };
    socket.onclose = () => {
      if (dead) return;
      if (!finished) report({ url, state: "failed", reason: "closed: the connection closed before the relay finished its answer" });
      ended();
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
    quiet?.();
    if (ws) {
      const socket = ws;
      socket.onclose = null;
      socket.onmessage = null;
      try {
        if (socket.readyState === 1) socket.send(JSON.stringify(["CLOSE", subId]));
        socket.close();
      } catch {
        // already closed
      }
    }
  };
}

/** A transport over these relays (WebSocket URLs, scheme ws or wss, as configured; none is built in). */
export function nostrTransport(relays: readonly string[], options: TransportOptions = {}): GiveTransport {
  const urls = checkRelays(relays);
  const WS = options.WebSocket ?? globalThis.WebSocket;
  const timeoutMs = options.timeoutMs ?? 3000;
  const maxBackoffMs = options.maxBackoffMs ?? 30_000;
  const stableMs = options.stableMs ?? 30_000;

  const wrap = (to: Hex, envelope: Envelope | Omit<Envelope, "replyTo">, from?: Hex, at?: number): Wrapped => {
    const key = from ? prefixed(from) : newChatKey().secret;
    const full = { ...envelope, replyTo: (envelope as Envelope).replyTo ?? publicKeyOf(key) } as Envelope;
    const { wrap: event, id } = wrapEnvelope(to, full, key, at ?? Math.floor(Date.now() / 1000));
    // Plain fields only (nostr-tools marks a signed event with a symbol): the outbox stores this as data.
    const plain: NostrEvent = { id: event.id, pubkey: event.pubkey, created_at: event.created_at, kind: event.kind, tags: event.tags, content: event.content, sig: event.sig };
    return { wrap: plain, id, key };
  };

  const publish = (event: NostrEvent, only?: readonly string[]) => {
    const targets = only === undefined ? urls : checkRelays(only);
    return Promise.all(targets.map((url) => publishOne(WS, url, event, timeoutMs)));
  };

  return {
    relays: urls,
    wrap,
    publish,

    async send(to, envelope, from, at) {
      const made = wrap(to, envelope, from, at);
      const answers = await publish(made.wrap);
      return { acks: answers.filter((a) => a.ok).length, of: urls.length, key: made.key, id: made.id, relays: answers };
    },

    listen(secret, onEnvelope, since, listenOptions = {}) {
      const sk = secretBytes(secret);
      const me = bare(getPublicKey(sk));
      const floor = since === undefined ? undefined : Math.floor(since) - (listenOptions.clockMargin ?? CLOCK_MARGIN);
      const filter: Record<string, unknown> = { kinds: [GIFT_WRAP_KIND], "#p": [me] };
      if (floor !== undefined) filter.since = Math.max(0, floor - WRAP_BACKDATE);
      // A wrap id is marked only once a copy under it verified (its id is the hash of its fields,
      // its signature holds) and opened: a relay that sends junk under a real id cannot shadow the
      // genuine copy from another relay. A verified copy that does not open is remembered apart, so
      // it is not decrypted again: its id fixes its content, so every genuine copy is the same.
      const opened = new Set<string>();
      const unopenable = new Set<string>();
      const seenMessages = new Set<string>();
      const onEvent = (raw: unknown) => {
        const id = (raw as { id?: unknown } | null)?.id;
        if (typeof id !== "string" || opened.has(id) || unopenable.has(id)) return;
        const wrapEvent = verifiedWrap(raw);
        if (!wrapEvent) return; // forged or malformed: the genuine copy may still come from another relay
        let got;
        try {
          got = unwrapEnvelope(wrapEvent, secret);
        } catch {
          unopenable.add(id); // not for this key, or its inner layers fail a check
          return;
        }
        opened.add(id);
        if (floor !== undefined && got.at < floor) return;
        if (listenOptions.hand && !sameHand(got.envelope.hand, listenOptions.hand)) return;
        if (seenMessages.has(got.id)) return;
        seenMessages.add(got.id);
        onEnvelope(got.envelope, got.from, { id: got.id, at: got.at });
      };
      const onRead = listenOptions.onRelay ?? (() => {});
      const stops = urls.map((url) => subscribe(WS, url, filter, sk, onEvent, onRead, timeoutMs, maxBackoffMs, stableMs));
      return () => stops.forEach((stop) => stop());
    },
  };
}
