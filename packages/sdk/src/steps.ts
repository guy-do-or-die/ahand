import { isAddressEqual, zeroAddress, zeroHash, type Hex } from "viem";

import { digest, domainSeparator, extendRouteHash, giveHash, shakeHash } from "./hash.js";
import { BPS, type Eip712Domain, type Hand, type SignedGive, type SignedShake } from "./types.js";
import { signedBy, type AskSignerCode, type RefusalName } from "./verify.js";

/**
 * Core's check order as data. `thank` checks, in this order (pinned by the
 * `firstWrongThing` tests of contracts/test/Core.t.sol):
 *
 *   NotOpen → NotRaiser → Expired              only the chain knows these: `ON_CHAIN_ONLY`
 *   GiverIsRaiser → ZeroPayee                  the Give's own fields
 *   per Shake: InvalidClaim → AnonymousMargin → InvalidKeySig
 *   the Give:  InvalidClaim(n) → InvalidRouteHash → BelowMinClaim → InvalidKeySig(n) → InvalidGiverSig
 *
 * `checkGive` makes the same checks without the first three; `checkRoute` makes the per-Shake ones
 * only. `runSteps` walks this order offline and says, for each step, pass, fail or not reached:
 * the first "fail" is exactly the error Core reverts with, at the same position.
 */

/** `thank`'s first checks, which need the chain (who calls, the Hand's state, its time): not run offline. */
export const ON_CHAIN_ONLY = ["NotOpen", "NotRaiser", "Expired"] as const;

/** The Give's own fields, checked before the route. */
export const GIVE_GATE: readonly RefusalName[] = ["GiverIsRaiser", "ZeroPayee"];
/** Each Shake's checks, in order. */
export const SHAKE_STEPS: readonly RefusalName[] = ["InvalidClaim", "AnonymousMargin", "InvalidKeySig"];
/** The Give's checks after the route, in order. */
export const GIVE_STEPS: readonly RefusalName[] = [
  "InvalidClaim",
  "InvalidRouteHash",
  "BelowMinClaim",
  "InvalidKeySig",
  "InvalidGiverSig",
];

/** The Give's checks whose error names a position: Core writes the number of Shakes there. */
const GIVE_POSITIONED: ReadonlySet<RefusalName> = new Set(["InvalidClaim", "InvalidKeySig"]);

/** One step of Core's check order. */
export interface Step {
  /** Whose field the step looks at: a Shake's or the Give's. */
  of: "shake" | "give";
  /**
   * The position Core's error names: the Shake's for a Shake's step; for the Give's InvalidClaim
   * and InvalidKeySig the number of Shakes, as Core writes it. Absent where Core's error has none.
   */
  position?: number;
  /** The check, named as Core's error it guards against. */
  check: RefusalName;
}

export interface StepResult extends Step {
  status: "pass" | "fail" | "not-reached";
}

/** Core's order for a route of `shakes` Shakes, ended by a Give or not (then: `checkRoute`). */
export function checkOrder(shakes: number, withGive: boolean): Step[] {
  if (!Number.isSafeInteger(shakes) || shakes < 0) throw new RangeError("a route has zero or more Shakes");
  const order: Step[] = [];
  if (withGive) for (const check of GIVE_GATE) order.push({ of: "give", check });
  for (let position = 0; position < shakes; ++position) {
    for (const check of SHAKE_STEPS) order.push({ of: "shake", position, check });
  }
  if (withGive) {
    for (const check of GIVE_STEPS) {
      order.push(GIVE_POSITIONED.has(check) ? { of: "give", position: shakes, check } : { of: "give", check });
    }
  }
  return order;
}

/**
 * Walks Core's order over a route and, if given, the Give that ends it, with no network: pass,
 * fail or not-reached for every step. The giver's signature counts if the signer's own key made
 * it; otherwise `askSignerCode` decides (an account's code), and without it the step fails, as
 * Core fails it for an address without code. Reads no clock.
 */
export async function runSteps(
  domain: Eip712Domain,
  hand: Hand,
  signedShakes: readonly SignedShake[],
  signedGive?: SignedGive,
  askSignerCode?: AskSignerCode,
): Promise<StepResult[]> {
  const separator = domainSeparator(domain);
  const order = checkOrder(signedShakes.length, signedGive !== undefined);

  // What the walk has reached so far, as Core keeps it in `_checkRoute`.
  let key = hand.rootKey;
  let claim = BPS;
  let route: Hex = zeroHash;
  let signed: Hex | undefined; // the Give's digest, once the Give's key signature is reached

  const passes = async (step: Step): Promise<boolean> => {
    if (step.of === "shake") {
      const { shake, keySig } = signedShakes[step.position!]!;
      switch (step.check) {
        case "InvalidClaim":
          return shake.claimBps === claim && shake.nextClaimBps <= claim;
        case "AnonymousMargin":
          return !(isAddressEqual(shake.payee, zeroAddress) && shake.nextClaimBps !== claim);
        case "InvalidKeySig": {
          const hash = shakeHash(hand, shake);
          if (!(await signedBy(key, digest(separator, hash), keySig))) return false;
          route = extendRouteHash(route, hash);
          key = shake.nextKey;
          claim = shake.nextClaimBps;
          return true;
        }
        default:
          throw new Error(`no Shake step ${step.check}`);
      }
    }
    const { give, keySig, giverSig } = signedGive!;
    switch (step.check) {
      case "GiverIsRaiser":
        return !isAddressEqual(give.signer, hand.raiser);
      case "ZeroPayee":
        return !isAddressEqual(give.payee, zeroAddress);
      case "InvalidClaim":
        return give.claimBps === claim;
      case "InvalidRouteHash":
        return give.routeHash.toLowerCase() === route.toLowerCase();
      case "BelowMinClaim":
        return claim >= hand.minClaimBps;
      case "InvalidKeySig":
        signed = digest(separator, giveHash(hand, give));
        return signedBy(key, signed, keySig);
      case "InvalidGiverSig":
        if (await signedBy(give.signer, signed!, giverSig)) return true;
        return askSignerCode ? askSignerCode(give.signer, signed!, giverSig) : false;
      default:
        throw new Error(`no Give step ${step.check}`);
    }
  };

  const results: StepResult[] = [];
  let failed = false;
  for (const step of order) {
    if (failed) {
      results.push({ ...step, status: "not-reached" });
      continue;
    }
    const ok = await passes(step);
    if (!ok) failed = true;
    results.push({ ...step, status: ok ? "pass" : "fail" });
  }
  return results;
}

/** The step Core would revert at: the first that failed, or undefined when every step passed. */
export function firstFailure(results: readonly StepResult[]): Step | undefined {
  const found = results.find((result) => result.status === "fail");
  if (!found) return undefined;
  const { status: _status, ...step } = found;
  return step;
}
