import { config } from "../../config";
import { t, useLang } from "../../i18n";
import { TID } from "../../testids";
import { percent, shortAddress } from "../../ui";

/**
 * "About these defaults" (UX-SPEC §11): one row for each choice in the experiment's table of
 * decisions (design/DECISIONS.md) that a person can feel, each marked as chosen for this
 * experiment and not by the project's owner, with its row number so it can be found. Rows the
 * table leaves for the owner to rule on say so. The mono line under each row is the setting as
 * this build actually has it, read from its configuration where the configuration holds it.
 */

interface Row {
  /** The row's number in DECISIONS.md. */
  number: string;
  /** The catalogue key of its words: defaults.<key>.title and .body. */
  key: string;
  /** Listed under "Left for the owner" in DECISIONS.md. */
  owner?: boolean;
  /** The setting itself, in mono: exact data from this build, or the catalogue key that says it. */
  value: string | { key: string };
}

const { defaults, prices } = config;

const ROWS: readonly Row[] = [
  { number: "D-21", key: "d21", owner: true, value: { key: "d21" } },
  { number: "D-26", key: "d26a", owner: true, value: `minClaimBps = ${defaults.minClaimBps}` },
  { number: "D-26", key: "d26b", owner: true, value: { key: "d26b" } },
  { number: "D-26", key: "d26c", owner: true, value: `payoutGasK = ${defaults.payoutGasK}` },
  { number: "D-27", key: "d27", value: config.tokens.map((token) => `${token.symbol} ${shortAddress(token.address)}`).join(" · ") },
  { number: "D-31", key: "d31", value: { key: "d31" } },
  { number: "D-32", key: "d32", value: { key: "d32" } },
  { number: "D-37", key: "d37", value: { key: "d37" } },
  { number: "D-39", key: "d39", value: { key: "d39" } },
  { number: "D-40", key: "d40", value: config.relays.length ? `NIP-17 · ${config.relays.join(" · ")}` : { key: "d40none" } },
  { number: "D-49", key: "d49", value: `${prices.date} · ETH $${prices.ethUsd} · BASE ${prices.base.gwei} GWEI · ETHEREUM ${prices.ethereum.gwei} GWEI` },
  { number: "D-61", key: "d61", value: { key: "d61" } },
  { number: "D-62", key: "d62", owner: true, value: config.forwarder ? `forwarder = ${config.forwarder}` : { key: "d62none" } },
  { number: "D-63", key: "d63", owner: true, value: { key: "d63" } },
  { number: "D-66", key: "d66", owner: true, value: { key: "d66" } },
];

export default function DefaultsScreen() {
  const lang = useLang();
  const values = {
    pct: percent(defaults.minClaimBps, lang),
    days: defaults.expiryDays,
    date: prices.date,
    eth: prices.ethUsd,
  };
  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-[var(--gap-section)] px-6 pb-14 pt-10 md:px-10" data-screen="defaults">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("defaults.title")}</h1>
        <p className="m-0 text-[length:var(--fs-body-lg)] leading-[1.45]">{t("defaults.lead")}</p>
      </header>

      <ul className="m-0 flex list-none flex-col gap-4 p-0">
        {ROWS.map((row, index) => (
          <li key={row.key} id={ROWS.findIndex((other) => other.number === row.number) === index ? row.number : undefined} data-testid={TID.about.default} data-value={row.number} data-key={row.key} className="ah-card flex flex-col gap-2 p-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="inline-flex items-center rounded-[var(--r-chip)] border-[1.5px] border-[color:var(--ink)] bg-[color:var(--amber)] px-2 py-[1px] font-mono text-[length:var(--fs-mono-md)] font-medium text-[color:var(--on-amber)]">
                <span className="sr-only">{t("defaults.row")} </span>
                {row.number}
              </span>
              {row.owner ? (
                <span className="inline-flex items-center rounded-[var(--r-chip)] border-[1.5px] border-dashed border-[color:var(--ink-a30)] px-2 py-[1px] text-[length:var(--fs-body-xs)] font-medium">
                  {t("defaults.open")}
                </span>
              ) : null}
            </div>
            <h2 className="m-0 text-[length:var(--fs-card-title)] font-extrabold leading-[1.15] tracking-[-0.015em]">{t(`defaults.${row.key}.title`, values)}</h2>
            <p className="m-0 text-[length:var(--fs-body-md)] leading-[1.45]">{t(`defaults.${row.key}.body`, values)}</p>
            <p className="ah-meta ah-meta--exact m-0">{typeof row.value === "string" ? row.value : t(`defaults.value.${row.value.key}`, values)}</p>
            <p className="m-0 border-t border-dashed border-[color:var(--ink-a30)] pt-2 text-[length:var(--fs-body-xs)] font-semibold">{t("defaults.chosen")}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
