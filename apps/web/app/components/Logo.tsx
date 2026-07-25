import type { CSSProperties } from "react";
import { MARK, MARK_DESCENT_EM } from "../lib/markSpec";

/** Rendered lockup height ÷ `size`. */
const LOCKUP_RATIO = 2.05;

/**
 * Canonical aHand lockup, composed structurally in HTML:
 * "aHand" in the brand face (bundled webfont — identical everywhere) with a
 * native 🙌 centered over the H *element*, so the browser does the centering
 * — no coordinates, no font-metric math.
 *
 * The hands render with the PLATFORM emoji font on purpose: like every other
 * emoji in the app, the logo feels native — aHand is home anywhere. The one
 * surface that can't adapt per-viewer (the OG card PNG) uses the frozen
 * outlined marks from scripts/generate-mark.ts instead; keep the proportions
 * here (hands ≈0.91em, wrists at the baseline) in sync with that script.
 */
export function Logo({
  size = 26,
  className,
  style,
}: {
  /** Reference size in px (corresponds to local font-size). */
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const height = size * LOCKUP_RATIO;

  // Too small for the hands to read — plain wordmark.
  if (size < 12) {
    return (
      <span
        className={className}
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 900,
          fontSize: size,
          lineHeight: 1,
          color: "var(--ink)",
          ...style,
        }}
      >
        aHand
      </span>
    );
  }

  return (
    <span
      className={className}
      aria-label="aHand"
      style={{
        display: "inline-flex",
        alignItems: "center",
        height,
        fontFamily: "var(--font-display)",
        fontWeight: MARK.fontWeight,
        fontSize: height * 0.66,
        lineHeight: 1,
        letterSpacing: MARK.letterSpacing,
        color: "var(--ink)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      a
      <span style={{ position: "relative", display: "inline-block" }}>
        H
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "50%",
            // box bottom = descent line; lift by the descent so the wrists
            // rest on the BASELINE, exactly like the frozen mark
            bottom: `${MARK_DESCENT_EM.toFixed(3)}em`,
            transform: "translateX(-50%)",
            fontSize: `${MARK.emojiScale.toFixed(3)}em`,
            lineHeight: 1,
            fontFamily: "var(--emoji)",
            letterSpacing: 0,
          }}
        >
          🙌
        </span>
      </span>
      and
    </span>
  );
}
