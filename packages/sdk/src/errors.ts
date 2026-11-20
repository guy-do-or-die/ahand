import { decodeErrorResult, isHex, parseAbi, type Hex } from "viem";

import { UntrustedCore } from "./chain.js";
import { LinkError } from "./link.js";
import { Refusal } from "./verify.js";

/**
 * Core's refusals, read out of whatever a call to the chain threw, and the one message id each
 * failure a person may meet is shown by.
 *
 * Core has 23 errors of its own. Three more can reach a caller from the OpenZeppelin code Core is
 * built on: `SafeERC20FailedOperation(token)` when a token answers a transfer with `false`, and
 * the two `ShortStrings` errors, which only a constructor can raise. All 26 are decoded.
 */

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

/** Core's errors as declared in AHandCore.sol, in its order, then the three of OpenZeppelin. */
export const CORE_ERRORS_ABI = parseAbi([
  "error ExpiryTooEarly()",
  "error ExpiryTooLate()",
  "error ZeroRootKey()",
  "error MinClaimTooHigh()",
  "error NotOpen()",
  "error NotRaised()",
  "error NotRaiser()",
  "error Expired()",
  "error GiverIsRaiser()",
  "error ZeroPayee()",
  "error InvalidClaim(uint256 position)",
  "error AnonymousMargin(uint256 position)",
  "error InvalidKeySig(uint256 position)",
  "error InvalidRouteHash()",
  "error BelowMinClaim()",
  "error InvalidGiverSig()",
  "error NotExpired()",
  "error NotPayee()",
  "error ZeroDestination()",
  "error NothingPending()",
  "error InexactTransfer()",
  "error NotCore()",
  "error Reentered()",
  "error SafeERC20FailedOperation(address token)",
  "error InvalidShortString()",
  "error StringTooLong(string str)",
]);

/** The names of the 23 errors Core itself declares. */
export const CORE_OWN_ERRORS: readonly CoreErrorName[] = CORE_ERRORS_ABI.slice(0, 23).map(
  (item) => item.name as CoreErrorName,
);

/** Core refused, with the position for the errors that name one. */
export interface CoreRefusal {
  name: CoreErrorName;
  /** The Shake (or, at the number of Shakes, the Give) that `InvalidClaim`, `AnonymousMargin` and `InvalidKeySig` name. */
  position?: number;
  /** The error's arguments as Core wrote them, for the lens: a position, a token, a string. */
  args?: readonly unknown[];
}

/**
 * A `CoreRefusal` that can be thrown: what `checkRouteOnChain`, `checkGiveOnChain` and
 * `getHandFor` throw when Core says no. Its `name` is Core's error name.
 */
export class CoreRefused extends Error implements CoreRefusal {
  override readonly name: CoreErrorName;
  readonly position?: number;
  readonly args?: readonly unknown[];

  constructor(refusal: CoreRefusal) {
    super(`Core refuses: ${refusal.name}${refusal.position === undefined ? "" : `(${refusal.position})`}`);
    this.name = refusal.name;
    if (refusal.position !== undefined) this.position = refusal.position;
    if (refusal.args !== undefined) this.args = refusal.args;
  }
}

const NAMES = new Set<string>(CORE_ERRORS_ABI.map((item) => item.name));
const POSITIONED = new Set<string>(["InvalidClaim", "AnonymousMargin", "InvalidKeySig"]);

/** The revert data in an error, wherever viem put it: `raw`, `data`, or `data.data`, down the causes. */
function revertDataIn(error: unknown): Hex[] {
  const found: Hex[] = [];
  const seen = new Set<unknown>();
  let node: unknown = error;
  while (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    const record = node as { raw?: unknown; data?: unknown; cause?: unknown };
    for (const candidate of [record.raw, record.data, (record.data as { data?: unknown } | undefined)?.data]) {
      if (typeof candidate === "string" && isHex(candidate) && candidate.length >= 10) found.push(candidate);
    }
    node = record.cause;
  }
  return found;
}

/** Decodes one revert's bytes as one of Core's errors, or undefined. */
export function refusalOfData(data: Hex): CoreRefusal | undefined {
  try {
    const decoded = decodeErrorResult({ abi: CORE_ERRORS_ABI, data });
    // viem also knows Solidity's own Error(string) and Panic(uint256): those are not Core's.
    if (!NAMES.has(decoded.errorName)) return undefined;
    const args = decoded.args ?? [];
    const refusal: CoreRefusal = { name: decoded.errorName as CoreErrorName, args };
    if (POSITIONED.has(decoded.errorName)) refusal.position = Number(args[0] as bigint);
    return refusal;
  } catch {
    return undefined;
  }
}

/**
 * Core's error inside whatever viem threw, if it is one: a `ContractFunctionRevertedError`, a
 * raw call error, an estimate's error, revert data as hex, or a `CoreRefused` already decoded.
 * Anything else (a token's own error, a network failure, a plain revert string) gives undefined.
 */
export function decodeCoreError(error: unknown): CoreRefusal | undefined {
  if (error instanceof CoreRefused) {
    const { name, position, args } = error;
    return { name, ...(position === undefined ? {} : { position }), ...(args === undefined ? {} : { args }) };
  }
  if (typeof error === "string" && isHex(error)) return refusalOfData(error);
  for (const data of revertDataIn(error)) {
    const refusal = refusalOfData(data);
    if (refusal) return refusal;
  }
  // viem decodes with the ABI it was given; when that was Core's, the name is all that is left.
  let node: unknown = error;
  for (let depth = 0; node && typeof node === "object" && depth < 16; depth++) {
    const named = (node as { data?: { errorName?: unknown; args?: unknown } }).data;
    if (named && typeof named.errorName === "string" && NAMES.has(named.errorName)) {
      const args = Array.isArray(named.args) ? (named.args as unknown[]) : [];
      const refusal: CoreRefusal = { name: named.errorName as CoreErrorName, args };
      if (POSITIONED.has(named.errorName)) refusal.position = Number(args[0] as bigint);
      return refusal;
    }
    node = (node as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Whether `value` is a Core refusal (thrown `CoreRefused` or a plain `{ name, position }`). */
export function isCoreRefusal(value: unknown): value is CoreRefusal {
  if (value instanceof CoreRefused) return true;
  if (value instanceof Error) return false;
  return !!value && typeof value === "object" && NAMES.has((value as { name?: unknown }).name as string);
}

/** The words `LinkError("unsupported")` uses when a link names the canonical Core and none is configured. */
export const NO_CANONICAL_WORDS = "the canonical Core and none is known";

/**
 * The message id a screen shows for a failure: "core.<error>" for Core's refusals and for the
 * SDK's offline `Refusal` (the same errors, predicted), "link.<code>" for a link that cannot be
 * read, "link.untrusted" for a contract this site does not read, "link.unsupported" for a newer
 * format, and "link.no-canonical" for a link that names the canonical Core where none is set.
 * The position is not part of the id: the sentence takes it as a value.
 */
export function messageIdOf(e: CoreRefusal | LinkError | Refusal | UntrustedCore): string {
  if (e instanceof UntrustedCore) return "link.untrusted";
  if (e instanceof LinkError) {
    if (e.code === "unsupported" && e.message.includes(NO_CANONICAL_WORDS)) return "link.no-canonical";
    return `link.${e.code}`;
  }
  if (e instanceof Refusal) return `core.${e.error}`;
  if (isCoreRefusal(e)) return `core.${e.name}`;
  throw new TypeError("messageIdOf: not a CoreRefusal, LinkError, Refusal or UntrustedCore");
}
