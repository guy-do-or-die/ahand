import { describe, expect, test } from "bun:test";
import { encodeGive, encodeLive, packAttachments, toAddress, toDigits, toText, type Hand } from "@ahand/sdk";
import { hexToBytes, keccak256, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { describeHand, giveAt, giverKey, liveLink, ownDomain, ownHand, ownOptions, payeeAt, rootSeed, testSalt } from "../../../../../packages/sdk/tests/link-fixtures";
import { outsideWords, readOffline, wordsOf } from "./offline";
import { rulerOf, splitPasted } from "./ruler";

const hand: Hand = ownHand();
const read = (link: Uint8Array, before = "") => readOffline(link, rulerOf(link), before);

describe("check offline: what a link's bytes say with no network", () => {
  test("a link nobody passed on yet: no passes, the whole reward left", async () => {
    const link = await encodeLive({ domain: ownDomain, hand, signedShakes: [], seed: rootSeed }, ownOptions);
    expect(read(link)).toEqual({ passes: [], leftBps: 10_000 });
  });

  test("each pass's share and payee, exactly as the SDK reads them with the Hand's terms", async () => {
    const shapes = [
      { paid: true, data: false },
      { paid: false, data: false },
      { paid: true, data: true },
    ];
    const { link, opened } = await liveLink(hand, 3, (position) => shapes[position]!);
    const reading = read(link);
    // The SDK proved this route against the Hand; the bytes alone must tell the same shares and payees.
    expect(reading.passes.map(({ claimBps, nextClaimBps }) => [claimBps, nextClaimBps])).toEqual(
      opened.signedShakes.map(({ shake }) => [shake.claimBps, shake.nextClaimBps]),
    );
    expect(reading.passes.map((pass) => pass.payee)).toEqual([payeeAt(0), undefined, payeeAt(2)]);
    expect(reading.passes.map((pass) => pass.ownWords)).toEqual([false, false, true]);
    expect(reading.passes.map((pass) => pass.position)).toEqual([0, 1, 2]);
    expect(reading.leftBps).toBe(opened.end.claimBps);
    expect(reading.give).toBeUndefined();
  });

  test("an answer: the helper, where the money lands, and whose kind of confirmation it carries", async () => {
    const { opened } = await liveLink(hand, 2);
    const helper = privateKeyToAccount(giverKey).address;
    const own = await encodeGive({ domain: ownDomain, hand, signedShakes: opened.signedShakes, signedGive: await giveAt(opened) }, ownOptions);
    expect(read(own).give).toEqual({ signer: helper, payee: helper, byKey: true, confirmationBytes: 64, ownWords: false });

    const elsewhere = await giveAt(opened, payeeAt(9), keccak256(stringToBytes("their words")));
    const other = await encodeGive({ domain: ownDomain, hand, signedShakes: opened.signedShakes, signedGive: elsewhere }, ownOptions);
    expect(read(other).give).toEqual({ signer: helper, payee: payeeAt(9), byKey: true, confirmationBytes: 64, ownWords: true });

    // An account's confirmation travels at its own length: 97 bytes here.
    const account = { ...(await giveAt(opened)), giverSig: `0x${"5a".repeat(97)}` as const };
    const wrapped = await encodeGive({ domain: ownDomain, hand, signedShakes: opened.signedShakes, signedGive: account }, ownOptions);
    expect(read(wrapped).give).toMatchObject({ signer: helper, byKey: false, confirmationBytes: 97 });
    expect(read(wrapped).leftBps).toBe(opened.end.claimBps);
  });

  test("the words inside a dark link, and the open part of an unlisted address", async () => {
    const dark = describeHand("dark", "A title", "Some words", testSalt("offline"));
    const darkLink = await encodeLive({ domain: ownDomain, hand: { ...hand, dataHash: dark.dataHash }, signedShakes: [], seed: rootSeed, attachments: dark.inside }, ownOptions);
    expect(read(darkLink).inside).toEqual({ names: ["content", "salt", "title"], texts: ["A title", "Some words"] });

    const unlisted = describeHand("unlisted", "Shown to the site", "Kept in the link", testSalt("offline"));
    const withData = { ...hand, dataHash: unlisted.dataHash };
    const options = { ...ownOptions, outside: packAttachments(unlisted.outside) };
    const link = await encodeLive({ domain: ownDomain, hand: withData, signedShakes: [], seed: rootSeed, attachments: unlisted.inside }, options);
    const address = toAddress({ site: "https://site.example", link, shape: "faced", outside: unlisted.outside }, ownOptions);
    const { before, fragment } = splitPasted(address);
    expect(fragment).toBe(toText(link));
    const reading = read(link, before);
    expect(reading.inside).toEqual({ names: ["content", "salt"], texts: ["Kept in the link"] });
    expect(reading.outside).toEqual({ names: ["private", "title"], texts: ["Shown to the site"] });
    expect(outsideWords("https://site.example/8453/5")).toBeUndefined();
    expect(outsideWords("https://site.example/8453/5?d=!!")).toBeUndefined();
  });

  test("attachments that do not read are left out, never guessed", () => {
    expect(wordsOf(Uint8Array.of())).toBeUndefined();
    expect(wordsOf(Uint8Array.of(1, 2, 200, 0x41))).toBeUndefined(); // a text announced longer than the bytes
    expect(wordsOf(Uint8Array.of(1, 2, 1, 0x41, 0))).toBeUndefined(); // a byte after the last attachment
    expect(wordsOf(Uint8Array.of(1, 2, 2, 0xff, 0xfe))).toBeUndefined(); // not text
    expect(wordsOf(Uint8Array.of(1, 2, 2, 0x4f, 0x4b))).toEqual({ names: [], texts: ["OK"] });
  });

  test("nothing of the secret part is in the reading", async () => {
    const { link } = await liveLink(hand, 2);
    const json = JSON.stringify(read(link));
    const secret = rulerOf(link).segments.find((segment) => segment.kind === "secret")!;
    const seed = link.subarray(secret.start, secret.start + secret.length);
    expect(seed.length).toBe(16);
    for (const form of [Buffer.from(seed).toString("hex"), toText(seed), toDigits(link), toText(link)]) {
      expect(json.toLowerCase().includes(form.toLowerCase())).toBe(false);
    }
    expect(hexToBytes(rootSeed).length).toBe(16);
  });
});
