/**
 * aHand as the first Shaker on board-originated routes.
 *
 * An open public hand's root secret is in its pinned doc, so anyone could
 * branch from the root directly — the app hop is the DEFAULT route the app
 * hands out, not an enforcement. The server signs the root→child delegation
 * (root secret is public anyway) and co-signs the app's ShakerAcceptance
 * (explicit mode: shaker ≠ signing capability), attributing aHand and
 * reserving a small disclosed margin, clamped so the giver floor always
 * holds and dust pots never revert with MarginRoundsToZero.
 */
import { privateKeyToAccount } from "viem/accounts";
import {
  newCapability,
  signShake,
  signShakerAcceptance,
  shakeStructHash,
  BPS_DENOMINATOR,
  type Shake,
  type SignedShake,
} from "@ahand/sdk";

/** The app's default margin on board-routed hands (2.5%), pre-clamp. */
export const APP_HOP_MARGIN_BPS = 250;

const ZERO32 = `0x${"0".repeat(64)}` as `0x${string}`;

export interface AppHopResult {
  signedShake: SignedShake;
  /** Fresh bearer secret for the child capability — for THIS visitor's branch. */
  childSecret: `0x${string}`;
  marginBps: number;
}

export async function buildAppHop(params: {
  handId: bigint;
  expiry: bigint;
  rootSecret: `0x${string}`;
  minGiverClaimBps: number;
  /** creditedReward - charityAllocation, in token units — for the dust clamp. */
  distributable: bigint;
  chainId: number | bigint;
  core: `0x${string}`;
  appKey: `0x${string}`;
}): Promise<AppHopResult> {
  const app = privateKeyToAccount(params.appKey);

  let marginBps = Math.min(APP_HOP_MARGIN_BPS, BPS_DENOMINATOR - params.minGiverClaimBps);
  if (marginBps > 0 && (params.distributable * BigInt(marginBps)) / BigInt(BPS_DENOMINATOR) === 0n) {
    marginBps = 0; // Core rejects positive-bps margins that floor to zero tokens
  }

  const child = newCapability();
  const shake: Shake = {
    handId: params.handId,
    childCapability: child.address,
    shaker: app.address,
    parentClaimBps: BPS_DENOMINATOR,
    childClaimBps: BPS_DENOMINATOR - marginBps,
    hopDataHash: ZERO32,
    deadline: params.expiry, // the codec reconstructs deadlines from expiry
  };

  const signature = await signShake(shake, params.rootSecret, params.chainId, params.core);
  const acceptanceSig = await signShakerAcceptance(
    shakeStructHash(shake),
    app,
    params.chainId,
    params.core,
  );

  return {
    signedShake: { shake, signature, acceptanceSig },
    childSecret: child.privateKey,
    marginBps,
  };
}
