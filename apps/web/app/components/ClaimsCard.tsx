import { clsx } from "clsx";
import { QuietButton } from "./QuietButton";
import { t } from "../i18n";

export interface ClaimsCardProps {
  /** Preformatted claimable total, e.g. "$12.50" (Intl at the call site). */
  amount: string;
  /** Quiet mono note next to the amount, e.g. "USDC". */
  tokenSymbol?: string;
  /** Nothing credited yet — the button hides, a quiet line explains. */
  empty?: boolean;
  /** Withdrawal in flight. */
  loading?: boolean;
  /** "Take out" → withdraw(token, address); wired by the caller. */
  onTakeOut: () => void;
  className?: string;
}

/**
 * Claimable pocket card — what PayoutAllocated has credited to you, with
 * the one action that moves it (withdraw). Pure shell: the caller reads the
 * chain and formats money; this only shows and asks.
 */
export function ClaimsCard({
  amount,
  tokenSymbol,
  empty = false,
  loading = false,
  onTakeOut,
  className,
}: ClaimsCardProps) {
  return (
    <div className={clsx("ah-card", className)}>
      <p className="ah-label ah-label--dim">{t("claimable")}</p>
      <div className="flex items-end justify-between gap-3 mt-2">
        <span
          className="font-extrabold break-all"
          style={{
            fontSize: "clamp(26px, 3vw, 36px)",
            lineHeight: 1,
            letterSpacing: "-0.035em",
            fontVariantNumeric: "tabular-nums",
            color: empty ? "var(--ink-a45)" : "var(--ink)",
          }}
          aria-live="polite"
        >
          {amount}
        </span>
        {tokenSymbol ? (
          <span className="ah-meta ah-meta--dim" style={{ fontSize: "var(--fs-mono-sm)" }}>
            {tokenSymbol}
          </span>
        ) : null}
      </div>
      {empty ? (
        <p className="ah-label ah-label--dim mt-3">
          {t("all clear — your thanks land straight in your wallet; anything undeliverable would wait here")}
        </p>
      ) : (
        <>
          <QuietButton
            className="mt-4 w-full"
            disabled={loading}
            aria-busy={loading}
            onClick={onTakeOut}
          >
            {loading ? t("Taking out…") : t("Take out")}
          </QuietButton>
          <p className="ah-label ah-label--dim mt-2.5">
            {t("yours already · taking out just moves it to your pocket")}
          </p>
        </>
      )}
    </div>
  );
}
