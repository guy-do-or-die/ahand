import { describe, expect, test } from "bun:test";
import { encodeGive, encodeLive, encodeAddressed, toDigits, toText, type Hand } from "@ahand/sdk";
import { keccak256, stringToBytes, zeroHash } from "viem";

import { giveAt, liveLink, ownDomain, ownHand, ownOptions, rootSeed, describeHand, testSalt } from "../../../../../packages/sdk/tests/link-fixtures";
import { outsideLength, rulerOf, splitPasted, Unmeasurable, type Ruler } from "./ruler";

/** Every byte belongs to exactly one segment, in order. */
function covers(ruler: Ruler): void {
  let at = 0;
  for (const segment of ruler.segments) {
    expect(segment.start).toBe(at);
    expect(segment.length).toBeGreaterThan(0);
    at += segment.length;
  }
  expect(at).toBe(ruler.total);
}

const hand: Hand = ownHand();

describe("check: the ruler measures links the SDK wrote", () => {
  test("a live link at 0 passes: head, secret, pin", async () => {
    const link = await encodeLive({ domain: ownDomain, hand, signedShakes: [], seed: rootSeed }, ownOptions);
    const ruler = rulerOf(link);
    covers(ruler);
    expect(ruler.kind).toBe("live");
    expect(ruler.segments.map((s) => s.kind)).toEqual(["head", "secret", "pin"]);
    expect(ruler.segments.find((s) => s.kind === "secret")!.length).toBe(16);
  });

  test("a live link after three passes, paid, anonymous and with data", async () => {
    const shapes = [
      { paid: true, data: false },
      { paid: false, data: false },
      { paid: true, data: true },
    ];
    const { link } = await liveLink(hand, 3, (position) => shapes[position]!);
    const ruler = rulerOf(link);
    covers(ruler);
    expect(ruler.segments.map((s) => s.kind)).toEqual(["head", "shake", "shake", "shake", "secret"]);
    expect(ruler.segments.filter((s) => s.kind === "shake").map((s) => s.length)).toEqual([1 + 1 + 20 + 64, 1 + 64, 1 + 1 + 20 + 32 + 64]);
    expect(ruler.segments.filter((s) => s.kind === "shake").map((s) => s.position)).toEqual([0, 1, 2]);
  });

  test("an addressed link ends at the last key, a give link carries the Give and no secret", async () => {
    const { opened } = await liveLink(hand, 2);
    const addressed = await encodeAddressed({ domain: ownDomain, hand, signedShakes: opened.signedShakes }, ownOptions);
    const a = rulerOf(addressed);
    covers(a);
    expect(a.kind).toBe("addressed");
    expect(a.segments.map((s) => s.kind)).toEqual(["head", "shake", "shake", "last-key"]);

    const signedGive = await giveAt(opened, undefined, keccak256(stringToBytes("their words")));
    const give = await encodeGive({ domain: ownDomain, hand, signedShakes: opened.signedShakes, signedGive }, ownOptions);
    const g = rulerOf(give);
    covers(g);
    expect(g.kind).toBe("give");
    expect(g.segments.map((s) => s.kind)).toEqual(["head", "shake", "shake", "last-key", "give"]);
    expect(g.segments.some((s) => s.kind === "secret")).toBe(false);
  });

  test("attachments after the route, and a link named by its own Core in the head", async () => {
    const described = describeHand("dark", "A title", "Some words", testSalt("ruler"));
    const withData = { ...hand, dataHash: described.dataHash };
    const link = await encodeLive({ domain: ownDomain, hand: withData, signedShakes: [], seed: rootSeed, attachments: described.linkPart }, ownOptions);
    const ruler = rulerOf(link);
    covers(ruler);
    expect(ruler.segments.map((s) => s.kind)).toEqual(["head", "secret", "pin", "attachments"]);

    const named = await encodeLive({ domain: ownDomain, hand, signedShakes: [], seed: rootSeed }, {});
    const n = rulerOf(named);
    covers(n);
    expect(n.segments[0]!.length).toBe(rulerOf(await encodeLive({ domain: ownDomain, hand, signedShakes: [], seed: rootSeed }, ownOptions)).segments[0]!.length + 20);
  });

  test("bytes that break the layout are not measured", async () => {
    const link = await encodeLive({ domain: ownDomain, hand, signedShakes: [], seed: rootSeed }, ownOptions);
    expect(() => rulerOf(link.subarray(0, link.length - 1))).toThrow(Unmeasurable);
    expect(() => rulerOf(Uint8Array.from([...link, 0]))).toThrow(Unmeasurable);
    expect(() => rulerOf(Uint8Array.from([0x20, ...link.subarray(1)]))).toThrow(Unmeasurable);
  });

  test("the ruler carries offsets only, never a byte's value", async () => {
    const link = await encodeLive({ domain: ownDomain, hand, signedShakes: [], seed: rootSeed }, ownOptions);
    const json = JSON.stringify(rulerOf(link));
    for (const form of [rootSeed.slice(2), toText(Uint8Array.from(Buffer.from(rootSeed.slice(2), "hex"))), toDigits(link)]) {
      expect(json.includes(form)).toBe(false);
    }
    expect(zeroHash.length).toBe(66);
  });

  test("pasted text splits at its first #; the public part is measured by its length", () => {
    expect(splitPasted("  http://x/31337/5?d=AAAA#E-Qx ")).toEqual({ before: "http://x/31337/5?d=AAAA", fragment: "E-Qx" });
    expect(splitPasted("E-Qx")).toEqual({ before: "", fragment: "E-Qx" });
    expect(outsideLength("http://x/31337/5?d=AAAA")).toBe(3);
    expect(outsideLength("http://x/31337/5")).toBe(0);
  });
});
