import type { Eip712Domain, Hand, SignedGive, SignedShake } from "./types.js";

// Wave 1 stub: the signatures are the contract between packages (ARCHITECTURE §4);
// the module `sdk-proof` writes the bodies in wave 3.

/** One step of Core's check order, per Shake and for the Give. */
export interface StepResult {
  /** "shake" steps carry their position; the Give's steps do not. */
  of: "shake" | "give";
  position?: number;
  /** The check, named as Core's error it guards against (e.g. "InvalidKeySig"). */
  check: string;
  status: "pass" | "fail" | "not-reached";
}

function notBuilt(name: string): never {
  throw new Error(`${name}: not built`);
}

export function runSteps(
  _domain: Eip712Domain,
  _hand: Hand,
  _signedShakes: readonly SignedShake[],
  _signedGive?: SignedGive,
): Promise<StepResult[]> {
  return notBuilt("runSteps");
}
