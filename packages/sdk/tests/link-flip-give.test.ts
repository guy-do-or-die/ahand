import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes } from "viem";

import { checkGive } from "../src/index.js";
import { encodeGive, openLink } from "../src/link.js";
import { giveAt, handOnChain, liveLink, ownDomain, ownHand, ownOptions, payeeAt } from "./link-fixtures.js";

/**
 * Every single flipped bit of a Give link with a Shake is refused, by the link or by the giver's signature.
 * It has a file of its own so that vitest runs it beside the other exhaustive flips
 * (link-flip-*.test.ts) and the rest of link.test.ts, not after them.
 */

describe("a link of our own, from a seed", () => {
  const hand = ownHand();
  const getHand = handOnChain(hand);

  it("refuses every single flipped bit of a Give link with a Shake, in the link or by the giver's signature", async () => {
    // One Shake is enough to have every field of a Give link; the bits of further Shakes are flipped
    // in link-flip-live.test.ts and link-flip-ten.test.ts.
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
});
