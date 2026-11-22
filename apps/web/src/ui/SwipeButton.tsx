import { useEffect, useRef, useState, type ButtonHTMLAttributes, type PointerEvent, type ReactNode } from "react";
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
 * Marker-swipe button — the signature CTA. Its fill fades out toward the oversized gesture emoji,
 * which stands on the page background (overflow stays visible by design). The label is the
 * accessible name; the emoji is decorative. The emoji idles with its gesture's motion, pushes on
 * press, and stands still while the button is disabled.
 *
 * A press is shown for at least 150 ms: a finger's tap is over in a few frames, and iOS shows
 * `:active` late or not at all, so the button keeps `data-pressed` from the pointer going down
 * until that long after it comes up (design/components.css answers both the same way).
 */

/** How long a press stays shown at the least, in milliseconds. */
const PRESS_SHOWN = 150;

export function SwipeButton({
  gesture,
  variant = "ink",
  compact = false,
  emoji,
  still = false,
  children,
  className,
  type = "button",
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  ...rest
}: SwipeButtonProps) {
  const [pressed, setPressed] = useState(false);
  const press = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | undefined }>({ at: 0, timer: undefined });
  useEffect(() => () => clearTimeout(press.current.timer), []);
  const down = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event);
    clearTimeout(press.current.timer);
    press.current.at = event.timeStamp;
    setPressed(true);
  };
  const up = (pass: typeof onPointerUp) => (event: PointerEvent<HTMLButtonElement>) => {
    pass?.(event);
    clearTimeout(press.current.timer);
    press.current.timer = setTimeout(() => setPressed(false), Math.max(0, PRESS_SHOWN - (event.timeStamp - press.current.at)));
  };
  return (
    <button
      type={type}
      className={clsx(
        "ah-swipe",
        variant === "amber" ? "ah-swipe--amber" : "ah-swipe--ink",
        compact && "ah-swipe--compact",
        className,
      )}
      data-pressed={pressed && !rest.disabled ? "" : undefined}
      onPointerDown={down}
      onPointerUp={up(onPointerUp)}
      onPointerCancel={up(onPointerCancel)}
      onPointerLeave={up(onPointerLeave)}
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
