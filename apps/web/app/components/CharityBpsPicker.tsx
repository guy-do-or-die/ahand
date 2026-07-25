import { useState } from "react";
import { clsx } from "clsx";
import { MIN_CHARITY_BPS, MAX_CHARITY_BPS } from "@ahand/sdk";
import { ChipRow } from "./ChipRow";
import { t } from "../i18n";

/** Constitutional charity bounds — sdk-owned, re-exported for call sites. */
export { MIN_CHARITY_BPS, MAX_CHARITY_BPS };

/** Preset chips: 1 / 5 / 10 / 30% — the last one IS the upper bound. */
export const CHARITY_BPS_PRESETS = [100, 500, 1000, 3000] as const;

export function clampCharityBps(bps: number): number {
  if (!Number.isFinite(bps)) return MIN_CHARITY_BPS;
  return Math.min(MAX_CHARITY_BPS, Math.max(MIN_CHARITY_BPS, Math.round(bps)));
}

const formatPct = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

export interface CharityBpsPickerProps {
  /** Basis points within [MIN_CHARITY_BPS, MAX_CHARITY_BPS]. */
  valueBps: number;
  /** Always receives a clamped, integer bps value. */
  onChange: (bps: number) => void;
  desktop?: boolean;
  className?: string;
}

/**
 * Charity share picker — preset chips + a "your call" percent field, same
 * pattern as the pot-amount row on /raise. Custom input is clamped into the
 * constitutional [1%, 30%] window on commit, never mid-keystroke.
 */
export function CharityBpsPicker({ valueBps, onChange, desktop = false, className }: CharityBpsPickerProps) {
  const isPreset = (CHARITY_BPS_PRESETS as readonly number[]).includes(valueBps);
  const [custom, setCustom] = useState(!isPreset);
  // Free-typing surface; committed (clamped) only on change, snapped on blur.
  const [draftPct, setDraftPct] = useState(String(valueBps / 100));

  const commit = (raw: string) => {
    setDraftPct(raw);
    const pct = Number(raw);
    if (Number.isFinite(pct) && raw.trim() !== "") {
      onChange(clampCharityBps(pct * 100));
    }
  };

  return (
    <div className={className}>
      <div className="flex gap-2 items-center">
        <ChipRow
          desktop={desktop}
          options={CHARITY_BPS_PRESETS.map((bps) => ({ key: String(bps), label: formatPct(bps) }))}
          selectedKey={custom ? undefined : String(valueBps)}
          onSelect={(key) => {
            setCustom(false);
            onChange(clampCharityBps(Number(key)));
          }}
        />
        {custom ? (
          <label className={clsx("ah-chip ah-chip--selected ah-chip-field", desktop && "ah-chip--desktop")}>
            <input
              type="number"
              min={MIN_CHARITY_BPS / 100}
              max={MAX_CHARITY_BPS / 100}
              step="0.5"
              inputMode="decimal"
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              value={draftPct}
              onChange={(e) => commit(e.target.value)}
              onBlur={() => setDraftPct(String(clampCharityBps(valueBps) / 100))}
              aria-label={t("your call")}
            />
            <span aria-hidden="true">%</span>
          </label>
        ) : (
          <button
            type="button"
            className={clsx("ah-chip ah-chip--dashed", desktop && "ah-chip--desktop")}
            onClick={() => {
              setDraftPct(String(valueBps / 100));
              setCustom(true);
            }}
          >
            {t("your call")}
          </button>
        )}
      </div>
      <p className="ah-label ah-label--dim mt-1.5">
        {t("between 1% and 30% · locked in when you raise")}
      </p>
    </div>
  );
}
