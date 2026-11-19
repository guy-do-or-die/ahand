import type { Address, Hex } from "viem";

import vectors from "../../../contracts/test/fixtures/sdk-vectors.json" with { type: "json" };
import { domain, type Hand, type SignedGive, type SignedShake } from "../src/index.js";
import type { RefusalName } from "../src/index.js";

/**
 * contracts/test/fixtures/sdk-vectors.json is written by contracts/test/SdkVectors.t.sol from Core itself: signed routes
 * and what `checkRoute` and `checkGive` answer about them, or the error they refuse them with.
 * Core is the authority; the SDK must agree with the file.
 */

export const chain = domain(vectors.domain.chainId, vectors.domain.verifyingContract as Address);
export const reported = vectors.domain;

/** The keys the fixtures were signed with: keys of the test only. */
export const keys = vectors.keys as Record<"root" | "first" | "second" | "third" | "giver", Hex>;

/** The key that signs each Shake of a fixture route, in route order, and then the Give. */
export const linkKeys: Hex[] = [keys.root, keys.first, keys.second, keys.third];

interface Signed {
  hand: Hand;
  shakes: SignedShake[];
  give: SignedGive;
}

export interface Accepted extends Signed {
  core: { lastKey: Address; claimBps: number; routeHash: Hex; giveHash: Hex };
}

export interface Refused extends Signed {
  what: string;
  error: { name: RefusalName; position?: number };
}

type Raw = (typeof vectors.routes)[number] | (typeof vectors.refusals)[number];

function signed(raw: Raw): Signed {
  const { keySig, giverSig, ...give } = raw.give;
  return {
    hand: { ...raw.hand, handId: BigInt(raw.hand.handId) } as Hand,
    shakes: raw.shakes.map(({ keySig, ...shake }) => ({ shake, keySig }) as SignedShake),
    give: { give, keySig, giverSig } as SignedGive,
  };
}

export const accepted: Accepted[] = vectors.routes.map((raw) => ({ ...signed(raw), core: raw.core as Accepted["core"] }));

export const refused: Refused[] = vectors.refusals.map((raw) => ({
  ...signed(raw),
  what: raw.what,
  error: raw.error as Refused["error"],
}));
