import {
  hexToBigInt,
  isAddressEqual,
  recoverAddress,
  size,
  slice,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from "viem";

import { digest, domainSeparator, extendRouteHash, giveHash, shakeHash } from "./hash.js";
import { BPS, type Eip712Domain, type Hand, type SignedGive, type SignedShake } from "./types.js";

/**
 * The checks Core makes on a route and on the Give that ends it, in Core's order and with Core's
 * errors, so that an application learns before sending a transaction what `thank` would say.
 * Checked against Core's own answers (contracts/test/fixtures/sdk-vectors.json).
 *
 * What only the chain knows is not here: whether the Hand is still open and before its expiry,
 * who calls, and what the code at the signer's address says about a signature.
 */

/** The errors of AHandCore.sol that `checkRoute` and `checkGive` revert with. */
export type RefusalName =
  | "GiverIsRaiser"
  | "ZeroPayee"
  | "InvalidClaim"
  | "AnonymousMargin"
  | "InvalidKeySig"
  | "InvalidRouteHash"
  | "BelowMinClaim"
  | "InvalidGiverSig";

/** Core would refuse this route or this Give with `error`, at `position` for the errors that name one. */
export class Refusal extends Error {
  constructor(
    readonly error: RefusalName,
    readonly position?: number,
  ) {
    super(position === undefined ? error : `${error}(${position})`);
    this.name = "Refusal";
  }
}

/** Where a route ends: what `checkRoute` returns. */
export interface RouteEnd {
  /** The route's last key, which must sign the Give. */
  lastKey: Address;
  /** The claim left for the giver, in basis points. */
  claimBps: number;
  routeHash: Hex;
}

/** The order of the secp256k1 curve, and its half: Core takes only signatures whose `s` is in the lower half. */
export const CURVE_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
export const HALF_ORDER = CURVE_ORDER >> 1n;

/** Whether `signature` has the one form Core takes from a key: 65 bytes, `v` 27 or 28, `s` in the lower half. */
export function isKeySignature(signature: Hex): boolean {
  if (size(signature) !== 65) return false;
  const v = Number(hexToBigInt(slice(signature, 64, 65)));
  return (v === 27 || v === 28) && hexToBigInt(slice(signature, 32, 64)) <= HALF_ORDER;
}

/**
 * Whether `key` signed `hash`, as Core's `_signedBy` judges it: only a signature in the form Core
 * takes counts, and one that cannot be read never counts.
 */
export async function signedBy(key: Address, hash: Hex, signature: Hex): Promise<boolean> {
  if (!isKeySignature(signature)) return false;
  try {
    return isAddressEqual(await recoverAddress({ hash, signature }), key);
  } catch {
    return false;
  }
}

/**
 * Follows the route from the Hand's root key, as Core's `checkRoute` does. Each Shake must start
 * from the claim that reached it and pass on no more, keep nothing without a payee, and be signed
 * by the key it comes from. Throws the `Refusal` Core would revert with.
 */
export async function checkRoute(
  domain: Eip712Domain,
  hand: Hand,
  signedShakes: readonly SignedShake[],
): Promise<RouteEnd> {
  const separator = domainSeparator(domain);
  let key = hand.rootKey;
  let claim = BPS;
  let routeHash: Hex = zeroHash;

  for (const [position, { shake, keySig }] of signedShakes.entries()) {
    if (shake.claimBps !== claim || shake.nextClaimBps > claim) throw new Refusal("InvalidClaim", position);
    if (isAddressEqual(shake.payee, zeroAddress) && shake.nextClaimBps !== claim) {
      throw new Refusal("AnonymousMargin", position);
    }

    const hash = shakeHash(hand, shake);
    if (!(await signedBy(key, digest(separator, hash), keySig))) throw new Refusal("InvalidKeySig", position);

    routeHash = extendRouteHash(routeHash, hash);
    key = shake.nextKey;
    claim = shake.nextClaimBps;
  }
  return { lastKey: key, claimBps: claim, routeHash };
}

/**
 * Asked when the signer's own key did not sign: what the code at the signer's address says about
 * the signature (ERC-1271). An application answers it with a call to the chain.
 */
export type AskSignerCode = (signer: Address, hash: Hex, signature: Hex) => Promise<boolean>;

/**
 * Checks a route and the Give that ends it, as Core's `checkGive` does, and returns the Give's
 * hash: the `giveHash` Core keeps in `thanks` if the raiser thanks this Give. Throws the `Refusal`
 * Core would revert with.
 *
 * The giver's signature counts if the signer's own key made it. Otherwise `askSignerCode` decides,
 * if given; without it the Give is refused, as Core refuses it for an address without code. One
 * thing differs from the chain and cannot be seen from here: an address that has code and no
 * EIP-7702 delegation no longer answers to its own key there.
 */
export async function checkGive(
  domain: Eip712Domain,
  hand: Hand,
  signedShakes: readonly SignedShake[],
  signedGive: SignedGive,
  askSignerCode?: AskSignerCode,
): Promise<Hex> {
  const { give, keySig, giverSig } = signedGive;
  if (isAddressEqual(give.signer, hand.raiser)) throw new Refusal("GiverIsRaiser");
  if (isAddressEqual(give.payee, zeroAddress)) throw new Refusal("ZeroPayee");

  const route = await checkRoute(domain, hand, signedShakes);
  if (give.claimBps !== route.claimBps) throw new Refusal("InvalidClaim", signedShakes.length);
  if (give.routeHash.toLowerCase() !== route.routeHash.toLowerCase()) throw new Refusal("InvalidRouteHash");
  if (route.claimBps < hand.minClaimBps) throw new Refusal("BelowMinClaim");

  const hash = giveHash(hand, give);
  const signed = digest(domainSeparator(domain), hash);
  if (!(await signedBy(route.lastKey, signed, keySig))) throw new Refusal("InvalidKeySig", signedShakes.length);

  let byGiver = await signedBy(give.signer, signed, giverSig);
  if (!byGiver && askSignerCode) byGiver = await askSignerCode(give.signer, signed, giverSig);
  if (!byGiver) throw new Refusal("InvalidGiverSig");

  return hash;
}
