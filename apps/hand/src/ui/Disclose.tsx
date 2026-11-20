import { useId, useState, type ReactNode } from "react";

import { clsx } from "../lib/clsx";
import { useLens } from "./ambient";

export interface DiscloseProps {
  /** The toggle's words, set in mono with a dashed underline. */
  label: string;
  /** A short fact beside the label, shown while closed and open. */
  summary?: string;
  /** Open from the start, lens or not. */
  defaultOpen?: boolean;
  /** The evidence: mono lines, marks, a command. */
  children: ReactNode;
  className?: string;
}

/**
 * A plain sentence first, the evidence one tap away. The toggle opens what stands behind the
 * sentence above it. When the lens is on, every Disclose stands open in place; the layout
 * does not change otherwise.
 */
export function Disclose({ label, summary, defaultOpen = false, children, className }: DiscloseProps) {
  const lens = useLens();
  const [own, setOwn] = useState(defaultOpen);
  const id = useId();
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
