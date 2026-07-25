import type { CSSProperties } from "react";

/** Rendered lockup height ÷ `size`. */
const LOCKUP_RATIO = 2.05;

/**
 * Canonical aHand lockup — references the static SVG logo files directly
 * from the public assets folder. Hides/shows light/dark versions via pure
 * CSS class selectors matching theme attributes.
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
  if (size < 12) {
    return (
      <span
        className={className}
        style={{
          fontFamily: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
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

  const height = size * LOCKUP_RATIO;

  return (
    <span
      className={`ah-logo-lockup ${className ?? ""}`}
      style={{
        display: "inline-flex",
        lineHeight: 0,
        // @ts-ignore
        "--logo-height": `${height}px`,
        ...style,
      }}
    >
      <img
        src="/ahand-logo-light.svg"
        alt="aHand"
        className="ah-logo-light-theme"
        style={{
          height: "var(--logo-height)",
          width: "auto",
        }}
      />
      <img
        src="/ahand-logo-dark.svg"
        alt="aHand"
        className="ah-logo-dark-theme"
        style={{
          height: "var(--logo-height)",
          width: "auto",
        }}
      />
    </span>
  );
}
