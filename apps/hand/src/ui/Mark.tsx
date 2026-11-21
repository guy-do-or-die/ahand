import { useId, useState, type ReactNode } from "react";

import { clsx } from "../lib/clsx";
import { useLens } from "./ambient";
import { useShown } from "./Proof";
import { useWords } from "./words";

export type MarkKind = "checked" | "chain" | "waiting";

export interface MarkProps {
  /**
   * How a claim is known (brief 06 §3, UX-SPEC §2):
   * checked = checked in this browser; chain = read from an event or a view on chain;
   * waiting = money that waits in the contract for its payee.
   */
  kind: MarkKind;
  /** What the mark opens: its source, in mono. With none, the mark is a plain tag. */
  source?: ReactNode;
  /**
   * For a mark whose source stands elsewhere, under a sentence it shares with a figure: the
   * caller holds the source (the element with this `id`) and whether it is open, and the mark is
   * one more button that opens and shuts it.
   */
  opens?: { id: string; open: boolean; toggle: () => void };
  className?: string;
}

const GLYPH: Record<MarkKind, string> = { checked: "✓", chain: "⛓️", waiting: "⏳" };

/**
 * The three marks, which never look alike: an ink outline, an ink fill, a dashed outline.
 * Each carries its words, so the state is never told by shape or colour alone. A mark with a
 * source is a button that opens it underneath; the lens opens every one.
 *
 * "Checked here" and "On chain" say how a claim is known, which is proof: they stand only under
 * the lens. "Waiting" says where money is, so it stays in the calm view too, as a plain tag
 * that opens nothing until the lens is on.
 */
export function Mark({ kind, source, opens, className }: MarkProps) {
  const words = useWords();
  const lens = useLens();
  const shown = useShown();
  const [own, setOwn] = useState(false);
  const id = useId();
  const open = lens || own;
  if (!shown && kind !== "waiting") return null;
  const face = (
    <>
      <span aria-hidden="true" className="ah-mark__glyph">
        {GLYPH[kind]}
      </span>
      {words.marks[kind]}
    </>
  );

  if (!shown) return <span className={clsx("ah-mark", `ah-mark--${kind}`, className)}>{face}</span>;
  if (opens) {
    return (
      <button
        type="button"
        className={clsx("ah-mark ah-mark--button", `ah-mark--${kind}`, className)}
        aria-expanded={opens.open}
        aria-controls={opens.open ? opens.id : undefined}
        onClick={opens.toggle}
      >
        {face}
        <span aria-hidden="true" className="ah-mark__caret">
          {opens.open ? "▴" : "▾"}
        </span>
      </button>
    );
  }
  if (source === undefined || source === null) {
    return <span className={clsx("ah-mark", `ah-mark--${kind}`, className)}>{face}</span>;
  }
  return (
    <span className={clsx("ah-markbox", className)}>
      <button
        type="button"
        className={clsx("ah-mark ah-mark--button", `ah-mark--${kind}`)}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOwn(!open)}
      >
        {face}
        <span aria-hidden="true" className="ah-mark__caret">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open ? (
        <span id={id} className="ah-evidence">
          {source}
        </span>
      ) : null}
    </span>
  );
}
