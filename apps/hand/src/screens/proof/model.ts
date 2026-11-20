import type { Check, CheckSource } from "@ahand/sdk";

import type { MarkKind } from "../../ui";

/**
 * The passport's arrangement (UX-SPEC §10.1): the SDK's checks, in the SDK's order, grouped into
 * the eleven parts of the timeline, each line given one of the three marks from its source.
 * Pure: no network, no clock, no words (the words are the catalogue's).
 */

export type SectionKey =
  | "core"
  | "raised"
  | "reward-time"
  | "description"
  | "route"
  | "shares"
  | "route-hash"
  | "give"
  | "giver-amount"
  | "payouts"
  | "now"
  | "back"
  | "closing";

/**
 * The part of the timeline a check belongs to. `refunded` changes where a payout and "now" stand.
 * The page's own two lines (sent.ts) stand with what they speak of: the opening time with the
 * raise, the closing time with the payouts of a thank or with the reward going back.
 */
export function sectionOf(id: string, refunded: boolean): SectionKey {
  if (id === "core" || id === "raised" || id === "reward-time" || id === "description" || id === "closing") return id;
  if (id === "time.opened") return "raised";
  if (id === "time.closed") return refunded ? "back" : "payouts";
  if (refunded && (id === "refunded" || id.startsWith("payout.") || id.startsWith("now."))) return "back";
  if (id.startsWith("route.") || id.startsWith("keys.")) return "route";
  if (id.startsWith("share.")) return "shares";
  if (id === "route-hash") return "route-hash";
  if (id === "give-claim" || id === "give-hash" || id === "give-key" || id === "giver") return "give";
  if (id === "giver-amount") return "giver-amount";
  if (id.startsWith("payout.") || id === "payouts") return "payouts";
  if (id.startsWith("now.")) return "now";
  return "closing";
}

export interface Section {
  key: SectionKey;
  /** 1..11 in UX-SPEC's numbering; "back" is the fifth part of a refunded Hand. */
  index: number;
  checks: Check[];
}

const NUMBER: Record<SectionKey, number> = {
  core: 1,
  raised: 2,
  "reward-time": 3,
  description: 4,
  route: 5,
  shares: 6,
  "route-hash": 7,
  give: 8,
  "giver-amount": 9,
  payouts: 10,
  now: 11,
  back: 5,
  closing: 5,
};

/** The checks grouped by part, the SDK's order kept inside and between parts. */
export function sectionsOf(checks: readonly Check[]): Section[] {
  const refunded = checks.some((check) => check.id === "refunded");
  const sections: Section[] = [];
  for (const check of checks) {
    const key = sectionOf(check.id, refunded);
    let section = sections.find((s) => s.key === key);
    if (!section) {
      section = { key, index: NUMBER[key], checks: [] };
      sections.push(section);
    }
    section.checks.push(check);
  }
  return sections;
}

/**
 * The mark a line carries, from its source: computed in this browser → checked here; an event or a
 * view → on chain; money still waiting in Core for a payee → waiting.
 */
export function markOf(check: Check): MarkKind {
  if (check.source === "computed here") return "checked";
  if (check.id.startsWith("now.") && check.actual !== "0") return "waiting";
  return "chain";
}

export type Verdict = "ok" | "fail" | "not-checkable";

export function verdictOf(check: Check): Verdict {
  // "recorded" comes only from a saved file checked with no network (the SDK's verifyBundle); the
  // page reads the chain itself and never shows it, and it is never counted as ok.
  return check.ok === "not-checkable" || check.ok === "recorded" ? "not-checkable" : check.ok ? "ok" : "fail";
}

export interface Tally {
  ok: number;
  fail: number;
  notCheckable: number;
}

export function tallyOf(checks: readonly Check[]): Tally {
  const tally: Tally = { ok: 0, fail: 0, notCheckable: 0 };
  for (const check of checks) {
    const verdict = verdictOf(check);
    if (verdict === "ok") tally.ok += 1;
    else if (verdict === "fail") tally.fail += 1;
    else tally.notCheckable += 1;
  }
  return tally;
}

/** The position a per-hand check names: `route.2` → 2. */
export function positionOf(id: string): number | undefined {
  const found = /\.(\d+)$/.exec(id);
  return found ? Number(found[1]) : undefined;
}

/** The sentence key of a line: the SDK's, made specific where the words differ by outcome. */
export function sentenceKeyOf(check: Check): string {
  if (check.sentence === "proof.payout") return check.actual.startsWith("Pending") ? "proof.payout.pending" : "proof.payout.paid";
  if (check.sentence === "proof.description" && check.expected === "none") return "proof.description.none";
  if (check.sentence === "proof.now" && check.actual === "0") return "proof.now.none";
  if (check.sentence === "proof.time.closed") return check.inputs.event === "Refunded" ? "proof.time.closed.refund" : "proof.time.closed.thank";
  // A pass that kept nothing is said in words, as the receipt says it, never as "$0" (M-4).
  if (check.sentence === "proof.share" && check.actual === "0") return "proof.share.none";
  // A pass that keeps a share names where it lands; one that keeps nothing has the zero address.
  if ((check.sentence === "proof.share" || check.sentence === "proof.route") && check.inputs.payee && !/^0x0{40}$/i.test(check.inputs.payee)) return `${check.sentence}.to`;
  return check.sentence;
}

/**
 * A pass line that names the asker's own address (brief 02 duties 11 and 23, the SDK's
 * `raiserHops` read from the line's own inputs): on `route.i` the next key or a kept share's payee,
 * on `share.i` a share above zero paid to it. The catalogue key of the note under the line.
 */
export function askerHopKeyOf(check: Check, raiser: string): string | undefined {
  const at = raiser.toLowerCase();
  const { payee, nextKey, claimBps, nextClaimBps } = check.inputs;
  const keeps = claimBps !== undefined && nextClaimBps !== undefined && Number(nextClaimBps) < Number(claimBps);
  const pays = keeps && payee?.toLowerCase() === at;
  if (check.id.startsWith("route.")) {
    const holds = nextKey?.toLowerCase() === at;
    return pays && holds ? "proof.askerHop.both" : pays ? "proof.askerHop.payee" : holds ? "proof.askerHop.key" : undefined;
  }
  if (check.id.startsWith("share.") && pays) return "proof.askerHop.share";
  return undefined;
}

/** Why a line could not be checked here, as a catalogue key. */
export function notCheckableKeyOf(check: Check): string {
  if (check.id === "core") return "proof.nc.core";
  if (check.id === "description") return "proof.nc.description";
  if (check.id === "reward-time") return "proof.nc.between";
  if (check.id.startsWith("time.")) return "proof.nc.time";
  if (check.id.startsWith("keys.") || check.id === "give-key" || check.id === "giver") return "proof.nc.confirmations";
  return "proof.nc.other";
}

/** The payee a payout or "now" line names, from its inputs or its id. */
export function payeeOfCheck(check: Check): string | undefined {
  if (check.inputs.payee) return check.inputs.payee;
  if (check.id.startsWith("now.")) return check.id.slice(4);
  return undefined;
}

/** The amount a line speaks of, in the token's smallest unit, when it speaks of one. */
export function amountOfCheck(check: Check): bigint | undefined {
  const digits = (text: string | undefined) => (text !== undefined && /^\d+$/.test(text) ? BigInt(text) : undefined);
  if (check.id.startsWith("payout.")) return digits(check.inputs.amount);
  if (check.id.startsWith("share.") || check.id === "giver-amount" || check.id === "payouts" || check.id === "refunded" || check.id.startsWith("now.")) {
    return digits(check.actual);
  }
  return undefined;
}

/**
 * The amounts the payout lines name, in route order: the rows a reader adds up. With the
 * kit's `receiptAmounts` they decide whether the passport writes cents or every digit, so the
 * lines add up to the total as the receipt's rows do (M-4).
 */
export function payoutRowsOf(checks: readonly Check[]): bigint[] {
  return checks.filter((check) => check.id.startsWith("payout.")).flatMap((check) => {
    const amount = amountOfCheck(check);
    return amount === undefined ? [] : [amount];
  });
}

/** A source as one mono line: `GIVEN · BLOCK 41 · TX 0xab…cd · LOG 3`, `HANDS(ID) · BLOCK 41`, `COMPUTED HERE`. */
export function sourceLine(source: CheckSource): { what: string; block?: bigint; tx?: string; logIndex?: number } {
  if (source === "computed here") return { what: "computed here" };
  if ("event" in source) return { what: source.event, block: source.block, tx: source.tx, logIndex: source.logIndex };
  return { what: source.view, block: source.block };
}

/** The file name a downloaded bundle gets. */
export function bundleName(chainId: number, handId: bigint): string {
  return `ahand-proof-${chainId}-${handId}.json`;
}

/** The line that checks this Hand from a clone of the code, with no site (D-51). */
export function verifyLine(opts: { commit?: string; rpc?: string; core: string; handId: bigint }): string {
  const checkout = opts.commit ? `git checkout ${opts.commit} && ` : "";
  const rpc = opts.rpc ? ` --rpc ${opts.rpc}` : "";
  return `${checkout}bun install && bun tools/ahand.ts verify${rpc} --core ${opts.core} ${opts.handId}`;
}

/**
 * The line that checks a downloaded bundle. With no RPC it proves the file's signatures, hashes
 * and sums only; with one it re-reads every event and view in the file from the chain first.
 */
export function bundleLine(chainId: number, handId: bigint, rpc?: string): string {
  return `bun tools/ahand.ts verify --bundle ${bundleName(chainId, handId)}${rpc ? ` --rpc ${rpc}` : ""}`;
}
