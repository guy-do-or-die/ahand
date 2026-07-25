import { clsx } from "clsx";
import type { CSSProperties } from "react";

/**
 * Warm sentence-case line (sentiment / reassurance / taglines) that only
 * wraps at its "·" separators — a mid-clause orphan reads as a glitch.
 * Human voice by default; the mono "machine truth" voice is .ah-meta.
 */
export function MetaLine({
  text,
  dim = false,
  className,
  style,
}: {
  text: string;
  dim?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const parts = text.split(" · ");
  return (
    <p className={clsx("ah-label", dim && "ah-label--dim", className)} style={style}>
      {parts.map((part, i) => (
        <span key={i}>
          {/* Keep each clause intact; allow a line break only at the "·". */}
          <span className="whitespace-nowrap">{part}</span>
          {i < parts.length - 1 ? <span> · </span> : null}
        </span>
      ))}
    </p>
  );
}
