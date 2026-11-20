import { config } from "../../config";
import { t, useLang } from "../../i18n";
import { TID } from "../../testids";
import { useLens } from "../../ui";
import { paidPassesAtWorst } from "../core/facts";

/**
 * "What it can't promise" (UX-SPEC §11, ARCHITECTURE §11): sixteen limits, each one plain
 * sentence and one small example. The twelve accepted limits of the record (brief 02 §2) come
 * first, starting with "Thanking is voluntary", then the two token risks of the plan's token
 * policy, then this build's own two, and the page ends with the unaudited sentence. The lens
 * adds where each one is recorded, in mono.
 */

/** The order of the entries and, for the lens, the record each one comes from. */
export const LIMITS: readonly { id: string; source: string }[] = [
  { id: "voluntary", source: "R-3 · ACCEPTED LIMITS" },
  { id: "route", source: "R-29 · ONEDOLLARAUDIT M-3" },
  { id: "second", source: "R-4 · GIVERISRAISER COMPARES ADDRESSES" },
  { id: "length", source: "R-45 · R-46 · ONEDOLLARAUDIT M-1" },
  { id: "balances", source: "R-2 · R-26 · R-102 · ONEDOLLARAUDIT M-2, L-8" },
  { id: "blocked", source: "R-26 · PENDING · WITHDRAW" },
  { id: "forever", source: "R-20" },
  { id: "cap", source: "R-98 · R-99 · MAX_EXPIRY_PERIOD 180 D" },
  { id: "lost", source: "R-19 · ROOT KEY" },
  { id: "rescue", source: "NO OWNER · NO ADMIN · NO RESCUE FUNCTION" },
  { id: "refund", source: "R-33 · REFUND → PENDING" },
  { id: "token", source: "PLAN · TOKEN POLICY · MAINNET RISKS" },
  { id: "usdc", source: "PLAN · TOKEN POLICY · USDC BLOCKLIST" },
  { id: "code", source: "THIS BUILD · ARCHITECTURE §9, §11" },
  { id: "keys", source: "THIS BUILD · D-19 · KEYS/1 MESSAGE" },
  { id: "unaudited", source: "7 AI REVIEWS · 1 AI SCAN · TESTED: COINBASE SMART WALLET, SAFE 1.4.1" },
];

/** This build's own figure for the "length" entry: paid shares at worst with its payout setting. */
const PAID_PASSES = paidPassesAtWorst(config.defaults.payoutGasK);

const two = (n: number) => String(n).padStart(2, "0");

export default function LimitsScreen() {
  useLang(); // re-render on a language switch
  const lens = useLens();
  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-[var(--gap-section)] px-6 pb-14 pt-10 md:px-10" data-screen="limits">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("limits.title")}</h1>
        <p className="m-0 text-[length:var(--fs-body-lg)] leading-[1.45]">{t("limits.lead")}</p>
      </header>

      <ol className="m-0 flex list-none flex-col p-0">
        {LIMITS.map(({ id, source }, index) => (
          <li
            key={id}
            data-testid={TID.about.limit}
            data-index={index + 1}
            data-value={id}
            className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 border-t-[1.5px] border-[color:var(--ink)] py-5 md:grid-cols-[3rem_minmax(0,1fr)]"
          >
            <span className="ah-meta ah-meta--ink pt-[3px] text-[length:var(--fs-mono-lg)]" aria-hidden="true">
              {two(index + 1)}
            </span>
            <div className="flex min-w-0 flex-col gap-2">
              <p className="m-0 text-[length:var(--fs-body-xl)] font-semibold leading-[1.4]">{t(`limits.${id}.say`)}</p>
              <p className="m-0 text-[length:var(--fs-body-md)] leading-[1.45] text-[color:var(--ink-a70)]">
                <span className="ah-meta mr-2 align-[1px]">{t("limits.example")}</span>
                {t(`limits.${id}.example`)}
              </p>
              {id === "length" ? (
                <p className="m-0 text-[length:var(--fs-body-md)] leading-[1.45]" data-testid={TID.about.limitHere} data-value={PAID_PASSES}>
                  {t("limits.length.here", { n: PAID_PASSES })}
                </p>
              ) : null}
              {lens ? <p className="ah-meta m-0">{source}</p> : null}
            </div>
          </li>
        ))}
      </ol>

      <nav className="flex flex-wrap gap-3 border-t-[1.5px] border-[color:var(--ink)] pt-5" aria-label={t("limits.title")}>
        <a href="/core" className="ah-quiet no-underline">
          {t("limits.next.core")}
        </a>
        <a href="/without-us" className="ah-quiet no-underline">
          {t("limits.next.withoutUs")}
        </a>
        <a href="/defaults" className="ah-quiet no-underline">
          {t("limits.next.defaults")}
        </a>
      </nav>
    </section>
  );
}
