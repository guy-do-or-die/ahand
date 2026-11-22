import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes, type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import file from "./link-vectors.json" with { type: "json" };
import {
  LinkError,
  encodeAddressed,
  encodeGive,
  encodeLive,
  fromText,
  keyOfSeed,
  openAddress,
  openLink,
  seenIn,
  toAddress,
  toDigits,
  toText,
  type Hand,
  type LinkOptions,
  type OpenedLink,
  type Statement,
} from "../src/index.js";

/**
 * tests/link-vectors.json: 27 links frozen by the study that settled the link's format
 * (docs/links.md; the byte layout is in src/link.ts). Three readers written apart
 * from each other, in TypeScript, Python and Go, give these answers; this is the fourth. Each
 * vector is the link, the Hand's terms as Core keeps them, the canonical Core the reader knows,
 * attachments that travelled outside the link (the public part), and what a reader answers.
 */

type Vector = (typeof file.vectors)[number];

function lists(statements: Statement[][]): unknown[] {
  return statements
    .map((list) => [...list].sort((a, b) => (a.name < b.name ? -1 : 1)).map(({ name, value }) => ({ name, value: value.toLowerCase() })))
    .map((list) => JSON.stringify(list))
    .sort()
    .map((text) => JSON.parse(text));
}

/** A reader's answer in the form the vectors keep it. */
function render(opened: OpenedLink): Record<string, unknown> {
  const lower = (hex: string) => hex.toLowerCase();
  const out: Record<string, unknown> = {
    kind: opened.head.kind,
    chainId: opened.head.chainId,
    core: lower(opened.head.core),
    handId: opened.head.handId.toString(),
    shakes: opened.signedShakes.map(({ shake, keySig }) => ({
      nextKey: lower(shake.nextKey),
      payee: lower(shake.payee),
      claimBps: shake.claimBps,
      nextClaimBps: shake.nextClaimBps,
      dataHash: lower(shake.dataHash),
      keySig: lower(keySig),
    })),
    lastKey: lower(opened.end.lastKey),
    claimBps: opened.end.claimBps,
    routeHash: lower(opened.end.routeHash),
    statements: lists(opened.statements),
    texts: [...opened.texts].sort(),
    ofHand: { statements: lists(opened.ofHand.statements), texts: [...opened.ofHand.texts].sort() },
  };
  if (opened.seed) {
    out.seed = lower(opened.seed);
    out.linkKey = lower(opened.linkKey!);
  }
  if (opened.signedGive) {
    const { give, keySig, giverSig } = opened.signedGive;
    out.give = {
      signer: lower(give.signer),
      payee: lower(give.payee),
      claimBps: give.claimBps,
      routeHash: lower(give.routeHash),
      dataHash: lower(give.dataHash),
      keySig: lower(keySig),
      giverSig: lower(giverSig),
    };
  }
  return out;
}

const handOf = (vector: Vector): Hand => ({ ...vector.hand, handId: BigInt(vector.hand.handId) }) as Hand;

function optionsOf(vector: Vector, withPublicPart = true): LinkOptions {
  return {
    // null: the study's reader that knows no canonical Core.
    canonicalCore: vector.canonicalCore as Address | null,
    publicPart: withPublicPart && vector.outside ? hexToBytes(vector.outside as Hex) : undefined,
  };
}

describe("the links the study froze", () => {
  it("are 27, and their seed gives the key the study wrote down", () => {
    expect(file.vectors.length).toBe(27);
    expect(keyOfSeed(file.keyOfSeed.seed as Hex)).toBe(file.keyOfSeed.key);
    expect(privateKeyToAddress(keyOfSeed(file.keyOfSeed.seed as Hex)).toLowerCase()).toBe(file.keyOfSeed.address);
  });

  for (const vector of file.vectors) {
    const bytes = hexToBytes(vector.link as Hex);
    const hand = handOf(vector);
    const getHand = async () => hand;

    it(`${vector.id}: opens with the answer the three readers give`, async () => {
      const opened = await openLink(bytes, getHand, optionsOf(vector));
      expect(render(opened)).toEqual(vector.opened);
    });

    it(`${vector.id}: has the two text forms the study wrote down`, () => {
      expect(bytes.length).toBe(vector.bytes);
      expect(toText(bytes)).toBe(vector.text);
      expect(toDigits(bytes)).toBe(vector.digits);
      expect(bytesToHex(fromText(vector.text))).toBe(vector.link);
      expect(bytesToHex(fromText(vector.digits))).toBe(vector.link);
    });

    it(`${vector.id}: is written again byte for byte from what it opened as`, async () => {
      const options = optionsOf(vector);
      const opened = await openLink(bytes, getHand, options);
      const route = { domain: opened.domain, hand, signedShakes: opened.signedShakes, attachments: opened.linkPart };
      const again =
        opened.head.kind === "live"
          ? encodeLive({ ...route, seed: opened.seed! }, options)
          : opened.head.kind === "give"
            ? encodeGive({ ...route, signedGive: opened.signedGive! }, options)
            : encodeAddressed(route, options);
      if (vector.id === "text-as-it-is-1") {
        // A text that is not in the form the SDK hashes texts in: read as it is, never written.
        await expect(again).rejects.toThrow(LinkError);
        return;
      }
      expect(bytesToHex(await again)).toBe(vector.link);
    });

    if (vector.address) {
      const address: string = vector.address;
      it(`${vector.id}: its address opens to the same answer and is written again as it stands`, async () => {
        const options = optionsOf(vector, false);
        const opened = await openAddress(address, getHand, options);
        expect(render(opened)).toEqual(vector.opened);
        const seen = seenIn(address.slice(0, address.indexOf("#")), options);
        expect(seen.publicPart ? bytesToHex(seen.publicPart) : null).toBe(vector.outside);
        const publicPart = seen.shape === "described" ? opened.publicPart : undefined;
        expect(toAddress({ site: "https://ahand.app", link: bytes, shape: seen.shape, publicPart }, options)).toBe(address);
      });
    }
  }
});
