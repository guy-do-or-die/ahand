import type { StepResult } from "@ahand/sdk";

/**
 * /check's comparison of its two columns (UX-SPEC §10.2): the steps run here and Core's own
 * answer by `eth_call`. Pure.
 */

/** Core's answer: accepted, or refused with its error's name and position. */
export type CoreAnswer = { kind: "accepted" } | { kind: "refused"; name: string; position?: number };

/** What this browser says Core will answer: the first step that failed here, or accepted. */
export type HereAnswer = CoreAnswer & { undecided?: boolean };

/**
 * The answer of the steps run here. A helper that is an account (its confirmation is not a key's)
 * is judged by its own code: when only that last step fails here, the answer is left to Core.
 */
export function hereAnswer(steps: readonly StepResult[], giverIsKey: boolean): HereAnswer {
  const failed = steps.find((step) => step.status === "fail");
  if (!failed) return { kind: "accepted" };
  if (failed.of === "give" && failed.check === "InvalidGiverSig" && !giverIsKey) return { kind: "accepted", undecided: true };
  return { kind: "refused", name: failed.check, ...(failed.position === undefined ? {} : { position: failed.position }) };
}

/** Whether the two columns say the same thing. An undecided step agrees with either answer. */
export function agree(here: HereAnswer, core: CoreAnswer): boolean {
  if (here.undecided) return core.kind === "accepted" || (core.kind === "refused" && core.name === "InvalidGiverSig");
  if (here.kind !== core.kind) return false;
  if (here.kind === "accepted") return true;
  return core.kind === "refused" && here.name === core.name && (here.position ?? -1) === (core.position ?? -1);
}

/** Core's name for an answer, in mono: `InvalidClaim(1)`, `accepted`. */
export function answerName(answer: CoreAnswer, accepted: string): string {
  if (answer.kind === "accepted") return accepted;
  return answer.position === undefined ? answer.name : `${answer.name}(${answer.position})`;
}

/** The catalogue key of a step's sentence. */
export function stepKey(step: { of: "shake" | "give"; check: string }): string {
  return `check.step.${step.of}.${step.check}`;
}
