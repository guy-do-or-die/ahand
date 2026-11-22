import { clsx } from "../lib/clsx";

export interface RewardBarProps {
  /** 0..1: the amber share of the track. */
  progress: number;
  /** What the bar measures, in words; a meter with no name says nothing to a screen reader. */
  label: string;
  /** bar = the 4px track; sm, md and lg are the mock sizes (8, 10, 12px). */
  size?: "bar" | "sm" | "md" | "lg";
  className?: string;
}

/** The reward bar (the old pot bar): how much of the reward a figure beside it stands for. */
export function RewardBar({ progress, label, size = "bar", className }: RewardBarProps) {
  const clamped = Math.min(1, Math.max(0, progress));
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      aria-label={label}
      className={clsx("ah-reward", size !== "bar" && `ah-reward--${size}`, className)}
    >
      <div className="ah-reward__fill" style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}
