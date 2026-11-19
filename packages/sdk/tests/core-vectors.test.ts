import { describe, expect, it } from "vitest";
import { hashTypedData, isAddressEqual, recoverAddress, zeroHash, type Address, type Hex } from "viem";

import vectors from "./core-vectors.json";
import {
  GIVE_TYPEHASH,
  GIVE_TYPES,
  HAND_TYPEHASH,
  SHAKE_TYPEHASH,
  SHAKE_TYPES,
  digest,
  domain,
  domainSeparator,
  giveHash,
  routeHash,
  shakeHash,
  type Give,
  type Hand,
  type Shake,
} from "../src/index.js";

/**
 * core-vectors.json is written by contracts/test/SdkVectors.t.sol from Core itself: three signed
 * routes and what `checkRoute` and `checkGive` answer about them. Core is the authority; the SDK
 * must reach the same hashes and recover the same signers from the file alone.
 */

const chain = domain(vectors.domain.chainId, vectors.domain.verifyingContract as Address);
const separator = domainSeparator(chain);

interface Route {
  hand: Hand;
  shakes: { shake: Shake; keySig: Hex }[];
  give: Give;
  keySig: Hex;
  giverSig: Hex;
  core: { lastKey: Address; claimBps: number; routeHash: Hex; giveHash: Hex };
}

const routes: Route[] = vectors.routes.map((route) => ({
  hand: { ...route.hand, handId: BigInt(route.hand.handId) } as Hand,
  shakes: route.shakes.map(({ keySig, ...shake }) => ({ shake: shake as Shake, keySig: keySig as Hex })),
  give: {
    signer: route.give.signer,
    payee: route.give.payee,
    claimBps: route.give.claimBps,
    routeHash: route.give.routeHash,
    dataHash: route.give.dataHash,
  } as Give,
  keySig: route.give.keySig as Hex,
  giverSig: route.give.giverSig as Hex,
  core: route.core as Route["core"],
}));

describe("the domain is Core's own", () => {
  it("name and version are the ones Core reports", () => {
    expect(chain.name).toBe(vectors.domain.name);
    expect(chain.version).toBe(vectors.domain.version);
  });
});

describe("type hashes", () => {
  it("are the hashes of the type strings in AHandCore.sol", () => {
    expect(HAND_TYPEHASH).toBe("0xc742d872db3d1dcf02593005ae8c8a0a1f48cab61037cbee6f86772652337962");
    expect(SHAKE_TYPEHASH).toBe("0x3f297631986eac2031249855bdd5aced440ea7aedee335ff2cc2d4bf6fef8d35");
    expect(GIVE_TYPEHASH).toBe("0xf4c201349da789c53e10b90b54ff2362ef9ab735c0713f59905f2f66f48361c4");
  });
});

describe("the fixtures cover the shapes a route takes", () => {
  it("no Shakes, one Shake, and three with one that names no payee", () => {
    expect(routes.map((route) => route.shakes.length)).toEqual([0, 1, 3]);
    expect(routes[2].shakes[1].shake.payee).toBe("0x0000000000000000000000000000000000000000");
  });
});

describe.each(routes.map((route) => [route.shakes.length, route] as const))("a route of %i Shakes", (_, route) => {
  const shakes = route.shakes.map(({ shake }) => shake);

  it("has the route hash Core returns from checkRoute", () => {
    expect(routeHash(route.hand, shakes)).toBe(route.core.routeHash);
    expect(route.give.routeHash).toBe(route.core.routeHash);
  });

  it("a route without Shakes hashes to zero", () => {
    expect(routeHash(route.hand, [])).toBe(zeroHash);
  });

  it("has the Give hash Core returns from checkGive", () => {
    expect(giveHash(route.hand, route.give)).toBe(route.core.giveHash);
  });

  it("every Shake was signed by the key the link had reached", async () => {
    let key = route.hand.rootKey;
    for (const { shake, keySig } of route.shakes) {
      const signer = await recoverAddress({ hash: digest(separator, shakeHash(route.hand, shake)), signature: keySig });
      expect(isAddressEqual(signer, key)).toBe(true);
      key = shake.nextKey;
    }
    expect(isAddressEqual(key, route.core.lastKey)).toBe(true);
  });

  it("the Give was signed by the route's last key and by its signer", async () => {
    const hash = digest(separator, giveHash(route.hand, route.give));
    const byKey = await recoverAddress({ hash, signature: route.keySig });
    const byGiver = await recoverAddress({ hash, signature: route.giverSig });
    expect(isAddressEqual(byKey, route.core.lastKey)).toBe(true);
    expect(isAddressEqual(byGiver, route.give.signer)).toBe(true);
  });

  it("a wallet signing typed data signs the same digests", () => {
    for (const { shake } of route.shakes) {
      const typed = hashTypedData({
        domain: chain,
        types: SHAKE_TYPES,
        primaryType: "Shake",
        message: { hand: route.hand, ...shake },
      });
      expect(typed).toBe(digest(separator, shakeHash(route.hand, shake)));
    }
    const typed = hashTypedData({
      domain: chain,
      types: GIVE_TYPES,
      primaryType: "Give",
      message: { hand: route.hand, ...route.give },
    });
    expect(typed).toBe(digest(separator, giveHash(route.hand, route.give)));
  });
});
