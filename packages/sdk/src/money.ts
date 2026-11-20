import { formatEther, parseAbi, type Address, type Hex, type PublicClient } from "viem";

/**
 * What an action costs in money, from gas and a dated price snapshot (`prices.json`, the fee study
 * of 2026-11-10). Shown on the human layer as "costs about $0.003 on Base · $0.15 on Ethereum",
 * always with the snapshot's date; gas and gwei stay in the lens.
 *
 *   on Base       gas × gwei(Base) + the L1 data fee, if known (OP Stack: `l1FeeOf`)
 *   on Ethereum   gas × gwei(Ethereum)
 *
 * Dollars are ETH × the snapshot's ETH price. These are estimates from one day's prices, never a quote.
 */

/** A dated price snapshot; always shown with its date. */
export interface PriceSnapshot {
  date: string;
  ethUsd: number;
  base: { gwei: number };
  ethereum: { gwei: number };
  source: string;
}

export interface Cost {
  base: { eth: string; usd: string };
  ethereum: { eth: string; usd: string };
}

/** Wei per gas for a price in gwei, which may be a fraction (Base runs at thousandths). */
function weiPerGas(gwei: number): bigint {
  if (!Number.isFinite(gwei) || gwei < 0) throw new Error(`a gas price is a number of gwei from 0 up, not ${gwei}`);
  return BigInt(Math.round(gwei * 1e9));
}

/**
 * Dollars as people read them: cents from one dollar up, two significant figures below it, so a
 * fraction of a cent is shown as it is ("0.0031") and never rounded to nothing.
 */
export function usdText(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`an amount of dollars is a number from 0 up, not ${usd}`);
  if (usd === 0) return "0";
  const rounded = Number(usd.toPrecision(2));
  if (rounded >= 1) return usd.toFixed(2);
  const decimals = 1 - Math.floor(Math.log10(rounded));
  return rounded.toFixed(decimals).replace(/0+$/, "");
}

function priced(wei: bigint, ethUsd: number): { eth: string; usd: string } {
  return { eth: formatEther(wei), usd: usdText((Number(wei) / 1e18) * ethUsd) };
}

export function costOf(gas: bigint, prices: PriceSnapshot, l1Fee?: bigint): Cost {
  if (gas < 0n) throw new Error("gas is a number from 0 up");
  if (l1Fee !== undefined && l1Fee < 0n) throw new Error("an L1 fee is a number from 0 up");
  if (!Number.isFinite(prices.ethUsd) || prices.ethUsd < 0) throw new Error("the snapshot's ETH price is a number from 0 up");
  return {
    base: priced(gas * weiPerGas(prices.base.gwei) + (l1Fee ?? 0n), prices.ethUsd),
    ethereum: priced(gas * weiPerGas(prices.ethereum.gwei), prices.ethUsd),
  };
}

/** The OP Stack `GasPriceOracle` predeploy, the same address on Base, Optimism and every OP chain. */
export const GAS_PRICE_ORACLE: Address = "0x420000000000000000000000000000000000000F";
const oracleAbi = parseAbi(["function getL1Fee(bytes _data) view returns (uint256)"]);

/**
 * The L1 data fee, in wei, that an OP Stack chain charges for a transaction of these bytes (the
 * serialized transaction; the oracle adds room for a signature itself). Undefined where the chain
 * has no oracle (Ethereum, the local stand); an oracle that is there and fails throws.
 */
export async function l1FeeOf(client: PublicClient, txBytes: Hex): Promise<bigint | undefined> {
  const code = await client.getCode({ address: GAS_PRICE_ORACLE });
  if (code === undefined || code === "0x") return undefined;
  return client.readContract({ address: GAS_PRICE_ORACLE, abi: oracleAbi, functionName: "getL1Fee", args: [txBytes] });
}
