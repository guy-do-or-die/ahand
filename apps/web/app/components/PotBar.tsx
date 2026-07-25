import { clsx } from "clsx";

export interface PotBarProps {
  /** 0..1 — amber fill share of the track. */
  progress: number;
  /** Mock sizes: lg 12px (mobile hand view), md 10px (desktop card), sm 8px. */
  size?: "sm" | "md" | "lg";
  /** Accessible description, e.g. "148 in the pot, solver keeps at least 105". */
  label?: string;
  className?: string;
}

export function PotBar({ progress, size = "lg", label, className }: PotBarProps) {
  const clamped = Math.min(1, Math.max(0, progress));
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={clamped}
      aria-label={label}
      className={clsx("ah-pot", size !== "lg" && `ah-pot--${size}`, className)}
    >
      <div className="ah-pot__fill" style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}
