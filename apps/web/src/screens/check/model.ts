import type { CoreHand, StepResult } from "@ahand/sdk";

/**
 * /check's comparison of its two columns: the steps run here and Core's own
 * answer by `eth_call`; and what the Hand itself is at that block, which Core's `checkRoute` and
 * `checkGive` never look at. Pure.
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

/** Where the Hand stands at the latest block, as column 3 says it before Core's sentence. */
export type Standing = "open" | "thanked" | "refunded" | "expired";

/**
 * The Hand's standing, said before Core's answer: Core's `checkRoute` and `checkGive` look at
 * neither the expiry nor `closedAt` (AHandCore.sol, NatSpec of `checkGive`), so an accepted route
 * on a closed Hand pays nobody. It is `handNow` at the latest block, told more coarsely (one fact,
 * one derivation): every thanked state is "thanked". `at` is the second the sentence names:
 * `closedAt` for a closed Hand, the expiry for one whose time is up. A Hand that is not raised
 * (`openedAt` 0) has no standing: Core's own refusal says it.
 */
export function standingOf(now: HandNow, view: Pick<CoreHand, "openedAt">): { state: Standing; at?: number } | undefined {
  if (view.openedAt === 0) return undefined;
  switch (now.state) {
    case "open":
      return { state: "open" };
    case "expired":
      return { state: "expired", at: now.expiry };
    case "refunded":
      return { state: "refunded", at: now.closedAt };
    default:
      return { state: "thanked", at: now.closedAt };
  }
}

/**
 * The catalogue keys of column 3's sentences for a standing and Core's answer: the Hand's state
 * first (none while it is open), then Core's own. On a Hand that is no longer open, an accepted
 * route is "valid" and nothing more: no share and no "the asker can thank it" is promised.
 */
export function coreSentences(standing: Standing | undefined, answer: CoreAnswer, give: boolean): { state?: string; valid?: string; core: string } {
  const ended = standing !== undefined && standing !== "open";
  const state = ended ? `check.state.${standing}` : undefined;
  if (answer.kind === "refused") return { ...(state ? { state } : {}), core: "check.core.refused" };
  if (!ended) return { core: give ? "check.core.accepted.give" : "check.core.accepted.route" };
  return {
    ...(state ? { state } : {}),
    ...(standing === "expired" ? {} : { valid: "check.state.closed.valid" }),
    core: give ? "check.core.accepted.give.ended" : "check.core.accepted.route.ended",
  };
}

/** The catalogue key of a step's sentence. */
export function stepKey(step: { of: "shake" | "give"; check: string }): string {
  return `check.step.${step.of}.${step.check}`;
}

/**
 * What the Hand is at one block. Core's `checkGive` and `checkRoute` judge a route and its
 * confirmations only: they do not look at whether the Hand is closed or past its time, so "the
 * contract accepts this" alone never means "this can still be thanked". This says the rest.
 */
export type HandNow =
  | { state: "open"; expiry: number }
  /** Still open in the contract, but its time is up by the block's clock: only the way back is left. */
  | { state: "expired"; expiry: number }
  /** Thanked, and the pasted answer is the very one the contract kept. */
  | { state: "thanked-this"; closedAt: number }
  /** Thanked, and the pasted answer is another one. */
  | { state: "thanked-other"; closedAt: number }
  /** Thanked; what was pasted is a route with no answer at its end. */
  | { state: "thanked"; closedAt: number }
  | { state: "refunded"; closedAt: number };

const ZERO_HASH = `0x${"0".repeat(64)}`;

/**
 * The Hand's state from `hands(id)` and `thanks(id)` read at one block, whose timestamp is `now`
 * (the network's clock, never the device's). `pastedGiveHash` is the hash of the pasted answer,
 * when an answer was pasted: equal to `thanks(id).giveHash`, it is the answer that was thanked.
 * A closed Hand with no Give kept was sent back (Core keeps a Give only for a thank).
 */
export function handNow(facts: { closedAt: number; expiry: number; thankedGiveHash: string; now: number; pastedGiveHash?: string }): HandNow {
  const { closedAt, expiry, now } = facts;
  if (closedAt !== 0) {
    const kept = facts.thankedGiveHash.toLowerCase();
    if (kept === ZERO_HASH) return { state: "refunded", closedAt };
    if (facts.pastedGiveHash === undefined) return { state: "thanked", closedAt };
    return { state: facts.pastedGiveHash.toLowerCase() === kept ? "thanked-this" : "thanked-other", closedAt };
  }
  return now >= expiry ? { state: "expired", expiry } : { state: "open", expiry };
}

/** Whether anyone can still be thanked on this Hand: only while it is open and in time. */
export function canStillThank(now: HandNow): boolean {
  return now.state === "open";
}
