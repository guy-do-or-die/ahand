import type { ButtonHTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";

export interface QuietButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  compact?: boolean;
  children: ReactNode;
}

/** Quiet/secondary action — text only, never gets an emoji. */
export function QuietButton({
  compact = false,
  children,
  className,
  type = "button",
  ...rest
}: QuietButtonProps) {
  return (
    <button
      type={type}
      className={clsx("ah-quiet", compact && "ah-quiet--compact", className)}
      {...rest}
    >
      {children}
    </button>
  );
}
