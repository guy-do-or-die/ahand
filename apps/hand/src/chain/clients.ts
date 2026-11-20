import { createPublicClient, defineChain, fallback, http, type Chain, type PublicClient, type Transport } from "viem";

import type { ChainConfig } from "../config/schema";

/**
 * One viem chain and one public client per configured chain (ARCHITECTURE §7). Pure: the
 * configuration is passed in, so tests build clients for their own anvil. `chain/index.ts` makes
 * the app's one set from the build configuration.
 */

/** The viem chain a configuration describes. Its currency is ether on every chain aHand runs on. */
export function chainOf(chain: ChainConfig): Chain {
  return defineChain({
    id: chain.id,
    name: chain.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: chain.rpcUrls } },
    blockTime: chain.blockTimeMs,
    testnet: chain.local,
  });
}

/** The RPC transport: the first URL, the others as fallbacks in order. */
export function transportOf(chain: ChainConfig): Transport {
  const [first, ...rest] = chain.rpcUrls;
  if (!first) throw new Error("a chain needs at least one RPC URL");
  return rest.length === 0 ? http(first) : fallback([http(first), ...rest.map((url) => http(url))]);
}

/** A public client that polls at the chain's block time. */
export function publicClientOf(chain: ChainConfig): PublicClient {
  return createPublicClient({ chain: chainOf(chain), transport: transportOf(chain), pollingInterval: chain.blockTimeMs }) as PublicClient;
}

/** One client per chain id, for the SDK's `getHandFor`. */
export function clientsOf(chains: readonly ChainConfig[]): Record<number, PublicClient> {
  return Object.fromEntries(chains.map((chain) => [chain.id, publicClientOf(chain)]));
}
