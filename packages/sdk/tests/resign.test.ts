import { keccak256, stringToBytes, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { giveHash } from "../src/hash.js";
import { judgeGive, routeKeys, seenGiveOf, type SeenGive } from "../src/resign.js";
import { giveAt, liveLink, ownHand, payeeAt } from "./link-fixtures.js";

const at = (label: string): Address => privateKeyToAddress(keccak256(stringToBytes(label)));
const hashOf = (label: string): Hex => keccak256(stringToBytes(`give ${label}`));

const r = at("root"), k1 = at("k1"), k2 = at("k2"), k3 = at("k3"), k4 = at("k4");
const p0 = at("p0"), p1 = at("p1"), p2 = at("p2"), p3 = at("p3");
const giver = at("giver"), helped = at("helped");

/** The route seen first: root → k1 → k2 → k3 → k4, every holder kept a share; the giver at k4. */
const earlier: SeenGive = {
  handId: 7n,
  keys: [r, k1, k2, k3, k4],
  payees: [p0, p1, p2, p3],
  signer: giver,
  payee: helped,
  giveHash: hashOf("earlier"),
};

function later(keys: Address[], payees: Address[], who: { signer?: Address; payee?: Address } = {}): SeenGive {
  return { handId: 7n, keys, payees, signer: who.signer ?? at("another giver"), payee: who.payee ?? at("another payee"), giveHash: hashOf(keys.join()) };
}

describe("judgeGive", () => {
  it("first: nothing seen for this Hand (a Give of another Hand does not count)", () => {
    expect(judgeGive([], earlier)).toEqual({ verdict: "first", dropped: [] });
    expect(judgeGive([{ ...earlier, handId: 8n }], earlier)).toEqual({ verdict: "first", dropped: [] });
  });

  it("same: the Give already seen", () => {
    expect(judgeGive([earlier], { ...earlier })).toEqual({ verdict: "same", dropped: [] });
  });

  it("branch: a holder passed to two people; another line reached another giver (allowed)", () => {
    const n3 = at("n3");
    expect(judgeGive([earlier], later([r, k1, k2, n3], [p0, p1, at("p2'")]))).toEqual({ verdict: "branch", dropped: [] });
    // A route that goes on past the earlier giver's key keeps every earlier holder.
    expect(judgeGive([earlier], later([r, k1, k2, k3, k4, at("n5")], [p0, p1, p2, p3, at("p4")]))).toEqual({ verdict: "branch", dropped: [] });
  });

  it("resigned: a middle cut that rejoins the earlier route after skipping a holder", () => {
    const cut = later([r, k1, k3, k4], [p0, at("p1'"), p3]);
    expect(judgeGive([earlier], cut)).toEqual({ verdict: "resigned", dropped: [{ position: 2, key: k2, payee: p2 }] });
    // Inserting a stranger in place of the skipped holders does not hide the cut.
    const swapped = later([r, k1, at("stranger"), k4], [p0, at("p1'"), at("p-stranger")]);
    expect(judgeGive([earlier], swapped)).toEqual({
      verdict: "resigned",
      dropped: [
        { position: 2, key: k2, payee: p2 },
        { position: 3, key: k3, payee: p3 },
      ],
    });
  });

  it("resigned: a tail cut for the same payee, signed by a new one-time key", () => {
    const tail = later([r, k1, at("fresh")], [p0, p1], { signer: at("one-time key"), payee: helped });
    expect(judgeGive([earlier], tail)).toEqual({
      verdict: "resigned",
      dropped: [
        { position: 2, key: k2, payee: p2 },
        { position: 3, key: k3, payee: p3 },
      ],
    });
  });

  it("resigned: the same signer paying elsewhere, or the earlier payee now signing", () => {
    expect(judgeGive([earlier], later([r, k1, at("x")], [p0, p1], { signer: giver })).verdict).toBe("resigned");
    expect(judgeGive([earlier], later([r, k1, at("x")], [p0, p1], { signer: helped })).verdict).toBe("resigned");
  });

  it("branch: the same payee on a route that drops only holders who kept nothing", () => {
    const anonymousTail: SeenGive = { ...earlier, payees: [p0, p1, zeroAddress, zeroAddress] };
    const tail = later([r, k1, at("fresh")], [p0, p1], { payee: helped });
    expect(judgeGive([anonymousTail], tail)).toEqual({ verdict: "branch", dropped: [] });
  });

  it("names a skipped holder who kept nothing without a payee", () => {
    const anonymousMiddle: SeenGive = { ...earlier, payees: [p0, p1, zeroAddress, p3] };
    expect(judgeGive([anonymousMiddle], later([r, k1, k3, k4], [p0, p1, p3]))).toEqual({ verdict: "resigned", dropped: [{ position: 2, key: k2 }] });
  });

  it("judges against every Give seen, and names each dropped holder once", () => {
    const second = later([r, k1, k2, at("n3")], [p0, p1, p2], { signer: at("g2"), payee: at("h2") });
    const cut = later([r, k1, k3, k4], [p0, p1, p3]);
    expect(judgeGive([earlier, second], cut)).toEqual({ verdict: "resigned", dropped: [{ position: 2, key: k2, payee: p2 }] });
  });
});

describe("routeKeys and seenGiveOf, from a real link", () => {
  it("are the root key, then each Shake's next key; payees only where a share was kept", async () => {
    const hand = ownHand();
    const { opened } = await liveLink(hand, 3, (position) => ({ paid: position !== 1, data: false }));
    const signedGive = await giveAt(opened);
    const keys = routeKeys(hand, opened.signedShakes);
    expect(keys).toHaveLength(4);
    expect(keys[0]).toBe(hand.rootKey);
    expect(keys[3]).toBe(opened.end.lastKey);

    const seen = seenGiveOf(hand, opened.signedShakes, signedGive);
    expect(seen.keys).toEqual(keys);
    expect(seen.payees).toEqual([payeeAt(0), zeroAddress, payeeAt(2)]);
    expect(seen.giveHash).toBe(giveHash(hand, signedGive.give));
    expect(seen.handId).toBe(hand.handId);

    // The same giver again from a second line out of the root: it drops the first line's paid holders.
    const other = await liveLink(hand, 1);
    const verdict = judgeGive([seen], seenGiveOf(hand, other.opened.signedShakes, await giveAt(other.opened)));
    expect(verdict.verdict).toBe("resigned");
    expect(verdict.dropped.map(({ position }) => position)).toEqual([2]);
  });
});
