import type { ButtonHTMLAttributes, ReactNode } from "react";
import { clsx } from "../lib/clsx";
import { GestureEmoji, type GestureKind } from "./Gesture";

export type Gesture = GestureKind;

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
 * the emoji is decorative. The emoji idles with its gesture's motion, jumps
 * on press, and stands still while the button is disabled.
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
      <GestureEmoji
        kind={gesture}
        still={still}
        className={clsx("ah-swipe__emoji", `ah-swipe__emoji--${gesture}`)}
        {...(emoji ? { emoji } : {})}
      />
    </button>
  );
}
