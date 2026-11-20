import { useId, useState, type ReactNode } from "react";

import { clsx } from "../lib/clsx";
import { readAddress, type AddressReading, type PayeeContext } from "./judge";
import { useWords } from "./words";

export interface AddressInputProps {
  /** The question above the field. */
  label: string;
  /** This Hand's Core, asker and token: what the SDK's `payeeProblem` judges the address against. */
  ctx: PayeeContext;
  /** What the field starts with (an account's address filled in by the screen). */
  initial?: string;
  /** Every change, as read. Only "ok" and "flagged" carry an address that may be paid. */
  onReading: (reading: AddressReading) => void;
  /** A line under the field while it is empty. */
  hint?: ReactNode;
}

/**
 * Where money should land, pasted by a person. The field judges it at once with the SDK's
 * `payeeProblem`: the zero address and the contract's own address are refused; the asker's
 * and the token's are let through with a question. For any other address it says the one
 * honest thing: nobody can check whose it is.
 */
export function AddressInput({ label, ctx, initial = "", onReading, hint }: AddressInputProps) {
  const words = useWords().address;
  const id = useId();
  const noteId = useId();
  const [text, setText] = useState(initial);
  const reading = readAddress(text, ctx);

  let tag: { text: string; ink: boolean } | undefined;
  let sentence: ReactNode;
  if (reading.status === "incomplete") sentence = words.incomplete;
  else if (reading.status === "typo") sentence = words.typo;
  else if (reading.status === "refused") {
    tag = { text: words.refused, ink: true };
    sentence = words[reading.problem];
  } else if (reading.status === "flagged") {
    tag = { text: words.flagged, ink: false };
    sentence = words[reading.problem];
  } else if (reading.status === "ok") sentence = words.ok;
  else sentence = hint;

  const refusal = reading.status === "refused" || reading.status === "typo";

  return (
    <div className="ah-field" data-reading={reading.status} data-problem={"problem" in reading ? reading.problem : undefined}>
      <label htmlFor={id} className="ah-field__label">
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        className="ah-input ah-input--exact"
        placeholder="0x…"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        value={text}
        aria-invalid={refusal ? true : undefined}
        aria-describedby={sentence ? noteId : undefined}
        onChange={(event) => {
          const next = event.target.value.replace(/\s+/g, "");
          setText(next);
          onReading(readAddress(next, ctx));
        }}
      />
      {sentence ? (
        <p id={noteId} className={clsx(tag || reading.status === "ok" ? "ah-verdict" : "ah-label")} role={refusal ? "alert" : "status"}>
          {tag ? <span className={clsx("ah-tag", tag.ink ? "ah-tag--ink" : "ah-tag--outline")}>{tag.text}</span> : null}
          <span>{sentence}</span>
        </p>
      ) : null}
    </div>
  );
}
