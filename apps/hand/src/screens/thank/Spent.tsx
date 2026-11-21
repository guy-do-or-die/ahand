import { useEffect, useState } from "react";
import { formatEther, formatGwei, type Hex, type TransactionReceipt } from "viem";

import { clientOf } from "../../chain";
import { config } from "../../config";
import { t, useLang } from "../../i18n";
import { TID } from "../../testids";
import { Disclose, Proof, count, day, minute } from "../../ui";
import { spentOf, totalSpent, usdOfWei, type Spent } from "./model";

/** One transaction's cost, and the time of the block that holds it once that block was read. */
interface Row extends Spent {
  timestamp?: number;
}

type Reading = { status: "reading" } | { status: "read"; rows: Row[] } | { status: "unread" };

/**
 * The receipts of the transactions this thanks took, in the order they were sent. The receipt
 * already in hand (the one the send waited for) is used as it is; any other is asked of the
 * chain by its hash. Each block is read once more for its time: the chain's, never the device's.
 */
function useSpent(sent: readonly Hex[], inHand: TransactionReceipt | undefined, chainId: number): Reading {
  const [reading, setReading] = useState<Reading>({ status: "reading" });
  const hashes = sent.join(",");
  useEffect(() => {
    let live = true;
    const client = clientOf(chainId);
    setReading({ status: "reading" });
    Promise.all(
      (hashes ? (hashes.split(",") as Hex[]) : []).map(async (hash): Promise<Row> => {
        const receipt = inHand?.transactionHash === hash ? inHand : await client.getTransactionReceipt({ hash });
        const timestamp = await client.getBlock({ blockNumber: receipt.blockNumber }).then(
          (block) => Number(block.timestamp),
          () => undefined, // the cost stands without its time
        );
        return { ...spentOf(receipt), ...(timestamp !== undefined ? { timestamp } : {}) };
      }),
    ).then(
      (rows) => live && setReading({ status: "read", rows }),
      () => live && setReading({ status: "unread" }),
    );
    return () => {
      live = false;
    };
  }, [hashes, inHand, chainId]);
  return reading;
}

/**
 * What the thanks cost, after it landed: one sentence in dollars for everyone, and behind it the
 * transaction itself, from its receipt: who sent it, its block and time, the gas it used, the
 * price paid for it, and the fee in ETH and in dollars at the dated snapshot's ETH price. The
 * estimate shown before sending is gone by now; every number here is what the chain recorded.
 * A thanks that took two steps (the helper's account set up first) shows both and their sum.
 */
export function ThankSpent({ sent, inHand, chainId }: { sent: readonly Hex[]; inHand?: TransactionReceipt; chainId: number }) {
  const lang = useLang();
  const reading = useSpent(sent, inHand, chainId);
  if (sent.length === 0) return null;
  if (reading.status !== "read") {
    return (
      <p className="ah-label m-0" role="status" data-testid={TID.thank.spent} data-status={reading.status}>
        {t(reading.status === "reading" ? "thank.spent.reading" : "thank.spent.unread")}
      </p>
    );
  }

  const { rows } = reading;
  const prices = config.prices;
  const total = totalSpent(rows);
  const point = (text: string) => (lang === "ru" ? text.replace(".", ",") : text);
  const usd = (wei: bigint) => point(usdOfWei(wei, prices.ethUsd));
  // The snapshot's date is a calendar day; noon UTC keeps it the same day in every time zone.
  const date = day(Date.parse(`${prices.date}T12:00:00Z`) / 1000, lang, "UTC");
  const steps = rows.length > 1;

  return (
    <div className="flex flex-col" data-testid={TID.thank.spent} data-status="read" data-count={rows.length} data-gas-used={total.gasUsed.toString()} data-fee={total.fee.toString()}>
      <p className="ah-label m-0" data-testid={TID.thank.spentSentence}>
        {/* The price snapshot's date is the lens's, like the estimate's before sending. */}
        <Proof calm={t(steps ? "thank.spent.steps.calm" : "thank.spent.calm", { usd: usd(total.fee) })}>{t(steps ? "thank.spent.steps" : "thank.spent", { usd: usd(total.fee), date })}</Proof>
      </p>
      <Disclose label={t("thank.lens.tx")}>
        {rows.map((row, index) => (
          <div
            key={row.hash}
            className="flex flex-col gap-1"
            data-testid={TID.thank.spentTx}
            data-hash={row.hash}
            data-from={row.from}
            data-block={row.block.toString()}
            data-gas-used={row.gasUsed.toString()}
            data-fee={row.fee.toString()}
          >
            {steps ? (
              <span className="ah-label">
                {t("thank.step", { step: index + 1, of: rows.length })} · {t(index < rows.length - 1 ? "thank.step.setup" : "thank.step.thanks")}
              </span>
            ) : null}
            <span className="ah-meta ah-meta--exact break-all">{t("thank.lens.tx.hash", { hash: row.hash })}</span>
            <span className="ah-meta ah-meta--exact break-all">{t("thank.lens.tx.from", { from: row.from })}</span>
            <span className="ah-meta ah-meta--exact">
              {row.timestamp !== undefined
                ? t("thank.lens.tx.block", { block: count(row.block), time: minute(row.timestamp, lang) })
                : t("thank.lens.tx.blockOnly", { block: count(row.block) })}
            </span>
            <span className="ah-meta ah-meta--exact">{t("thank.lens.tx.gas", { gas: count(row.gasUsed), gwei: formatGwei(row.gasPrice) })}</span>
            {row.l1Fee !== undefined ? <span className="ah-meta ah-meta--exact">{t("thank.lens.tx.l1", { eth: formatEther(row.l1Fee) })}</span> : null}
            <span className="ah-meta ah-meta--exact">
              {t("thank.lens.tx.fee", { eth: formatEther(row.fee), usd: usd(row.fee), ethUsd: count(Math.round(prices.ethUsd)), date: prices.date })}
            </span>
          </div>
        ))}
        {config.chain.local ? <span className="ah-meta ah-meta--exact">{t("thank.lens.tx.local")}</span> : null}
      </Disclose>
    </div>
  );
}
