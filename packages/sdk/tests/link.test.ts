import { describe, expect, it } from "vitest";
import { bytesToHex, hashTypedData, hexToBytes, keccak256, numberToHex, stringToBytes, zeroAddress, zeroHash, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import {
  SHAKE_TYPES,
  checkGive,
  checkRoute,
  dataHashOf,
  signShake,
  textValue,
  type Hand,
  type Shake,
  type SignedShake,
  type Statement,
} from "../src/index.js";
import {
  LinkError,
  encodeAddressed,
  encodeGive,
  encodeLive,
  fromText,
  keyOfSeed,
  newSeed,
  openLink,
  openOutside,
  pack,
  packAttachments,
  passOn,
  peekLink,
  pinOf,
  toDigits,
  toText,
  type LinkErrorCode,
  type LinkHead,
  type WireLink,
} from "../src/link.js";
import { accepted, chain, linkKeys, refused, type Accepted, type Refused } from "./fixtures.js";
import { CORE, giveAt, liveLink, ownDomain, ownHand, ownOptions, payeeAt, rootSeed } from "./link-fixtures.js";

/**
 * The link against Core's own fixtures (contracts/test/fixtures/sdk-vectors.json) and against a
 * Hand of the tests' own. The layout is in src/link.ts.
 */

async function code(run: Promise<unknown> | (() => Promise<unknown>)): Promise<LinkErrorCode | "opened" | "other error"> {
  try {
    await (typeof run === "function" ? run() : run);
    return "opened";
  } catch (error) {
    return error instanceof LinkError ? error.code : "other error";
  }
}

/** The wire parts of a fixture as they stand, written without any check. */
function wireOfFixture({ hand, shakes, give }: Accepted | Refused, withGive: boolean): WireLink {
  return {
    chainId: BigInt(chain.chainId),
    core: chain.verifyingContract,
    handId: hand.handId,
    shakes: shakes.map(({ shake, keySig }) => ({ ...shake, keySig })),
    lastKey: shakes.length > 0 ? shakes[shakes.length - 1].shake.nextKey : undefined,
    give: withGive ? { ...give.give, keySig: give.keySig, giverSig: give.giverSig } : undefined,
    pin: shakes.length === 0 && !withGive ? pinOf(chain, hand) : undefined,
  };
}

describe("the seed", () => {
  it("gives the key that any keccak256 tool gives: cast keccak (concat-hex (from-utf8 aHand.key/1) seed)", () => {
    expect(keyOfSeed(rootSeed)).toBe("0xc9e45709ceb1d529bb2aaff52c2454691a3604258718e072d1bc6070997bb2fb");
  });

  it("is 16 bytes, and a fresh one is another each time", () => {
    expect(() => keyOfSeed("0x0001")).toThrow(LinkError);
    const seeds = new Set(Array.from({ length: 8 }, () => newSeed()));
    expect(seeds.size).toBe(8);
    for (const seed of seeds) expect(hexToBytes(seed).length).toBe(16);
  });
});

describe("the pin", () => {
  it("is the first 16 bytes of what a wallet would sign for the Hand alone under Core's domain", () => {
    const hand = ownHand();
    const signedForTheHand = hashTypedData({ domain: ownDomain, types: { Hand: SHAKE_TYPES.Hand }, primaryType: "Hand", message: hand });
    expect(signedForTheHand).toBe("0xb5539e48265102f3bba39f4dc03e1c37c048f92437af1f7fae95f66b6fb11962");
    expect(pinOf(ownDomain, hand)).toBe("0xb5539e48265102f3bba39f4dc03e1c37");
  });
});

describe("the routes Core accepted", () => {
  for (const fixture of accepted) {
    const count = fixture.shakes.length;

    it(`${count} Shakes with the Give: the link gives back the same route and Give, and Core's answers`, async () => {
      const link = await encodeGive({ domain: chain, hand: fixture.hand, signedShakes: fixture.shakes, signedGive: fixture.give });
      for (const text of [toText(link), toDigits(link)]) {
        const opened = await openLink(fromText(text), async () => fixture.hand);
        expect(opened.head.kind).toBe("give");
        expect(opened.signedShakes).toEqual(fixture.shakes);
        expect(opened.signedGive).toEqual(fixture.give);
        expect(opened.seed).toBeUndefined();
        expect(opened.linkKey).toBeUndefined();
        // What the SDK's mirror of Core says about the decoded route is what Core itself answered.
        expect(await checkRoute(opened.domain, opened.hand, opened.signedShakes)).toEqual({
          lastKey: fixture.core.lastKey,
          claimBps: fixture.core.claimBps,
          routeHash: fixture.core.routeHash,
        });
        expect(await checkGive(opened.domain, opened.hand, opened.signedShakes, opened.signedGive!)).toBe(fixture.core.giveHash);
      }
    });

    it(`${count} Shakes without a secret: the addressed link gives back the same route`, async () => {
      const link = await encodeAddressed({ domain: chain, hand: fixture.hand, signedShakes: fixture.shakes });
      const opened = await openLink(fromText(toText(link)), async () => fixture.hand);
      expect(opened.head.kind).toBe("addressed");
      expect(opened.signedShakes).toEqual(fixture.shakes);
      expect(opened.end.lastKey).toBe(fixture.core.lastKey);
      expect(opened.end.routeHash).toBe(fixture.core.routeHash);
      expect(opened.seed).toBeUndefined();
    });

    it(`${count} Shakes and one more to a seed: the live link carries the Core-checked route and the one secret`, async () => {
      // The fixtures' keys are not made from seeds, so the route is passed on once more, to a seed's key.
      const seed = newSeed();
      const shake: Shake = {
        nextKey: privateKeyToAddress(keyOfSeed(seed)),
        payee: payeeAt(count),
        claimBps: fixture.core.claimBps,
        nextClaimBps: fixture.core.claimBps,
        dataHash: zeroHash,
      };
      const keySig = await signShake(linkKeys[count], chain, fixture.hand, shake);
      const signedShakes: SignedShake[] = [...fixture.shakes, { shake, keySig }];
      const link = await encodeLive({ domain: chain, hand: fixture.hand, signedShakes, seed });
      const opened = await openLink(fromText(toDigits(link)), async () => fixture.hand);
      expect(opened.head.kind).toBe("live");
      expect(opened.signedShakes).toEqual(signedShakes);
      expect(opened.seed).toBe(seed);
      expect(privateKeyToAddress(opened.linkKey!)).toBe(opened.end.lastKey);
    });
  }
});

describe("the routes and Gives Core refused", () => {
  for (const fixture of refused) {
    it(`${fixture.what}: no link of it opens and passes`, async () => {
      let link: Uint8Array;
      try {
        link = pack(wireOfFixture(fixture, true));
      } catch (error) {
        // A signature Core does not take cannot even be written.
        expect((error as LinkError).code).toBe("invalid");
        return;
      }
      let opened;
      try {
        opened = await openLink(link, async () => fixture.hand);
      } catch (error) {
        expect(error).toBeInstanceOf(LinkError);
        return;
      }
      // The link itself is sound; then the Give must fail exactly as Core said.
      const refusal = await checkGive(opened.domain, opened.hand, opened.signedShakes, opened.signedGive!).then(
        () => undefined,
        (error) => error,
      );
      expect(refusal?.error).toBe(fixture.error.name);
    });
  }
});

describe("a link of our own, from a seed", () => {
  const hand = ownHand();
  const getHand = async (head: LinkHead): Promise<Hand> => {
    // The application asks the chain and the Core the link names for the Hand the link names.
    if (head.chainId !== ownDomain.chainId || head.core !== CORE || head.handId !== hand.handId) throw new Error("no such Hand");
    return hand;
  };

  it("grows by passing: 0, 1, 3, 6 and 10 paid Shakes, each read back from both text forms", async () => {
    // The sizes of the study of 2026-11-19: Base, Hand 123456, the canonical Core, paid Shakes without a dataHash.
    const sizes: Record<number, number> = { 0: 39, 1: 109, 3: 281, 6: 539, 10: 883 };
    for (const count of [0, 1, 3, 6, 10]) {
      const { link, opened } = await liveLink(hand, count);
      expect(link.length).toBe(sizes[count]);
      expect(opened.signedShakes.length).toBe(count);
      expect(opened.end.claimBps).toBe(10_000 - 100 * count);
      for (const text of [toText(link), toDigits(link)]) {
        expect(bytesToHex(fromText(text))).toBe(bytesToHex(link));
      }
      expect(toText(link)).toMatch(/^[EF]/);
      expect(peekLink(link, ownOptions)).toEqual({ version: 1, kind: "live", chainId: 8453, core: CORE, handId: hand.handId, shakes: count });
    }
  }, 60_000);

  it("ends with a Give in the sizes the study measured, and without a secret as an addressed link", async () => {
    const withGive: Record<number, number> = { 0: 156, 1: 262, 3: 434 };
    const addressed: Record<number, number> = { 0: 23, 1: 113, 3: 285 };
    for (const count of [0, 1, 3]) {
      const { opened } = await liveLink(hand, count);
      const route = { domain: ownDomain, hand, signedShakes: opened.signedShakes };
      expect((await encodeGive({ ...route, signedGive: await giveAt(opened) }, ownOptions)).length).toBe(withGive[count]);
      expect((await encodeAddressed(route, ownOptions)).length).toBe(addressed[count]);
    }
  }, 60_000);

  it("carries one secret: the new seed only, and a Give link none", async () => {
    const before = await liveLink(hand, 2);
    const { link, seed } = await passOn(before.opened, { payee: payeeAt(2), nextClaimBps: 9_700 }, ownOptions);
    const hex = bytesToHex(link).slice(2);
    expect(hex.endsWith(seed.slice(2))).toBe(true);
    expect(hex.includes(before.opened.seed!.slice(2))).toBe(false);
    expect(hex.includes(before.opened.linkKey!.slice(2))).toBe(false);

    const opened = await openLink(link, getHand, ownOptions);
    const give = await encodeGive({ domain: ownDomain, hand, signedShakes: opened.signedShakes, signedGive: await giveAt(opened) }, ownOptions);
    const giveHex = bytesToHex(give).slice(2);
    expect(giveHex.includes(seed.slice(2))).toBe(false);
    expect(giveHex.includes(opened.linkKey!.slice(2))).toBe(false);
    const read = await openLink(give, getHand, ownOptions);
    expect(read.seed).toBeUndefined();
    expect(await checkGive(read.domain, read.hand, read.signedShakes, read.signedGive!)).toMatch(/^0x/);
    // A Give with a secret cannot be read.
    const forced = Uint8Array.from(give);
    forced[0] &= ~0x01;
    expect(await code(openLink(forced, getHand, ownOptions))).toBe("non-canonical");
  }, 60_000);

  it("refuses every single flipped bit of a live link with 0 and with 3 Shakes", async () => {
    for (const count of [0, 3]) {
      const { link } = await liveLink(hand, count);
      let opened = 0;
      for (let bit = 0; bit < link.length * 8; ++bit) {
        const flipped = Uint8Array.from(link);
        flipped[bit >> 3] ^= 1 << (bit & 7);
        if ((await code(openLink(flipped, getHand, ownOptions))) === "opened") ++opened;
      }
      expect(opened).toBe(0);
    }
  }, 300_000);

  it("refuses one flipped bit in every byte of a live link with 10 Shakes", async () => {
    const { link } = await liveLink(hand, 10);
    let opened = 0;
    for (let index = 0; index < link.length; ++index) {
      const flipped = Uint8Array.from(link);
      flipped[index] ^= 1 << (index * 5) % 8;
      if ((await code(openLink(flipped, getHand, ownOptions))) === "opened") ++opened;
    }
    expect(opened).toBe(0);
  }, 300_000);

  it("refuses every single flipped bit of a Give link with a Shake, in the link or by the giver's signature", async () => {
    // One Shake is enough to have every field of a Give link; the bits of further Shakes are flipped above.
    const { opened } = await liveLink(hand, 1);
    const signedGive = await giveAt(opened, payeeAt(99), keccak256(stringToBytes("the answer")));
    const link = await encodeGive({ domain: ownDomain, hand, signedShakes: opened.signedShakes, signedGive }, ownOptions);
    let passed = 0;
    for (let bit = 0; bit < link.length * 8; ++bit) {
      const flipped = Uint8Array.from(link);
      flipped[bit >> 3] ^= 1 << (bit & 7);
      try {
        const read = await openLink(flipped, getHand, ownOptions);
        await checkGive(read.domain, read.hand, read.signedShakes, read.signedGive!);
        ++passed;
      } catch {
        // refused by the link or by the Give's checks
      }
    }
    expect(passed).toBe(0);
  }, 300_000);

  it("refuses a link cut short or with a byte added", async () => {
    for (const count of [0, 3]) {
      const { link } = await liveLink(hand, count);
      for (let length = 0; length < link.length; ++length) {
        expect(await code(openLink(link.subarray(0, length), getHand, ownOptions))).not.toBe("opened");
      }
      for (const extra of [0x00, 0x01, 0x02, 0xff]) {
        expect(await code(openLink(Uint8Array.from([...link, extra]), getHand, ownOptions))).not.toBe("opened");
      }
    }
  }, 120_000);

  it("names its Hand's terms: another Hand under the same number and root key is refused", async () => {
    // After a reorg the same number can hold a copy: the same root key, another raiser, other terms.
    const copy: Hand = { ...hand, raiser: "0x2222222222222222222222222222222222222222", minClaimBps: 0 };
    const bare = await liveLink(hand, 0);
    expect(await code(openLink(bare.link, async () => copy, ownOptions))).toBe("not-this-hand");
    // With the copy's pin the same link opens on the copy: the pin is all that names the terms here.
    const repinned = Uint8Array.from(bare.link);
    repinned.set(hexToBytes(pinOf(ownDomain, copy)), repinned.length - 16);
    expect(await code(openLink(repinned, async () => copy, ownOptions))).toBe("opened");
    // With a Shake the first signature names the terms.
    const one = await liveLink(hand, 1);
    expect(await code(openLink(one.link, async () => copy, ownOptions))).toBe("not-this-hand");
    // Each signed term counts.
    for (const other of [
      { ...hand, token: zeroAddress },
      { ...hand, payoutGasK: 201 },
      { ...hand, minClaimBps: 5_001 },
      { ...hand, dataHash: zeroHash },
    ] as Hand[]) {
      expect(await code(openLink(bare.link, async () => other, ownOptions))).toBe("not-this-hand");
      expect(await code(openLink(one.link, async () => other, ownOptions))).toBe("not-this-hand");
    }
    // A Give without Shakes carries no pin: its key signature names the terms.
    const signedGive = await giveAt(bare.opened);
    const give = await encodeGive({ domain: ownDomain, hand, signedShakes: [], signedGive }, ownOptions);
    expect(await code(openLink(give, async () => hand, ownOptions))).toBe("opened");
    expect(await code(openLink(give, async () => copy, ownOptions))).toBe("not-this-hand");
    // Another Core is another domain.
    const elsewhere = { canonicalCore: "0x00000000000000000000000000000000000000aa" } as const;
    expect(await code(openLink(one.link, async () => hand, elsewhere))).toBe("not-this-hand");
    expect(await code(openLink(bare.link, async () => hand, elsewhere))).toBe("not-this-hand");
    // And the Hand the application answers with must be the one the link names.
    expect(await code(openLink(one.link, async () => ({ ...hand, handId: 7n }), ownOptions))).toBe("another-hand");
  }, 60_000);

  it("is written in one way only", async () => {
    const { link } = await liveLink(hand, 1);
    // Layout of this link: 0x10 | chainId 8453 (2) | handId 123456 (3) | count (1) | Shake: 2 + 20 + 64 | seed 16.
    expect(link.length).toBe(1 + 2 + 3 + 1 + 86 + 16);
    const edit = (change: (bytes: number[]) => void) => {
      const bytes = [...link];
      change(bytes);
      return openLink(Uint8Array.from(bytes), getHand, ownOptions);
    };
    expect(await code(edit((b) => (b[0] = 0x20)))).toBe("unsupported"); // another version
    expect(await code(edit((b) => (b[0] |= 0x08)))).toBe("malformed"); // attachments announced where the link ends
    expect(await code(edit((b) => (b[0] = 0x12)))).toBe("non-canonical"); // a Give with a secret
    expect(await code(edit((b) => b.splice(5, 1, b[5] | 0x80, 0x00)))).toBe("non-canonical"); // handId written longer
    expect(await code(edit((b) => b.splice(6, 1, 0x81, 0x00)))).toBe("non-canonical"); // count written longer

    // An s in the upper half, which Core refuses. Almost none fits the 64 bytes of the wire at all
    // (the upper half starts 2^127 below 2^255); the few that fit are refused before any recovery.
    const halfOrder = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n >> 1n;
    const sAt = 7 + 22 + 32;
    expect(await code(edit((b) => b.splice(sAt, 32, ...hexToBytes(numberToHex(halfOrder + 1n, { size: 32 })))))).toBe("non-canonical");
    expect(await code(edit((b) => b.splice(sAt, 32, ...hexToBytes(numberToHex(halfOrder, { size: 32 })))))).toBe("not-this-hand");

    // A Shake without a payee that still writes a claim; a payee or a dataHash written as zero.
    const { link: anonymous } = await liveLink(hand, 1, () => ({ paid: false, data: false }));
    expect(anonymous.length).toBe(1 + 2 + 3 + 1 + 65 + 16);
    const marked = Uint8Array.from(anonymous);
    marked[7] |= 0x01;
    expect(await code(openLink(marked, getHand, ownOptions))).toBe("non-canonical");
    expect(await code(edit((b) => b.fill(0, 9, 29)))).toBe("non-canonical");
    const { link: withData } = await liveLink(hand, 1, () => ({ paid: true, data: true }));
    const zeroed = Uint8Array.from(withData);
    zeroed.fill(0, 29, 61);
    expect(await code(openLink(zeroed, getHand, ownOptions))).toBe("non-canonical");

    // The canonical Core is named by leaving its address out; without one known, it must be written.
    const explicit = pack({ chainId: 8453n, core: CORE, handId: hand.handId, shakes: [], seed: rootSeed, pin: pinOf(ownDomain, hand) });
    expect(await code(openLink(explicit, getHand, ownOptions))).toBe("non-canonical");
    expect(await code(openLink(explicit, getHand, {}))).toBe("opened");
    expect(await code(openLink(link, getHand, {}))).toBe("unsupported");

    // The text forms: base64url with loose bits at the end, a decimal number with a leading zero.
    const text = toText(link);
    expect(link.length % 3).toBe(1);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const loose = text.slice(0, -1) + alphabet[alphabet.indexOf(text[text.length - 1]) | 1];
    expect(loose).not.toBe(text);
    expect(() => fromText(loose)).toThrow(LinkError);
    expect(() => fromText(`0${toDigits(link)}`)).toThrow(LinkError);
    expect(() => fromText(`${text}=`)).toThrow(LinkError);
    expect(() => fromText("")).toThrow(LinkError);
  }, 60_000);

  it("takes the giver's signature as it is: a smart wallet's of any length, or a key's in another form", async () => {
    const { opened } = await liveLink(hand, 1);
    const signedGive = await giveAt(opened);
    const wallet = `0x${"ab".repeat(300)}` as Hex;
    const unusual = (signedGive.giverSig.slice(0, -2) + (signedGive.giverSig.endsWith("1b") ? "00" : "01")) as Hex;
    for (const giverSig of [wallet, unusual, "0x" as Hex]) {
      const link = await encodeGive({ domain: ownDomain, hand, signedShakes: opened.signedShakes, signedGive: { ...signedGive, giverSig } }, ownOptions);
      const read = await openLink(link, getHand, ownOptions);
      expect(read.signedGive!.giverSig).toBe(giverSig);
    }
    // A key's signature in Core's form travels as 64 bytes and comes back as the same 65.
    const plain = await encodeGive({ domain: ownDomain, hand, signedShakes: opened.signedShakes, signedGive }, ownOptions);
    const longer = await encodeGive({ domain: ownDomain, hand, signedShakes: opened.signedShakes, signedGive: { ...signedGive, giverSig: unusual } }, ownOptions);
    expect(longer.length - plain.length).toBe(2);
    expect((await openLink(plain, getHand, ownOptions)).signedGive).toEqual(signedGive);

    // The Give is written in one way too. Its block here: first byte | signer 20 | keySig 64 | giverSig 64.
    const at = plain.length - 149;
    expect(plain[at]).toBe(0x20);
    const head = [...plain.subarray(0, at)];
    const signer = [...plain.subarray(at + 1, at + 21)];
    const keySig = [...plain.subarray(at + 21, at + 85)];
    const giverSig = [...plain.subarray(at + 85)];
    // The same key's signature at full length; the signer written once more as the payee.
    const atFullLength = Uint8Array.from([...head, 0x00, ...signer, ...keySig, 65, ...hexToBytes(signedGive.giverSig)]);
    expect(await code(openLink(atFullLength, getHand, ownOptions))).toBe("non-canonical");
    const payeeRepeated = Uint8Array.from([...head, 0xa0, ...signer, ...signer, ...keySig, ...giverSig]);
    expect(await code(openLink(payeeRepeated, getHand, ownOptions))).toBe("non-canonical");
    const reservedBit = Uint8Array.from([...head, 0x21, ...signer, ...keySig, ...giverSig]);
    expect(await code(openLink(reservedBit, getHand, ownOptions))).toBe("unsupported");
  }, 60_000);

  it("refuses a route that ends at no key", async () => {
    const { opened } = await liveLink(hand, 1);
    const toNobody: Shake = { nextKey: zeroAddress, payee: zeroAddress, claimBps: 9_900, nextClaimBps: 9_900, dataHash: zeroHash };
    const keySig = await signShake(opened.linkKey!, ownDomain, hand, toNobody);
    const signedShakes = [...opened.signedShakes, { shake: toNobody, keySig }];
    expect(await code(encodeAddressed({ domain: ownDomain, hand, signedShakes }, ownOptions))).toBe("invalid");
  }, 60_000);

  it("carries the statements and the texts behind its hashes, and nothing else", async () => {
    const question = "Кто починит Vespa 1978 года в Лиссабоне?\nНужен мастер по двухтактным моторам.";
    const statements: Statement[] = [
      { name: "content", value: textValue(question) },
      { name: "author", value: "0x0000000000000000000000001111111111111111111111111111111111111111" },
      { name: "lang", value: textValue("ru") },
    ];
    const described = ownHand(dataHashOf(statements));
    const getDescribed = async () => described;
    const route = { domain: ownDomain, hand: described, signedShakes: [], seed: rootSeed };
    const link = await encodeLive({ ...route, attachments: { statements: [statements], texts: [question] } }, ownOptions);
    const bare = await encodeLive(route, ownOptions);
    const opened = await openLink(link, getDescribed, ownOptions);
    expect(opened.texts).toEqual([question]);
    expect(dataHashOf(opened.statements[0])).toBe(described.dataHash);
    // The attachments stand after the route, announced by a flag in the first byte and by their number.
    const flagged = Uint8Array.from(bare);
    flagged[0] |= 0x08;
    expect(bare[0] & 0x08).toBe(0);
    expect(bytesToHex(link).startsWith(bytesToHex(flagged))).toBe(true);
    expect(link[bare.length]).toBe(2);

    // What is attached travels on when the link is passed, unless the holder attaches something else:
    // its own Shake's statements beside the Hand's, or nothing.
    const passed1 = await passOn(opened, { payee: payeeAt(0), nextClaimBps: 9_900 }, ownOptions);
    expect((await openLink(passed1.link, getDescribed, ownOptions)).texts).toEqual([question]);
    const note: Statement[] = [{ name: "note", value: textValue("from a friend") }];
    const passed2 = await passOn(
      opened,
      { payee: payeeAt(0), nextClaimBps: 9_900, dataHash: dataHashOf(note) },
      ownOptions,
      { statements: [statements, note], texts: [question, "from a friend"] },
    );
    const reopened = await openLink(passed2.link, getDescribed, ownOptions);
    expect(reopened.statements.length).toBe(2);
    expect([...reopened.texts].sort()).toEqual([question, "from a friend"].sort());
    const passed3 = await passOn(opened, { payee: payeeAt(0), nextClaimBps: 9_900 }, ownOptions, {});
    expect((await openLink(passed3.link, getDescribed, ownOptions)).statements).toEqual([]);

    // A list behind no dataHash of the link, a text behind no statement: refused when written and when read.
    const stray: Statement[] = [{ name: "content", value: textValue("another question") }];
    expect(await code(encodeLive({ ...route, attachments: { statements: [stray] } }, ownOptions))).toBe("unmatched-data");
    expect(await code(encodeLive({ ...route, attachments: { statements: [statements], texts: ["not the question"] } }, ownOptions))).toBe(
      "unmatched-data",
    );
    // A text is written in the form it is hashed in.
    expect(await code(encodeLive({ ...route, attachments: { statements: [statements], texts: [question.replace("\n", "\r\n")] } }, ownOptions))).toBe(
      "non-canonical",
    );

    // The same parts put together by hand: the flagged route, the number of attachments, each as kind, length, bytes.
    const item = (kind: number, bytes: Uint8Array | number[]) => {
      const length = bytes.length < 128 ? [bytes.length] : [(bytes.length & 0x7f) | 0x80, bytes.length >> 7];
      return [kind, ...length, ...bytes];
    };
    const withTail = (...items: number[][]) => Uint8Array.from([...flagged, items.length, ...items.flat()]);
    const textBytes = stringToBytes(question);
    expect(textBytes.length).toBeGreaterThan(127);
    // The list: its count, then "author" (1 + 6 + 32 bytes), "content" (1 + 7 + 32) and "lang" (1 + 4 + 32).
    const listBytes = link.subarray(bare.length + 3, link.length - textBytes.length - 3);
    expect([...link.subarray(bare.length, bare.length + 3)]).toEqual([2, 1, 117]);
    expect(listBytes[0]).toBe(3);
    const [author, content, lang] = [listBytes.subarray(1, 40), listBytes.subarray(40, 80), listBytes.subarray(80)];
    const list = item(1, listBytes);
    const text = item(2, textBytes);
    expect(bytesToHex(withTail(list, text))).toBe(bytesToHex(link));

    // The same text with other line ends is other bytes: its hash is not the statement's.
    expect(await code(openLink(withTail(list, item(2, stringToBytes(question.replace("\n", "\r\n")))), getDescribed, ownOptions))).toBe("unmatched-data");
    // The two attachments in the other order, or one of them twice.
    expect(await code(openLink(withTail(text, list), getDescribed, ownOptions))).toBe("non-canonical");
    expect(await code(openLink(withTail(list, text, text), getDescribed, ownOptions))).toBe("non-canonical");
    // The statements of the list in another order than by name, or one of them twice.
    expect(await code(openLink(withTail(item(1, [3, ...content, ...author, ...lang]), text), getDescribed, ownOptions))).toBe("non-canonical");
    expect(await code(openLink(withTail(item(1, [3, ...author, ...author, ...content]), text), getDescribed, ownOptions))).toBe("non-canonical");
    // A name with a zero byte after it would hash as the same name and hide the statement from a
    // reader that looks it up by name: "author" written as 7 bytes.
    const padded = item(1, [3, 7, ...author.subarray(1, 7), 0, ...author.subarray(7), ...content, ...lang]);
    expect(await code(openLink(withTail(padded, text), getDescribed, ownOptions))).toBe("non-canonical");
    const hidden = [{ name: "content\u0000", value: textValue(question) }, ...statements.slice(1)];
    expect(await code(encodeLive({ ...route, attachments: { statements: [hidden] } }, ownOptions))).toBe("malformed");
    const longName = [{ name: "n".repeat(33), value: textValue(question) }];
    expect(await code(encodeLive({ ...route, attachments: { statements: [longName] } }, ownOptions))).toBe("malformed");
    // Bytes after the last statement of a list: no hash covers them.
    expect(await code(openLink(withTail(item(1, [...listBytes, 0]), text), getDescribed, ownOptions))).toBe("malformed");
    expect(await code(openLink(withTail(item(1, [...listBytes, ...lang]), text), getDescribed, ownOptions))).toBe("malformed");
    // An attachment of a kind this version does not know.
    expect(await code(openLink(withTail(list, text, [3, 0]), getDescribed, ownOptions))).toBe("unsupported");
    // Attachments announced and none written; more or fewer announced than written; a byte after the last.
    expect(await code(openLink(Uint8Array.from([...flagged, 0]), getDescribed, ownOptions))).toBe("non-canonical");
    expect(await code(openLink(Uint8Array.from([...flagged, 3, ...list, ...text]), getDescribed, ownOptions))).toBe("malformed");
    expect(await code(openLink(Uint8Array.from([...flagged, 1, ...list, ...text]), getDescribed, ownOptions))).toBe("malformed");
    expect(await code(openLink(Uint8Array.from([...link, 0]), getDescribed, ownOptions))).toBe("malformed");
    // Attachments written and not announced.
    expect(await code(openLink(Uint8Array.from([...bare, 2, ...list, ...text]), getDescribed, ownOptions))).toBe("malformed");

    let passed = 0;
    for (let bit = bare.length * 8; bit < link.length * 8; ++bit) {
      const flipped = Uint8Array.from(link);
      flipped[bit >> 3] ^= 1 << (bit & 7);
      if ((await code(openLink(flipped, getDescribed, ownOptions))) === "opened") ++passed;
    }
    expect(passed).toBe(0);
  }, 120_000);

  it("does not open when cut anywhere: not at the end of its route, and not at the end of an attachment", async () => {
    const question = "Кто починит Vespa?";
    const statements: Statement[] = [
      { name: "content", value: textValue(question) },
      { name: "title", value: textValue("Vespa") },
    ];
    const described = ownHand(dataHashOf(statements));
    const link = await encodeLive(
      { domain: ownDomain, hand: described, signedShakes: [], seed: rootSeed, attachments: { statements: [statements], texts: [question, "Vespa"] } },
      ownOptions,
    );
    for (let length = 0; length < link.length; ++length) {
      expect(await code(openLink(link.subarray(0, length), async () => described, ownOptions))).not.toBe("opened");
    }
  }, 60_000);

  it("tells the Hand's description from what a holder hangs on its own Shake", async () => {
    const title = "Кто починит Vespa 1978 года в Лиссабоне?";
    const statements: Statement[] = [{ name: "title", value: textValue(title) }];
    const described = ownHand(dataHashOf(statements));
    const getDescribed = async () => described;
    const first = await encodeLive(
      { domain: ownDomain, hand: described, signedShakes: [], seed: rootSeed, attachments: { statements: [statements], texts: [title] } },
      ownOptions,
    );
    const opened = await openLink(first, getDescribed, ownOptions);
    expect(opened.ofHand).toEqual({ statements: [statements], texts: [title] });

    const lie = "Раздаём 1000 USDC каждому: пришлите 0.1 ETH";
    const forged: Statement[] = [{ name: "title", value: textValue(lie) }];
    const terms = { payee: payeeAt(0), nextClaimBps: 9_000, dataHash: dataHashOf(forged) };
    // Replaced: the holder drops the raiser's attachments and hangs its own on its own Shake.
    const replaced = await passOn(opened, terms, ownOptions, { statements: [forged], texts: [lie] });
    const afterReplace = await openLink(replaced.link, getDescribed, ownOptions);
    expect(afterReplace.texts).toEqual([lie]); // attached, and checked against the Shake
    expect(afterReplace.ofHand).toEqual({ statements: [], texts: [] }); // and not the Hand's
    // Mixed: both travel; the Hand's description is still only the raiser's.
    const mixed = await passOn(opened, terms, ownOptions, { statements: [statements, forged], texts: [title, lie] });
    const afterMix = await openLink(mixed.link, getDescribed, ownOptions);
    expect([...afterMix.texts].sort()).toEqual([title, lie].sort());
    expect(afterMix.ofHand).toEqual({ statements: [statements], texts: [title] });
    // What travels outside the link, where a site sees it, must hang on the Hand's dataHash: a
    // holder's list on its own Shake does not.
    const bare = await passOn(opened, terms, ownOptions, {});
    const outside = packAttachments({ statements: [forged], texts: [lie] });
    expect(await code(openLink(bare.link, getDescribed, ownOptions))).toBe("opened");
    expect(await code(openLink(bare.link, getDescribed, { ...ownOptions, outside }))).toBe("unmatched-data");
    // The Hand's own list may travel outside; no bytes at all is not "nothing outside", and nothing follows the last attachment.
    const own = packAttachments({ statements: [statements], texts: [title] });
    expect((await openLink(bare.link, getDescribed, { ...ownOptions, outside: own })).outside).toEqual({ statements: [statements], texts: [title] });
    expect(await code(openLink(bare.link, getDescribed, { ...ownOptions, outside: new Uint8Array(0) }))).toBe("malformed");
    expect(await code(openLink(bare.link, getDescribed, { ...ownOptions, outside: Uint8Array.from([...own, 0]) }))).toBe("malformed");
    expect(await code(async () => openOutside(Uint8Array.from([...own, 0]), described))).toBe("malformed");
    expect(await code(async () => openOutside(Uint8Array.of(0), described))).toBe("non-canonical");
    // The giver's own words hang on the Give's dataHash: attached and checked, and not the Hand's either.
    const answer = "Мастер в Алфаме: Rua dos Remédios, 12";
    const answered: Statement[] = [{ name: "content", value: textValue(answer) }];
    const signedGive = await giveAt(opened, undefined, dataHashOf(answered));
    const giveRoute = { domain: ownDomain, hand: described, signedShakes: [], signedGive };
    const withAnswer = await encodeGive({ ...giveRoute, attachments: { statements: [statements, answered], texts: [title, answer] } }, ownOptions);
    const afterGive = await openLink(withAnswer, getDescribed, ownOptions);
    expect([...afterGive.texts].sort()).toEqual([title, answer].sort());
    expect(afterGive.ofHand).toEqual({ statements: [statements], texts: [title] });
    // The same list on a Give that does not name it hangs on nothing.
    const silent = { ...giveRoute, signedGive: await giveAt(opened) };
    expect(await code(encodeGive({ ...silent, attachments: { statements: [answered], texts: [answer] } }, ownOptions))).toBe("unmatched-data");
    // A Shake may repeat the Hand's own dataHash: what hangs on it is the Hand's all the same.
    const echoed = await passOn(opened, { ...terms, dataHash: described.dataHash }, ownOptions);
    expect((await openLink(echoed.link, getDescribed, ownOptions)).ofHand).toEqual({ statements: [statements], texts: [title] });
  }, 60_000);

  it("takes a list behind a statement of another list, and a text only behind a statement", async () => {
    const content = "Нужен мастер по двухтактным моторам.";
    const hidden: Statement[] = [
      { name: "content", value: textValue(content) },
      { name: "salt", value: keccak256("0x5a17") },
    ];
    const shown: Statement[] = [
      { name: "private", value: dataHashOf(hidden) },
      { name: "title", value: textValue("Vespa") },
    ];
    const described = ownHand(dataHashOf(shown));
    const route = { domain: ownDomain, hand: described, signedShakes: [], seed: rootSeed };
    const link = await encodeLive({ ...route, attachments: { statements: [shown, hidden], texts: ["Vespa", content] } }, ownOptions);
    const opened = await openLink(link, async () => described, ownOptions);
    expect(opened.statements.length).toBe(2);
    expect([...opened.texts].sort()).toEqual(["Vespa", content].sort());
    expect([...opened.ofHand.texts].sort()).toEqual(["Vespa", content].sort());
    // The inner list without the outer one hangs on nothing.
    expect(await code(encodeLive({ ...route, attachments: { statements: [hidden] } }, ownOptions))).toBe("unmatched-data");
    // A text whose hash is a dataHash itself, with no list between, is refused.
    const direct = ownHand(textValue(content));
    expect(await code(encodeLive({ ...route, hand: direct, attachments: { texts: [content] } }, ownOptions))).toBe("unmatched-data");
    // A statement of zero proves nothing: no list and no text hangs on it.
    const empty: Statement[] = [];
    const zeroed: Statement[] = [{ name: "next", value: zeroHash }];
    expect(dataHashOf(empty)).not.toBe(zeroHash);
    const onZero = ownHand(dataHashOf(zeroed));
    expect(await code(encodeLive({ ...route, hand: onZero, attachments: { statements: [zeroed] } }, ownOptions))).toBe("opened");
    // An empty list is a list like any other, behind its one hash.
    const onEmpty = ownHand(dataHashOf(empty));
    const emptied = await encodeLive({ ...route, hand: onEmpty, attachments: { statements: [empty] } }, ownOptions);
    expect((await openLink(emptied, async () => onEmpty, ownOptions)).ofHand.statements).toEqual([[]]);
  }, 60_000);

  it("reads a long chain of lists in the worst order as fast as in the best", async () => {
    const chainOfLists: Statement[][] = [];
    let value: Hex = keccak256("0x00");
    for (let index = 0; index < 1_500; ++index) {
      const list = [{ name: "next", value }];
      chainOfLists.push(list);
      value = dataHashOf(list);
    }
    const start = performance.now();
    expect(openOutside(packAttachments({ statements: chainOfLists }), ownHand(value)).statements.length).toBe(1_500);
    expect(performance.now() - start).toBeLessThan(3_000);
  }, 60_000);

  it("hashes an attached text as its bytes are: a byte-order mark, line ends and the form of its letters included", async () => {
    const marked = "﻿hello";
    const statements: Statement[] = [{ name: "content", value: textValue(marked) }];
    const described = ownHand(dataHashOf(statements));
    const getDescribed = async () => described;
    const route = { domain: ownDomain, hand: described, signedShakes: [], seed: rootSeed };
    const link = await encodeLive({ ...route, attachments: { statements: [statements], texts: [marked] } }, ownOptions);
    expect((await openLink(link, getDescribed, ownOptions)).ofHand.texts).toEqual([marked]);

    const flagged = Uint8Array.from(await encodeLive(route, ownOptions));
    flagged[0] |= 0x08;
    const item = (kind: number, bytes: Uint8Array | number[]) => [kind, bytes.length, ...bytes];
    const withTail = (...items: number[][]) => Uint8Array.from([...flagged, items.length, ...items.flat()]);
    const list = [...packAttachments({ statements: [statements] }).subarray(1)];
    expect(await code(openLink(withTail(list, item(2, stringToBytes(marked))), getDescribed, ownOptions))).toBe("opened");
    // The same text without its mark, or with a second one: other bytes, another hash.
    expect(await code(openLink(withTail(list, item(2, stringToBytes("hello"))), getDescribed, ownOptions))).toBe("unmatched-data");
    expect(await code(openLink(withTail(list, item(2, stringToBytes(`﻿${marked}`))), getDescribed, ownOptions))).toBe("unmatched-data");
    // Bytes that are no text.
    expect(await code(openLink(withTail(list, item(2, [0xff, 0xfe])), getDescribed, ownOptions))).toBe("malformed");
    // A name that is only a mark is a name: its list just hangs on nothing here.
    const named = item(1, [1, 3, 0xef, 0xbb, 0xbf, ...hexToBytes(textValue(marked))]);
    expect(await code(openLink(withTail(named), getDescribed, ownOptions))).toBe("unmatched-data");
    // A name with a zero byte inside.
    expect(await code(openLink(withTail(item(1, [1, 3, 0x74, 0, 0x74, ...hexToBytes(textValue(marked))])), getDescribed, ownOptions))).toBe("non-canonical");

    // A text not in the form the SDK hashes texts in, behind a value made from exactly its bytes:
    // a reader takes it as it is, and does not depend on its own tables of Unicode for it.
    const raw = stringToBytes("Café de Alfama\r\n");
    const odd: Statement[] = [{ name: "content", value: keccak256(raw) }];
    const oddHand = ownHand(dataHashOf(odd));
    const oddBare = Uint8Array.from(await encodeLive({ ...route, hand: oddHand }, ownOptions));
    oddBare[0] |= 0x08;
    const oddLink = Uint8Array.from([...oddBare, 2, ...packAttachments({ statements: [odd] }).subarray(1), ...item(2, raw)]);
    expect((await openLink(oddLink, async () => oddHand, ownOptions)).texts).toEqual(["Café de Alfama\r\n"]);
    // An empty text is a text.
    const none: Statement[] = [{ name: "content", value: textValue("") }];
    const noneHand = ownHand(dataHashOf(none));
    const noneLink = await encodeLive({ ...route, hand: noneHand, attachments: { statements: [none], texts: [""] } }, ownOptions);
    expect((await openLink(noneLink, async () => noneHand, ownOptions)).texts).toEqual([""]);
  }, 60_000);

  it("is never written with a seed that is not the route's last key", async () => {
    const { opened } = await liveLink(hand, 2);
    const route = { domain: ownDomain, hand, signedShakes: opened.signedShakes };
    expect(await code(encodeLive({ ...route, seed: opened.seed! }, ownOptions))).toBe("opened");
    expect(await code(encodeLive({ ...route, seed: rootSeed }, ownOptions))).toBe("invalid");
    expect(await code(encodeLive({ ...route, seed: newSeed() }, ownOptions))).toBe("invalid");
    // Written past the encoder's checks, such a link does not open either.
    const forged = pack({
      chainId: 8453n,
      handId: hand.handId,
      shakes: opened.signedShakes.map(({ shake, keySig }) => ({ ...shake, keySig })),
      seed: newSeed(),
    });
    expect(await code(openLink(forged, getHand, ownOptions))).toBe("not-this-hand");
  }, 60_000);

  it("is never written for a route or a Give that Core would refuse", async () => {
    const { opened } = await liveLink(hand, 2);
    const route = { domain: ownDomain, hand, signedShakes: opened.signedShakes };
    const signedGive = await giveAt(opened);
    expect(await code(encodeGive({ ...route, signedGive }, ownOptions))).toBe("opened");
    // The Give of another route, of another claim, to nobody.
    expect(await code(encodeGive({ ...route, signedGive: { ...signedGive, give: { ...signedGive.give, routeHash: zeroHash } } }, ownOptions))).toBe("invalid");
    expect(await code(encodeGive({ ...route, signedGive: { ...signedGive, give: { ...signedGive.give, claimBps: 9_900 } } }, ownOptions))).toBe("invalid");
    expect(await code(encodeGive({ ...route, signedGive: { ...signedGive, give: { ...signedGive.give, payee: zeroAddress } } }, ownOptions))).toBe("invalid");
    // The Give of the raiser itself, which Core refuses whatever else is right.
    const byRaiser = { ...signedGive, give: { ...signedGive.give, signer: hand.raiser } };
    expect(await code(encodeGive({ ...route, signedGive: byRaiser }, ownOptions))).toBe("invalid");
    // Written past the encoder, such Gives do not open either: to nobody, and by the raiser.
    const wire = {
      chainId: 8453n,
      handId: hand.handId,
      shakes: opened.signedShakes.map(({ shake, keySig }) => ({ ...shake, keySig })),
      lastKey: opened.end.lastKey,
    };
    const give = { ...signedGive.give, keySig: signedGive.keySig, giverSig: signedGive.giverSig };
    expect(await code(openLink(pack({ ...wire, give }), getHand, ownOptions))).toBe("opened");
    expect(await code(openLink(pack({ ...wire, give: { ...give, payee: zeroAddress } }), getHand, ownOptions))).toBe("invalid");
    expect(await code(openLink(pack({ ...wire, give: { ...give, signer: hand.raiser } }), getHand, ownOptions))).toBe("invalid");
    // A route with a Shake out of place.
    const swapped = [opened.signedShakes[1], opened.signedShakes[0]];
    expect(await code(encodeAddressed({ ...route, signedShakes: swapped }, ownOptions))).toBe("invalid");
    // Only a live link can be passed on with its key.
    const addressed = await openLink(await encodeAddressed(route, ownOptions), getHand, ownOptions);
    expect(await code(passOn(addressed, { payee: payeeAt(2), nextClaimBps: 9_700 }, ownOptions))).toBe("invalid");
  }, 60_000);

  it("is never passed on for less than the Hand's minimum for the giver: no Give could end such a route", async () => {
    // The Hand of these tests leaves the giver at least 5 000 of 10 000.
    const { opened } = await liveLink(hand, 1);
    expect(await code(passOn(opened, { payee: payeeAt(1), nextClaimBps: 5_000 }, ownOptions))).toBe("opened");
    expect(await code(passOn(opened, { payee: payeeAt(1), nextClaimBps: 4_999 }, ownOptions))).toBe("invalid");
    // Signed and written past the encoder, such a route does not open either.
    const greedy: Shake = { nextKey: payeeAt(7), payee: payeeAt(1), claimBps: 9_900, nextClaimBps: 4_999, dataHash: zeroHash };
    const keySig = await signShake(opened.linkKey!, ownDomain, hand, greedy);
    const forged = pack({
      chainId: 8453n,
      handId: hand.handId,
      shakes: [...opened.signedShakes, { shake: greedy, keySig }].map(({ shake, keySig }) => ({ ...shake, keySig })),
      lastKey: payeeAt(7),
    });
    expect(await code(openLink(forged, getHand, ownOptions))).toBe("invalid");
  }, 60_000);

  it("refuses to write what its fields cannot hold", async () => {
    const { opened } = await liveLink(hand, 1);
    const [{ shake, keySig }] = opened.signedShakes;
    // A claim above the whole would spill into the flags of the Shake's first byte.
    expect(() => pack({ chainId: 8453n, handId: hand.handId, shakes: [{ ...shake, nextClaimBps: 0x4000, keySig }], seed: opened.seed })).toThrow(LinkError);
    expect(() => toDigits(new Uint8Array(0))).toThrow(LinkError);
    expect(() => toText(new Uint8Array(0))).toThrow(LinkError);
  }, 60_000);

  it("takes no more Shakes than one transaction can carry, unless the application says otherwise", async () => {
    // 369 Shakes is the longest route Core's own test thanks; a longer one could never be thanked.
    const { opened } = await liveLink(hand, 1);
    const loop: Shake = { nextKey: opened.end.lastKey, payee: zeroAddress, claimBps: 9_900, nextClaimBps: 9_900, dataHash: zeroHash };
    const keySig = await signShake(opened.linkKey!, ownDomain, hand, loop);
    const wireOf = (count: number) =>
      pack({
        chainId: 8453n,
        handId: hand.handId,
        shakes: [...opened.signedShakes, ...Array.from({ length: count - 1 }, () => ({ shake: loop, keySig }))].map(({ shake, keySig }) => ({ ...shake, keySig })),
        seed: opened.seed,
      });
    expect(await code(openLink(wireOf(370), getHand, ownOptions))).toBe("too-long");
    expect(peekLink(wireOf(369), ownOptions).shakes).toBe(369);
    expect(peekLink(wireOf(370), { ...ownOptions, maxShakes: 1_000 }).shakes).toBe(370);
  }, 60_000);

  it("leaves the longest route to the application", async () => {
    const { link } = await liveLink(hand, 3);
    expect(await code(openLink(link, getHand, { ...ownOptions, maxShakes: 2 }))).toBe("too-long");
    expect(await code(openLink(link, getHand, { ...ownOptions, maxShakes: 3 }))).toBe("opened");
    expect(() => peekLink(link, { ...ownOptions, maxShakes: 2 })).toThrow(LinkError);
  }, 60_000);

  it("takes a Shake a key passes to itself, as often as it stands in the route", async () => {
    // Core lets the same signed Shake stand in a route many times if the key passes to itself and keeps nothing.
    const { opened } = await liveLink(hand, 1);
    const loop: Shake = { nextKey: opened.end.lastKey, payee: zeroAddress, claimBps: 9_900, nextClaimBps: 9_900, dataHash: zeroHash };
    const keySig = await signShake(opened.linkKey!, ownDomain, hand, loop);
    const signedShakes = [...opened.signedShakes, { shake: loop, keySig }, { shake: loop, keySig }, { shake: loop, keySig }];
    const link = await encodeLive({ domain: ownDomain, hand, signedShakes, seed: opened.seed! }, ownOptions);
    expect((await openLink(link, getHand, ownOptions)).signedShakes).toEqual(signedShakes);
  }, 60_000);
});
