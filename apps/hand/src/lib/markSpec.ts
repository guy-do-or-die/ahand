/**
 * THE source of truth for the aHand lockup — every number that defines the
 * mark's proportions lives here and only here.
 *
 * Consumers:
 *  - components/Logo.tsx        → live HTML lockup (native platform emoji)
 *  - scripts/generate-mark.ts   → frozen outlined SVGs for surfaces that
 *                                 can't adapt per-viewer (OG cards, print)
 *
 * Horizontal centering of the hands is NOT a number: HTML centers them on
 * the H element structurally; the script centers them on the H's measured
 * ink box. Both express the same rule — "hands on the H, wherever it is."
 */
export const MARK = {
  fontWeight: 900,
  letterSpacing: "-0.01em",
  /**
   * Baseline offset of Schibsted Grotesk at line-height 1, measured via
   * satori ink-box probes (2026-07-13): baseline = top + 0.866em.
   * Re-measure if the brand face ever changes.
   */
  ascent: 0.866,
  /** Hands em-box ÷ wordmark font size (the 300/330 of the frozen mark). */
  emojiScale: 300 / 330,
} as const;

/** Descent below the baseline — where an inline box's bottom edge sits. */
export const MARK_DESCENT_EM = 1 - MARK.ascent;
