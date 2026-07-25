import { z } from "zod";

/** aHand v1 — protocol types (mirror of AHandTypes.sol). */

export const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "invalid address")
  .transform((val) => val as `0x${string}`);
export const Bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "invalid bytes32")
  .transform((val) => val as `0x${string}`);

/** Shake structure. Signed by the parent capability (not the wallet!). */
export const ShakeSchema = z.object({
  handId: z.bigint(),
  childCapability: AddressSchema, // bearer: fresh ephemeral; personal: recipient's wallet
  payout: AddressSchema, // destination for hop's margin payment
  parentClaimBps: z.number().int().min(0).max(10_000),
  childClaimBps: z.number().int().min(0).max(10_000),
  deadline: z.bigint(),
});
export type Shake = z.infer<typeof ShakeSchema>;

/** Give structure. Signed by the last capability in the route path. */
export const GiveSchema = z.object({
  handId: z.bigint(),
  solver: AddressSchema,
  solutionHash: Bytes32Schema,
});
export type Give = z.infer<typeof GiveSchema>;

/** EIP-712 typed-data definitions — type names visible in user wallets. */
export const EIP712_DOMAIN_NAME = "aHand";
export const EIP712_DOMAIN_VERSION = "1";

export const SHAKE_TYPES = {
  Shake: [
    { name: "handId", type: "uint256" },
    { name: "childCapability", type: "address" },
    { name: "payout", type: "address" },
    { name: "parentClaimBps", type: "uint16" },
    { name: "childClaimBps", type: "uint16" },
    { name: "deadline", type: "uint40" },
  ],
} as const;

export const GIVE_TYPES = {
  Give: [
    { name: "handId", type: "uint256" },
    { name: "solver", type: "address" },
    { name: "solutionHash", type: "bytes32" },
  ],
} as const;

export interface Eip712Domain {
  name: string;
  version: string;
  chainId: bigint;
  verifyingContract: `0x${string}`;
}

export function domain(
  chainId: number | bigint,
  verifyingContract: `0x${string}`,
): Eip712Domain {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId: BigInt(chainId),
    verifyingContract,
  };
}
