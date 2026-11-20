import { keccak256, stringToBytes } from "viem";
import { describe, expect, it } from "vitest";

import { LinkError, encodeGive, encodeLive, linkLayout, type LinkLayout } from "../src/link.js";
import { giveAt, liveLink, ownDomain, ownHand, ownOptions, rootSeed } from "./link-fixtures.js";

/** Every byte belongs to exactly one segment, in order. */
function covered(layout: LinkLayout): boolean {
  let at = 0;
  for (const segment of layout.segments) {
    if (segment.start !== at || segment.length <= 0) return false;
    at += segment.length;
  }
  return at === layout.total;
}

describe("linkLayout: where a link's parts lie, by the reader's own flags", () => {
  const hand = ownHand();

  it("a live link at 0 passes, one after two passes, and a give link", async () => {
    const fresh = linkLayout(await encodeLive({ domain: ownDomain, hand, signedShakes: [], seed: rootSeed }, ownOptions));
    expect(covered(fresh)).toBe(true);
    expect(fresh.segments.map((s) => s.kind)).toEqual(["head", "secret", "pin"]);

    const { link, opened } = await liveLink(hand, 2);
    const passed = linkLayout(link);
    expect(covered(passed)).toBe(true);
    expect(passed.kind).toBe("live");
    expect(passed.segments.map((s) => s.kind)).toEqual(["head", "shake", "shake", "secret"]);

    const signedGive = await giveAt(opened, undefined, keccak256(stringToBytes("words")));
    const give = linkLayout(await encodeGive({ domain: ownDomain, hand, signedShakes: opened.signedShakes, signedGive }, ownOptions));
    expect(covered(give)).toBe(true);
    expect(give.kind).toBe("give");
    expect(give.segments.map((s) => s.kind)).toEqual(["head", "shake", "shake", "last-key", "give"]);
  });

  it("refuses another version and cut bytes as the reader does", async () => {
    const link = await encodeLive({ domain: ownDomain, hand, signedShakes: [], seed: rootSeed }, ownOptions);
    const other = Uint8Array.from(link);
    other[0] = (2 << 4) | (other[0]! & 0x0f);
    expect(() => linkLayout(other)).toThrow(LinkError);
    expect(() => linkLayout(link.subarray(0, link.length - 3))).toThrow(/ends in the middle/);
  });
});
