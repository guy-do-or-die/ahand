import type { ButtonHTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";

export type Gesture = "raise" | "shake" | "cheer" | "bow";

const GESTURE_EMOJI: Record<Gesture, string> = {
  raise: "✋",
  shake: "🤝",
  cheer: "🙌",
  bow: "🙏",
};

export interface SwipeButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Picks the emoji, its idle animation and mock-exact size/offset. */
  gesture: Gesture;
  /** ink = primary (amber on dark theme); amber = confirm/positive. */
  variant?: "ink" | "amber";
  compact?: boolean;
  /** Override the gesture emoji (e.g. 👍 on Onboarding's connect). */
  emoji?: string;
  /** Suppress the idle animation (mock 02 keeps 👍 static). */
  still?: boolean;
  children: ReactNode;
}

/**
 * Marker-swipe button — the signature CTA. Gradient fill fades to
 * transparent so the oversized gesture emoji stands on the page background
 * (overflow stays visible by design). The label is the accessible name;
 * the emoji is decorative.
 */
export function SwipeButton({
  gesture,
  variant = "ink",
  compact = false,
  emoji,
  still = false,
  children,
  className,
  type = "button",
  ...rest
}: SwipeButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        "ah-swipe",
        variant === "amber" ? "ah-swipe--amber" : "ah-swipe--ink",
        compact && "ah-swipe--compact",
        className,
      )}
      {...rest}
    >
      {children}
      <span
        aria-hidden="true"
        className={clsx("ah-swipe__emoji", `ah-swipe__emoji--${gesture}`)}
        style={still ? { animation: "none" } : undefined}
      >
        {emoji ?? GESTURE_EMOJI[gesture]}
      </span>
    </button>
  );
}
