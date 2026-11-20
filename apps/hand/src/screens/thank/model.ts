import {
  BPS,
  CORE_ABI,
  payeeProblem,
  receiptOf,
  type Give,
  type HandEventName,
  type HandLog,
  type PayeeProblem,
  type Receipt,
  type SignedShake,
} from "@ahand/sdk";
import { decodeEventLog, isAddressEqual, zeroAddress, type Address, type Hex } from "viem";

/**
 * The thank screen's arithmetic and judgements, without React and without the network, so each
 * can be tested on its own. Everything here mirrors what Core does in `thank` (AHandCore.sol
 * `_payShakers`, `_payGiver`, `_pay`): a Shake's margin is `mulDiv(reward, claimBps -
 * nextClaimBps, 10 000)`, rounded down; the giver gets what is left; a payout of zero touches no
 * token and logs nothing.
 */

/** One row of "who gets what", predicted from the route before anything is sent. */
export interface Payout {
  /** "passed": a holder's Shake; "helped": the Give's payee. */
  kind: "passed" | "helped";
  /** The Shake's position on the route; absent for the helper. */
  position?: number;
  /** Where it lands. A Shake that keeps nothing names the zero address. */
  payee: Address;
  /** The share in basis points: a Shake's margin (`claimBps − nextClaimBps`), or the Give's claim. */
  bps: number;
  amount: bigint;
  /** The numbers the amount is worked out from, for the row's formula. */
  formula: { reward: bigint; bps: number; amount: bigint; rest?: bigint };
}

/** What Core would pay on `thank` with this reward, row by row in Core's order. */
export function predictPayouts(reward: bigint, signedShakes: readonly SignedShake[], give: Give): Payout[] {
  const rows: Payout[] = [];
  let rest = reward;
  signedShakes.forEach(({ shake }, position) => {
    const bps = shake.claimBps - shake.nextClaimBps;
    const amount = (reward * BigInt(bps)) / BigInt(BPS);
    rest -= amount;
    rows.push({ kind: "passed", position, payee: shake.payee, bps, amount, formula: { reward, bps, amount } });
  });
  rows.push({
    kind: "helped",
    payee: give.payee,
    bps: give.claimBps,
    amount: rest,
    formula: { reward, bps: give.claimBps, amount: rest, rest: reward - rest },
  });
  return rows;
}

/** A payee the screen must speak about: refused (Core's own address) or flagged (the asker, the token). */
export interface PayeeFinding {
  row: number;
  payee: Address;
  problem: Exclude<PayeeProblem, "ok" | "zero">;
}

/**
 * The payees on this route that need a word (R-18, R-26). A Shake that keeps nothing names no
 * one and is skipped; a zero payee where money would land never reaches here, because Core's
 * `checkGive` refuses it first (`ZeroPayee`, `AnonymousMargin`).
 */
export function payeeFindings(payouts: readonly Payout[], ctx: { core: Address; raiser: Address; token: Address }): PayeeFinding[] {
  const found: PayeeFinding[] = [];
  payouts.forEach((payout, row) => {
    if (payout.kind === "passed" && payout.bps === 0) return;
    const problem = payeeProblem(payout.payee, ctx);
    if (problem === "ok" || problem === "zero") return;
    found.push({ row, payee: payout.payee, problem });
  });
  return found;
}

/** Whether any finding stops the thank: money paid to Core's own address waits there forever. */
export function payeeRefusedIn(findings: readonly PayeeFinding[]): boolean {
  return findings.some((finding) => finding.problem === "core");
}

/** A transaction receipt's log, as viem returns it. */
export interface RawLog {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  blockNumber: bigint | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  logIndex: number | null;
}

const HAND_EVENTS = new Set<HandEventName>(["Raised", "Funded", "Extended", "Shaken", "Given", "Thanked", "Refunded", "Paid", "Pending"]);

/** Core's events about this Hand among a receipt's logs, decoded; every other log is left out. */
export function handLogsOf(logs: readonly RawLog[], core: Address, handId: bigint): HandLog[] {
  const out: HandLog[] = [];
  for (const log of logs) {
    if (!isAddressEqual(log.address, core) || log.topics.length === 0) continue;
    let decoded: { eventName: string; args: unknown };
    try {
      decoded = decodeEventLog({ abi: CORE_ABI, topics: log.topics as [Hex, ...Hex[]], data: log.data });
    } catch {
      continue; // one of Core's events that is not a Hand's (Withdrawn), or not Core's at all
    }
    if (!HAND_EVENTS.has(decoded.eventName as HandEventName)) continue;
    const args = decoded.args as Record<string, bigint | number | Address | Hex>;
    if (args.handId !== handId) continue;
    if (log.blockNumber === null || log.blockHash === null || log.transactionHash === null || log.logIndex === null) continue;
    out.push({
      eventName: decoded.eventName as HandEventName,
      args,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
    });
  }
  return out;
}

export type ThankVerdict = { ok: true; receipt: Receipt; payouts: Payout[] } | { ok: false; why: string };

/**
 * Success is declared only from the transaction's own logs: `Thanked` and `Given` for this Hand,
 * the Give's signer and payee as sent, and exactly one `Paid` or `Pending` for each payout above
 * zero, of that amount, to that payee, in Core's order. The amounts are worked out again from the
 * reward `Thanked` logged, so a reward added while the thank was on its way is no false alarm.
 */
export function verifyThanked(logs: readonly HandLog[], expected: { signedShakes: readonly SignedShake[]; give: Give }): ThankVerdict {
  if (logs.length === 0) return { ok: false, why: "no event of this hand in the transaction" };
  let receipt: Receipt;
  try {
    receipt = receiptOf([...logs]);
  } catch (error) {
    return { ok: false, why: (error as Error).message };
  }
  if (receipt.closedBy !== "thank") return { ok: false, why: "the transaction holds no Thanked for this hand" };
  const thanked = receipt.rows[0]!;
  const given = receipt.rows.find((row) => row.eventName === "Given");
  if (!given) return { ok: false, why: "no Given" };
  const signer = given.log.args.signer as Address;
  if (!isAddressEqual(signer, expected.give.signer) || !isAddressEqual(given.payee!, expected.give.payee)) {
    return { ok: false, why: "the Given names another signer or payee than the answer that was sent" };
  }

  const payouts = predictPayouts(thanked.amount ?? 0n, expected.signedShakes, expected.give);
  const paid = receipt.rows.filter((row) => row.eventName === "Paid" || row.eventName === "Pending");
  const owed = payouts.filter((payout) => payout.amount > 0n);
  if (paid.length !== owed.length) return { ok: false, why: `${paid.length} payouts logged, ${owed.length} expected` };
  for (const [index, payout] of owed.entries()) {
    const row = paid[index]!;
    if (row.amount !== payout.amount || !isAddressEqual(row.payee!, payout.payee)) {
      return { ok: false, why: `payout ${index} differs from the route` };
    }
  }
  return { ok: true, receipt, payouts };
}

/** Which receipt rows a later read of the chain's logs found again, by transaction and log index. */
export function landedFlags(receipt: Receipt, read: readonly HandLog[]): boolean[] {
  const seen = new Set(read.map((log) => `${log.transactionHash.toLowerCase()}:${log.logIndex}`));
  return receipt.rows.map((row) => seen.has(`${row.log.transactionHash.toLowerCase()}:${row.log.logIndex}`));
}

/** The holder a re-signed route dropped, with the share its Shake kept on the earlier route. */
export interface DroppedShare {
  position: number;
  key: Address;
  payee?: Address;
  bps: number;
}

/** Each dropped holder's share, read from the earlier route whose keys it held. */
export function droppedShares(
  dropped: readonly { position: number; key: Address; payee?: Address }[],
  earlier: readonly { keys: readonly Address[]; signedShakes: readonly SignedShake[] }[],
): DroppedShare[] {
  return dropped.map((holder) => {
    const route = earlier.find((r) => r.keys[holder.position] !== undefined && isAddressEqual(r.keys[holder.position]!, holder.key));
    const shake = route?.signedShakes[holder.position]?.shake;
    const bps = shake ? shake.claimBps - shake.nextClaimBps : 0;
    return { ...holder, bps };
  });
}

/** Whether the zero address: a Shake that names no one. */
export function namesNoOne(address: Address): boolean {
  return isAddressEqual(address, zeroAddress);
}
