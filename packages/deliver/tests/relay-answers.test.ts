/**
 * The transport against scripted relays (helpers.ts `fixtureRelay`): forged copies under a real id,
 * CLOSED, NIP-42 AUTH on reading and on publishing, and the reasons a publish reports. Everything
 * runs on 127.0.0.1; no other host is contacted.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { verifyEvent, type NostrEvent } from "nostr-tools/pure";
import {
  CLOCK_MARGIN,
  MAX_CHALLENGE_CHARS,
  isFinalRefusal,
  newChatKey,
  nostrTransport,
  reasonPrefix,
  wrapEnvelope,
  type Envelope,
  type Hex,
  type Meta,
  type RelayRead,
} from "../src/index.ts";
import { fixtureRelay, freePort, HAND, spawnRelay, until, type FixtureSocket, type RelayProcess } from "./helpers.ts";

let stand: RelayProcess;
beforeAll(async () => {
  stand = await spawnRelay(freePort());
});
afterAll(async () => {
  await stand.stop();
});

type Got = { envelope: Envelope; from: Hex; meta: Meta };
const collect = () => {
  const got: Got[] = [];
  return { got, on: (envelope: Envelope, from: Hex, meta: Meta) => got.push({ envelope, from, meta }) };
};

/** A note from a fresh chat key to `to`, wrapped, with its time. */
function note(to: Hex, text: string, at = Math.floor(Date.now() / 1000)) {
  const key = newChatKey();
  const envelope: Envelope = { v: 1, kind: "note", hand: { ...HAND }, text, replyTo: key.pub };
  return { ...wrapEnvelope(to, envelope, key.secret, at), envelope };
}

const subIdOf = (m: unknown[]) => m[1] as string;

describe("a relay sending junk under a real id cannot shadow the genuine copy", () => {
  test("forged copies (changed content, changed signature) arrive first from one relay; the genuine copy from another is still heard, once", async () => {
    const inbox = newChatKey();
    const { wrap, id } = note(inbox.pub, "the genuine one");
    const junk: NostrEvent = { ...wrap, content: "AAAA" + wrap.content.slice(4) };
    const badSig: NostrEvent = { ...wrap, sig: (wrap.sig[0] === "0" ? "1" : "0") + wrap.sig.slice(1) };
    expect(verifyEvent({ ...junk })).toBe(false);
    expect(verifyEvent({ ...badSig })).toBe(false);
    const hostile = fixtureRelay({
      onMessage(ws, m) {
        if (m[0] !== "REQ") return;
        ws.send(["EVENT", subIdOf(m), junk]);
        ws.send(["EVENT", subIdOf(m), badSig]);
        ws.send(["EOSE", subIdOf(m)]);
      },
    });
    const honest = fixtureRelay({
      onMessage(ws, m) {
        if (m[0] !== "REQ") return;
        // Later than the hostile relay, so the forged copies are seen first.
        setTimeout(() => {
          ws.send(["EVENT", subIdOf(m), wrap]);
          ws.send(["EVENT", subIdOf(m), wrap]);
          ws.send(["EOSE", subIdOf(m)]);
        }, 200);
      },
    });
    try {
      const at = collect();
      const stop = nostrTransport([hostile.url, honest.url]).listen(inbox.secret, at.on);
      await until(() => at.got.length === 1, 5000, "the genuine copy");
      expect(at.got[0]!.envelope.text).toBe("the genuine one");
      expect(at.got[0]!.meta.id).toBe(id);
      await Bun.sleep(200);
      expect(at.got).toHaveLength(1);
      stop();
    } finally {
      await hostile.stop();
      await honest.stop();
    }
  });

  test("the forged copy also arrives after the genuine one: still heard once, no error", async () => {
    const inbox = newChatKey();
    const { wrap } = note(inbox.pub, "first genuine");
    const junk: NostrEvent = { ...wrap, content: wrap.content.split("").reverse().join("") };
    const relay = fixtureRelay({
      onMessage(ws, m) {
        if (m[0] !== "REQ") return;
        for (const e of [wrap, junk, wrap]) ws.send(["EVENT", subIdOf(m), e]);
        ws.send(["EOSE", subIdOf(m)]);
      },
    });
    try {
      const at = collect();
      const stop = nostrTransport([relay.url]).listen(inbox.secret, at.on);
      await until(() => at.got.length === 1, 5000, "the message");
      await Bun.sleep(150);
      expect(at.got).toHaveLength(1);
      stop();
    } finally {
      await relay.stop();
    }
  });
});

describe("subscriptions: CLOSED and AUTH", () => {
  test("CLOSED: reported as failed with the relay's reason, the socket closed and retried with growing pauses; the other relay still delivers", async () => {
    const closing = fixtureRelay({
      onMessage(ws, m) {
        if (m[0] === "REQ") ws.send(["CLOSED", subIdOf(m), "rate-limited: slow down"]);
      },
    });
    try {
      const inbox = newChatKey();
      const reads: RelayRead[] = [];
      const at = collect();
      const t = nostrTransport([closing.url, stand.url], { maxBackoffMs: 2000 });
      const stop = t.listen(inbox.secret, at.on, undefined, { onRelay: (r) => reads.push(r) });
      await until(() => reads.some((r) => r.url === stand.url && r.state === "read"), 5000, "the stand relay's read");
      await until(() => reads.some((r) => r.url === closing.url && r.state === "failed"), 5000, "the closing relay's failure");
      expect(reads.find((r) => r.url === closing.url)).toEqual({ url: closing.url, state: "failed", reason: "rate-limited: slow down" });

      // Sent through the stand relay alone, so every connection to the closing relay is the listener's.
      const sent = await nostrTransport([stand.url]).send(inbox.pub, { v: 1, kind: "note", hand: { ...HAND }, text: "via the other relay" });
      expect(sent.relays.find((r) => r.url === stand.url)).toEqual({ url: stand.url, ok: true, reason: "" });
      await until(() => at.got.length === 1, 5000, "the note");

      // Pauses 500, 1000, 2000 ms between connections: the relay is retried, not hammered.
      await until(() => closing.connections.length >= 4, 6000, "four connections");
      const gaps = closing.connections.slice(1).map((t0, i) => t0 - closing.connections[i]!);
      expect(gaps[0]!).toBeGreaterThanOrEqual(400);
      expect(gaps[1]!).toBeGreaterThanOrEqual(900);
      expect(gaps[2]!).toBeGreaterThanOrEqual(1900);
      stop();
    } finally {
      await closing.stop();
    }
  }, 15_000);

  /** A relay that keeps gift wraps from readers until they authenticate (NIP-42) as the key they ask for. */
  function authRelay(stored: NostrEvent[], opts: { challengeFirst: boolean; accept: boolean }) {
    const authed: string[] = [];
    const relay = fixtureRelay({
      onOpen(ws) {
        if (opts.challengeFirst) ws.send(["AUTH", "challenge-123"]);
      },
      onMessage(ws: FixtureSocket, m) {
        if (m[0] === "REQ") {
          const filter = m[2] as { "#p": string[] };
          if (ws.data.pubkey !== filter["#p"][0]) {
            ws.send(["CLOSED", subIdOf(m), "ERROR: auth-required: requested filter requires authentication"]);
            if (!opts.challengeFirst) ws.send(["AUTH", "challenge-123"]);
            return;
          }
          for (const e of stored) ws.send(["EVENT", subIdOf(m), e]);
          ws.send(["EOSE", subIdOf(m)]);
        } else if (m[0] === "AUTH") {
          const e = m[1] as NostrEvent;
          const tag = (name: string) => e.tags.find((t) => t[0] === name)?.[1];
          const good = verifyEvent(e) && e.kind === 22242 && tag("challenge") === "challenge-123" && tag("relay") === relay.url;
          if (good && opts.accept) {
            ws.data.pubkey = e.pubkey;
            authed.push(e.pubkey);
            ws.send(["OK", e.id, true, ""]);
          } else {
            ws.send(["OK", e.id, false, "restricted: not you"]);
          }
        }
      },
    });
    return { relay, authed };
  }

  for (const challengeFirst of [true, false]) {
    test(`AUTH (${challengeFirst ? "challenge on connect" : "challenge after CLOSED"}): the reader authenticates as the inbox key and reads`, async () => {
      const inbox = newChatKey();
      const { wrap } = note(inbox.pub, "behind authentication");
      const { relay, authed } = authRelay([wrap], { challengeFirst, accept: true });
      try {
        const at = collect();
        const reads: RelayRead[] = [];
        const stop = nostrTransport([relay.url]).listen(inbox.secret, at.on, undefined, { onRelay: (r) => reads.push(r) });
        await until(() => at.got.length === 1, 5000, "the note behind AUTH");
        expect(authed).toEqual([inbox.pub.slice(2)]);
        await until(() => reads.length > 0, 2000, "a read mark");
        expect(reads).toEqual([{ url: relay.url, state: "read" }]);
        stop();
      } finally {
        await relay.stop();
      }
    });
  }

  test("AUTH refused: reported as failed (auth-required), not read, and retried later", async () => {
    const inbox = newChatKey();
    const { relay } = authRelay([note(inbox.pub, "never read").wrap], { challengeFirst: true, accept: false });
    try {
      const at = collect();
      const reads: RelayRead[] = [];
      const stop = nostrTransport([relay.url], { maxBackoffMs: 500 }).listen(inbox.secret, at.on, undefined, { onRelay: (r) => reads.push(r) });
      await until(() => reads.length > 0, 3000, "a read mark");
      expect(reads[0]).toEqual({ url: relay.url, state: "failed", reason: "auth-required: the relay refused authentication: restricted: not you" });
      await until(() => relay.connections.length >= 2, 3000, "a retry");
      expect(at.got).toHaveLength(0);
      stop();
    } finally {
      await relay.stop();
    }
  });

  test("a relay that never finishes its answer is reported failed after the time limit, and read once EOSE comes", async () => {
    let late: (() => void) | undefined;
    const slow = fixtureRelay({
      onMessage(ws, m) {
        if (m[0] === "REQ") late = () => ws.send(["EOSE", subIdOf(m)]);
      },
    });
    try {
      const reads: RelayRead[] = [];
      const stop = nostrTransport([slow.url], { timeoutMs: 300 }).listen(newChatKey().secret, () => {}, undefined, { onRelay: (r) => reads.push(r) });
      await until(() => reads.length === 1, 2000, "the timeout");
      expect(reads[0]).toMatchObject({ state: "failed" });
      expect(reasonPrefix((reads[0] as { reason: string }).reason)).toBe("timeout");
      late!();
      await until(() => reads.length === 2, 2000, "the late read");
      expect(reads[1]).toEqual({ url: slow.url, state: "read" });
      stop();
    } finally {
      await slow.stop();
    }
  });
});

describe("subscriptions that never get going, and relays that hang up after answering", () => {
  const gapsOf = (times: number[]) => times.slice(1).map((t0, i) => t0 - times[i]!);

  test("a relay that answers in full (EOSE) and hangs up at once is retried with growing pauses, not every 500 ms", async () => {
    const hangup = fixtureRelay({
      onMessage(ws, m) {
        if (m[0] !== "REQ") return;
        ws.send(["EOSE", subIdOf(m)]);
        ws.close();
      },
    });
    try {
      const reads: RelayRead[] = [];
      const stop = nostrTransport([hangup.url], { maxBackoffMs: 2000 }).listen(newChatKey().secret, () => {}, undefined, { onRelay: (r) => reads.push(r) });
      await until(() => hangup.connections.length >= 4, 6000, "four connections");
      const gaps = gapsOf(hangup.connections);
      expect(gaps[0]!).toBeGreaterThanOrEqual(400);
      expect(gaps[1]!).toBeGreaterThanOrEqual(900);
      expect(gaps[2]!).toBeGreaterThanOrEqual(1900);
      expect(reads[0]).toEqual({ url: hangup.url, state: "read" });
      stop();
    } finally {
      await hangup.stop();
    }
  }, 10_000);

  test("a connection that read in full and then held for `stableMs` starts the pauses afresh", async () => {
    const held = fixtureRelay({
      onMessage(ws, m) {
        if (m[0] !== "REQ") return;
        ws.send(["EOSE", subIdOf(m)]);
        setTimeout(() => ws.close(), 300);
      },
    });
    try {
      const stop = nostrTransport([held.url], { maxBackoffMs: 4000, stableMs: 200 }).listen(newChatKey().secret, () => {});
      await until(() => held.connections.length >= 4, 6000, "four connections");
      // 300 ms held plus a 500 ms pause each time; growing pauses would make the third gap 2 300 ms.
      for (const gap of gapsOf(held.connections).slice(0, 3)) expect(gap).toBeLessThan(1500);
      stop();
    } finally {
      await held.stop();
    }
  }, 10_000);

  test("a relay whose WebSocket never opens is reported failed at the time limit and tried again", async () => {
    let accepted = 0;
    const port = freePort();
    const silent = Bun.listen({
      hostname: "127.0.0.1",
      port,
      socket: {
        open() {
          accepted++; // takes the TCP connection, never answers the upgrade
        },
        data() {},
      },
    });
    try {
      const url = `ws://127.0.0.1:${port}`;
      const reads: RelayRead[] = [];
      const stop = nostrTransport([url], { timeoutMs: 300, maxBackoffMs: 500 }).listen(newChatKey().secret, () => {}, undefined, { onRelay: (r) => reads.push(r) });
      await until(() => reads.length > 0, 2000, "a read mark");
      expect(reads[0]).toEqual({ url, state: "failed", reason: "timeout: no connection within 300 ms" });
      await until(() => accepted >= 2, 3000, "a second connection");
      stop();
    } finally {
      silent.stop(true);
    }
  });

  test("CLOSED auth-required with no challenge ever: failed with the relay's reason, closed and tried again", async () => {
    const relay = fixtureRelay({
      onMessage(ws, m) {
        if (m[0] === "REQ") ws.send(["CLOSED", subIdOf(m), "auth-required: nope"]);
      },
    });
    try {
      const reads: RelayRead[] = [];
      const stop = nostrTransport([relay.url], { timeoutMs: 300, maxBackoffMs: 500 }).listen(newChatKey().secret, () => {}, undefined, { onRelay: (r) => reads.push(r) });
      await until(() => reads.length > 0, 2000, "a read mark");
      expect(reads[0]).toEqual({ url: relay.url, state: "failed", reason: "auth-required: nope (it sent no NIP-42 challenge within 300 ms)" });
      await until(() => relay.connections.length >= 2, 3000, "a second connection");
      stop();
    } finally {
      await relay.stop();
    }
  });

  test("an AUTH the relay never answers: failed, closed and tried again", async () => {
    const relay = fixtureRelay({
      onOpen(ws) {
        ws.send(["AUTH", "challenge-123"]);
      },
      onMessage(ws, m) {
        if (m[0] === "REQ") ws.send(["CLOSED", subIdOf(m), "auth-required: who are you"]);
        // AUTH: no OK, ever
      },
    });
    try {
      const reads: RelayRead[] = [];
      const stop = nostrTransport([relay.url], { timeoutMs: 300, maxBackoffMs: 500 }).listen(newChatKey().secret, () => {}, undefined, { onRelay: (r) => reads.push(r) });
      await until(() => reads.length > 0, 2000, "a read mark");
      expect(reads[0]).toEqual({ url: relay.url, state: "failed", reason: "auth-required: who are you (it did not answer the NIP-42 authentication within 300 ms)" });
      expect(relay.received.some((r) => r.message[0] === "AUTH")).toBe(true);
      await until(() => relay.connections.length >= 2, 3000, "a second connection");
      stop();
    } finally {
      await relay.stop();
    }
  });
});

describe("publish: each relay's answer, with its reason", () => {
  test("OK false carries the relay's reason; duplicate counts as acknowledged; a dead address and silence get our own reasons", async () => {
    const refusing = fixtureRelay({
      onMessage(ws, m) {
        if (m[0] === "EVENT") ws.send(["OK", (m[1] as NostrEvent).id, false, "blocked: test relay refuses everything"]);
      },
    });
    const dup = fixtureRelay({
      onMessage(ws, m) {
        if (m[0] === "EVENT") ws.send(["OK", (m[1] as NostrEvent).id, false, "duplicate: already have it"]);
      },
    });
    const quiet = fixtureRelay({});
    const dead = `ws://127.0.0.1:${freePort()}`;
    try {
      const t = nostrTransport([refusing.url, dup.url, quiet.url, dead], { timeoutMs: 500 });
      const sent = await t.send(newChatKey().pub, { v: 1, kind: "note", hand: { ...HAND }, text: "hello" });
      expect({ acks: sent.acks, of: sent.of }).toEqual({ acks: 1, of: 4 });
      const by = Object.fromEntries(sent.relays.map((r) => [r.url, r]));
      expect(by[refusing.url]).toEqual({ url: refusing.url, ok: false, reason: "blocked: test relay refuses everything" });
      expect(by[dup.url]).toEqual({ url: dup.url, ok: true, reason: "duplicate: already have it" });
      expect(reasonPrefix(by[quiet.url]!.reason)).toBe("timeout");
      expect(by[quiet.url]!.ok).toBe(false);
      expect(["closed", "unreachable"]).toContain(reasonPrefix(by[dead]!.reason));
      expect(isFinalRefusal(by[refusing.url]!.reason)).toBe(true);
      expect(isFinalRefusal(by[quiet.url]!.reason)).toBe(false);
      expect(isFinalRefusal("rate-limited: wait")).toBe(false);
      expect(isFinalRefusal("ERROR: auth-required: who are you")).toBe(true);
    } finally {
      await refusing.stop();
      await dup.stop();
      await quiet.stop();
    }
  });

  test("auth-required on publish: authenticates with a throwaway key and sends the same event again", async () => {
    const authors: string[] = [];
    const relay = fixtureRelay({
      onOpen(ws) {
        ws.send(["AUTH", "pub-challenge"]);
      },
      onMessage(ws, m) {
        if (m[0] === "EVENT") {
          const e = m[1] as NostrEvent;
          ws.send(["OK", e.id, ws.data.authed === true, ws.data.authed ? "" : "auth-required: publish needs authentication"]);
        } else if (m[0] === "AUTH") {
          const e = m[1] as NostrEvent;
          authors.push(e.pubkey);
          ws.data.authed = verifyEvent(e) && e.tags.some((t) => t[0] === "challenge" && t[1] === "pub-challenge");
          ws.send(["OK", e.id, ws.data.authed, ""]);
        }
      },
    });
    try {
      const key = newChatKey();
      const t = nostrTransport([relay.url]);
      const sent = await t.send(newChatKey().pub, { v: 1, kind: "note", hand: { ...HAND }, text: "after auth" }, key.secret);
      expect(sent.relays).toEqual([{ url: relay.url, ok: true, reason: "" }]);
      expect(authors).toHaveLength(1);
      expect(authors[0]).not.toBe(key.pub.slice(2)); // not the chat key: a throwaway one
      const events = relay.received.filter((r) => r.message[0] === "EVENT").map((r) => (r.message[1] as NostrEvent).id);
      expect(events).toEqual([events[0]!, events[0]!]);
    } finally {
      await relay.stop();
    }
  });
});

describe("publish: a challenge after the refusal, or none", () => {
  test("auth-required first, the challenge after it: authenticates then, and the event is taken", async () => {
    const relay = fixtureRelay({
      onMessage(ws, m) {
        if (m[0] === "EVENT") {
          const e = m[1] as NostrEvent;
          if (ws.data.authed === true) return ws.send(["OK", e.id, true, ""]);
          ws.send(["OK", e.id, false, "auth-required: publish needs authentication"]);
          ws.send(["AUTH", "late-challenge"]);
        } else if (m[0] === "AUTH") {
          const e = m[1] as NostrEvent;
          ws.data.authed = verifyEvent(e) && e.tags.some((t) => t[0] === "challenge" && t[1] === "late-challenge");
          ws.send(["OK", e.id, ws.data.authed, ""]);
        }
      },
    });
    try {
      const sent = await nostrTransport([relay.url]).send(newChatKey().pub, { v: 1, kind: "note", hand: { ...HAND }, text: "late challenge" });
      expect(sent.relays).toEqual([{ url: relay.url, ok: true, reason: "" }]);
    } finally {
      await relay.stop();
    }
  });

  test("auth-required and no usable challenge (none, or one too long to sign): a timeout, retried later, not a final refusal", async () => {
    for (const challenge of [undefined, "x".repeat(MAX_CHALLENGE_CHARS + 1)]) {
      const relay = fixtureRelay({
        onMessage(ws, m) {
          if (m[0] !== "EVENT") return;
          ws.send(["OK", (m[1] as NostrEvent).id, false, "auth-required: publish needs authentication"]);
          if (challenge !== undefined) ws.send(["AUTH", challenge]);
        },
      });
      try {
        const [answer] = await nostrTransport([relay.url], { timeoutMs: 300 }).publish(note(newChatKey().pub, "no challenge").wrap);
        expect(answer).toEqual({ url: relay.url, ok: false, reason: "timeout: no answer within 300 ms (the relay wants NIP-42 authentication and sent no challenge)" });
        expect(isFinalRefusal(answer!.reason)).toBe(false);
        expect(relay.received.some((r) => r.message[0] === "AUTH")).toBe(false);
      } finally {
        await relay.stop();
      }
    }
  });
});

describe("listening: clock margin and the Hand", () => {
  test("a sender whose clock is 10 minutes slow is still heard; one an hour before `since` is not", async () => {
    expect(CLOCK_MARGIN).toBe(15 * 60);
    const inbox = newChatKey();
    const t = nostrTransport([stand.url]);
    const now = Math.floor(Date.now() / 1000);
    const slow = newChatKey();
    await t.send(inbox.pub, { v: 1, kind: "note", hand: { ...HAND }, text: "slow clock" }, slow.secret, now - 600);
    await t.send(inbox.pub, { v: 1, kind: "note", hand: { ...HAND }, text: "an hour old" }, slow.secret, now - 3600);
    const at = collect();
    const stop = t.listen(inbox.secret, at.on, now);
    await until(() => at.got.length >= 1, 5000, "the slow-clock note");
    await Bun.sleep(300);
    expect(at.got.map((g) => g.envelope.text)).toEqual(["slow clock"]);
    stop();
  });

  test("with `hand`, only envelopes about that Hand are heard (core in any case, the id as a number)", async () => {
    const inbox = newChatKey();
    const t = nostrTransport([stand.url]);
    const key = newChatKey();
    await t.send(inbox.pub, { v: 1, kind: "note", hand: { ...HAND, handId: "8" }, text: "another Hand" }, key.secret);
    await t.send(inbox.pub, { v: 1, kind: "note", hand: { ...HAND, handId: "07", core: HAND.core.toLowerCase() as Hex }, text: "this Hand" }, key.secret);
    const at = collect();
    const stop = t.listen(inbox.secret, at.on, undefined, { hand: { ...HAND } });
    await until(() => at.got.length >= 1, 5000, "the note about this Hand");
    await Bun.sleep(300);
    expect(at.got.map((g) => g.envelope.text)).toEqual(["this Hand"]);
    stop();
  });
});
