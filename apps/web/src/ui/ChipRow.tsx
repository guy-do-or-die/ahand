import { clsx } from "../lib/clsx";

export interface ChipOption {
  key: string;
  /** Written out by the caller (money and dates through Intl). */
  label: string;
  /** The dashed "your call" chip. */
  dashed?: boolean;
}

export interface ChipRowProps {
  /** What is being chosen, for a screen reader. */
  label: string;
  options: ChipOption[];
  selectedKey?: string;
  onSelect: (key: string) => void;
  desktop?: boolean;
  className?: string;
}

/**
 * A row of chips where one is chosen (amounts, days, visibility). 44px chips (48 on desktop);
 * the chosen one is an amber fill with an ink border at weight 800. The arrow keys move the
 * choice, as in any radio group.
 */
export function ChipRow({ label, options, selectedKey, onSelect, desktop = false, className }: ChipRowProps) {
  const move = (from: number, by: number) => {
    const next = options[(from + by + options.length) % options.length];
    if (next) onSelect(next.key);
  };
  return (
    <div className={clsx("flex flex-wrap gap-2", className)} role="radiogroup" aria-label={label}>
      {options.map((option, index) => {
        const selected = option.key === selectedKey;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (selectedKey === undefined && index === 0) ? 0 : -1}
            onClick={() => onSelect(option.key)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") move(index, 1);
              else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(index, -1);
              else return;
              event.preventDefault();
              const chips = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
              chips?.[(index + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
            }}
            className={clsx("ah-chip", desktop && "ah-chip--desktop", selected && "ah-chip--selected", option.dashed && !selected && "ah-chip--dashed")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
