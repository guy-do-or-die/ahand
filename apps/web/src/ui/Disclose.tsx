import { useId, useState, type ReactNode } from "react";

import { clsx } from "../lib/clsx";
import { useLens } from "./ambient";
import { useShown } from "./Proof";

export interface DiscloseProps {
  /** The toggle's words, set in mono with a dashed underline. */
  label: string;
  /** A short fact beside the label, shown while closed and open. */
  summary?: string;
  /** Open from the start; under the lens every Disclose stands open anyway. */
  defaultOpen?: boolean;
  /** The evidence: mono lines, marks, a command. */
  children: ReactNode;
  className?: string;
}

/**
 * A plain sentence first, the evidence behind it. A Disclose is proof, so it stands only under
 * the lens, and there it stands open in place, as every Disclose always did under the lens; in
 * the calm view the sentence above it is all there is. On a page that is itself
 * the proof (the passport, `ProofPage`) it is drawn closed, one tap away, as it always was.
 */
export function Disclose({ label, summary, defaultOpen = false, children, className }: DiscloseProps) {
  const lens = useLens();
  const shown = useShown();
  const [own, setOwn] = useState(defaultOpen);
  const id = useId();
  if (!shown) return null;
  const open = lens || own;
  return (
    <div className={clsx("flex flex-col items-start", className)}>
      <button type="button" className="ah-disclose" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOwn(!open)}>
        <span className="ah-disclose__toggle">{label}</span>
        {summary ? <span className="ah-disclose__summary">{summary}</span> : null}
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div id={id} className="ah-evidence ah-evidence--wide">
          {children}
        </div>
      ) : null}
    </div>
  );
}
