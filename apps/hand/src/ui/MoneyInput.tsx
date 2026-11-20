import { useId, useState, type ReactNode } from "react";

import { useLang } from "./ambient";
import { money, unitsText } from "./format";
import { readMoney, type MoneyReading } from "./judge";
import { useWords } from "./words";

export interface MoneyInputProps {
  /** The question above the field, in the human voice. */
  label: string;
  /** The token's decimals. */
  decimals: number;
  /** The amount the field starts with; zero is an amount like any other. */
  initial?: bigint;
  /** The most the field accepts (a balance, a cap). */
  max?: bigint;
  /** Every change, as read: empty, an amount, not an amount, or above the limit. */
  onReading: (reading: MoneyReading) => void;
  /** A line under the field. */
  hint?: ReactNode;
  disabled?: boolean;
}

/**
 * An amount of dollars. It accepts a point or a comma, reads exactly what was typed (nothing
 * is rounded), and takes zero as a valid amount: Core takes a reward of zero.
 */
export function MoneyInput({ label, decimals, initial, max, onReading, hint, disabled }: MoneyInputProps) {
  const words = useWords();
  const lang = useLang();
  const id = useId();
  const noteId = useId();
  const [text, setText] = useState(initial === undefined ? "" : unitsText(initial, decimals));
  const reading = readMoney(text, decimals, max);
  const problem =
    reading.status === "invalid" ? words.money.invalid(decimals) : reading.status === "too-much" && max !== undefined ? words.money.tooMuch(money(max, decimals, lang)) : undefined;

  return (
    <div className="ah-field">
      <label htmlFor={id} className="ah-field__label">
        {label}
      </label>
      <div className="ah-money" onClick={(event) => event.currentTarget.querySelector("input")?.focus()}>
        <span aria-hidden="true">$</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={text}
          disabled={disabled}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem || hint ? noteId : undefined}
          onChange={(event) => {
            setText(event.target.value);
            onReading(readMoney(event.target.value, decimals, max));
          }}
        />
      </div>
      {problem ? (
        <p id={noteId} className="ah-verdict" role="alert">
          {problem}
        </p>
      ) : hint ? (
        <p id={noteId} className="ah-label">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
