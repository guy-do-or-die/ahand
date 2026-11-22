/**
 * Opt-in checks against the recommended public relays; `bun run check` skips both, so it contacts
 * no host beyond 127.0.0.1.
 *
 *   DELIVER_LIVE_RELAYS=1 bun test tests/live.test.ts     read only: publishes nothing
 *   DELIVER_LIVE_PUBLISH=1 bun test tests/live.test.ts    publishes one gift wrap per relay
 *
 * The read check asks every relay for gift wraps to a fresh random key and expects each to answer
 * in full (EOSE), authenticating with NIP-42 where a relay asks (an AUTH event is not stored).
 *
 * The publish check sends what delivery sends: one gift wrap (kind 1059) to a fresh random key,
 * carrying a note with random text, its wrap back-dated 47 hours (NIP-59 allows up to two days, and
 * a relay with a narrow time window would refuse it). It expects every relay to acknowledge it and
 * then to give it back, on a new connection, to the listener's own filter.
 */
import { expect, test } from "bun:test";
import { encrypt, getConversationKey } from "nostr-tools/nip44";
import { createRumor, createSeal } from "nostr-tools/nip59";
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from "nostr-tools/pure";
import { GIFT_WRAP_KIND, RECOMMENDED_RELAYS, RUMOR_KIND, newChatKey, nostrTransport, type Envelope, type Hex, type RelayRead } from "../src/index.ts";
import { HAND, until } from "./helpers.ts";

const urls = RECOMMENDED_RELAYS.map((r) => r.url);

test.skipIf(process.env.DELIVER_LIVE_RELAYS !== "1")(
  "every recommended relay answers a read of kind 1059 in full",
  async () => {
    const reads = new Map<string, RelayRead>();
    const stop = nostrTransport(urls, { timeoutMs: 8000 }).listen(newChatKey().secret, () => {}, undefined, {
      onRelay: (r) => void reads.set(r.url, r),
    });
    try {
      await until(() => urls.every((u) => reads.get(u)?.state === "read"), 15_000, "every relay to answer").catch(() => {});
      expect(Object.fromEntries(urls.map((u) => [u, reads.get(u) ?? { url: u, state: "no answer" }]))).toEqual(
        Object.fromEntries(urls.map((u) => [u, { url: u, state: "read" }])),
      );
    } finally {
      stop();
    }
  },
  20_000,
);

/** A NIP-17 gift wrap of a note to `to` (x-only, bare hex), its wrap dated `wrapAt`; and the rumor id. */
function backDatedWrap(to: string, wrapAt: number): { wrap: NostrEvent; id: string } {
  const chat = generateSecretKey();
  const envelope: Envelope = { v: 1, kind: "note", hand: { ...HAND }, text: crypto.randomUUID(), replyTo: `0x${getPublicKey(chat)}` as Hex };
  const rumor = createRumor({ kind: RUMOR_KIND, content: JSON.stringify(envelope), tags: [["p", to]], created_at: Math.floor(Date.now() / 1000) }, chat);
  const seal = createSeal(rumor, chat, to);
  const throwaway = generateSecretKey();
  const wrap = finalizeEvent(
    { kind: GIFT_WRAP_KIND, created_at: wrapAt, tags: [["p", to]], content: encrypt(JSON.stringify(seal), getConversationKey(throwaway, to)) },
    throwaway,
  );
  return { wrap, id: rumor.id };
}

test.skipIf(process.env.DELIVER_LIVE_PUBLISH !== "1")(
  "every recommended relay takes a gift wrap back-dated 47 hours and gives it back by #p",
  async () => {
    const inbox = newChatKey();
    const now = Math.floor(Date.now() / 1000);
    const { wrap, id } = backDatedWrap(inbox.pub.slice(2), now - 47 * 3600);
    const transport = nostrTransport(urls, { timeoutMs: 8000 });
    const answers = await transport.publish(wrap);
    expect(Object.fromEntries(answers.map((a) => [a.url, a.ok ? "ok" : a.reason]))).toEqual(Object.fromEntries(urls.map((u) => [u, "ok"])));

    // One listener per relay, each on a new connection, so every relay has to give it back itself.
    const heard = new Map<string, string>();
    const stops = urls.map((url) => nostrTransport([url], { timeoutMs: 8000 }).listen(inbox.secret, (_e, _from, meta) => void heard.set(url, meta.id), now - 60));
    try {
      await until(() => heard.size === urls.length, 15_000, "every relay to give it back").catch(() => {});
      expect(Object.fromEntries(urls.map((u) => [u, heard.get(u) ?? "not given back"]))).toEqual(Object.fromEntries(urls.map((u) => [u, id])));
    } finally {
      stops.forEach((stop) => stop());
    }
  },
  40_000,
);
