import { describe, expect, it } from "vitest";

import { openLink } from "../src/link.js";
import { code, handOnChain, liveLink, ownHand, ownOptions } from "./link-fixtures.js";

/**
 * Every single flipped bit of a live link with 0 and with 3 Shakes is refused.
 * It has a file of its own so that vitest runs it beside the other exhaustive flips
 * (link-flip-*.test.ts) and the rest of link.test.ts, not after them.
 */

describe("a link of our own, from a seed", () => {
  const hand = ownHand();
  const getHand = handOnChain(hand);

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
});
