import type { Address, Hex } from "viem";

/**
 * Typed view of the on-chain Hand struct (contracts/src/AHandTypes.sol) —
 * mapHand() consumes the NAMED outputs of `getHand(handId)` so a struct
 * field reorder can never silently shift meanings the way positional
 * `handRaw` destructuring did.
 */

/** Status ordinals, mirrored from `enum Status` — order is ABI-load-bearing. */
export const HAND_STATUSES = ["none", "active", "settled", "reclaimed"] as const;
export type HandStatus = (typeof HAND_STATUSES)[number];

/** Visibility ordinals, mirrored from `enum Visibility`. */
export const HAND_VISIBILITIES = ["public", "preview", "dark"] as const;
export type HandVisibility = (typeof HAND_VISIBILITIES)[number];

export interface Hand {
  raiser: Address;
  /** Unix seconds (uint40). */
  expiry: number;
  charityBps: number;
  minGiverClaimBps: number;
  visibility: HandVisibility;
  status: HandStatus;
  rewardToken: Address;
  /** Token units snapshot at raise (uint96); never mutated on-chain. */
  creditedReward: bigint;
  charityRecipient: Address;
  usdScaleAtRaise: bigint;
  rootCapability: Address;
  metadataCommitment: Hex;
  /** Zero for dark hands. */
  discoveryCommitment: Hex;
  /** Zero until Thank; stays zero on Reclaim. */
  thankSignalSourceHash: Hex;
}

/**
 * The shape viem decodes `getHand` into: named struct fields, with small
 * uints as number and wide ones as bigint. Both are accepted defensively —
 * decoder width rules are not something to couple display code to.
 */
export interface HandAbiOutput {
  raiser: Address;
  expiry: number | bigint;
  charityBps: number | bigint;
  minGiverClaimBps: number | bigint;
  visibility: number | bigint;
  status: number | bigint;
  rewardToken: Address;
  creditedReward: bigint;
  charityRecipient: Address;
  usdScaleAtRaise: bigint;
  rootCapability: Address;
  metadataCommitment: Hex;
  discoveryCommitment: Hex;
  thankSignalSourceHash: Hex;
}

function ordinal<T extends readonly string[]>(
  values: T,
  raw: number | bigint,
  field: string,
): T[number] {
  const i = Number(raw);
  const value = values[i];
  if (value === undefined) throw new Error(`Hand.${field}: unknown ordinal ${raw}`);
  return value;
}

export function mapHand(raw: HandAbiOutput): Hand {
  return {
    raiser: raw.raiser,
    expiry: Number(raw.expiry),
    charityBps: Number(raw.charityBps),
    minGiverClaimBps: Number(raw.minGiverClaimBps),
    visibility: ordinal(HAND_VISIBILITIES, raw.visibility, "visibility"),
    status: ordinal(HAND_STATUSES, raw.status, "status"),
    rewardToken: raw.rewardToken,
    creditedReward: raw.creditedReward,
    charityRecipient: raw.charityRecipient,
    usdScaleAtRaise: raw.usdScaleAtRaise,
    rootCapability: raw.rootCapability,
    metadataCommitment: raw.metadataCommitment,
    discoveryCommitment: raw.discoveryCommitment,
    thankSignalSourceHash: raw.thankSignalSourceHash,
  };
}

export function isExpired(hand: Pick<Hand, "expiry">, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return nowSeconds >= hand.expiry;
}

/** Permissionless reclaim window: Active and at/past expiry. */
export function isReclaimable(hand: Pick<Hand, "expiry" | "status">, nowSeconds?: number): boolean {
  return hand.status === "active" && isExpired(hand, nowSeconds);
}
