import { hashTypedData, hashDomain, type Hex } from "viem";
import {
  privateKeyToAccount,
  privateKeyToAddress,
  generatePrivateKey,
} from "viem/accounts";
import {
  domain,
  SHAKE_TYPES,
  GIVE_TYPES,
  type Shake,
  type Give,
} from "./types.js";

/**
 * Ephemeral capability: fresh private key for every hop.
 * Appendix P RULE: the forwarded payload contains EXACTLY ONE private key —
 * that of the latest capability. The parent's key is stripped by the codec (see payload.ts).
 */
export function newCapability(): { privateKey: Hex; address: `0x${string}` } {
  const privateKey = generatePrivateKey();
  return { privateKey, address: privateKeyToAddress(privateKey) };
}

/** EIP-712 domainSeparator — must match core.DOMAIN_SEPARATOR(). */
export function domainSeparator(
  chainId: number,
  core: `0x${string}`,
): Hex {
  return hashDomain({
    domain: domain(chainId, core) as any,
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

export function shakeDigest(
  shake: Shake,
  chainId: number,
  core: `0x${string}`,
): Hex {
  return hashTypedData({
    domain: domain(chainId, core) as any,
    types: SHAKE_TYPES,
    primaryType: "Shake",
    message: {
      handId: shake.handId,
      childCapability: shake.childCapability as `0x${string}`,
      payout: shake.payout as `0x${string}`,
      parentClaimBps: shake.parentClaimBps,
      childClaimBps: shake.childClaimBps,
      deadline: Number(shake.deadline),
    },
  });
}

export function giveDigest(
  give: Give,
  chainId: number,
  core: `0x${string}`,
): Hex {
  return hashTypedData({
    domain: domain(chainId, core),
    types: GIVE_TYPES,
    primaryType: "Give",
    message: {
      handId: give.handId,
      solver: give.solver as `0x${string}`,
      solutionHash: give.solutionHash as `0x${string}`,
      finalClaimBps: give.finalClaimBps,
    },
  });
}

/** Sign shake using the parent capability key. */
export async function signShake(
  shake: Shake,
  parentCapabilityPriv: Hex,
  chainId: number,
  core: `0x${string}`,
): Promise<Hex> {
  const account = privateKeyToAccount(parentCapabilityPriv);
  return account.signTypedData({
    domain: domain(chainId, core) as any,
    types: SHAKE_TYPES,
    primaryType: "Shake",
    message: {
      handId: shake.handId,
      childCapability: shake.childCapability as `0x${string}`,
      payout: shake.payout as `0x${string}`,
      parentClaimBps: shake.parentClaimBps,
      childClaimBps: shake.childClaimBps,
      deadline: Number(shake.deadline),
    },
  });
}

/** Sign give using the last capability key in the route path. */
export async function signGive(
  give: Give,
  lastCapabilityPriv: Hex,
  chainId: number,
  core: `0x${string}`,
): Promise<Hex> {
  const account = privateKeyToAccount(lastCapabilityPriv);
  return account.signTypedData({
    domain: domain(chainId, core),
    types: GIVE_TYPES,
    primaryType: "Give",
    message: {
      handId: give.handId,
      solver: give.solver as `0x${string}`,
      solutionHash: give.solutionHash as `0x${string}`,
      finalClaimBps: give.finalClaimBps,
    },
  });
}
