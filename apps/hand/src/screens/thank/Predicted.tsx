import type { ThankGas } from "@ahand/sdk";

import { t, useLang } from "../../i18n";
import { TID } from "../../testids";
import { Disclose, Mark, count, money, percent, shortAddress, useLens } from "../../ui";
import { namesNoOne, type Payout } from "./model";

/**
 * Who gets what, before anything is sent: worked out here from the route and the reward Core
 * holds at the latest block, row by row as Core will pay it. Each row opens its formula. A Hand
 * with no reward shows no money at all, only the sentence that the thanks moves none.
 */
export function Predicted({ payouts, decimals, noReward, gas }: { payouts: Payout[]; decimals: number; noReward: boolean; gas: ThankGas }) {
  const lang = useLang();
  const lens = useLens();
  const total = payouts.reduce((sum, payout) => sum + payout.amount, 0n);
  const units = (amount: bigint) => amount.toString();

  return (
    <section className="flex flex-col gap-3" data-testid={TID.thank.predicted} data-total={total.toString()}>
      <h2 className="m-0 flex flex-wrap items-center gap-2 text-[length:var(--fs-card-title)] font-extrabold tracking-[-0.02em]">
        {t("thank.predicted.title")}
        <Mark kind="checked" source={<span className="ah-meta">{t("thank.predicted.note")}</span>} />
      </h2>

      {noReward ? (
        <p className="ah-note m-0" data-testid={TID.thank.noReward}>
          {t("thank.noReward")}
        </p>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0" style={{ borderTop: "var(--bw-emph) solid var(--ink)" }}>
          {payouts.map((payout, index) => {
            const helper = payout.kind === "helped";
            const nobody = payout.kind === "passed" && (payout.bps === 0 || namesNoOne(payout.payee));
            return (
              <li
                key={index}
                className="flex flex-col gap-1 py-3"
                style={{ borderBottom: "var(--bw-hair) solid var(--ink-a10)" }}
                data-testid={TID.thank.predictedRow}
                data-kind={payout.kind}
                data-payee={nobody ? "" : payout.payee}
                data-amount={payout.amount.toString()}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="font-semibold">{t(helper ? "thank.predicted.helper" : "thank.predicted.passed")}</span>
                    {nobody ? null : <span className="ah-exact ml-2 text-[length:var(--fs-mono-md)]">{shortAddress(payout.payee)}</span>}
                    {payout.bps > 0 ? <span className="ah-meta ml-2">{percent(payout.bps, lang)}</span> : null}
                  </span>
                  {nobody ? (
                    <span className="ah-label shrink-0">{t("thank.predicted.keptNothing")}</span>
                  ) : (
                    <span className={helper ? "ah-receipt__amount--chip shrink-0 tabular-nums font-extrabold" : "shrink-0 tabular-nums font-bold"}>
                      {money(payout.amount, decimals, lang, { cents: true })}
                    </span>
                  )}
                </div>
                {nobody ? null : (
                  <Disclose label={t("thank.predicted.formula")}>
                    <span className="ah-meta ah-meta--exact break-all">{payout.payee}</span>
                    <span className="ah-meta ah-meta--exact">
                      {helper
                        ? t("thank.lens.giveFormula", { reward: units(payout.formula.reward), paid: units(payout.formula.rest ?? 0n), amount: units(payout.amount), bps: payout.bps })
                        : t("thank.lens.shakeFormula", { reward: units(payout.formula.reward), bps: payout.bps, amount: units(payout.amount) })}
                    </span>
                  </Disclose>
                )}
              </li>
            );
          })}
          <li className="flex items-baseline justify-between gap-3 pt-3">
            <span className="font-semibold">{t("thank.predicted.total")}</span>
            <span className="tabular-nums font-extrabold">{money(total, decimals, lang, { cents: true })}</span>
          </li>
        </ol>
      )}

      {/* A sentence for people, so the human voice: sentence case, never the mono of exact data. */}
      {noReward ? null : <p className="ah-label m-0">{t("thank.predicted.waitsIfBlocked")}</p>}
      {lens ? <span className="ah-meta ah-meta--dim">{t("thank.lens.fit", { gas: count(gas.gasLimit), bytes: count(gas.calldataBytes) })}</span> : null}
    </section>
  );
}
