/**
 * THE source of truth for the aHand lockup — every number that defines the
 * mark's proportions lives here and only here.
 *
 * Consumers:
 *  - ui/Logo.tsx                → live HTML lockup (native platform emoji)
 *  - public/ahand-mark-*.svg    → frozen outlined SVGs for surfaces that
 *                                 can't adapt per-viewer (OG cards, print)
 *
 * The frozen SVGs are kept as files. The script that outlined them
 * (apps/web/scripts/generate-mark.ts, in git history:
 * `git log -- apps/web/scripts/generate-mark.ts`) needed Schibsted Grotesk 900
 * as a TTF, a vector raised-hands emoji and satori 0.26; none of these is in
 * the tree any more, and a newer satori moves the outlines by a pixel, so a
 * change to the mark means bringing those back and redrawing both files.
 *
 * Horizontal centering of the hands is NOT a number: HTML centers them on
 * the H element structurally; the script centered them on the H's measured
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
