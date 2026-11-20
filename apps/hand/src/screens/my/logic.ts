import { BPS, type Give, type SignedShake } from "@ahand/sdk";
import { isHex, zeroAddress, type Address, type Hex } from "viem";

/**
 * The plain arithmetic of "My hands" (UX-SPEC §7.3), kept free of the chain, the store and React
 * so it is tested on its own.
 */

export const DAY = 86_400;
/** Under this much time left by the network's clock, a hand gets the "keep it open longer?" band. */
export const CARE_BAND_SECONDS = 7 * DAY;

/**
 * A device's code: its 8-byte book (ARCHITECTURE §5, D-16), 16 hex characters. Not a secret.
 * Written in four groups of four so a person can read it out; read back with or without the
 * groups, a 0x prefix, spaces or dashes, in either case.
 */
export function formatCode(book: Hex): string {
  const digits = book.slice(2).toLowerCase();
  return digits.match(/.{1,4}/g)!.join(" ");
}

export function parseCode(text: string): Hex | undefined {
  const digits = text.trim().replace(/^0x/i, "").replace(/[\s-]/g, "").toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(digits)) return undefined;
  const book = `0x${digits}` as Hex;
  return isHex(book) ? book : undefined;
}

/** A hand's number as typed: a whole number of at most 78 digits (uint256), or undefined. */
export function parseHandNumber(text: string): bigint | undefined {
  const digits = text.trim().replace(/^#/, "");
  if (!/^[0-9]{1,78}$/.test(digits)) return undefined;
  const value = BigInt(digits);
  return value > 0n ? value : undefined;
}

/**
 * Time left by the network's clock. Undefined before a block arrives (nothing that depends on
 * "now" is claimed then, UX-SPEC §15); zero once the end has come.
 */
export function secondsLeft(expiry: number, now: number | undefined): number | undefined {
  if (now === undefined) return undefined;
  return Math.max(0, expiry - now);
}

/** Whole days left, rounded down; a hand with 6 days and 23 hours left has 6. */
export function daysLeft(seconds: number): number {
  return Math.floor(seconds / DAY);
}

/** Whether an open hand should carry the "keep it open longer?" band. */
export function wantsCare(state: string | undefined, seconds: number | undefined): boolean {
  return state === "open" && seconds !== undefined && seconds < CARE_BAND_SECONDS;
}

export interface SplitRow {
  role: "passer" | "helper";
  /** A Shake's position on the route; none for the helper. */
  position?: number;
  /** Where the money would land; undefined for a Shake that named no payee (it keeps nothing). */
  payee?: Address;
  amount: bigint;
  /** The share in basis points: claimBps − nextClaimBps for a Shake, the rest for the helper. */
  bps: number;
}

/**
 * Who would get what if this Give were thanked now, by Core's own arithmetic (AHandCore
 * `_payShakers`, `_payGiver`): each Shake's margin is ⌊reward × (claimBps − nextClaimBps) / 10 000⌋,
 * and the helper gets whatever is left, rounding included. A prediction for a reward that can still
 * grow, never a record of money that moved.
 */
export function predictSplit(reward: bigint, signedShakes: readonly SignedShake[], give: Pick<Give, "payee" | "claimBps">): SplitRow[] {
  const rows: SplitRow[] = [];
  let rest = reward;
  signedShakes.forEach(({ shake }, position) => {
    const bps = shake.claimBps - shake.nextClaimBps;
    const amount = (reward * BigInt(bps)) / BigInt(BPS);
    rest -= amount;
    rows.push({ role: "passer", position, ...(shake.payee === zeroAddress ? {} : { payee: shake.payee }), amount, bps });
  });
  rows.push({ role: "helper", payee: give.payee, amount: rest, bps: give.claimBps });
  return rows;
}
