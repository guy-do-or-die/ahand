import { clsx } from "clsx";

export interface ChipOption {
  key: string;
  /** Preformatted label (money via Intl.NumberFormat at the call site). */
  label: string;
  /** Dashed "your call" style chip. */
  dashed?: boolean;
}

export interface ChipRowProps {
  options: ChipOption[];
  selectedKey?: string;
  onSelect: (key: string) => void;
  desktop?: boolean;
  className?: string;
}

/** Chip radio row (amounts, visibility modes). 44px chips (48 desktop),
 *  selected = amber bg + ink border + weight 800. */
export function ChipRow({
  options,
  selectedKey,
  onSelect,
  desktop = false,
  className,
}: ChipRowProps) {
  return (
    <div className={clsx("flex gap-2", className)} role="radiogroup">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          role="radio"
          aria-checked={opt.key === selectedKey}
          onClick={() => onSelect(opt.key)}
          className={clsx(
            "ah-chip",
            desktop && "ah-chip--desktop",
            opt.key === selectedKey && "ah-chip--selected",
            opt.dashed && opt.key !== selectedKey && "ah-chip--dashed",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
