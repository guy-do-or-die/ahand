/**
 * Live tests: the stand relay runs as its own process (infra/relay/relay.ts) on a port of this
 * package's range, and two transports talk through it. No other host is contacted.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { newChatKey, nostrTransport, publicKeyOf, type Envelope, type Hex, type Meta } from "../src/index.ts";
import { freePort, HAND, longGiveLink, spawnRelay, until, type RelayProcess } from "./helpers.ts";

let relay: RelayProcess;
beforeAll(async () => {
  relay = await spawnRelay(freePort());
});
afterAll(async () => {
  await relay.stop();
});

type Got = { envelope: Envelope; from: Hex; meta: Meta };
const collect = () => {
  const got: Got[] = [];
  return { got, on: (envelope: Envelope, from: Hex, meta: Meta) => got.push({ envelope, from, meta }) };
};

describe("two transports through the stand relay", () => {
  test("a give and two notes round-trip; each side gets exactly what was sent and the right replyTo", async () => {
    const inbox = newChatKey(); // the Hand's inbox (inbox.n1 is its public half)
    const raiserSide = nostrTransport([relay.url]);
    const giverSide = nostrTransport([relay.url]);
    const atRaiser = collect();
    const atGiver = collect();
    const since = Math.floor(Date.now() / 1000) - 5;
    const stopRaiser = raiserSide.listen(inbox.secret, atRaiser.on, since);

    // 1. The giver sends the give with no key of its own: a fresh chat key is made and handed back.
    const give = { v: 1, kind: "give", hand: { ...HAND }, giveLink: longGiveLink(600), text: "I can fix it on Saturday." } as const;
    const sentGive = await giverSide.send(inbox.pub, give);
    expect(sentGive).toMatchObject({ acks: 1, of: 1 });
    expect(sentGive.key).toMatch(/^0x[0-9a-f]{64}$/);
    const giverPub = publicKeyOf(sentGive.key);
    const stopGiver = giverSide.listen(sentGive.key, atGiver.on, since);

    await until(() => atRaiser.got.length === 1, 5000, "the give");
    expect(atRaiser.got[0]!.envelope).toEqual({ ...give, hand: { ...HAND }, replyTo: giverPub });
    expect(atRaiser.got[0]!.from).toBe(giverPub);
    expect(atRaiser.got[0]!.meta.id).toBe(sentGive.id);

    // 2. The raiser answers to replyTo, signing with the inbox key.
    const reply: Envelope = { v: 1, kind: "note", hand: { ...HAND }, text: "Saturday works. Thank you!", replyTo: inbox.pub };
    expect(await raiserSide.send(atRaiser.got[0]!.envelope.replyTo, reply, inbox.secret)).toMatchObject({ acks: 1, of: 1 });
    await until(() => atGiver.got.length === 1, 5000, "the raiser's note");
    expect(atGiver.got[0]!.envelope).toEqual(reply);
    expect(atGiver.got[0]!.from).toBe(inbox.pub);

    // 3. The giver writes again in the same thread, with the kept key.
    const again: Envelope = { v: 1, kind: "note", hand: { ...HAND }, text: "See you at ten.", replyTo: giverPub };
    expect(await giverSide.send(atGiver.got[0]!.envelope.replyTo, again, sentGive.key)).toMatchObject({ acks: 1, of: 1 });
    await until(() => atRaiser.got.length === 2, 5000, "the giver's second note");
    expect(atRaiser.got[1]!.envelope).toEqual(again);
    expect(atRaiser.got[1]!.envelope.replyTo).toBe(giverPub);

    await Bun.sleep(200);
    expect(atRaiser.got).toHaveLength(2);
    expect(atGiver.got).toHaveLength(1);
    stopRaiser();
    stopGiver();
  });

  test("a give envelope of 2 000 bytes round-trips through the relay unchanged", async () => {
    const inbox = newChatKey();
    const t = nostrTransport([relay.url]);
    const at = collect();
    const stop = t.listen(inbox.secret, at.on);
    const key = newChatKey();
    const env: Envelope = { v: 1, kind: "give", hand: { ...HAND }, giveLink: longGiveLink(2000), replyTo: key.pub };
    expect(new TextEncoder().encode(env.giveLink!).length).toBe(2000);
    expect(await t.send(inbox.pub, env, key.secret)).toMatchObject({ acks: 1, of: 1 });
    await until(() => at.got.length === 1, 5000, "the long give");
    expect(at.got[0]!.envelope).toEqual(env);
    stop();
  });

  test("a message sent twice with the same time reaches the listener once; older messages than `since` are skipped", async () => {
    const inbox = newChatKey();
    const t = nostrTransport([relay.url]);
    const key = newChatKey();
    const now = Math.floor(Date.now() / 1000);
    const note = (text: string): Envelope => ({ v: 1, kind: "note", hand: { ...HAND }, text, replyTo: key.pub });
    const first = await t.send(inbox.pub, note("retry me"), key.secret, now);
    const second = await t.send(inbox.pub, note("retry me"), key.secret, now);
    expect(second.id).toBe(first.id);
    await t.send(inbox.pub, note("too old"), key.secret, now - 3600);
    const at = collect();
    const stop = t.listen(inbox.secret, at.on, now - 60);
    await until(() => at.got.length >= 1, 5000, "the retried note");
    await Bun.sleep(300);
    expect(at.got.map((g) => g.envelope.text)).toEqual(["retry me"]);
    stop();
  });

  test("only the addressed key hears a message", async () => {
    const inbox = newChatKey();
    const stranger = newChatKey();
    const t = nostrTransport([relay.url]);
    const atStranger = collect();
    const stop = t.listen(stranger.secret, atStranger.on);
    const key = newChatKey();
    await t.send(inbox.pub, { v: 1, kind: "note", hand: { ...HAND }, text: "for the inbox only", replyTo: key.pub }, key.secret);
    await Bun.sleep(300);
    expect(atStranger.got).toHaveLength(0);
    stop();
  });

  test("a listener reconnects after the relay restarts and hears what arrives afterwards", async () => {
    const port = freePort();
    let own = await spawnRelay(port);
    const inbox = newChatKey();
    const t = nostrTransport([own.url], { maxBackoffMs: 500 });
    const at = collect();
    const stop = t.listen(inbox.secret, at.on);
    await Bun.sleep(150);
    await own.stop();
    await Bun.sleep(300);
    own = await spawnRelay(port);
    const key = newChatKey();
    const sent = await t.send(inbox.pub, { v: 1, kind: "note", hand: { ...HAND }, text: "after the restart", replyTo: key.pub }, key.secret);
    expect(sent).toMatchObject({ acks: 1, of: 1 });
    await until(() => at.got.length === 1, 5000, "the note after the restart");
    stop();
    await own.stop();
  });
});

describe("acknowledgements", () => {
  test("one live relay and one dead address: {acks: 1, of: 2}", async () => {
    const dead = `ws://127.0.0.1:${freePort()}`;
    const t = nostrTransport([relay.url, dead]);
    const key = newChatKey();
    const sent = await t.send(newChatKey().pub, { v: 1, kind: "note", hand: { ...HAND }, text: "hello", replyTo: key.pub }, key.secret);
    expect({ acks: sent.acks, of: sent.of }).toEqual({ acks: 1, of: 2 });
  });

  test("a relay that answers OK false, or answers nothing within 3 s, is not counted", async () => {
    const quietPort = freePort();
    const falsePort = freePort();
    const quiet = Bun.serve({
      port: quietPort,
      hostname: "127.0.0.1",
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("no")),
      websocket: { message() {} },
    });
    const refusing = Bun.serve({
      port: falsePort,
      hostname: "127.0.0.1",
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("no")),
      websocket: {
        message(ws, raw) {
          const [, event] = JSON.parse(String(raw));
          ws.send(JSON.stringify(["OK", event.id, false, "blocked: test"]));
        },
      },
    });
    try {
      const t = nostrTransport([relay.url, `ws://127.0.0.1:${quietPort}`, `ws://127.0.0.1:${falsePort}`]);
      const key = newChatKey();
      const started = Date.now();
      const sent = await t.send(newChatKey().pub, { v: 1, kind: "note", hand: { ...HAND }, text: "hello", replyTo: key.pub }, key.secret);
      const took = Date.now() - started;
      expect({ acks: sent.acks, of: sent.of }).toEqual({ acks: 1, of: 3 });
      expect(took).toBeGreaterThanOrEqual(2900);
      expect(took).toBeLessThan(4500);
    } finally {
      await quiet.stop(true);
      await refusing.stop(true);
    }
  });

  test("an OK for another event id is not an acknowledgement", async () => {
    const port = freePort();
    const liar = Bun.serve({
      port,
      hostname: "127.0.0.1",
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("no")),
      websocket: { message: (ws) => void ws.send(JSON.stringify(["OK", "00".repeat(32), true, ""])) },
    });
    try {
      const t = nostrTransport([`ws://127.0.0.1:${port}`], { timeoutMs: 500 });
      const key = newChatKey();
      const sent = await t.send(newChatKey().pub, { v: 1, kind: "note", hand: { ...HAND }, text: "x", replyTo: key.pub }, key.secret);
      expect({ acks: sent.acks, of: sent.of }).toEqual({ acks: 0, of: 1 });
    } finally {
      await liar.stop(true);
    }
  });

  test("no relays configured: nothing is contacted and {acks: 0, of: 0}", async () => {
    const key = newChatKey();
    const sent = await nostrTransport([]).send(newChatKey().pub, { v: 1, kind: "note", hand: { ...HAND }, text: "x", replyTo: key.pub }, key.secret);
    expect({ acks: sent.acks, of: sent.of }).toEqual({ acks: 0, of: 0 });
  });

  test("relay addresses must be WebSocket URLs", () => {
    expect(() => nostrTransport(["http://127.0.0.1:1"])).toThrow(/WebSocket address/);
  });
});
