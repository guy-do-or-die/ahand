import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from "nostr-tools/pure";
import { MAX_EVENT_BYTES, MAX_EVENTS, MAX_MESSAGE_BYTES, MAX_REPLY_BYTES, MAX_STORED_BYTES, startRelay, type RunningRelay } from "../relay.ts";

// This package's tests use ports 15100–15119 (the delivery package's use 15120–15149);
// RELAY_TEST_PORTS="from-to" picks another range, for agents that share one machine.
const [PORTS_FROM, PORTS_TO] = (process.env.RELAY_TEST_PORTS ?? "15100-15119").split("-").map(Number) as [number, number];
async function freePort(from = PORTS_FROM, to = PORTS_TO): Promise<number> {
  for (let port = from; port <= to; port++) {
    try {
      const probe = Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } });
      probe.stop(true);
      return port;
    } catch {
      // taken
    }
  }
  throw new Error(`no free port in ${from}–${to}`);
}

/** A small NIP-01 client over one socket that records everything the relay says. */
async function client(url: string) {
  const ws = new WebSocket(url);
  const got: unknown[][] = [];
  const waiters: Array<() => void> = [];
  ws.onmessage = (m) => {
    got.push(JSON.parse(String(m.data)));
    waiters.splice(0).forEach((w) => w());
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("no connection"));
  });
  const until = async (pred: (m: unknown[]) => boolean, ms = 2000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = got.find(pred);
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error("timed out");
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, 50);
      });
    }
  };
  return { ws, got, until, send: (m: unknown[]) => ws.send(JSON.stringify(m)) };
}

const pTo = getPublicKey(generateSecretKey());
const other = getPublicKey(generateSecretKey());
function wrapLike(p: string, created_at: number, content = "opaque"): NostrEvent {
  return finalizeEvent({ kind: 1059, created_at, tags: [["p", p]], content }, generateSecretKey());
}

let relay: RunningRelay;
const lines: string[] = [];

beforeAll(async () => {
  relay = startRelay({ port: await freePort(), log: (l) => lines.push(l) });
});
afterAll(async () => {
  await relay.stop();
});

describe("stand relay", () => {
  test("accepts a verified gift wrap with OK true, and a second copy as a duplicate", async () => {
    const c = await client(relay.url);
    const e = wrapLike(pTo, 1_700_000_000);
    c.send(["EVENT", e]);
    expect(await c.until((m) => m[0] === "OK" && m[1] === e.id)).toEqual(["OK", e.id, true, ""]);
    c.send(["EVENT", e]);
    await c.until((m) => m[0] === "OK" && m[1] === e.id && String(m[3]).startsWith("duplicate"));
    c.ws.close();
  });

  test("refuses other kinds, a broken signature, a changed id and malformed events with OK false", async () => {
    const c = await client(relay.url);
    const note = finalizeEvent({ kind: 1, created_at: 1_700_000_000, tags: [], content: "hi" }, generateSecretKey());
    c.send(["EVENT", note]);
    const a = await c.until((m) => m[0] === "OK" && m[1] === note.id);
    expect(a[2]).toBe(false);
    expect(String(a[3])).toStartWith("blocked:");

    const forged = { ...wrapLike(pTo, 1_700_000_001) };
    forged.content = "changed after signing"; // the id no longer matches
    c.send(["EVENT", forged]);
    const b = await c.until((m) => m[0] === "OK" && m[1] === forged.id);
    expect(b[2]).toBe(false);

    const badSig = { ...wrapLike(pTo, 1_700_000_002) };
    badSig.sig = badSig.sig.replace(/^./, (ch) => (ch === "0" ? "1" : "0"));
    c.send(["EVENT", badSig]);
    const d = await c.until((m) => m[0] === "OK" && m[1] === badSig.id);
    expect(d[2]).toBe(false);

    c.send(["EVENT", { id: "x", kind: 1059 }]);
    const f = await c.until((m) => m[0] === "OK" && m[1] === "x");
    expect(f[2]).toBe(false);
    c.ws.close();
  });

  test("REQ honours kinds, #p and since, ends stored events with EOSE, then pushes new ones until CLOSE", async () => {
    const pub = await client(relay.url);
    const old = wrapLike(pTo, 1_600_000_000);
    const fresh = wrapLike(pTo, 1_800_000_000);
    const elsewhere = wrapLike(other, 1_800_000_000);
    for (const e of [old, fresh, elsewhere]) {
      pub.send(["EVENT", e]);
      await pub.until((m) => m[0] === "OK" && m[1] === e.id);
    }

    const sub = await client(relay.url);
    sub.send(["REQ", "s1", { kinds: [1059], "#p": [pTo], since: 1_799_999_999 }]);
    await sub.until((m) => m[0] === "EOSE" && m[1] === "s1");
    const before = sub.got.filter((m) => m[0] === "EVENT").map((m) => (m[2] as NostrEvent).id);
    expect(before).toEqual([fresh.id]);

    sub.send(["REQ", "s2", { kinds: [1] }]);
    await sub.until((m) => m[0] === "EOSE" && m[1] === "s2");
    expect(sub.got.filter((m) => m[0] === "EVENT" && m[1] === "s2")).toHaveLength(0);

    const live = wrapLike(pTo, 1_800_000_100);
    pub.send(["EVENT", live]);
    const pushed = await sub.until((m) => m[0] === "EVENT" && m[1] === "s1" && (m[2] as NostrEvent).id === live.id);
    expect(pushed[2]).toEqual(JSON.parse(JSON.stringify(live)));

    sub.send(["CLOSE", "s1"]);
    await Bun.sleep(50);
    const after = wrapLike(pTo, 1_800_000_200);
    pub.send(["EVENT", after]);
    await pub.until((m) => m[0] === "OK" && m[1] === after.id);
    await Bun.sleep(100);
    expect(sub.got.some((m) => m[0] === "EVENT" && (m[2] as NostrEvent).id === after.id)).toBe(false);
    pub.ws.close();
    sub.ws.close();
  });

  test("answers nonsense with NOTICE and a bad filter with CLOSED", async () => {
    const c = await client(relay.url);
    c.ws.send("not json");
    await c.until((m) => m[0] === "NOTICE");
    c.send(["REQ", "bad", { kinds: ["1059"] }]);
    const closed = await c.until((m) => m[0] === "CLOSED");
    expect(closed[1]).toBe("bad");
    c.ws.close();
  });

  test("the log holds counts only: no content, no event id, no key", async () => {
    const secretContent = "content-that-must-not-be-logged";
    const c = await client(relay.url);
    const e = wrapLike(pTo, 1_700_000_500, secretContent);
    c.send(["EVENT", e]);
    await c.until((m) => m[0] === "OK" && m[1] === e.id);
    c.ws.close();
    const all = lines.join("\n");
    expect(all).toContain("stored");
    for (const needle of [secretContent, e.id, e.pubkey, e.sig, pTo]) expect(all).not.toContain(needle);
  });
});

/** A gift-wrap-shaped event whose JSON is exactly `bytes` long (ASCII content). */
function wrapOfSize(bytes: number, created_at: number, p = pTo): NostrEvent {
  const base = wrapLike(p, created_at, "");
  const pad = bytes - JSON.stringify(base).length;
  if (pad < 0) throw new Error("too small");
  const e = wrapLike(p, created_at, "x".repeat(pad));
  expect(JSON.stringify(e).length).toBe(bytes);
  return e;
}

/** Ids the relay returns for the filter (by default every stored gift wrap), in its order. */
async function storedIds(url: string, filter: Record<string, unknown> = { kinds: [1059] }): Promise<string[]> {
  const c = await client(url);
  const subId = `all-${Math.random().toString(36).slice(2)}`;
  c.send(["REQ", subId, filter]);
  await c.until((m) => m[0] === "EOSE" && m[1] === subId, 10_000);
  c.ws.close();
  return c.got.filter((m) => m[0] === "EVENT").map((m) => (m[2] as NostrEvent).id);
}

describe("stand relay limits", () => {
  test("the limits are 64 KiB per event, 64 MiB and 10 000 events in all, and NIP-11 says so", async () => {
    expect(MAX_EVENT_BYTES).toBe(64 * 1024);
    expect(MAX_STORED_BYTES).toBe(64 * 1024 * 1024);
    expect(MAX_EVENTS).toBe(10_000);
    expect(MAX_MESSAGE_BYTES).toBeGreaterThan(MAX_EVENT_BYTES);
    expect(MAX_REPLY_BYTES).toBe(8 * 1024 * 1024);
    const info = await fetch(`http://127.0.0.1:${relay.port}/`, { headers: { accept: "application/nostr+json" } }).then((r) => r.json());
    expect(info.limitation.max_message_length).toBe(MAX_MESSAGE_BYTES);
    expect(info.limitation.max_content_length).toBe(MAX_EVENT_BYTES);
  });

  test("an event over 64 KiB gets OK false and the connection stays open; one at 64 KiB is kept", async () => {
    const c = await client(relay.url);
    const big = wrapOfSize(MAX_EVENT_BYTES + 1, 1_700_001_000);
    c.send(["EVENT", big]);
    const no = await c.until((m) => m[0] === "OK" && m[1] === big.id);
    expect(no[2]).toBe(false);
    expect(String(no[3])).toStartWith("invalid:");
    const fits = wrapOfSize(MAX_EVENT_BYTES, 1_700_001_001);
    c.send(["EVENT", fits]);
    expect(await c.until((m) => m[0] === "OK" && m[1] === fits.id)).toEqual(["OK", fits.id, true, ""]);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    c.ws.close();
    const kept = await storedIds(relay.url);
    expect(kept).toContain(fits.id);
    expect(kept).not.toContain(big.id);
  });

  test("past the byte budget the oldest events go first, and the stored bytes stay within it", async () => {
    const size = 10_000;
    const r = startRelay({ port: await freePort(), log: () => {}, limits: { maxStoredBytes: 3 * size + 500 } });
    try {
      const c = await client(r.url);
      const sent: NostrEvent[] = [];
      for (let i = 0; i < 5; i++) {
        const e = wrapOfSize(size, 1_700_002_000 + i);
        sent.push(e);
        c.send(["EVENT", e]);
        await c.until((m) => m[0] === "OK" && m[1] === e.id && m[2] === true);
      }
      c.ws.close();
      expect(r.counts().stored).toBe(3);
      expect(r.counts().storedBytes).toBe(3 * size);
      expect((await storedIds(r.url)).sort()).toEqual(sent.slice(2).map((e) => e.id).sort());
      // An evicted event can be published again: the relay no longer counts it a duplicate.
      const again = await client(r.url);
      again.send(["EVENT", sent[0]]);
      expect(await again.until((m) => m[0] === "OK" && m[1] === sent[0]!.id)).toEqual(["OK", sent[0]!.id, true, ""]);
      again.ws.close();
      expect(r.counts().stored).toBe(3);
    } finally {
      await r.stop();
    }
  });

  test("past the event count the oldest events go first", async () => {
    const r = startRelay({ port: await freePort(), log: () => {}, limits: { maxEvents: 2 } });
    try {
      const c = await client(r.url);
      const sent = [0, 1, 2].map((i) => wrapLike(pTo, 1_700_003_000 + i));
      for (const e of sent) {
        c.send(["EVENT", e]);
        await c.until((m) => m[0] === "OK" && m[1] === e.id && m[2] === true);
      }
      c.ws.close();
      expect(r.counts().stored).toBe(2);
      expect((await storedIds(r.url)).sort()).toEqual(sent.slice(1).map((e) => e.id).sort());
    } finally {
      await r.stop();
    }
  });

  test("at the real defaults, 1 030 events of 64 KiB leave at most 64 MiB stored, oldest gone; one REQ gets 8 MiB, newest first", async () => {
    const r = startRelay({ port: await freePort(), log: () => {} });
    try {
      const c = await client(r.url);
      const total = 1_030;
      const fit = Math.floor(MAX_STORED_BYTES / MAX_EVENT_BYTES); // 1 024
      const all: string[] = [];
      let last = "";
      for (let i = 0; i < total; i++) {
        const e = wrapOfSize(MAX_EVENT_BYTES, 1_700_004_000 + i);
        all.push(e.id);
        last = e.id;
        c.send(["EVENT", e]);
        if (i % 100 === 99) await c.until((m) => m[0] === "OK" && m[1] === e.id, 10_000);
      }
      await c.until((m) => m[0] === "OK" && m[1] === last, 10_000);
      expect(c.got.filter((m) => m[0] === "OK" && m[2] === true)).toHaveLength(total);
      c.ws.close();
      expect(r.counts().stored).toBe(fit);
      expect(r.counts().storedBytes).toBe(fit * MAX_EVENT_BYTES);
      expect(r.counts().storedBytes).toBeLessThanOrEqual(MAX_STORED_BYTES);
      // The oldest six are gone, the next one and the newest are there (asked by id: small answers).
      expect(await storedIds(r.url, { ids: all.slice(0, total - fit) })).toEqual([]);
      expect(await storedIds(r.url, { ids: [all[total - fit], last] })).toEqual([last, all[total - fit]!]);
      // Everything asked at once: the newest 8 MiB worth, newest first, then EOSE.
      const answer = await storedIds(r.url);
      const perReply = Math.floor(MAX_REPLY_BYTES / MAX_EVENT_BYTES); // 128
      expect(answer).toEqual(all.slice(-perReply).reverse());
    } finally {
      await r.stop();
    }
  }, 60_000);
});

describe("relay as a program", () => {
  test("listens on PORT, serves NIP-11, and stops on SIGTERM", async () => {
    const port = await freePort();
    const proc = Bun.spawn(["bun", `${import.meta.dir}/../relay.ts`], {
      env: { ...process.env, PORT: String(port) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = proc.stdout.getReader();
    let out = "";
    while (!out.includes("listening")) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    expect(out).toContain(`ws://127.0.0.1:${port}`);
    const info = await fetch(`http://127.0.0.1:${port}/`, { headers: { accept: "application/nostr+json" } }).then((r) => r.json());
    expect(info.supported_nips).toContain(1);
    proc.kill("SIGTERM");
    expect(await proc.exited).toBe(0);
  });

  test("refuses to start without PORT", async () => {
    const env = { ...process.env };
    delete env.PORT;
    const proc = Bun.spawn(["bun", `${import.meta.dir}/../relay.ts`], { env, stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(2);
  });
});
