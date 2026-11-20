/**
 * The outbox against the real stand relay process: stopped, then started again on the same port.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { newChatKey, nostrTransport, openOutbox, type Envelope, type GiveTransport, type OutboxEntry } from "../src/index.ts";
import { freePort, HAND, longGiveLink, spawnRelay, until } from "./helpers.ts";

const give = (): Omit<Envelope, "replyTo"> => ({ v: 1, kind: "give", hand: { ...HAND }, giveLink: longGiveLink(300) });

describe("outbox", () => {
  test("relay stopped: {acks: 0, of: 1} and the envelope is kept; after the relay returns the timer delivers it, once", async () => {
    const port = freePort();
    const url = `ws://127.0.0.1:${port}`;
    const inbox = newChatKey();
    const store = new Map<string, OutboxEntry>();
    const box = openOutbox(nostrTransport([url], { maxBackoffMs: 300 }), store, { everyMs: 250 });
    try {
      const first = await box.send(inbox.pub, give());
      expect({ acks: first.acks, of: first.of }).toEqual({ acks: 0, of: 1 });
      expect(first.deliveredAt).toBeUndefined();
      expect(store.get(first.key)).toEqual(first); // written down, chat key included
      expect(first.chatKey).toMatch(/^0x[0-9a-f]{64}$/);
      await Bun.sleep(600); // a few retry rounds with nobody there
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
        await Bun.sleep(700); // further rounds must not send it again
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
      const offline = openOutbox(nostrTransport([`ws://127.0.0.1:${freePort()}`]), store, { everyMs: 60_000 });
      const left = await offline.send(inbox.pub, give());
      offline.close();
      expect(left.acks).toBe(0);

      // Same store, a transport that now reaches a relay (as after a reload with the relay back).
      const changes: OutboxEntry[] = [];
      const box = openOutbox(nostrTransport([relay.url]), store, { everyMs: 60_000, onChange: (e) => changes.push(e) });
      await until(() => store.get(left.key)!.acks === 1, 5000, "the reopened outbox to deliver");
      expect(changes.at(-1)!.key).toBe(left.key);
      box.close();
    } finally {
      await relay.stop();
    }
  });

  test("a failure is recorded and the entry kept; forget is the only way out", async () => {
    const failing: GiveTransport = {
      send: async () => {
        throw new Error("relay refused the size");
      },
      listen: () => () => {},
    };
    const store = new Map<string, OutboxEntry>();
    const box = openOutbox(failing, store, { everyMs: 60_000 });
    const entry = await box.send(newChatKey().pub, give());
    expect(entry.error).toBe("relay refused the size");
    expect(await box.list()).toHaveLength(1);
    await box.flush();
    expect(store.get(entry.key)!.tries).toBe(2);
    await box.forget(entry.key);
    expect(await box.list()).toHaveLength(0);
    box.close();
  });

  test("a malformed envelope or a replyTo that is not the chat key is refused before anything is written", async () => {
    const store = new Map<string, OutboxEntry>();
    const box = openOutbox(nostrTransport([]), store, { everyMs: 60_000 });
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
      const box = openOutbox(nostrTransport([relay.url]), asyncStore, { everyMs: 60_000 });
      const sent = await box.send(newChatKey().pub, give());
      expect(sent.acks).toBe(1);
      expect((await box.list())[0]).toEqual(sent);
      box.close();
    } finally {
      await relay.stop();
    }
  });

  test("retries every 30 seconds by default, and close stops the timer", () => {
    const setSpy = spyOn(globalThis, "setInterval");
    const clearSpy = spyOn(globalThis, "clearInterval");
    try {
      const box = openOutbox(nostrTransport([]), new Map<string, OutboxEntry>());
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0]![1]).toBe(30_000);
      box.close();
      expect(clearSpy).toHaveBeenCalledWith(setSpy.mock.results[0]!.value);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });
});
