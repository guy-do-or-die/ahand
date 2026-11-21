import type { Cost, PriceSnapshot } from "@ahand/sdk";

import { clsx } from "../lib/clsx";
import { useLang, useLens } from "./ambient";
import { Disclose } from "./Disclose";
import { count, day } from "./format";
import { useWords } from "./words";

export interface CostLineProps {
  /** The SDK's `costOf(gas, prices, l1Fee)`. */
  cost: Cost;
  /** The dated snapshot the cost was worked out from; its date always stands on the line. */
  prices: PriceSnapshot;
  /** The gas the estimate used, for the lens. */
  gas?: bigint;
  className?: string;
}

/**
 * What an action costs, in money. The calm view says the fee on this site's network alone,
 * "network fee about $0.003"; the lens adds what it would cost on Ethereum, the date of the
 * prices and, behind a disclosure, the gas units and gwei in mono.
 */
export function CostLine({ cost, prices, gas, className }: CostLineProps) {
  const lang = useLang();
  const words = useWords().cost;
  const lens = useLens();
  const point = (text: string) => (lang === "ru" ? text.replace(".", ",") : text);
  // The snapshot's date is a calendar day; noon UTC keeps it the same day in every time zone.
  const date = day(Date.parse(`${prices.date}T12:00:00Z`) / 1000, lang, "UTC");
  if (!lens) {
    return (
      <div className={clsx("ah-cost", className)}>
        <p className="ah-label" style={{ margin: 0 }}>
          {words.calm(point(cost.base.usd))}
        </p>
      </div>
    );
  }
  return (
    <div className={clsx("ah-cost", className)}>
      <p className="ah-label" style={{ margin: 0 }}>
        {words.line(point(cost.base.usd), point(cost.ethereum.usd))} · {words.asOf(date)}
      </p>
      <Disclose label={words.how}>
        {gas !== undefined ? <span className="ah-meta">gas {count(gas)}</span> : null}
        <span className="ah-meta">
          Base {prices.base.gwei} gwei · {cost.base.eth} ETH
        </span>
        <span className="ah-meta">
          Ethereum {prices.ethereum.gwei} gwei · {cost.ethereum.eth} ETH
        </span>
        <span className="ah-meta">
          ETH ${count(Math.round(prices.ethUsd))} · {prices.date}
        </span>
        <span className="ah-meta">{prices.source}</span>
      </Disclose>
    </div>
  );
}
