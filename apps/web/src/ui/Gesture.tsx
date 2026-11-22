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
 * A gesture emoji that moves the way its gesture does: ✋ waves, 🤝 shakes, 🙌 cheers, 🙏 bows.
 * It makes its move once in a round of five seconds and rests for the remainder
 * (design/components.css, `.ah-gesture`), so a screen is alive without flickering. It belongs
 * where the gesture is the hero of the moment: the Deal card, a screen's big emoji, the main
 * action. A small emoji inside running text stays a plain <Emoji>, because motion there is only
 * noise. `turn` is the second of the round at which this one moves: gestures that share a screen
 * get different turns and so move one after another, never together. `still` keeps this one from
 * moving; `prefers-reduced-motion` stops every one of them. The emoji is decorative and hidden
 * from assistive tech: the words beside it carry the meaning.
 */
export function GestureEmoji({
  kind,
  size,
  emoji,
  still = false,
  turn,
  className,
  style,
}: {
  kind: GestureKind;
  /** Font size in px; without it the size comes from the class or the parent. */
  size?: number;
  /** Another emoji with this gesture's motion (🫴 on the waiting screen's take-out). */
  emoji?: string;
  still?: boolean;
  /** When in the five-second round this gesture moves, in seconds; unset, its place decides. */
  turn?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const placed = { ...(size ? { fontSize: size } : {}), ...(turn !== undefined ? { "--gesture-turn": `${turn}s` } : {}), ...style } as CSSProperties;
  return (
    <span
      aria-hidden="true"
      data-gesture={kind}
      className={clsx("ah-gesture", `ah-gesture--${kind}`, still && "ah-gesture--still", className)}
      style={Object.keys(placed).length > 0 ? placed : undefined}
    >
      {emoji ?? GESTURE_EMOJI[kind]}
    </span>
  );
}
