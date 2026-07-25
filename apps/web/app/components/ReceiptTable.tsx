import type { ReactNode } from "react";
import { clsx } from "clsx";

export interface ReceiptRow {
  key: string;
  /** Mono uppercase label, may include an inline <Emoji>. */
  label: ReactNode;
  /** Preformatted money string (tabular-nums applied by the table). */
  amount: string;
  /** Solver row: taller, ink label, amber amount chip. */
  highlight?: boolean;
}

export interface ReceiptTableProps {
  rows: ReceiptRow[];
  total: { label: ReactNode; amount: string };
  /** Accessible table caption (visually hidden). */
  caption?: string;
  className?: string;
}

/** Settlement receipt (Thank / Pocket): 1.5px ink open rule, hairline rows,
 *  amber chip on the solver amount, 1.5px rule before the total. */
export function ReceiptTable({ rows, total, caption, className }: ReceiptTableProps) {
  return (
    <table className={clsx("ah-receipt", className)}>
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={row.key}
            className={clsx(
              row.highlight && "ah-receipt__row--highlight",
              i === rows.length - 1 && "ah-receipt__row--pretotal",
            )}
          >
            <th scope="row">{row.label}</th>
            <td>
              {row.highlight ? (
                <span className="ah-receipt__amount--chip">{row.amount}</span>
              ) : (
                row.amount
              )}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{total.label}</th>
          <td>{total.amount}</td>
        </tr>
      </tfoot>
    </table>
  );
}
