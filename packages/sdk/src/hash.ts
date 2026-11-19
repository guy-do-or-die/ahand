import { concatHex, encodeAbiParameters, keccak256, stringToBytes, zeroHash, type Hex } from "viem";

import {
  GIVE_TYPE_STRING,
  HAND_TYPE_STRING,
  SHAKE_TYPE_STRING,
  type Eip712Domain,
  type Give,
  type Hand,
  type Shake,
} from "./types.js";

/**
 * Hashing as Core does it. Every function here is checked against what Core itself returns
 * (tests/core-vectors.json, written by contracts/test/SdkVectors.t.sol).
 */

export const HAND_TYPEHASH: Hex = keccak256(stringToBytes(HAND_TYPE_STRING));
export const SHAKE_TYPEHASH: Hex = keccak256(stringToBytes(SHAKE_TYPE_STRING));
export const GIVE_TYPEHASH: Hex = keccak256(stringToBytes(GIVE_TYPE_STRING));

const DOMAIN_TYPEHASH: Hex = keccak256(
  stringToBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
);

export function domainSeparator(domain: Eip712Domain): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [
        DOMAIN_TYPEHASH,
        keccak256(stringToBytes(domain.name)),
        keccak256(stringToBytes(domain.version)),
        BigInt(domain.chainId),
        domain.verifyingContract,
      ],
    ),
  );
}

/** What gets signed: keccak256("\x19\x01" || domainSeparator || structHash). */
export function digest(separator: Hex, structHash: Hex): Hex {
  return keccak256(concatHex(["0x1901", separator, structHash]));
}

/** The Hand as a Shake or a Give names it. */
export function handHash(hand: Hand): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint16" },
        { type: "uint16" },
        { type: "bytes32" },
      ],
      [
        HAND_TYPEHASH,
        hand.handId,
        hand.raiser,
        hand.token,
        hand.rootKey,
        hand.payoutGasK,
        hand.minClaimBps,
        hand.dataHash,
      ],
    ),
  );
}

export function shakeHash(hand: Hand, shake: Shake): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "uint16" },
        { type: "uint16" },
        { type: "bytes32" },
      ],
      [SHAKE_TYPEHASH, handHash(hand), shake.nextKey, shake.payee, shake.claimBps, shake.nextClaimBps, shake.dataHash],
    ),
  );
}

/** The hash Core keeps as `giveHash` in `thanks` when the raiser thanks this Give. */
export function giveHash(hand: Hand, give: Give): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "uint16" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [GIVE_TYPEHASH, handHash(hand), give.signer, give.payee, give.claimBps, give.routeHash, give.dataHash],
    ),
  );
}

/**
 * The hash of a route, which its Give names: each Shake's hash is chained onto the hash so far,
 * starting from zero. A route without Shakes hashes to zero.
 */
export function routeHash(hand: Hand, shakes: readonly Shake[]): Hex {
  let hash: Hex = zeroHash;
  for (const shake of shakes) hash = extendRouteHash(hash, shakeHash(hand, shake));
  return hash;
}

/** One step of the route hash: the hash so far with one more Shake's hash chained onto it. */
export function extendRouteHash(hashSoFar: Hex, nextShakeHash: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [hashSoFar, nextShakeHash]));
}
