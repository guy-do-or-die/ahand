import {
  compactSignatureToSignature,
  parseCompactSignature,
  parseSignature,
  serializeCompactSignature,
  serializeSignature,
  signatureToCompactSignature,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import {
  domain,
  GIVE_TYPES,
  GIVER_ACCEPTANCE_TYPES,
  SHAKE_TYPES,
  SHAKER_ACCEPTANCE_TYPES,
  type Give,
  type Shake,
} from "./types.js";

/**
 * Ephemeral capability: fresh private key for every hop.
 * RULE: the forwarded payload contains AT MOST ONE private key —
 * that of the latest capability. The parent's key is stripped by the codec (see payload.ts).
 */
export function newCapability(): { privateKey: Hex; address: `0x${string}` } {
  const privateKey = generatePrivateKey();
  return { privateKey, address: privateKeyToAddress(privateKey) };
}

function shakeMessage(shake: Shake) {
  return {
    handId: shake.handId,
    childCapability: shake.childCapability as `0x${string}`,
    shaker: shake.shaker as `0x${string}`,
    parentClaimBps: shake.parentClaimBps,
    childClaimBps: shake.childClaimBps,
    hopDataHash: shake.hopDataHash as Hex,
    deadline: Number(shake.deadline),
  };
}

function giveMessage(give: Give) {
  return {
    handId: give.handId,
    routeHash: give.routeHash as Hex,
    giver: give.giver as `0x${string}`,
    solutionHash: give.solutionHash as Hex,
    finalClaimBps: give.finalClaimBps,
    deadline: Number(give.deadline),
  };
}

/** Sign shake using the parent capability key. */
export async function signShake(
  shake: Shake,
  parentCapabilityPriv: Hex,
  chainId: number | bigint,
  core: `0x${string}`,
): Promise<Hex> {
  const account = privateKeyToAccount(parentCapabilityPriv);
  return account.signTypedData({
    domain: domain(chainId, core),
    types: SHAKE_TYPES,
    primaryType: "Shake",
    message: shakeMessage(shake),
  });
}

/** Sign give using the last capability key in the route path. */
export async function signGive(
  give: Give,
  lastCapabilityPriv: Hex,
  chainId: number | bigint,
  core: `0x${string}`,
): Promise<Hex> {
  const account = privateKeyToAccount(lastCapabilityPriv);
  return account.signTypedData({
    domain: domain(chainId, core),
    types: GIVE_TYPES,
    primaryType: "Give",
    message: giveMessage(give),
  });
}

/**
 * Anything that can produce an EIP-712 signature: a viem local account or a
 * connected wallet client (with a hoisted account). Acceptances are the ONLY
 * artifacts signed by user wallets — everything else is capability-key work.
 */
export interface TypedSigner {
  signTypedData(parameters: {
    domain: ReturnType<typeof domain>;
    types: Record<string, readonly { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

/** Consent of a distinct Shaker account to attribution over the exact shakeHash. */
export async function signShakerAcceptance(
  shakeHash: Hex,
  signer: TypedSigner,
  chainId: number | bigint,
  core: `0x${string}`,
): Promise<Hex> {
  return signer.signTypedData({
    domain: domain(chainId, core),
    types: SHAKER_ACCEPTANCE_TYPES,
    primaryType: "ShakerAcceptance",
    message: { shakeHash },
  });
}

/** Consent of the Giver account to attribution over the exact giveHash. */
export async function signGiverAcceptance(
  giveHash: Hex,
  signer: TypedSigner,
  chainId: number | bigint,
  core: `0x${string}`,
): Promise<Hex> {
  return signer.signTypedData({
    domain: domain(chainId, core),
    types: GIVER_ACCEPTANCE_TYPES,
    primaryType: "GiverAcceptance",
    message: { giveHash },
  });
}

/*//////////////////////////////////////////////////////////////
            EIP-2098 compact signatures (codec stores 64B)
//////////////////////////////////////////////////////////////*/

/** 65-byte signature → 64-byte EIP-2098 compact form; compact input passes through. */
export function toCompactSig(signature: Hex): Hex {
  if (signature.length === 130) return signature; // already compact (64 bytes)
  return serializeCompactSignature(
    signatureToCompactSignature(parseSignature(signature)),
  );
}

/** 64-byte EIP-2098 compact signature → 65-byte form (v in {27, 28}); long input passes through. */
export function fromCompactSig(signature: Hex): Hex {
  if (signature.length === 132) return signature; // already 65 bytes
  return serializeSignature(
    compactSignatureToSignature(parseCompactSignature(signature)),
  );
}
