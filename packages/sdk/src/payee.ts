import type { Address } from "viem";

/**
 * What is wrong with an address as a payee of this Hand, if anything.
 *
 * - `zero`: the zero address; Core refuses it (`ZeroPayee`), and money sent there is gone.
 * - `core`: Core's own address; money paid to it is locked in Core for good.
 * - `raiser`: the person who asked; allowed by Core, but paying the asker back is rarely meant.
 * - `token`: the token's own contract; allowed by Core, but most tokens keep what is sent to them.
 *
 * `zero` and `core` are refusals; `raiser` and `token` are flags the screen shows and lets through.
 * Comparison ignores letter case, so a checksummed and a lower-case address are the same address.
 */
export type PayeeProblem = "ok" | "zero" | "core" | "raiser" | "token";

const ZERO = "0x0000000000000000000000000000000000000000";

export function payeeProblem(
  payee: Address,
  ctx: { core: Address; raiser: Address; token: Address },
): PayeeProblem {
  const at = payee.toLowerCase();
  if (at === ZERO) return "zero";
  if (at === ctx.core.toLowerCase()) return "core";
  if (at === ctx.raiser.toLowerCase()) return "raiser";
  if (at === ctx.token.toLowerCase()) return "token";
  return "ok";
}

/** Whether Core or common sense forbids paying this address at all (as opposed to a flag). */
export function payeeRefused(problem: PayeeProblem): boolean {
  return problem === "zero" || problem === "core";
}
