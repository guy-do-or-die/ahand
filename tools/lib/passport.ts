/**
 * The passport in a terminal: the checks of the SDK's passportOf (the same ids, verdicts and
 * order as the site's proof page), one line each, with an English sentence per
 * sentence key and, on request or on a failure, the evidence under it.
 */
import type { Check, CheckSource } from "../../packages/sdk/src/proof.ts";

import { clean } from "./cli.ts";

export type Verdict = "ok" | "FAIL" | "not checkable" | "recorded";

export function verdictOf(check: Check): Verdict {
  return check.verdict === true ? "ok" : check.verdict === false ? "FAIL" : check.verdict === "recorded" ? "recorded" : "not checkable";
}

/** The number after the last dot of an id such as `route.2`, as a person counts: pass 3. */
function passOf(check: Check): string {
  const last = check.id.split(".").at(-1);
  return last !== undefined && /^\d+$/.test(last) ? String(Number(last) + 1) : "?";
}

function payeeOf(check: Check): string {
  return check.inputs.payee ?? "the payee";
}

/** One English sentence per sentence key of proof.ts. A key not listed here prints as itself. */
export const SENTENCES: Record<string, (check: Check) => string> = {
  "proof.chain": () => "The file and the chain: every event it carries stands at its block hash and log index, and hands, thanks and pending at its block are the same.",
  "proof.core": () => "This contract: its address is the one derived from the factory, the salt and the code hash, and code is there. Unaudited.",
  "proof.raised": () => "Raised: the terms in the Raised event equal what Core keeps for this Hand.",
  "proof.rewardTime": () => "Reward and time: Raised plus every Funded equals the reward; the last Extended equals the end date.",
  "proof.description": () => "Description: attached and matching its hash, or none, or it did not arrive.",
  "proof.closing": () => "Closing: a Thanked or Refunded event stands in the block where the Hand closed.",
  "proof.route": (check) => `The route, pass ${passOf(check)}: it continues the claim that reached it, and a kept share names someone to pay.`,
  "proof.keys": (check) => `The route, pass ${passOf(check)}: signed by the key that held the link.`,
  "proof.share": (check) => `Share of pass ${passOf(check)}: reward × (claim − next) / 10 000, rounded down.`,
  "proof.routeHash": () => "Route hash: rebuilt here from the Shaken events, it equals the one in Given.",
  "proof.giveClaim": () => "The helper's claim: what the route left, and at least the minimum the raiser promised.",
  "proof.giveHash": () => "The Give: rebuilt here, it equals the giveHash Core kept (GIVEHASH MATCHES CORE).",
  "proof.giveKey": () => "The Give was signed by the key that held the link last.",
  "proof.giver.key": () => "The helper signed the Give with their own key.",
  "proof.giver.account": () => "The helper's account judged its own signature when Core accepted the thank.",
  "proof.giverAmount": () => "The helper's amount: the reward minus the shares.",
  "proof.payout": (check) =>
    `Payout to ${payeeOf(check)}: one Paid or Pending for its amount${check.id === "payout.raiser" ? " (the way back to the raiser)" : ""}.`,
  "proof.payouts": () =>
    "Payouts: together they equal the reward. Paid means it left the contract; a token that takes its own cut may deliver less.",
  "proof.now": (check) => `Now: ${check.actual} units still wait for ${payeeOf(check)} in this token (counted per token and address, across every Hand).`,
  "proof.refunded": () => "The reward went back: Refunded carries the whole reward, at or after the end date.",
};

export function sentenceOf(check: Check): string {
  return SENTENCES[check.messageId]?.(check) ?? check.messageId;
}

function sourceLine(source: CheckSource): string {
  if (source === "computed here") return "computed here";
  if ("event" in source) return `event ${source.event} in block ${source.block}, tx ${source.tx}, log ${source.logIndex}`;
  return `view ${source.view} at block ${source.block}`;
}

/**
 * The passport's lines. Each check: id, verdict, sentence. Under a failed one always, under a
 * "not checkable" one its reason, and under every one with `details` the formula, inputs,
 * expected, actual and source.
 */
export function passportLines(checks: readonly Check[], options: { details?: boolean } = {}): string[] {
  // Ids are aligned up to 16 characters; the longer `now.<address>` ids simply run on.
  const idWidth = Math.min(Math.max(...checks.map((check) => check.id.length), 2), 16) + 2;
  const lines: string[] = [];
  for (const check of checks) {
    const verdict = verdictOf(check);
    const id = clean(check.id);
    lines.push(`${id.length < idWidth ? id.padEnd(idWidth) : `${id}  `}${verdict.padEnd(15)}${clean(sentenceOf(check), 400)}`);
    const pad = " ".repeat(idWidth + 15);
    if (options.details || verdict === "FAIL") {
      if (check.formula) lines.push(`${pad}formula   ${clean(check.formula, 400)}`);
      const inputs = Object.entries(check.inputs);
      if (inputs.length) lines.push(`${pad}inputs    ${clean(inputs.map(([name, value]) => `${name}=${value}`).join(" · "), 2000)}`);
      lines.push(`${pad}expected  ${clean(check.expected, 400)}`);
      lines.push(`${pad}actual    ${clean(check.actual, 400)}`);
      lines.push(`${pad}source    ${sourceLine(check.source)}`);
    } else if (verdict === "not checkable") {
      lines.push(`${pad}why       ${clean(check.actual, 400)}`);
    } else if (verdict === "recorded") {
      lines.push(`${pad}why       holds within the file; its events and views were not re-read from the chain`);
    }
  }
  return lines;
}

export function summaryOf(checks: readonly Check[]): { ok: number; failed: Check[]; notCheckable: number; recorded: number; line: string } {
  const failed = checks.filter((check) => check.verdict === false);
  const ok = checks.filter((check) => check.verdict === true).length;
  const recorded = checks.filter((check) => check.verdict === "recorded").length;
  const notCheckable = checks.length - ok - failed.length - recorded;
  const line =
    `${checks.length} checks: ${ok} ok, ` +
    (recorded ? `${recorded} recorded in the file (not re-read), ` : "") +
    `${notCheckable} not checkable here, ${failed.length} failed` +
    (failed.length ? ` (${failed.map((check) => check.id).join(", ")})` : "");
  return { ok, failed, notCheckable, recorded, line };
}
