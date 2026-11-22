import type { CSSProperties } from "react";
import { clsx } from "../lib/clsx";

/** The four gestures of a Hand: raise ✋, pass on 🤝, help 🙌, thank 🙏. */
export type GestureKind = "raise" | "shake" | "cheer" | "bow";

export const GESTURE_EMOJI: Record<GestureKind, string> = {
  raise: "✋",
  shake: "🤝",
  cheer: "🙌",
  bow: "🙏",
};

/** The keyframes each gesture idles with (design/tokens.css); tests read the same table. */
export const GESTURE_KEYFRAMES: Record<GestureKind, string> = {
  raise: "ah-raise",
  shake: "ah-shake",
  cheer: "ah-cheer",
  bow: "ah-bow",
};

/**
 * A gesture emoji that moves the way its gesture does: ✋ rises, 🤝 shakes, 🙌 cheers, 🙏 bows,
 * in an idle loop of 3–4 seconds (design/components.css, `.ah-gesture`). It belongs where the
 * gesture is the hero of the moment: the Deal card, a screen's big emoji, the main action. A
 * small emoji inside running text stays a plain <Emoji>, because motion there is only noise.
 * `still` keeps this one from moving; `prefers-reduced-motion` stops every one of them. The
 * emoji is decorative and hidden from assistive tech: the words beside it carry the meaning.
 */
export function GestureEmoji({
  kind,
  size,
  emoji,
  still = false,
  className,
  style,
}: {
  kind: GestureKind;
  /** Font size in px; without it the size comes from the class or the parent. */
  size?: number;
  /** Another emoji with this gesture's motion (🫴 on the waiting screen's take-out). */
  emoji?: string;
  still?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      data-gesture={kind}
      className={clsx("ah-gesture", `ah-gesture--${kind}`, still && "ah-gesture--still", className)}
      style={size ? { fontSize: size, ...style } : style}
    >
      {emoji ?? GESTURE_EMOJI[kind]}
    </span>
  );
}
