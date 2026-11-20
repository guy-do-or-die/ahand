import { castLine, type Call, type Receipt } from "@ahand/sdk";
import type { Hex } from "viem";

import { config } from "../../config";
import { t, useLang } from "../../i18n";
import { TID } from "../../testids";
import { CopyRow, Disclose, Mark, ReceiptTable, count, receiptAmounts, shortAddress } from "../../ui";

/**
 * After the thank: who got what, from this transaction's own logs (`receiptOf`). The table gets
 * one `landed` flag per row, set as a second read of the chain's logs finds each row again; the
 * marker sweep of wave 5 is drawn from them inside the table. Each payout is said as what it is:
 * "left the contract for" (`Paid`: what left Core, not what arrived) or "is waiting for"
 * (`Pending`); never "received".
 */
export function ThankReceipt({
  receipt,
  landed,
  decimals,
  hash,
  before,
  chainId,
  handId,
}: {
  receipt: Receipt;
  landed: boolean[] | undefined;
  decimals: number;
  hash: Hex;
  before: boolean;
  chainId: number;
  handId: bigint;
}) {
  const lang = useLang();
  const payouts = receipt.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.eventName === "Paid" || row.eventName === "Pending");
  const block = receipt.rows[0]?.log.blockNumber;
  // Each payout as the receipt writes it: in cents, or every digit where cents would hide some (M-4).
  const amounts = payouts.map(({ row }) => row.amount ?? 0n);
  const written = receiptAmounts(
    amounts,
    amounts.reduce((sum, amount) => sum + amount, 0n),
    decimals,
    lang,
  );

  return (
    <section className="flex flex-col gap-4" data-testid={TID.thank.done} data-hash={hash}>
      <p className="m-0 flex items-start gap-3 text-[length:var(--fs-title-m)] font-extrabold leading-[1.08] tracking-[-0.03em]">
        <span aria-hidden="true" className="ah-hero--bow shrink-0">
          🙏
        </span>
        <span>{t(before ? "thank.done.before" : "thank.done")}</span>
      </p>

      <div data-testid={TID.thank.receipt} data-landed={landed ? landed.map(String).join(",") : ""}>
        <ReceiptTable rows={receipt.rows} {...(landed ? { landed } : {})} decimals={decimals} />
      </div>

      {payouts.length === 0 ? (
        <p className="ah-note m-0" data-testid={TID.thank.noMoney}>
          {t("thank.noMoney")}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {payouts.map(({ row, index }, at) => {
            const waiting = row.eventName === "Pending";
            const amount = written.rows[at]!;
            return (
              <li
                key={index}
                className="flex flex-col gap-1"
                data-testid={TID.thank.payout}
                data-kind={waiting ? "waiting" : "paid"}
                data-payee={row.payee}
                data-amount={(row.amount ?? 0n).toString()}
                data-landed={landed ? String(landed[index] === true) : ""}
              >
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {waiting ? <Mark kind="waiting" /> : <Mark kind="chain" source={<span className="ah-meta ah-meta--exact">{t("thank.lens.event", { event: row.eventName, block: count(row.log.blockNumber), index: row.log.logIndex })}</span>} />}
                  <span>{t(waiting ? "thank.waiting" : "thank.left", { amount, payee: shortAddress(row.payee ?? "") })}</span>
                </span>
                <span className="ah-meta ah-meta--exact break-all">{row.payee}</span>
                {waiting ? <span className="ah-label">{t("thank.waiting.why")}</span> : null}
              </li>
            );
          })}
        </ul>
      )}

      <Disclose label={t("thank.lens.events")} summary={block !== undefined ? `#${count(block)}` : undefined}>
        <ol className="m-0 flex list-none flex-col gap-1 p-0">
          {receipt.rows.map((row, index) => (
            <li key={index} className="ah-meta ah-meta--exact break-all" data-testid={TID.thank.receiptEvent} data-value={row.eventName}>
              {t("thank.lens.event", { event: row.eventName, block: count(row.log.blockNumber), index: row.log.logIndex })}
              {row.payee ? ` · ${row.payee}` : ""}
              {row.amount !== undefined ? ` · ${row.amount.toString()}` : ""}
            </li>
          ))}
          <li className="ah-meta ah-meta--exact break-all">tx {hash}</li>
        </ol>
      </Disclose>

      <a className="ah-quiet self-start no-underline" href={`/${chainId}/${handId.toString()}/proof`} data-testid={TID.thank.proof}>
        {t("thank.proof")}
      </a>
    </section>
  );
}

/** "Do it without us": the exact calls as `cast send` lines, the same bytes the swipe sends. */
export function WithoutUs({ calls }: { calls: Call[] }) {
  const rpc = config.chain.rpcUrls[0];
  return (
    <div data-testid={TID.thank.withoutUs}>
      <Disclose label={t("thank.withoutUs")}>
        <p className="ah-label m-0">{t("thank.withoutUs.lead")}</p>
        {calls.map((call, index) => (
          <CopyRow key={index} value={castLine(call, rpc ? { rpc } : {})} display={`${index + 1}. ${castLine(call, { rpc: "$RPC" }).slice(0, 72)}…`} />
        ))}
        <a className="ah-label" href="/without-us">
          {t("thank.withoutUs.page")}
        </a>
      </Disclose>
    </div>
  );
}
