import { payeeProblem, type PayeeProblem } from "@ahand/sdk";
import { getAddress, isAddress, type Address } from "viem";

/**
 * The reading of what someone typed into an amount or an address field. Pure functions, so the
 * rules are tested without a browser; the inputs (MoneyInput, AddressInput) only show them.
 */

// ── Money ────────────────────────────────────────────────────────────────

export type MoneyReading =
  | { status: "empty" }
  | { status: "ok"; amount: bigint }
  | { status: "invalid" }
  | { status: "too-much"; amount: bigint };

/**
 * Reads an amount typed by a person: "40", "12.5", "12,5", "$1 000", ".5". Zero is an amount
 * (Core takes a reward of zero). More digits after the point than the token has is invalid:
 * nothing is rounded behind the person's back.
 */
export function readMoney(text: string, decimals: number, max?: bigint): MoneyReading {
  const cleaned = text.replace(/[\s  $_]/g, "").replace(",", ".");
  if (cleaned === "") return { status: "empty" };
  const match = /^([0-9]*)(?:\.([0-9]*))?$/.exec(cleaned);
  if (!match) return { status: "invalid" };
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (whole === "" && fraction === "") return { status: "invalid" };
  if (fraction.length > decimals) return { status: "invalid" };
  const amount = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (max !== undefined && amount > max) return { status: "too-much", amount };
  return { status: "ok", amount };
}

// ── Addresses ────────────────────────────────────────────────────────────

export interface PayeeContext {
  core: Address;
  raiser: Address;
  token: Address;
}

export type AddressReading =
  | { status: "empty" }
  /** Not 0x and forty hex characters yet. */
  | { status: "incomplete" }
  /** Mixed case whose checksum does not match: a slip while copying. */
  | { status: "typo" }
  /** The zero address or Core's own: never a payee. */
  | { status: "refused"; problem: "zero" | "core"; address: Address }
  /** The asker's or the token's own address: allowed, shown with a question. */
  | { status: "flagged"; problem: "raiser" | "token"; address: Address }
  | { status: "ok"; address: Address };

/** Reads a pasted address and asks the SDK's `payeeProblem` what is wrong with it as a payee. */
export function readAddress(text: string, ctx: PayeeContext): AddressReading {
  const value = text.trim();
  if (value === "") return { status: "empty" };
  if (!isAddress(value, { strict: false })) return { status: "incomplete" };
  const body = value.slice(2);
  const mixedCase = body !== body.toLowerCase() && body !== body.toUpperCase();
  if (mixedCase && !isAddress(value, { strict: true })) return { status: "typo" };
  const address = getAddress(value);
  const problem: PayeeProblem = payeeProblem(address, ctx);
  if (problem === "zero" || problem === "core") return { status: "refused", problem, address };
  if (problem === "raiser" || problem === "token") return { status: "flagged", problem, address };
  return { status: "ok", address };
}

/** The address a reading lets through as a payee: an accepted or a flagged one. */
export function payeeOf(reading: AddressReading): Address | undefined {
  return reading.status === "ok" || reading.status === "flagged" ? reading.address : undefined;
}
