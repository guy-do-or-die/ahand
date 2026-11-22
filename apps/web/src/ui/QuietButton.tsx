import type { ButtonHTMLAttributes, ReactNode } from "react";

import { clsx } from "../lib/clsx";

export interface QuietButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  compact?: boolean;
  /** frame = the 1.5px outline; text = an underlined action inside a sentence or a row. */
  variant?: "frame" | "text";
  children: ReactNode;
}

/** The quiet, secondary action: words only, never an emoji. */
export function QuietButton({ compact = false, variant = "frame", children, className, type = "button", ...rest }: QuietButtonProps) {
  return (
    <button type={type} className={clsx("ah-quiet", compact && "ah-quiet--compact", variant === "text" && "ah-quiet--text", className)} {...rest}>
      {children}
    </button>
  );
}
