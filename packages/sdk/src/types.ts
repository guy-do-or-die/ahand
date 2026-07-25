import { z } from "zod";

/** aHand — protocol types (mirror of AHandTypes.sol; field order is FROZEN there). */

export const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "invalid address");
export const Bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "invalid bytes32");

export const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;
export const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/*//////////////////////////////////////////////////////////////
                Constitutional constants (mirror of core)
//////////////////////////////////////////////////////////////*/

export const BPS_DENOMINATOR = 10_000;
export const MIN_CHARITY_BPS = 100;
export const MAX_CHARITY_BPS = 3_000;
export const MAX_SHAKES = 6;

/** Hard cap on the rendered link fragment; the route must survive messengers. */
export const MAX_ENCODED_LINK_LENGTH = 1_900;
/** Hard cap on the inline metadata body carried inside the payload. */
export const MAX_INLINE_BODY_BYTES = 256;

/** Discovery posture ordinals — must match the on-chain Visibility enum. */
export const Visibility = { Public: 0, Preview: 1, Dark: 2 } as const;
export type Visibility = (typeof Visibility)[keyof typeof Visibility];

/*//////////////////////////////////////////////////////////////
                        Protocol structs
//////////////////////////////////////////////////////////////*/

/** Canonical Hand reference — one identity across contracts, SDK and indexers. */
export const HandRefSchema = z.object({
  chainId: z.bigint(),
  core: AddressSchema,
  handId: z.bigint(),
});
export type HandRef = z.infer<typeof HandRefSchema>;

/** Shake. Signed by the parent CAPABILITY (not the wallet!). */
export const ShakeSchema = z.object({
  handId: z.bigint(),
  childCapability: AddressSchema, // bearer: fresh ephemeral; personal: recipient wallet
  shaker: AddressSchema, // stable attributed account; zero = anonymous (zero-margin only)
  parentClaimBps: z.number().int().min(0).max(BPS_DENOMINATOR),
  childClaimBps: z.number().int().min(0).max(BPS_DENOMINATOR),
  hopDataHash: Bytes32Schema, // app-opaque commitment; zero = none
  deadline: z.bigint(), // never past the Hand expiry
});
export type Shake = z.infer<typeof ShakeSchema>;

/**
 * Transport-only posture of a hop. The EIP-712 hash always covers the RESOLVED
 * shaker address; the mode merely tells the codec how that address travels:
 *   anonymous — shaker is the zero address (zero-margin only);
 *   self      — shaker IS the signing parent capability (personal wallet hop);
 *   explicit  — shaker is a distinct account and must co-sign a ShakerAcceptance.
 */
export const ShakerModeSchema = z.enum(["anonymous", "self", "explicit"]);
export type ShakerMode = z.infer<typeof ShakerModeSchema>;

/** Give. Signed by the LAST capability in the route. */
export const GiveSchema = z.object({
  handId: z.bigint(),
  routeHash: Bytes32Schema, // binds the complete accepted route — no tail substitution
  giver: AddressSchema,
  solutionHash: Bytes32Schema,
  finalClaimBps: z.number().int().min(0).max(BPS_DENOMINATOR), // binds the giver signature to their terminal share
  deadline: z.bigint(), // never past the Hand expiry
});
export type Give = z.infer<typeof GiveSchema>;

/** Acceptance by a distinct Shaker account: consent to attribution and payout. */
export const ShakerAcceptanceSchema = z.object({
  shakeHash: Bytes32Schema, // EIP-712 struct hash of the accepted Shake
});
export type ShakerAcceptance = z.infer<typeof ShakerAcceptanceSchema>;

/** Acceptance by the Giver account: consent to attribution and residual payout. */
export const GiverAcceptanceSchema = z.object({
  giveHash: Bytes32Schema, // EIP-712 struct hash of the accepted Give
});
export type GiverAcceptance = z.infer<typeof GiverAcceptanceSchema>;

/*//////////////////////////////////////////////////////////////
        EIP-712 — typed-data definitions, visible in wallets
//////////////////////////////////////////////////////////////*/

export const EIP712_DOMAIN_NAME = "aHand";
export const EIP712_DOMAIN_VERSION = "2";

export const SHAKE_TYPES = {
  Shake: [
    { name: "handId", type: "uint256" },
    { name: "childCapability", type: "address" },
    { name: "shaker", type: "address" },
    { name: "parentClaimBps", type: "uint16" },
    { name: "childClaimBps", type: "uint16" },
    { name: "hopDataHash", type: "bytes32" },
    { name: "deadline", type: "uint40" },
  ],
} as const;

export const SHAKER_ACCEPTANCE_TYPES = {
  ShakerAcceptance: [{ name: "shakeHash", type: "bytes32" }],
} as const;

export const GIVE_TYPES = {
  Give: [
    { name: "handId", type: "uint256" },
    { name: "routeHash", type: "bytes32" },
    { name: "giver", type: "address" },
    { name: "solutionHash", type: "bytes32" },
    { name: "finalClaimBps", type: "uint16" },
    { name: "deadline", type: "uint40" },
  ],
} as const;

export const GIVER_ACCEPTANCE_TYPES = {
  GiverAcceptance: [{ name: "giveHash", type: "bytes32" }],
} as const;

/** FROZEN type strings — must equal the AHandSig literals byte for byte. */
export const SHAKE_TYPE_STRING =
  "Shake(uint256 handId,address childCapability,address shaker,uint16 parentClaimBps,uint16 childClaimBps,bytes32 hopDataHash,uint40 deadline)";
export const SHAKER_ACCEPTANCE_TYPE_STRING =
  "ShakerAcceptance(bytes32 shakeHash)";
export const GIVE_TYPE_STRING =
  "Give(uint256 handId,bytes32 routeHash,address giver,bytes32 solutionHash,uint16 finalClaimBps,uint40 deadline)";
export const GIVER_ACCEPTANCE_TYPE_STRING =
  "GiverAcceptance(bytes32 giveHash)";

export interface Eip712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: `0x${string}`;
}

export function domain(
  chainId: number | bigint,
  verifyingContract: `0x${string}`,
): Eip712Domain {
  const id = Number(chainId);
  if (!Number.isSafeInteger(id)) throw new Error("chainId out of safe range");
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId: id,
    verifyingContract,
  };
}
