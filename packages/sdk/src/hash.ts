import {
  concatHex,
  encodeAbiParameters,
  hashDomain,
  hashTypedData,
  keccak256,
  stringToBytes,
  type Hex,
} from "viem";
import {
  domain,
  GIVE_TYPES,
  GIVE_TYPE_STRING,
  GIVER_ACCEPTANCE_TYPE_STRING,
  SHAKE_TYPES,
  SHAKE_TYPE_STRING,
  SHAKER_ACCEPTANCE_TYPE_STRING,
  type Give,
  type HandRef,
  type Shake,
} from "./types.js";

/**
 * Hashing — every function here MUST byte-match its AHandSig counterpart.
 * Struct hashes cover the FROZEN field order; signature bytes are deliberately
 * excluded everywhere, so malleability cannot rename a route or an artifact.
 */

export const SHAKE_TYPEHASH: Hex = keccak256(stringToBytes(SHAKE_TYPE_STRING));
export const SHAKER_ACCEPTANCE_TYPEHASH: Hex = keccak256(
  stringToBytes(SHAKER_ACCEPTANCE_TYPE_STRING),
);
export const GIVE_TYPEHASH: Hex = keccak256(stringToBytes(GIVE_TYPE_STRING));
export const GIVER_ACCEPTANCE_TYPEHASH: Hex = keccak256(
  stringToBytes(GIVER_ACCEPTANCE_TYPE_STRING),
);

/** EIP-712 domainSeparator — must match core.DOMAIN_SEPARATOR(). */
export function domainSeparator(
  chainId: number | bigint,
  core: `0x${string}`,
): Hex {
  const d = domain(chainId, core);
  return hashDomain({
    domain: { ...d, chainId: BigInt(d.chainId) },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
    },
  });
}

/** keccak256("\x19\x01" || domainSeparator || structHash) — the raw signing digest. */
export function eip712Digest(ds: Hex, structHash: Hex): Hex {
  return keccak256(concatHex(["0x1901", ds, structHash]));
}

/** Canonical Hand reference hash: keccak256(abi.encode(chainId, core, handId)). */
export function handRef(ref: HandRef): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "uint256" }],
      [ref.chainId, ref.core as `0x${string}`, ref.handId],
    ),
  );
}

/** shakeHash = hashStruct(Shake); what a ShakerAcceptance consents to. */
export function shakeStructHash(s: Shake): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint16" },
        { type: "uint16" },
        { type: "bytes32" },
        { type: "uint40" },
      ],
      [
        SHAKE_TYPEHASH,
        s.handId,
        s.childCapability as `0x${string}`,
        s.shaker as `0x${string}`,
        s.parentClaimBps,
        s.childClaimBps,
        s.hopDataHash as Hex,
        Number(s.deadline),
      ],
    ),
  );
}

export function shakeDigest(
  shake: Shake,
  chainId: number | bigint,
  core: `0x${string}`,
): Hex {
  return hashTypedData({
    domain: domain(chainId, core),
    types: SHAKE_TYPES,
    primaryType: "Shake",
    message: {
      handId: shake.handId,
      childCapability: shake.childCapability as `0x${string}`,
      shaker: shake.shaker as `0x${string}`,
      parentClaimBps: shake.parentClaimBps,
      childClaimBps: shake.childClaimBps,
      hopDataHash: shake.hopDataHash as Hex,
      deadline: Number(shake.deadline),
    },
  });
}

/** giveHash = hashStruct(Give); what a GiverAcceptance consents to. */
export function giveHash(g: Give): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint16" },
        { type: "uint40" },
      ],
      [
        GIVE_TYPEHASH,
        g.handId,
        g.routeHash as Hex,
        g.giver as `0x${string}`,
        g.solutionHash as Hex,
        g.finalClaimBps,
        Number(g.deadline),
      ],
    ),
  );
}

export function giveDigest(
  give: Give,
  chainId: number | bigint,
  core: `0x${string}`,
): Hex {
  return hashTypedData({
    domain: domain(chainId, core),
    types: GIVE_TYPES,
    primaryType: "Give",
    message: {
      handId: give.handId,
      routeHash: give.routeHash as Hex,
      giver: give.giver as `0x${string}`,
      solutionHash: give.solutionHash as Hex,
      finalClaimBps: give.finalClaimBps,
      deadline: Number(give.deadline),
    },
  });
}

export function shakerAcceptanceStructHash(shakeHash: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      [SHAKER_ACCEPTANCE_TYPEHASH, shakeHash],
    ),
  );
}

/** Digest a distinct Shaker wallet signs to consent to attribution. */
export function shakerAcceptanceDigest(
  shakeHash: Hex,
  chainId: number | bigint,
  core: `0x${string}`,
): Hex {
  return eip712Digest(
    domainSeparator(chainId, core),
    shakerAcceptanceStructHash(shakeHash),
  );
}

export function giverAcceptanceStructHash(giveHash_: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      [GIVER_ACCEPTANCE_TYPEHASH, giveHash_],
    ),
  );
}

/** Digest the Giver wallet signs to consent to attribution and residual payout. */
export function giverAcceptanceDigest(
  giveHash_: Hex,
  chainId: number | bigint,
  core: `0x${string}`,
): Hex {
  return eip712Digest(
    domainSeparator(chainId, core),
    giverAcceptanceStructHash(giveHash_),
  );
}

/**
 * Route identity: keccak256(abi.encode(handRef, bytes32[] shakeHashes)).
 * Ordered shake STRUCT hashes under the Hand reference — an empty route is valid.
 */
export function routeHash(handRefHash: Hex, shakeHashes: readonly Hex[]): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32[]" }],
      [handRefHash, shakeHashes as Hex[]],
    ),
  );
}

/** Convenience: route identity straight from the Hand reference and shakes. */
export function routeHashOf(ref: HandRef, shakes: readonly Shake[]): Hex {
  return routeHash(handRef(ref), shakes.map(shakeStructHash));
}
