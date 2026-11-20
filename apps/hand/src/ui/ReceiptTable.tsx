import type { ReceiptRow } from "@ahand/sdk";
import { zeroAddress } from "viem";

import { clsx } from "../lib/clsx";
import { useLang, type Lang } from "./ambient";
import { Flip, useTwistWords, type TwistWords } from "./Flip";
import { count, money, shortAddress } from "./format";
import { Mark } from "./Mark";
import { lineLanded, receiptLines, type ReceiptLine } from "./receipt";
import { Sweep, useSweep, type SweepState } from "./Sweep";
import { useWords, type Words } from "./words";
import { TID } from "../testids";

export interface ReceiptTableProps {
  /** The SDK's receipt rows: Core's events in Core's order (`receiptOf(logs).rows`). */
  rows: ReceiptRow[];
  /**
   * One flag per row of `rows`: true once that row's log has been read. The thank screen sets
   * them one by one; the table draws the marker sweep from them. Left out, every row counts as
   * read and no sweep is drawn.
   */
  landed?: boolean[];
  /** The token's decimals. */
  decimals: number;
  /** The table's caption for a screen reader; by default "Who got what…". */
  caption?: string;
  className?: string;
}

function label(line: ReceiptLine, words: Words): string {
  if (line.kind === "passed") return words.receipt.passed;
  if (line.kind === "helped") return words.receipt.helped;
  if (line.kind === "back") return words.receipt.back;
  return "";
}

/**
 * Who got what. It opens with a 1.5px ink rule; labels are mono, amounts are right-aligned
 * tabular figures; the helper's row carries an amber chip; the total follows a second rule.
 * Every amount is one that a Paid or Pending event carries. Money that waits in the contract
 * wears the waiting mark, so "waiting" never looks like "paid". A row with no payout says so
 * in words, never as a zero.
 *
 * The twist (UX-SPEC §3): each row is a flip card whose back is its formula with the real
 * numbers and its events (name, block, transaction). With `landed`, the marker sweeps the rows
 * in order as their flags turn true, and rests under the helper's chip while 🙏 bows.
 */
export function ReceiptTable({ rows, landed, decimals, caption, className }: ReceiptTableProps) {
  const words = useWords();
  const twist = useTwistWords();
  const lang = useLang();
  const { lines, total } = receiptLines(rows);
  const sweep = useSweep(landed ? lines.map((line) => lineLanded(line, landed)) : undefined);
  if (lines.length === 0) return null;

  return (
    <table className={clsx("ah-receipt ah-receipt--flips", className)} data-sweep={sweep ? sweepSummary(sweep) : undefined}>
      <caption className="sr-only">{caption ?? words.receipt.caption}</caption>
      <tbody>
        {lines.map((line, index) => {
          const read = lineLanded(line, landed);
          const helper = line.kind === "helped";
          const amount = line.amount !== undefined && line.amount > 0n ? money(line.amount, decimals, lang, { cents: true }) : undefined;
          const what = label(line, words);
          // Core logs a pass that kept nothing with the zero address as its payee: nobody to name.
          const payee = line.payee && line.payee !== zeroAddress ? line.payee : undefined;
          const state: SweepState | undefined = sweep?.[index];
          const front = (
            <span className="ah-receipt__line">
              {state ? <Sweep state={state} /> : null}
              <span className="ah-receipt__what">
                {what}
                {what && payee ? " · " : null}
                {payee ? <span className="ah-exact">{shortAddress(payee)}</span> : null}
                {landed && !read ? <span className="sr-only"> ({words.receipt.notRead})</span> : null}
              </span>
              {amount ? (
                <span className="ah-receipt__sum">
                  {helper ? <span className="ah-receipt__amount--chip">{amount}</span> : amount}
                  {helper && state === "done" ? (
                    <span aria-hidden="true" className="ah-sweep__bow" data-testid={TID.twist.bow}>
                      🙏
                    </span>
                  ) : null}
                  {line.waiting ? (
                    <span className="ah-receipt__mark">
                      <Mark kind="waiting" />
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="ah-receipt__sum ah-receipt__none">
                  {helper ? words.receipt.thanksOnly : words.receipt.keptNothing}
                  {helper && state === "done" ? (
                    <span aria-hidden="true" className="ah-sweep__bow" data-testid={TID.twist.bow}>
                      🙏
                    </span>
                  ) : null}
                </span>
              )}
            </span>
          );
          return (
            <tr
              key={line.rows.join("-")}
              data-landed={landed ? String(read) : undefined}
              data-swept={state ? String(state === "done") : undefined}
              data-kind={line.kind}
              className={clsx(helper && "ah-receipt__row--highlight", index === lines.length - 1 && "ah-receipt__row--pretotal")}
            >
              <td colSpan={2} className="ah-receipt__cell">
                <Flip variant="row" front={front} backLabel={twist.backOfRow} back={() => <RowBack line={line} rows={rows} total={total} decimals={decimals} lang={lang} words={twist} />} />
              </td>
            </tr>
          );
        })}
      </tbody>
      {total > 0n ? (
        <tfoot>
          <tr>
            <th scope="row">{words.receipt.total}</th>
            <td>{money(total, decimals, lang, { cents: true })}</td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

/** "3/8": rows swept of rows in all, for tests and the lens. */
function sweepSummary(states: readonly SweepState[]): string {
  return `${states.filter((state) => state === "done").length}/${states.length}`;
}

/** The back of a row: how its amount follows from Core's formula, with the numbers of this thank, then its events. */
function RowBack({ line, rows, total, decimals, lang, words }: { line: ReceiptLine; rows: readonly ReceiptRow[]; total: bigint; decimals: number; lang: Lang; words: TwistWords }) {
  const formula = formulaOf(line, rows, total);
  return (
    <div className="ah-back" lang={lang}>
      <p className="ah-back__label">{words.row.formula}</p>
      {total === 0n ? (
        <p className="ah-back__line" data-testid={TID.twist.formula}>
          {words.row.nothing}
        </p>
      ) : (
        <>
          <p className="ah-back__line">{formula.rule === "margin" ? words.row.margin : formula.rule === "rest" ? words.row.rest : formula.rule === "back" ? words.row.back : words.row.logged}</p>
          <p className="ah-back__line ah-back__exact" data-testid={TID.twist.formula} data-value={formula.result.toString()}>
            {formula.text} = {count(formula.result)}
            {formula.result > 0n ? ` · ${money(formula.result, decimals, lang, { cents: true })}` : null}
          </p>
        </>
      )}
      <p className="ah-back__label">{words.row.event}</p>
      <ul className="ah-back__events">
        {line.rows.map((at) => {
          const row = rows[at]!;
          return (
            <li key={at} data-testid={TID.twist.event} data-value={row.eventName} data-block={row.log.blockNumber.toString()} data-tx={row.log.transactionHash}>
              <span className="ah-back__line">{words.row.eventLine(row.eventName, count(row.log.blockNumber), row.log.logIndex)}</span>
              <span className="ah-back__line ah-back__exact">
                {words.row.tx} {row.log.transactionHash}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface Formula {
  rule: "margin" | "rest" | "back" | "logged";
  /** The numbers put into the rule, in token units. */
  text: string;
  result: bigint;
}

/**
 * The real numbers behind a row. A margin is Core's `mulDiv(reward, claimBps − nextClaimBps,
 * 10 000)` with the fields its `Shaken` event carries; the helper's amount is the reward less
 * every margin (Core's own rest, so dust goes to the helper); a refund is the whole reward. When
 * an event does not carry the fields (a record without its arguments), the amount stands as
 * Core logged it, and nothing is worked out on the side.
 */
export function formulaOf(line: ReceiptLine, rows: readonly ReceiptRow[], reward: bigint): Formula {
  const head = rows[line.rows[0]!]!;
  const logged = line.amount ?? head.amount ?? 0n;
  if (line.kind === "passed") {
    const claim = head.log.args.claimBps;
    const next = head.log.args.nextClaimBps;
    if (claim === undefined || next === undefined) return { rule: "logged", text: count(logged), result: logged };
    const result = (reward * (BigInt(claim) - BigInt(next))) / 10_000n;
    return { rule: "margin", text: `${count(reward)} × (${count(BigInt(claim))} − ${count(BigInt(next))}) ÷ 10 000`, result };
  }
  if (line.kind === "helped") {
    const margins = rows.filter((row) => row.eventName === "Shaken").map((row) => row.amount ?? 0n);
    const result = margins.reduce((rest, margin) => rest - margin, reward);
    return { rule: "rest", text: [count(reward), ...margins.map(count)].join(" − "), result };
  }
  if (line.kind === "back") return { rule: "back", text: count(reward), result: reward };
  return { rule: "logged", text: count(logged), result: logged };
}
