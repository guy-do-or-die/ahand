import type { CSSProperties } from "react";

/**
 * Decorative native emoji. Always rendered with the platform emoji stack
 * and hidden from assistive tech — the surrounding text carries the meaning.
 */
export function Emoji({
  children,
  size,
  className,
  style,
}: {
  children: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        fontFamily: "var(--emoji)",
        letterSpacing: 0,
        ...(size ? { fontSize: size } : null),
        ...style,
      }}
    >
      {children}
    </span>
  );
}
