import type { Address, Hex } from "viem";

/** The whole reward, in basis points: `BPS` in Core. */
export const BPS = 10_000;

/** The signing domain Core reports from `eip712Domain()`. */
export const EIP712_DOMAIN_NAME = "aHand";
export const EIP712_DOMAIN_VERSION = "core";

/**
 * What a Shake or a Give names its Hand by: its number, its raiser and all that the raiser sets for
 * good in `raise`. Reward and expiry are not signed. An application reads these from `Raised` or
 * from `hands(handId)`.
 */
export interface Hand {
  handId: bigint;
  raiser: Address;
  token: Address;
  rootKey: Address;
  /** Gas each payout may use, in thousands. */
  payoutGasK: number;
  /** The least claim, in basis points, a giver may be left with. */
  minClaimBps: number;
  dataHash: Hex;
}

/** One link of a route: the key it came from passes the Hand on to `nextKey`. */
export interface Shake {
  nextKey: Address;
  /** Who gets the margin; the zero address for a Shake that keeps none. */
  payee: Address;
  /** The claim that reached this Shake, in basis points. */
  claimBps: number;
  /** The claim it passes on; the difference is its margin. */
  nextClaimBps: number;
  dataHash: Hex;
}

/** The end of a route: `signer` gave, `payee` gets what the route left. */
export interface Give {
  signer: Address;
  payee: Address;
  /** The claim the route left, in basis points. */
  claimBps: number;
  /** The hash of the route this Give ends; zero for a route without Shakes. */
  routeHash: Hex;
  dataHash: Hex;
}

/** A Shake with the signature of the key it came from. */
export interface SignedShake {
  shake: Shake;
  keySig: Hex;
}

/** A Give with the signature of the route's last key and the signature of its signer. */
export interface SignedGive {
  give: Give;
  keySig: Hex;
  giverSig: Hex;
}

/** The type strings, byte for byte as in AHandCore.sol. */
export const HAND_TYPE_STRING =
  "Hand(uint256 handId,address raiser,address token,address rootKey,uint16 payoutGasK,uint16 minClaimBps,bytes32 dataHash)";
export const SHAKE_TYPE_STRING =
  "Shake(Hand hand,address nextKey,address payee,uint16 claimBps,uint16 nextClaimBps,bytes32 dataHash)" +
  HAND_TYPE_STRING;
export const GIVE_TYPE_STRING =
  "Give(Hand hand,address signer,address payee,uint16 claimBps,bytes32 routeHash,bytes32 dataHash)" +
  HAND_TYPE_STRING;

/** The same types as a wallet takes them for `signTypedData`. */
const HAND_FIELDS = [
  { name: "handId", type: "uint256" },
  { name: "raiser", type: "address" },
  { name: "token", type: "address" },
  { name: "rootKey", type: "address" },
  { name: "payoutGasK", type: "uint16" },
  { name: "minClaimBps", type: "uint16" },
  { name: "dataHash", type: "bytes32" },
] as const;

export const SHAKE_TYPES = {
  Shake: [
    { name: "hand", type: "Hand" },
    { name: "nextKey", type: "address" },
    { name: "payee", type: "address" },
    { name: "claimBps", type: "uint16" },
    { name: "nextClaimBps", type: "uint16" },
    { name: "dataHash", type: "bytes32" },
  ],
  Hand: HAND_FIELDS,
} as const;

export const GIVE_TYPES = {
  Give: [
    { name: "hand", type: "Hand" },
    { name: "signer", type: "address" },
    { name: "payee", type: "address" },
    { name: "claimBps", type: "uint16" },
    { name: "routeHash", type: "bytes32" },
    { name: "dataHash", type: "bytes32" },
  ],
  Hand: HAND_FIELDS,
} as const;

export interface Eip712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

/** The signing domain of the Core at `core` on chain `chainId`. */
export function domain(chainId: number, core: Address): Eip712Domain {
  return { name: EIP712_DOMAIN_NAME, version: EIP712_DOMAIN_VERSION, chainId, verifyingContract: core };
}
