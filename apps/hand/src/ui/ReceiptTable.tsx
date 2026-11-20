import type { ReceiptRow } from "@ahand/sdk";

import { clsx } from "../lib/clsx";
import { money, shortAddress } from "./format";
import { Mark } from "./Mark";
import { lineLanded, receiptLines, type ReceiptLine } from "./receipt";
import { useLang } from "./ambient";
import { useWords, type Words } from "./words";

export interface ReceiptTableProps {
  /** The SDK's receipt rows: Core's events in Core's order (`receiptOf(logs).rows`). */
  rows: ReceiptRow[];
  /**
   * One flag per row of `rows`: true once that row's log has been read. The thank screen sets
   * them one by one; wave 5 draws the marker sweep from them, inside this table. Left out,
   * every row counts as read.
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
 */
export function ReceiptTable({ rows, landed, decimals, caption, className }: ReceiptTableProps) {
  const words = useWords();
  const lang = useLang();
  const { lines, total } = receiptLines(rows);
  if (lines.length === 0) return null;

  return (
    <table className={clsx("ah-receipt", className)}>
      <caption className="sr-only">{caption ?? words.receipt.caption}</caption>
      <tbody>
        {lines.map((line, index) => {
          const read = lineLanded(line, landed);
          const helper = line.kind === "helped";
          const amount = line.amount !== undefined && line.amount > 0n ? money(line.amount, decimals, lang, { cents: true }) : undefined;
          const what = label(line, words);
          return (
            <tr
              key={line.rows.join("-")}
              data-landed={landed ? String(read) : undefined}
              data-kind={line.kind}
              className={clsx(helper && "ah-receipt__row--highlight", index === lines.length - 1 && "ah-receipt__row--pretotal")}
            >
              <th scope="row">
                {what}
                {what && line.payee ? " · " : null}
                {line.payee ? <span className="ah-exact">{shortAddress(line.payee)}</span> : null}
                {landed && !read ? <span className="sr-only"> ({words.receipt.notRead})</span> : null}
              </th>
              {amount ? (
                <td>
                  {helper ? <span className="ah-receipt__amount--chip">{amount}</span> : amount}
                  {line.waiting ? (
                    <span className="ah-receipt__mark">
                      <Mark kind="waiting" />
                    </span>
                  ) : null}
                </td>
              ) : (
                <td className="ah-receipt__none">{helper ? words.receipt.thanksOnly : words.receipt.keptNothing}</td>
              )}
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
