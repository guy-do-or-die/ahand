import { clsx } from "clsx";
import { SwipeButton } from "./SwipeButton";
import { QuietButton } from "./QuietButton";
import { t } from "../i18n";

export interface ReclaimButtonProps {
  /** Viewer raised this hand — the CTA speaks to them directly. */
  isRaiser?: boolean;
  /** Preformatted refund heading back to the raiser's claims, e.g. "$148". */
  refundAmount?: string;
  loading?: boolean;
  /** Parent gates on isReclaimable(hand) — Active and at/past expiry. */
  disabled?: boolean;
  onReclaim: () => void;
  className?: string;
}

/**
 * Permissionless reclaim of an expired, still-Active hand. The raiser gets
 * the full CTA ("Take it back"); anyone else sees a quiet tidy-up action —
 * either way the pot goes to the raiser's claims, never to the caller.
 */
export function ReclaimButton({
  isRaiser = false,
  refundAmount,
  loading = false,
  disabled = false,
  onReclaim,
  className,
}: ReclaimButtonProps) {
  if (isRaiser) {
    return (
      <div className={clsx("flex flex-col gap-2", className)}>
        <SwipeButton
          gesture="raise"
          emoji="🫳"
          variant="ink"
          disabled={disabled || loading}
          aria-busy={loading}
          onClick={onReclaim}
        >
          {loading ? t("Taking it back…") : t("Take it back")}
        </SwipeButton>
        <p className="ah-label ah-label--dim text-center">
          {refundAmount
            ? t("this hand has expired · {amount} returns to your claims", { amount: refundAmount })
            : t("this hand has expired · the pot returns to your claims")}
        </p>
      </div>
    );
  }

  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      <QuietButton disabled={disabled || loading} aria-busy={loading} onClick={onReclaim}>
        {loading ? t("Releasing…") : t("Release the pot")}
      </QuietButton>
      <p className="ah-label ah-label--dim text-center">
        {t("expired · anyone can tidy up — the pot goes back to whoever raised it")}
      </p>
    </div>
  );
}
