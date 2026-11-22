import { config } from "../../config";
import { t, useLang } from "../../i18n";
import { TID } from "../../testids";
import { Proof, percent, shortAddress } from "../../ui";

/**
 * "About these defaults": one row for each default of this experimental build that a person can
 * feel, each marked as chosen for this experiment and not by the project's owner. Rows whose
 * choice is still open say so. The mono line under each row is the setting as this build actually
 * has it, read from its configuration where the configuration holds it.
 */

interface Row {
  /** The catalogue key of its words: defaults.<key>.title and .body; also the row's anchor. */
  key: string;
  /** The choice is still open. */
  open?: boolean;
  /** The setting itself, in mono: exact data from this build, or the catalogue key that says it. */
  value: string | { key: string };
}

const { defaults, prices } = config;

/** Whether this build's relays are public ones, not a test relay on this computer (its words differ). */
export function relaysArePublic(relays: readonly string[]): boolean {
  return relays.some((url) => {
    try {
      return !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
    } catch {
      return true;
    }
  });
}

const ROWS: readonly Row[] = [
  { key: "d21", open: true, value: { key: "d21" } },
  { key: "d26a", open: true, value: `minClaimBps = ${defaults.minClaimBps}` },
  { key: "d26b", open: true, value: { key: "d26b" } },
  { key: "d26c", open: true, value: `payoutGasK = ${defaults.payoutGasK}` },
  { key: "d27", value: config.tokens.map((token) => `${token.symbol} ${shortAddress(token.address)}`).join(" · ") },
  { key: "d31", value: { key: "d31" } },
  { key: "d32", value: { key: "d32" } },
  { key: "d37", value: { key: "d37" } },
  { key: "d39", value: { key: "d39" } },
  { key: relaysArePublic(config.relays) ? "d40public" : "d40", value: config.relays.length ? `NIP-17 · ${config.relays.join(" · ")}` : { key: "d40none" } },
  { key: "d49", value: `${prices.date} · ETH $${prices.ethUsd} · BASE ${prices.base.gwei} GWEI · ETHEREUM ${prices.ethereum.gwei} GWEI` },
  { key: "d61", value: { key: "d61" } },
  { key: "d62", open: true, value: config.forwarder ? `forwarder = ${config.forwarder}` : { key: "d62none" } },
  { key: "d63", open: true, value: { key: "d63" } },
  { key: "d66", open: true, value: { key: "d66" } },
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
        {ROWS.map((row) => (
          <li key={row.key} id={row.key} data-testid={TID.about.default} data-value={row.key} data-key={row.key} className="ah-card flex flex-col gap-2 p-5">
            {row.open ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="inline-flex items-center rounded-[var(--r-chip)] border-[1.5px] border-dashed border-[color:var(--ink-a30)] px-2 py-[1px] text-[length:var(--fs-body-xs)] font-medium">
                  {t("defaults.open")}
                </span>
              </div>
            ) : null}
            <h2 className="m-0 text-[length:var(--fs-card-title)] font-extrabold leading-[1.15] tracking-[-0.015em]">{t(`defaults.${row.key}.title`, values)}</h2>
            <p className="m-0 text-[length:var(--fs-body-md)] leading-[1.45]">{t(`defaults.${row.key}.body`, values)}</p>
            <Proof>
              <p className="ah-meta ah-meta--exact m-0">{typeof row.value === "string" ? row.value : t(`defaults.value.${row.value.key}`, values)}</p>
            </Proof>
            <p className="m-0 border-t border-dashed border-[color:var(--ink-a30)] pt-2 text-[length:var(--fs-body-xs)] font-semibold">{t("defaults.chosen")}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
