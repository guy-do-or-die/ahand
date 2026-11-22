import { concatHex, hexToBigInt, numberToHex, size, slice, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from "viem/accounts";

import { GIVE_TYPES, SHAKE_TYPES, type Eip712Domain, type Give, type Hand, type Shake } from "./types.js";
import { CURVE_ORDER, HALF_ORDER } from "./verify.js";

/** What a wallet is asked to sign for a Shake: the same bytes `shakeHash` and `digest` lead to. */
export function shakeTypedData(domain: Eip712Domain, hand: Hand, shake: Shake) {
  return { domain, types: SHAKE_TYPES, primaryType: "Shake" as const, message: { hand, ...shake } };
}

/** What a wallet is asked to sign for a Give. */
export function giveTypedData(domain: Eip712Domain, hand: Hand, give: Give) {
  return { domain, types: GIVE_TYPES, primaryType: "Give" as const, message: { hand, ...give } };
}

/** Anything that signs a Give as typed data: a viem account, or a wallet behind a client. */
export interface GiveSigner {
  signTypedData(typedData: ReturnType<typeof giveTypedData>): Promise<Hex>;
}

/** A fresh link key: whoever holds the private key holds the link from here on. */
export function newKey(): { privateKey: Hex; address: Address } {
  const privateKey = generatePrivateKey();
  return { privateKey, address: privateKeyToAddress(privateKey) };
}

/** Signs a Shake with the link key it comes from: the root key for the first, then each `nextKey`. */
export async function signShake(linkKey: Hex, domain: Eip712Domain, hand: Hand, shake: Shake): Promise<Hex> {
  return toCoreSignature(await privateKeyToAccount(linkKey).signTypedData(shakeTypedData(domain, hand, shake)));
}

/** Signs a Give with a private key: the route's last link key, or a giver's own key. */
export async function signGiveWithKey(key: Hex, domain: Eip712Domain, hand: Hand, give: Give): Promise<Hex> {
  return toCoreSignature(await privateKeyToAccount(key).signTypedData(giveTypedData(domain, hand, give)));
}

/**
 * Asks the giver's wallet to sign a Give and returns what the wallet answered, untouched: a smart
 * wallet's signature is its own format and goes to Core as it is. For a wallet that is a plain
 * key, bring the answer to Core's form with `toCoreSignature`.
 */
export function signGiveWithWallet(
  wallet: GiveSigner,
  domain: Eip712Domain,
  hand: Hand,
  give: Give,
): Promise<Hex> {
  return wallet.signTypedData(giveTypedData(domain, hand, give));
}


/**
 * Core takes a key's signature only as 65 bytes, `r`, `s`, `v`, with `v` 27 or 28 and `s` in the
 * lower half of the curve's order. Wallets and libraries also give the same signature as 64
 * bytes (ERC-2098), with `v` 0 or 1, or with the higher `s`: this brings each of them to the one
 * form Core takes. The signer stays the same. Anything else is not a key's signature and throws.
 */
export function toCoreSignature(signature: Hex): Hex {
  let r: Hex;
  let s: bigint;
  let v: number;
  if (size(signature) === 64) {
    const vs = hexToBigInt(slice(signature, 32, 64));
    r = slice(signature, 0, 32);
    s = vs & ((1n << 255n) - 1n);
    v = 27 + Number(vs >> 255n);
  } else if (size(signature) === 65) {
    r = slice(signature, 0, 32);
    s = hexToBigInt(slice(signature, 32, 64));
    v = Number(hexToBigInt(slice(signature, 64, 65)));
    if (v === 0 || v === 1) v += 27;
  } else {
    throw new Error(`a key's signature is 64 or 65 bytes, not ${size(signature)}`);
  }
  if (v !== 27 && v !== 28) throw new Error(`a key's signature ends in 27, 28, 0 or 1, not ${v}`);
  if (s > HALF_ORDER) {
    s = CURVE_ORDER - s;
    v = v === 27 ? 28 : 27;
  }
  return concatHex([r, numberToHex(s, { size: 32 }), numberToHex(v, { size: 1 })]);
}
