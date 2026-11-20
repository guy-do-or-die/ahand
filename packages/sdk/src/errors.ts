import type { UntrustedCore } from "./chain.js";
import type { LinkError } from "./link.js";
import type { Refusal } from "./verify.js";

// Wave 1 stub: the signatures are the contract between packages (ARCHITECTURE §4);
// the module `sdk-chain` writes the bodies in wave 2.

/** Every custom error AHandCore.sol can revert with (its ABI). */
export type CoreErrorName =
  | "AnonymousMargin"
  | "BelowMinClaim"
  | "Expired"
  | "ExpiryTooEarly"
  | "ExpiryTooLate"
  | "GiverIsRaiser"
  | "InexactTransfer"
  | "InvalidClaim"
  | "InvalidGiverSig"
  | "InvalidKeySig"
  | "InvalidRouteHash"
  | "InvalidShortString"
  | "MinClaimTooHigh"
  | "NotCore"
  | "NotExpired"
  | "NotOpen"
  | "NotPayee"
  | "NotRaised"
  | "NotRaiser"
  | "NothingPending"
  | "Reentered"
  | "SafeERC20FailedOperation"
  | "StringTooLong"
  | "ZeroDestination"
  | "ZeroPayee"
  | "ZeroRootKey";

/** Core refused, with the position for the errors that name one. */
export interface CoreRefusal {
  name: CoreErrorName;
  position?: number;
}

function notBuilt(name: string): never {
  throw new Error(`${name}: not built`);
}

/** Core's error inside whatever viem threw, if it is one. */
export function decodeCoreError(_error: unknown): CoreRefusal | undefined {
  return notBuilt("decodeCoreError");
}

/** "core.InvalidClaim", "link.malformed", "link.unsupported", "link.no-canonical", "link.untrusted", … */
export function messageIdOf(_e: CoreRefusal | LinkError | Refusal | UntrustedCore): string {
  return notBuilt("messageIdOf");
}
