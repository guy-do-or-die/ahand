import { useEffect, useState } from "react";

import { clsx } from "../lib/clsx";
import { useWords } from "./words";

export interface CopyRowProps {
  /** What goes to the clipboard, exactly. A link is handed in from memory by the caller. */
  value: string;
  /** What the row shows; by default the value, cut at the row's edge. */
  display?: string;
  /** The dashed row of the mocks ("take this with you"); a solid frame otherwise. */
  dashed?: boolean;
  onCopied?: () => void;
  className?: string;
}

/**
 * A row that copies its value when pressed. The value is never logged and never leaves the
 * page except through the clipboard. Where the clipboard is closed, the row says so and the
 * text can be selected by hand.
 */
export function CopyRow({ value, display, dashed = true, onCopied, className }: CopyRowProps) {
  const words = useWords();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      onCopied?.();
    } catch {
      setState("failed");
    }
  };

  return (
    <div className="ah-stack">
      <button type="button" onClick={copy} className={clsx("ah-linkrow", dashed && "ah-linkrow--dashed", className)}>
        <span className="ah-linkrow__value ah-exact">{display ?? value}</span>
        <span className="ah-linkrow__action" aria-live="polite">
          {state === "copied" ? words.copy.copied : words.copy.copy}
        </span>
      </button>
      {state === "failed" ? (
        <p className="ah-label" role="status">
          {words.copy.failed}
        </p>
      ) : null}
    </div>
  );
}
