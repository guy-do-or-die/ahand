import { describe, expect, test } from "bun:test";
import { createRumor, createSeal, createWrap } from "nostr-tools/nip59";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex } from "nostr-tools/utils";
import { checkEnvelope, newChatKey, publicKeyOf, unwrapEnvelope, wrapEnvelope, type Envelope } from "../src/index.ts";
import { HAND, longGiveLink } from "./helpers.ts";

const inbox = newChatKey();
const giver = newChatKey();

const give = (giveLink = "http://127.0.0.1:18300/#abc"): Envelope => ({
  v: 1,
  kind: "give",
  hand: { ...HAND },
  giveLink,
  text: "I can fix the fence on Saturday.",
  replyTo: giver.pub,
});

describe("NIP-17 layers", () => {
  test("a wrap is kind 1059 to the inbox key, and its rumor opens to exactly the envelope", () => {
    const { wrap, id } = wrapEnvelope(inbox.pub, give(), giver.secret, 1_700_000_000);
    expect(wrap.kind).toBe(1059);
    expect(wrap.tags).toEqual([["p", inbox.pub.slice(2)]]);
    expect(wrap.pubkey).not.toBe(giver.pub.slice(2)); // a throwaway key signs the wrap
    expect(wrap.content).not.toContain("fence");
    const opened = unwrapEnvelope(wrap, inbox.secret);
    expect(opened).toEqual({ envelope: give(), from: giver.pub, id, at: 1_700_000_000 });
  });

  test("the same time gives the same message id; the wraps differ", () => {
    const a = wrapEnvelope(inbox.pub, give(), giver.secret, 1_700_000_000);
    const b = wrapEnvelope(inbox.pub, give(), giver.secret, 1_700_000_000);
    expect(a.id).toBe(b.id);
    expect(a.wrap.id).not.toBe(b.wrap.id);
  });

  test("a third key cannot unwrap the gift wrap, nor can the sender's own key", () => {
    const { wrap } = wrapEnvelope(inbox.pub, give(), giver.secret);
    expect(() => unwrapEnvelope(wrap, newChatKey().secret)).toThrow();
    expect(() => unwrapEnvelope(wrap, giver.secret)).toThrow();
  });

  test("a seal whose author differs from the rumor's is rejected", () => {
    const mallory = generateSecretKey();
    const victim = generateSecretKey();
    // The rumor claims to come from the victim (and names the victim as replyTo); Mallory seals it.
    const envelope = { ...give(), replyTo: `0x${getPublicKey(victim)}` };
    const rumor = createRumor({ kind: 14, content: JSON.stringify(envelope), tags: [["p", inbox.pub.slice(2)]] }, victim);
    const wrap = createWrap(createSeal(rumor, mallory, inbox.pub.slice(2)), inbox.pub.slice(2));
    expect(() => unwrapEnvelope(wrap, inbox.secret)).toThrow(/seal's author/);
  });

  test("an envelope whose replyTo is not its sender's key is refused on both sides", () => {
    const other = newChatKey();
    expect(() => wrapEnvelope(inbox.pub, { ...give(), replyTo: other.pub }, giver.secret)).toThrow(/replyTo/);
    const sk = generateSecretKey();
    const rumor = createRumor({ kind: 14, content: JSON.stringify({ ...give(), replyTo: other.pub }), tags: [["p", inbox.pub.slice(2)]] }, sk);
    const wrap = createWrap(createSeal(rumor, sk, inbox.pub.slice(2)), inbox.pub.slice(2));
    expect(() => unwrapEnvelope(wrap, inbox.secret)).toThrow(/replyTo/);
  });

  test("a rumor not addressed to the reader, of another kind, or with a changed id is refused", () => {
    const sk = generateSecretKey();
    const me = inbox.pub.slice(2);
    const content = JSON.stringify({ ...give(), replyTo: `0x${getPublicKey(sk)}` });
    const notToMe = createRumor({ kind: 14, content, tags: [["p", getPublicKey(generateSecretKey())]] }, sk);
    expect(() => unwrapEnvelope(createWrap(createSeal(notToMe, sk, me), me), inbox.secret)).toThrow(/addressed/);
    const otherKind = createRumor({ kind: 1, content, tags: [["p", me]] }, sk);
    expect(() => unwrapEnvelope(createWrap(createSeal(otherKind, sk, me), me), inbox.secret)).toThrow(/direct message/);
    const changed = { ...createRumor({ kind: 14, content, tags: [["p", me]] }, sk), id: "00".repeat(32) };
    expect(() => unwrapEnvelope(createWrap(createSeal(changed, sk, me), me), inbox.secret)).toThrow(/id/);
    const notJson = createRumor({ kind: 14, content: "hello", tags: [["p", me]] }, sk);
    expect(() => unwrapEnvelope(createWrap(createSeal(notJson, sk, me), me), inbox.secret)).toThrow(/envelope/);
  });

  test("a give envelope of 2 000 bytes round-trips unchanged", () => {
    const link = longGiveLink(2000);
    expect(new TextEncoder().encode(link).length).toBe(2000);
    const env = give(link);
    const { wrap } = wrapEnvelope(inbox.pub, env, giver.secret);
    expect(unwrapEnvelope(wrap, inbox.secret).envelope).toEqual(env);
  });

  test("no size cap below NIP-44's: a 40 kB give link and non-Latin text round-trip", () => {
    const env = { ...give(longGiveLink(40_000)), text: "Помогу в субботу 🙌 — 土曜日" };
    const { wrap } = wrapEnvelope(inbox.pub, env, giver.secret);
    expect(unwrapEnvelope(wrap, inbox.secret).envelope).toEqual(env);
  });
});

describe("envelope shape", () => {
  test("keeps the documented fields, drops others, and prefixes keys", () => {
    const raw = { ...give(), replyTo: giver.pub.slice(2).toUpperCase(), extra: "dropped" } as unknown;
    const clean = checkEnvelope(raw);
    expect(clean).toEqual(give());
    expect("extra" in clean).toBe(false);
  });

  test.each([
    ["unknown version", { v: 2 }],
    ["unknown kind", { kind: "spam" }],
    ["a give without its link", { giveLink: undefined }],
    ["a bad chain id", { hand: { ...HAND, chainId: 0 } }],
    ["a bad core", { hand: { ...HAND, core: "0x12" } }],
    ["a hand id that is not a number", { hand: { ...HAND, handId: "0x07" } }],
    ["a short replyTo", { replyTo: "0x1234" }],
  ])("refuses %s", (_what, change) => {
    expect(() => checkEnvelope({ ...give(), ...change })).toThrow();
  });

  test("a note needs text", () => {
    expect(() => checkEnvelope({ v: 1, kind: "note", hand: HAND, replyTo: giver.pub })).toThrow(/text/);
    expect(checkEnvelope({ v: 1, kind: "note", hand: HAND, text: "ok", replyTo: giver.pub }).text).toBe("ok");
  });

  test("chat keys are random 32-byte x-only keys with their public halves", () => {
    const a = newChatKey();
    const b = newChatKey();
    expect(a.secret).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.pub).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.secret).not.toBe(b.secret);
    expect(publicKeyOf(a.secret)).toBe(a.pub);
    const sk = generateSecretKey();
    expect(publicKeyOf(bytesToHex(sk))).toBe(`0x${getPublicKey(sk)}`);
  });
});
