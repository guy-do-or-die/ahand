import { SwipeButton } from "./SwipeButton";
import { ReceiptTable, type ReceiptRow } from "./ReceiptTable";
import { t } from "../i18n";

/**
 * Settlement receipt. Rows come straight from the chain's PayoutAllocated
 * lines — every amount already credited to a claim, nothing recomputed.
 * `rows === null` renders the receipt-less "already settled" fallback (a
 * late-opened proof link has no settlement logs of its own).
 */
export function ThankReceipt(props: {
  rows: ReceiptRow[] | null;
  total: { label: string; amount: string } | null;
  onRaise: () => void;
}) {
  const { rows, total } = props;

  return (
    <div className="ah-page">
      <div className="flex flex-col flex-1 w-full px-6 pt-[26px] pb-6 lg:max-w-[640px] lg:mx-auto lg:pt-12 lg:pb-[60px]">
        <span className="ah-hero ah-hero--bow text-[64px]" aria-hidden="true">
          🙏
        </span>
        <h1
          className="mt-3 font-extrabold"
          style={{ fontSize: "var(--fs-title-m)", lineHeight: 1.05, letterSpacing: "-0.03em" }}
        >
          {t("Accepted. Thanks, everyone.")}
        </h1>

        {rows && rows.length > 0 && total ? (
          <>
            <ReceiptTable className="mt-[22px]" caption={t("who got what")} rows={rows} total={total} />
            <p className="ah-label ah-label--dim mt-3">
              {t("everyone's share is set aside on-chain — claimable from their pocket, any time")}
            </p>
          </>
        ) : (
          <p className="mt-4 ah-label">{t("already accepted — the thanks went out")}</p>
        )}

        <div aria-hidden="true" className="flex-1 min-h-5 max-h-24" />
        <div className="pt-6">
          <SwipeButton gesture="raise" variant="ink" onClick={props.onRaise} className="w-full">
            {t("Pay it forward")}
          </SwipeButton>
        </div>
        <p className="ah-label ah-label--dim mt-3.5 pb-4 text-center">
          {t("good travels · raise the next one")}
        </p>
      </div>
    </div>
  );
}
