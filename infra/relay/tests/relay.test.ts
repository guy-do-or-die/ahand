import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from "nostr-tools/pure";
import { startRelay, type RunningRelay } from "../relay.ts";

// This package's tests use ports 15100–15119; the delivery package's use 15120–15149.
async function freePort(from = 15100, to = 15119): Promise<number> {
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
