import { describe, expect, it } from "vitest";
import { concatHex, hexToBigInt, numberToHex, slice, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { accepted, chain, keys, linkKeys } from "./fixtures.js";
import {
  checkGive,
  newKey,
  signGiveWithKey,
  signGiveWithWallet,
  signShake,
  signedBy,
  toCoreSignature,
} from "../src/index.js";

const CURVE_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** The other forms the same signature comes in. */
function shortForm(signature: Hex): Hex {
  const s = hexToBigInt(slice(signature, 32, 64));
  const parity = hexToBigInt(slice(signature, 64, 65)) - 27n;
  return concatHex([slice(signature, 0, 32), numberToHex(s | (parity << 255n), { size: 32 })]);
}
function withParity(signature: Hex): Hex {
  return concatHex([slice(signature, 0, 64), numberToHex(hexToBigInt(slice(signature, 64, 65)) - 27n, { size: 1 })]);
}
function higherS(signature: Hex): Hex {
  const s = CURVE_ORDER - hexToBigInt(slice(signature, 32, 64));
  const v = hexToBigInt(slice(signature, 64, 65)) === 27n ? 28 : 27;
  return concatHex([slice(signature, 0, 32), numberToHex(s, { size: 32 }), numberToHex(v, { size: 1 })]);
}

describe.each(accepted.map((route) => [route.shakes.length, route] as const))(
  "signing a route of %i Shakes",
  (count, route) => {
    it("each link key signs its Shake to the bytes Core accepted", async () => {
      for (const [position, { shake, keySig }] of route.shakes.entries()) {
        expect(await signShake(linkKeys[position], chain, route.hand, shake)).toBe(keySig);
      }
    });

    it("the last link key and the giver sign the Give to the bytes Core accepted", async () => {
      const { give, keySig, giverSig } = route.give;
      expect(await signGiveWithKey(linkKeys[count], chain, route.hand, give)).toBe(keySig);
      expect(await signGiveWithKey(keys.giver, chain, route.hand, give)).toBe(giverSig);
    });

    it("a wallet is asked for the same Give and its answer is passed on untouched", async () => {
      const wallet = privateKeyToAccount(keys.giver);
      expect(await signGiveWithWallet(wallet, chain, route.hand, route.give.give)).toBe(route.give.giverSig);
      const contractWallet = { signTypedData: async () => "0x00112233" as Hex };
      expect(await signGiveWithWallet(contractWallet, chain, route.hand, route.give.give)).toBe("0x00112233");
    });
  },
);

describe("a new link key", () => {
  it("signs what Core's check takes for its address, and no two are alike", async () => {
    const key = newKey();
    const hash = "0x5c3bd3e9e1a0b3f1d2a7c0f3a1b2c3d4e5f60718293a4b5c6d7e8f9012345678" as Hex;
    const signature = toCoreSignature(await privateKeyToAccount(key.privateKey).sign({ hash }));
    expect(await signedBy(key.address, hash, signature)).toBe(true);
    expect(await signedBy(newKey().address, hash, signature)).toBe(false);
  });
});

describe("the one form of a key's signature Core takes", () => {
  const { hand, shakes, give } = accepted[2];
  const signatures = [...shakes.map(({ keySig }) => keySig), give.keySig, give.giverSig];

  it("is left as it is", () => {
    for (const signature of signatures) expect(toCoreSignature(signature)).toBe(signature);
  });

  it("is reached from the short form, from v as 0 or 1 and from the higher s", () => {
    for (const signature of signatures) {
      expect(toCoreSignature(shortForm(signature))).toBe(signature);
      expect(toCoreSignature(withParity(signature))).toBe(signature);
      expect(toCoreSignature(higherS(signature))).toBe(signature);
    }
  });

  it("the other forms are not what Core's check takes", async () => {
    for (const other of [shortForm, withParity, higherS]) {
      const changed = { ...give, giverSig: other(give.giverSig) };
      await expect(checkGive(chain, hand, shakes, changed)).rejects.toMatchObject({ error: "InvalidGiverSig" });
    }
  });

  it("anything else is refused", () => {
    expect(() => toCoreSignature("0x1234")).toThrow();
    expect(() => toCoreSignature(concatHex([slice(give.keySig, 0, 64), "0x05"]))).toThrow();
  });
});
