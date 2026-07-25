import { formatUnits } from "viem";
import { SwipeButton } from "./SwipeButton";
import { ReceiptTable, type ReceiptRow } from "./ReceiptTable";
import { formatUsdCents } from "../lib/format";
import { t } from "../i18n";

/** People show as warm roles, never hex — no name travels in the protocol
 *  (see #3 / DEVIATIONS.md). The real payout target lives in the shake and
 *  still drives settlement; this is the receipt's human-facing label only. */
export function hopLabel(_s: any): string {
  return t("a friend");
}

/**
 * Settlement receipt (mock 08/17). Amounts are the deterministic §5 math,
 * display-only; the chain already settled. `pool === null` renders the
 * receipt-less "already settled" fallback (a late-opened proof link can't
 * reconstruct the pool).
 */
export function ThankReceipt(props: {
  pool: bigint | null;
  charityFeeBps: number;
  maintFeeBps: number;
  shakes: any[];
  give: any;
  solverLabel: string;
  onRaise: () => void;
}) {
  const { pool, charityFeeBps, maintFeeBps, shakes, give, solverLabel } = props;

  const rows: ReceiptRow[] = [];
  let total: { label: string; amount: string } | null = null;
  if (pool !== null) {
    const poolNum = Number(formatUnits(pool, 6));
    const charity = (poolNum * charityFeeBps) / 10000;
    const maint = (poolNum * maintFeeBps) / 10000;
    const net = poolNum - charity - maint;

    rows.push({
      key: "solver",
      label: `${solverLabel} · ${t("accepted it")}`,
      amount: formatUsdCents((net * Number(give.finalClaimBps)) / 10000),
      highlight: true,
    });
    [...shakes].reverse().forEach((s, i) => {
      const margin = (Number(s.shake.parentClaimBps) - Number(s.shake.childClaimBps)) / 10000;
      rows.push({
        key: `hop-${i}`,
        label: `${hopLabel(s)} · ${t("passed it")}`,
        amount: formatUsdCents(net * margin),
      });
    });
    if (charityFeeBps > 0) {
      rows.push({
        key: "charity",
        label: t("charity · {pct}%", { pct: (charityFeeBps / 100).toFixed(0) }),
        amount: formatUsdCents(charity),
      });
    }
    const people = 1 + shakes.length + (charityFeeBps > 0 ? 1 : 0);
    total = {
      label: t("{n} people better off", { n: people }),
      amount: formatUsdCents(poolNum),
    };
  }

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
          {t("Solved. Thanks, everyone.")}
        </h1>

        {rows.length > 0 && total ? (
          <ReceiptTable className="mt-[22px]" caption={t("who got what")} rows={rows} total={total} />
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
