import type { Hex, PublicClient } from "viem";

// Wave 1 stub: the signatures are the contract between packages (ARCHITECTURE §4);
// the module `sdk-words` writes the bodies in wave 2. The snapshot is in prices.json.

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

function notBuilt(name: string): never {
  throw new Error(`${name}: not built`);
}

export function costOf(_gas: bigint, _prices: PriceSnapshot, _l1Fee?: bigint): Cost {
  return notBuilt("costOf");
}

/** The OP Stack GasPriceOracle predeploy's L1 fee; undefined where it is absent. */
export function l1FeeOf(_client: PublicClient, _txBytes: Hex): Promise<bigint | undefined> {
  return notBuilt("l1FeeOf");
}
