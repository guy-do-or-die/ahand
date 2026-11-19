import { describe, expect, it } from "vitest";

import { accepted, chain, refused } from "./fixtures.js";
import { Refusal, checkGive, checkRoute } from "../src/index.js";

describe.each(accepted.map((route) => [route.shakes.length, route] as const))(
  "a route of %i Shakes that Core accepts",
  (_, route) => {
    it("ends where Core's checkRoute says it ends", async () => {
      expect(await checkRoute(chain, route.hand, route.shakes)).toEqual({
        lastKey: route.core.lastKey,
        claimBps: route.core.claimBps,
        routeHash: route.core.routeHash,
      });
    });

    it("its Give has the hash Core's checkGive returns", async () => {
      expect(await checkGive(chain, route.hand, route.shakes, route.give)).toBe(route.core.giveHash);
    });

    it("the signer's code is not asked when the signer's own key signed", async () => {
      let asked = false;
      await checkGive(chain, route.hand, route.shakes, route.give, async () => {
        asked = true;
        return false;
      });
      expect(asked).toBe(false);
    });
  },
);

describe("the routes Core refuses are refused with Core's error", () => {
  it("the fixtures name every error of checkRoute and checkGive", () => {
    expect(new Set(refused.map(({ error }) => error.name))).toEqual(
      new Set([
        "GiverIsRaiser",
        "ZeroPayee",
        "InvalidClaim",
        "AnonymousMargin",
        "InvalidKeySig",
        "InvalidRouteHash",
        "BelowMinClaim",
        "InvalidGiverSig",
      ]),
    );
  });

  it.each(refused.map((route) => [route.what, route] as const))("%s", async (_, route) => {
    const refusal = await checkGive(chain, route.hand, route.shakes, route.give).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(Refusal);
    expect({ name: (refusal as Refusal).error, position: (refusal as Refusal).position }).toEqual({
      name: route.error.name,
      position: route.error.position,
    });
  });

  it("a route refused at one of its Shakes is refused by checkRoute alone, the same way", async () => {
    const atAShake = refused.filter(({ error, shakes }) => error.position !== undefined && error.position < shakes.length);
    expect(atAShake.length).toBeGreaterThan(0);
    for (const route of atAShake) {
      await expect(checkRoute(chain, route.hand, route.shakes)).rejects.toMatchObject({
        error: route.error.name,
        position: route.error.position,
      });
    }
  });
});

describe("a signer whose own key did not sign", () => {
  const route = refused.find(({ what }) => what === "the Give signed by another key than its signer's")!;

  it("is refused when nothing answers for its address", async () => {
    await expect(checkGive(chain, route.hand, route.shakes, route.give)).rejects.toMatchObject({
      error: "InvalidGiverSig",
    });
  });

  it("is accepted or refused by what the code at its address says", async () => {
    const asked: string[] = [];
    const yes = await checkGive(chain, route.hand, route.shakes, route.give, async (signer, _hash, signature) => {
      asked.push(signer, signature);
      return true;
    });
    expect(yes).toMatch(/^0x[0-9a-f]{64}$/);
    expect(asked).toEqual([route.give.give.signer, route.give.giverSig]);
    await expect(checkGive(chain, route.hand, route.shakes, route.give, async () => false)).rejects.toMatchObject({
      error: "InvalidGiverSig",
    });
  });
});
