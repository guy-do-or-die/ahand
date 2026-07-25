import { clsx } from "clsx";
import { t } from "../i18n";

export type AttributionMode = "anonymous" | "attributed";

export interface AttributionChoiceProps {
  mode: AttributionMode;
  onChange: (mode: AttributionMode) => void;
  /** Protocol gate: attribution needs a positive margin + a connected
   *  wallet to sign the ShakerAcceptance — the parent decides and gates. */
  attributedDisabled?: boolean;
  /** One-liner shown instead of the attributed caption while it's gated,
   *  e.g. "keep a margin to put your name on it". */
  attributedDisabledReason?: string;
  desktop?: boolean;
  className?: string;
}

/** Selected-mode captions — same one-line idiom as the visibility chips. */
const CAPTION: Record<AttributionMode, () => string> = {
  anonymous: () => t("No name on the route. You pass your whole share along."),
  attributed: () => t("Your wallet signs it — your name and margin travel with the route."),
};

/**
 * Anonymous vs attributed Shake — a two-chip choice with a one-line
 * explanation under the selected mode. Chips are hand-rolled (not ChipRow)
 * because attributed can be disabled while the margin is zero.
 */
export function AttributionChoice({
  mode,
  onChange,
  attributedDisabled = false,
  attributedDisabledReason,
  desktop = false,
  className,
}: AttributionChoiceProps) {
  const options: { key: AttributionMode; label: string; disabled: boolean }[] = [
    { key: "anonymous", label: t("anonymous"), disabled: false },
    { key: "attributed", label: t("with my name"), disabled: attributedDisabled },
  ];

  return (
    <div className={className}>
      <div className="flex gap-2" role="radiogroup" aria-label={t("how you're remembered")}>
        {options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={opt.key === mode}
            disabled={opt.disabled}
            onClick={() => onChange(opt.key)}
            className={clsx(
              "ah-chip",
              desktop && "ah-chip--desktop",
              opt.key === mode && "ah-chip--selected",
              opt.disabled && "opacity-40 cursor-not-allowed",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="text-[13.5px] leading-[1.4] text-ink/50 mt-1.5">
        {attributedDisabled && attributedDisabledReason && mode === "anonymous"
          ? attributedDisabledReason
          : CAPTION[mode]()}
      </p>
    </div>
  );
}
