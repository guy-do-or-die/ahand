import { describe, expect, it } from "vitest";
import { hashTypedData, isAddressEqual, recoverAddress, zeroAddress, zeroHash } from "viem";

import { accepted, chain, reported } from "./fixtures.js";
import {
  GIVE_TYPEHASH,
  HAND_TYPEHASH,
  SHAKE_TYPEHASH,
  digest,
  domainSeparator,
  giveHash,
  giveTypedData,
  routeHash,
  shakeHash,
  shakeTypedData,
} from "../src/index.js";

const separator = domainSeparator(chain);

describe("the domain is Core's own", () => {
  it("name and version are the ones Core reports", () => {
    expect(chain.name).toBe(reported.name);
    expect(chain.version).toBe(reported.version);
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
    expect(accepted.map((route) => route.shakes.length)).toEqual([0, 1, 3]);
    expect(accepted[2].shakes[1].shake.payee).toBe(zeroAddress);
  });
});

describe.each(accepted.map((route) => [route.shakes.length, route] as const))("a route of %i Shakes", (_, route) => {
  const shakes = route.shakes.map(({ shake }) => shake);
  const { give, keySig, giverSig } = route.give;

  it("has the route hash Core returns from checkRoute", () => {
    expect(routeHash(route.hand, shakes)).toBe(route.core.routeHash);
    expect(give.routeHash).toBe(route.core.routeHash);
  });

  it("a route without Shakes hashes to zero", () => {
    expect(routeHash(route.hand, [])).toBe(zeroHash);
  });

  it("has the Give hash Core returns from checkGive", () => {
    expect(giveHash(route.hand, give)).toBe(route.core.giveHash);
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
    const hash = digest(separator, giveHash(route.hand, give));
    expect(isAddressEqual(await recoverAddress({ hash, signature: keySig }), route.core.lastKey)).toBe(true);
    expect(isAddressEqual(await recoverAddress({ hash, signature: giverSig }), give.signer)).toBe(true);
  });

  it("a wallet signing typed data signs the same digests", () => {
    for (const { shake } of route.shakes) {
      expect(hashTypedData(shakeTypedData(chain, route.hand, shake))).toBe(
        digest(separator, shakeHash(route.hand, shake)),
      );
    }
    expect(hashTypedData(giveTypedData(chain, route.hand, give))).toBe(digest(separator, giveHash(route.hand, give)));
  });
});
