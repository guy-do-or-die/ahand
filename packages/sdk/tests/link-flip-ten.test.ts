import { describe, expect, it } from "vitest";

import { openLink } from "../src/link.js";
import { code, handOnChain, liveLink, ownHand, ownOptions } from "./link-fixtures.js";

/**
 * One flipped bit in every byte of a live link with 10 Shakes is refused.
 * It has a file of its own so that vitest runs it beside the other exhaustive flips
 * (link-flip-*.test.ts) and the rest of link.test.ts, not after them.
 */

describe("a link of our own, from a seed", () => {
  const hand = ownHand();
  const getHand = handOnChain(hand);

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
});
