/**
 * The outbox against the stand relay process (stopped, then started again on the same port), and
 * against scripted relays and transports for the retry schedule, the delivered rule and the races.
 */
import { describe, expect, spyOn, test } from "bun:test";
import type { NostrEvent } from "nostr-tools/pure";
import {
  DELIVERED_ACKS,
  RECOMMENDED_RELAYS,
  UNSUITABLE_RELAYS,
  acksNeeded,
  newChatKey,
  nostrTransport,
  openOutbox,
  type Envelope,
  type GiveTransport,
  type OutboxEntry,
  type OutboxStore,
  type RelayAnswer,
} from "../src/index.ts";
import { fixtureRelay, freePort, HAND, longGiveLink, spawnRelay, until } from "./helpers.ts";

const give = (): Omit<Envelope, "replyTo"> => ({ v: 1, kind: "give", hand: { ...HAND }, giveLink: longGiveLink(300) });
const fast = { tickMs: 25, retryMs: 100, maxRetryMs: 400 };

/** A transport over `relays` whose publish is scripted; wrap is the real one. */
function scripted(relays: string[], publish: (wrap: NostrEvent, targets: readonly string[]) => Promise<RelayAnswer[]>): GiveTransport & { published: Array<{ id: string; targets: readonly string[] }> } {
  const real = nostrTransport(relays);
  const published: Array<{ id: string; targets: readonly string[] }> = [];
  return {
    relays: real.relays,
    wrap: real.wrap,
    published,
    publish: (wrap, targets = relays) => {
      published.push({ id: wrap.id, targets });
      return publish(wrap, targets);
    },
    send: real.send,
    listen: real.listen,
  };
}

describe("the delivered rule", () => {
  test("2 acknowledgements by default, capped at the number of relays, never below 1", () => {
    expect(DELIVERED_ACKS).toBe(2);
    expect([0, 1, 2, 3, 5].map((n) => acksNeeded(n))).toEqual([1, 1, 2, 2, 2]);
    expect(acksNeeded(5, 3)).toBe(3);
    expect(() => acksNeeded(3, 0)).toThrow(/need/);
    expect(() => openOutbox(nostrTransport([]), new Map(), { need: 0 })).toThrow(/need/);
  });

  test("the recommended relays: five operators, all on disk, more than one hosting network and relay program, each a valid relay address, none of the unsuitable ones", () => {
    const urls = RECOMMENDED_RELAYS.map((r) => r.url);
    expect(nostrTransport(urls).relays).toEqual(urls);
    expect(new Set(urls.map((u) => new URL(u).hostname.split(".").slice(-2).join("."))).size).toBe(urls.length);
    expect(new Set(RECOMMENDED_RELAYS.map((r) => r.operator)).size).toBe(5);
    expect(RECOMMENDED_RELAYS.every((r) => r.storage === "disk")).toBe(true);
    expect(new Set(RECOMMENDED_RELAYS.map((r) => r.hosting)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(RECOMMENDED_RELAYS.map((r) => r.software.split(" ")[0])).size).toBeGreaterThanOrEqual(2);
    expect(RECOMMENDED_RELAYS.every((r) => r.maxMessageBytes >= 16_384)).toBe(true);
    expect(urls.some((u) => UNSUITABLE_RELAYS.some((x) => x.url === u))).toBe(false);
    expect(acksNeeded(urls.length)).toBe(2);
  });

  test("three relays, one dead: delivered at 2 of 3, and the dead one is still tried with the same wrap until it acknowledges", async () => {
    const a = await spawnRelay(freePort());
    const b = await spawnRelay(freePort());
    const cPort = freePort();
    const cUrl = `ws://127.0.0.1:${cPort}`;
    const store = new Map<string, OutboxEntry>();
    const box = openOutbox(nostrTransport([a.url, b.url, cUrl], { timeoutMs: 500 }), store, fast);
    try {
      const first = await box.send(newChatKey().pub, give());
      expect({ acks: first.acks, of: first.of }).toEqual({ acks: 2, of: 3 });
      expect(box.isDelivered(first)).toBe(true);
      expect(first.deliveredAt).toBeNumber();
      expect(first.relays[cUrl]).toMatchObject({ ok: false, final: false });
      expect(first.nextTryMs).toBeNumber();
      await until(() => store.get(first.key)!.tries >= 3, 5000, "more tries of the dead relay");
      const c = await spawnRelay(cPort);
      try {
        await until(() => store.get(first.key)!.acks === 3, 5000, "the third relay to acknowledge");
        const done = store.get(first.key)!;
        expect(done.wrap!.id).toBe(first.wrap!.id); // the same wrap on every try
        expect(done.nextTryMs).toBeUndefined(); // nothing left to try
        const tries = done.tries;
        await Bun.sleep(300);
        expect(store.get(first.key)!.tries).toBe(tries);
      } finally {
        await c.stop();
      }
    } finally {
      box.close();
      await a.stop();
      await b.stop();
    }
  }, 15_000);

  test("two relays, one dead: 1 of 2 is not delivered", async () => {
    const a = await spawnRelay(freePort());
    try {
      const box = openOutbox(nostrTransport([a.url, `ws://127.0.0.1:${freePort()}`], { timeoutMs: 300 }), new Map(), { retryMs: 60_000 });
      const entry = await box.send(newChatKey().pub, give());
      expect({ acks: entry.acks, of: entry.of }).toEqual({ acks: 1, of: 2 });
      expect(box.isDelivered(entry)).toBe(false);
      expect(entry.deliveredAt).toBeUndefined();
      box.close();
    } finally {
      await a.stop();
    }
  });

  test("a final refusal is not retried; when every relay refuses for good the entry says so and stays", async () => {
    const relay = fixtureRelay({
      onMessage(ws, m) {
        if (m[0] === "EVENT") ws.send(["OK", (m[1] as NostrEvent).id, false, "blocked: kind 1059 is not allowed here"]);
      },
    });
    try {
      const store = new Map<string, OutboxEntry>();
      const box = openOutbox(nostrTransport([relay.url]), store, fast);
      const entry = await box.send(newChatKey().pub, give());
      expect(entry.relays[relay.url]).toEqual({ ok: false, reason: "blocked: kind 1059 is not allowed here", final: true });
      expect(entry.error).toBe(`refused by every relay: ${relay.url} (blocked: kind 1059 is not allowed here)`);
      expect(entry.nextTryMs).toBeUndefined();
      await Bun.sleep(300);
      expect(relay.received.filter((r) => r.message[0] === "EVENT")).toHaveLength(1);
      expect(await box.list()).toHaveLength(1);
      box.close();
    } finally {
      await relay.stop();
    }
  });
});

describe("retries", () => {
  test("the same wrap is republished with growing pauses (100, 200, 400, 400 ms) until the relay takes it", async () => {
    let answers = 0;
    const relay = fixtureRelay({
      onMessage(ws, m) {
        if (m[0] !== "EVENT") return;
        answers++;
        const ok = answers > 4;
        ws.send(["OK", (m[1] as NostrEvent).id, ok, ok ? "" : "rate-limited: slow down"]);
      },
    });
    try {
      const store = new Map<string, OutboxEntry>();
      const box = openOutbox(nostrTransport([relay.url]), store, { ...fast, tickMs: 10 });
      const entry = await box.send(newChatKey().pub, give());
      expect(entry.relays[relay.url]).toEqual({ ok: false, reason: "rate-limited: slow down", final: false });
      await until(() => store.get(entry.key)!.acks === 1, 5000, "the fifth try to land");
      const events = relay.received.filter((r) => r.message[0] === "EVENT").map((r) => r.message[1] as NostrEvent);
      expect(events).toHaveLength(5);
      expect(new Set(events.map((e) => JSON.stringify(e))).size).toBe(1); // byte for byte the same wrap
      const times = relay.received.filter((r) => r.message[0] === "EVENT").map((r) => relay.connections[r.conn]!);
      const gaps = times.slice(1).map((t, i) => t - times[i]!);
      [100, 200, 400, 400].forEach((want, i) => {
        expect(gaps[i]!).toBeGreaterThanOrEqual(want - 15);
        expect(gaps[i]!).toBeLessThan(want + 250);
      });
      box.close();
    } finally {
      await relay.stop();
    }
  });

  test("defaults: first pause 10 s, doubling, at most 10 minutes; the timer looks every second; close stops it", async () => {
    let clock = 1_800_000_000_000;
    const failing = scripted(["ws://127.0.0.1:1"], async (_w, targets) => targets.map((url) => ({ url, ok: false, reason: "timeout: test" })));
    const setSpy = spyOn(globalThis, "setInterval");
    const clearSpy = spyOn(globalThis, "clearInterval");
    try {
      const store = new Map<string, OutboxEntry>();
      const box = openOutbox(failing, store, { now: () => clock });
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0]![1]).toBe(1000);
      const entry = await box.send(newChatKey().pub, give());
      const pauses = [entry.nextTryMs! - clock];
      for (let i = 0; i < 8; i++) {
        clock += 1000;
        await box.flush();
        pauses.push(store.get(entry.key)!.nextTryMs! - clock);
      }
      expect(pauses).toEqual([10_000, 20_000, 40_000, 80_000, 160_000, 320_000, 600_000, 600_000, 600_000]);
      box.close();
      expect(clearSpy).toHaveBeenCalledWith(setSpy.mock.results[0]!.value);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  test("relay stopped: kept with {acks: 0, of: 1}; after the relay returns the timer delivers it, once", async () => {
    const port = freePort();
    const url = `ws://127.0.0.1:${port}`;
    const inbox = newChatKey();
    const store = new Map<string, OutboxEntry>();
    const box = openOutbox(nostrTransport([url], { maxBackoffMs: 300 }), store, fast);
    try {
      const first = await box.send(inbox.pub, give());
      expect({ acks: first.acks, of: first.of }).toEqual({ acks: 0, of: 1 });
      expect(first.deliveredAt).toBeUndefined();
      expect(store.get(first.key)).toEqual(first); // written down, chat key and wrap included
      expect(first.chatKey).toMatch(/^0x[0-9a-f]{64}$/);
      await Bun.sleep(400); // a few retry rounds with nobody there
      expect(store.get(first.key)!.acks).toBe(0);
      expect(store.get(first.key)!.tries).toBeGreaterThan(1);

      const relay = await spawnRelay(port);
      try {
        const heard: Envelope[] = [];
        const stop = nostrTransport([url]).listen(inbox.secret, (e) => heard.push(e));
        await until(() => (store.get(first.key)?.acks ?? 0) === 1, 5000, "the retry to land");
        const done = store.get(first.key)!;
        expect(done.deliveredAt).toBeNumber();
        expect(done.id).toBe(first.id!); // the same message on every try
        await until(() => heard.length === 1, 5000, "the listener to hear it");
        await Bun.sleep(500); // further rounds must not send it again
        expect(heard).toHaveLength(1);
        expect(heard[0]).toEqual({ ...give(), replyTo: first.envelope.replyTo });
        expect(store.size).toBe(1); // delivered entries stay, with their chat key, until forgotten
        stop();
      } finally {
        await relay.stop();
      }
    } finally {
      box.close();
    }
  });

  test("what an earlier session left undelivered is retried when the outbox opens", async () => {
    const relay = await spawnRelay(freePort());
    try {
      const inbox = newChatKey();
      const store = new Map<string, OutboxEntry>();
      const offline = openOutbox(nostrTransport([`ws://127.0.0.1:${freePort()}`]), store, { retryMs: 60_000 });
      const left = await offline.send(inbox.pub, give());
      offline.close();
      expect(left.acks).toBe(0);

      // Same store, a transport that now reaches a relay (as after a reload with the relay back).
      const changes: OutboxEntry[] = [];
      const box = openOutbox(nostrTransport([relay.url]), store, { retryMs: 60_000, onChange: (e) => changes.push(e) });
      await until(() => store.get(left.key)!.acks === 1, 5000, "the reopened outbox to deliver");
      expect(changes.at(-1)!.key).toBe(left.key);
      box.close();
    } finally {
      await relay.stop();
    }
  });
});

describe("races and failures", () => {
  test("flush while an attempt is still waiting on a silent relay makes a fresh try after it, not that attempt's result", async () => {
    const url = "ws://127.0.0.1:1";
    let calls = 0;
    let releaseFirst!: () => void;
    const transport = scripted([url], async (_w, targets) => {
      calls++;
      if (calls === 1) {
        await new Promise<void>((r) => (releaseFirst = r)); // offline: the publish waits out its time limit
        return targets.map((u) => ({ url: u, ok: false, reason: "timeout: no answer within 3000 ms" }));
      }
      return targets.map((u) => ({ url: u, ok: true, reason: "" })); // the network is back
    });
    const box = openOutbox(transport, new Map(), { retryMs: 60_000, tickMs: 60_000 });
    try {
      await Bun.sleep(20); // the opening round over an empty store
      const sending = box.send(newChatKey().pub, give());
      await until(() => calls === 1, 2000, "the first publish");
      const flushing = box.flush();
      const flushingAgain = box.flush(); // shares the one fresh try
      releaseFirst();
      expect((await sending).acks).toBe(0);
      const after = await flushing;
      expect(after.map((e) => e.acks)).toEqual([1]);
      expect((await flushingAgain).map((e) => e.acks)).toEqual([1]);
      expect(calls).toBe(2);
      expect(after[0]!.nextTryMs).toBeUndefined();
    } finally {
      box.close();
    }
  });

  test("the relays that have not acknowledged are tried for `restMs` after delivery, not after the message's time", async () => {
    const urls = ["ws://127.0.0.1:1", "ws://127.0.0.1:2", "ws://127.0.0.1:3"];
    let clock = Date.UTC(2026, 10, 1);
    let online = false;
    const transport = scripted(urls, async (_w, targets) =>
      targets.map((u) => (online && u !== urls[2] ? { url: u, ok: true, reason: "" } : { url: u, ok: false, reason: "timeout: no answer" })),
    );
    const day = 24 * 60 * 60 * 1000;
    const box = openOutbox(transport, new Map(), { retryMs: 60_000, tickMs: 60_000, now: () => clock });
    try {
      await Bun.sleep(20);
      const first = await box.send(newChatKey().pub, give());
      expect(first.acks).toBe(0);
      clock += 2 * day; // offline for two days
      online = true;
      const [delivered] = await box.flush();
      expect(delivered!.acks).toBe(2);
      expect(delivered!.deliveredAt).toBe(Math.floor(clock / 1000));
      expect(delivered!.nextTryMs).toBeNumber(); // the third relay is still to be tried
      clock += day - 1000;
      await box.flush();
      expect(transport.published.at(-1)!.targets).toEqual([urls[2]]);
      const tries = transport.published.length;
      clock += 2000; // a day after delivery
      const [rested] = await box.flush();
      expect(transport.published.length).toBe(tries);
      expect(rested!.nextTryMs).toBeNumber(); // unchanged by a round that had nothing to try
    } finally {
      box.close();
    }
  });

  test("not delivered with one relay acknowledging and the rest refusing for good: the error says what got through", async () => {
    const urls = ["ws://127.0.0.1:1", "ws://127.0.0.1:2", "ws://127.0.0.1:3"];
    const transport = scripted(urls, async (_w, targets) =>
      targets.map((u) => (u === urls[0] ? { url: u, ok: true, reason: "" } : { url: u, ok: false, reason: "invalid: too old" })),
    );
    const box = openOutbox(transport, new Map(), { retryMs: 60_000, tickMs: 60_000 });
    try {
      const entry = await box.send(newChatKey().pub, give());
      expect({ acks: entry.acks, of: entry.of, delivered: box.isDelivered(entry) }).toEqual({ acks: 1, of: 3, delivered: false });
      expect(entry.error).toBe(`acknowledged by 1 of 3, 2 needed; the others refused for good: ${urls[1]} (invalid: too old), ${urls[2]} (invalid: too old)`);
      expect(entry.nextTryMs).toBeUndefined();
    } finally {
      box.close();
    }
  });

  test("a round that listed an entry before it was delivered does not show it undelivered afterwards", async () => {
    // A store whose next read can be held, returning what the entry was when it was asked for.
    const map = new Map<string, OutboxEntry>();
    let holdNext: Promise<void> | undefined;
    const store: OutboxStore = {
      get: async (k) => {
        const snapshot = structuredClone(map.get(k));
        const hold = holdNext;
        holdNext = undefined;
        if (hold) await hold;
        return snapshot;
      },
      set: async (k, v) => void map.set(k, structuredClone(v)),
      delete: async (k) => void map.delete(k),
      keys: async () => [...map.keys()],
    };
    let releasePublish!: () => void;
    const publishGate = new Promise<void>((r) => (releasePublish = r));
    const url = "ws://127.0.0.1:1";
    let calls = 0;
    const transport = scripted([url], async (_w, targets) => {
      calls++;
      if (calls === 1) {
        await publishGate;
        return targets.map((u) => ({ url: u, ok: true, reason: "" }));
      }
      return targets.map((u) => ({ url: u, ok: false, reason: "closed: the relay went away" })); // a later try would fail
    });
    const states: boolean[] = [];
    const box = openOutbox(transport, store, { retryMs: 60_000, tickMs: 60_000, onChange: (e) => states.push(e.acks === 1) });
    await Bun.sleep(20); // the opening round over an empty store
    const sending = box.send(newChatKey().pub, give());
    await until(() => calls === 1, 2000, "the first publish");
    let releaseRead!: () => void;
    holdNext = new Promise<void>((r) => (releaseRead = r));
    const flushing = box.flush(); // lists the entry while undelivered, and is held there
    await Bun.sleep(20);
    releasePublish();
    const sent = await sending;
    expect(sent.acks).toBe(1);
    releaseRead();
    const after = await flushing;
    expect(after.map((e) => e.acks)).toEqual([1]);
    expect(calls).toBe(1); // nothing was published again from the stale copy
    expect(states.at(-1)).toBe(true);
    expect(states.slice(states.indexOf(true))).not.toContain(false);
    expect([...map.values()][0]!.deliveredAt).toBeNumber();
    box.close();
  });

  test("a store that fails in a background round is reported to onError, not left as an unhandled rejection", async () => {
    const errors: unknown[] = [];
    const broken: OutboxStore = {
      get: () => undefined,
      set: () => undefined,
      delete: () => undefined,
      keys: async () => {
        throw new Error("the store is gone");
      },
    };
    const box = openOutbox(nostrTransport([]), broken, { tickMs: 20, onError: (e) => errors.push(e) });
    await until(() => errors.length >= 2, 2000, "the opening round and a tick to fail");
    expect(String(errors[0])).toContain("the store is gone");
    box.close();
  });

  test("a failure is recorded and the entry kept; forget is the only way out", async () => {
    const failing = scripted(["ws://127.0.0.1:1"], async () => {
      throw new Error("relay refused the size");
    });
    const store = new Map<string, OutboxEntry>();
    const box = openOutbox(failing, store, { retryMs: 60_000 });
    const entry = await box.send(newChatKey().pub, give());
    expect(entry.error).toBe("relay refused the size");
    expect(await box.list()).toHaveLength(1);
    await box.flush();
    expect(store.get(entry.key)!.tries).toBe(2);
    expect(failing.published.map((p) => p.id)).toEqual([entry.wrap!.id, entry.wrap!.id]);
    await box.forget(entry.key);
    expect(await box.list()).toHaveLength(0);
    box.close();
  });

  test("a malformed envelope or a replyTo that is not the chat key is refused before anything is written", async () => {
    const store = new Map<string, OutboxEntry>();
    const box = openOutbox(nostrTransport([]), store, { retryMs: 60_000 });
    await expect(box.send(newChatKey().pub, { v: 1, kind: "give", hand: { ...HAND } } as unknown as Envelope)).rejects.toThrow(/give link/);
    const key = newChatKey();
    await expect(box.send(newChatKey().pub, { ...give(), replyTo: newChatKey().pub }, key.secret)).rejects.toThrow(/replyTo/);
    expect(store.size).toBe(0);
    box.close();
  });

  test("works over an async key-value store, as IndexedDB is", async () => {
    const map = new Map<string, OutboxEntry>();
    const asyncStore = {
      get: async (k: string) => structuredClone(map.get(k)),
      set: async (k: string, v: OutboxEntry) => void map.set(k, structuredClone(v)),
      delete: async (k: string) => void map.delete(k),
      keys: async () => [...map.keys()],
    };
    const relay = await spawnRelay(freePort());
    try {
      const box = openOutbox(nostrTransport([relay.url]), asyncStore, { retryMs: 60_000 });
      const sent = await box.send(newChatKey().pub, give());
      expect(sent.acks).toBe(1);
      expect((await box.list())[0]).toEqual(sent);
      box.close();
    } finally {
      await relay.stop();
    }
  });
});
