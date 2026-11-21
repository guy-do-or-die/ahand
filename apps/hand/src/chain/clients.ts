import { setLogWindow } from "@ahand/sdk";
import { createPublicClient, defineChain, fallback, http, type Chain, type PublicClient, type Transport } from "viem";

import { pollMsOf, type ChainConfig } from "../config/schema";
import { ccipReadIsHere } from "./ccip";

/**
 * One viem chain and one public client per configured chain (ARCHITECTURE §7). Pure: the
 * configuration is passed in, so tests build clients for their own anvil. `chain/index.ts` makes
 * the app's one set from the build configuration.
 */

/**
 * The viem chain a configuration describes. Its currency is ether on every chain aHand runs on.
 * Its `blockTime` is the chain's real pace (the SDK's `findBlockAt` guesses with it), not how often
 * the app polls (`pollMsOf`).
 */
export function chainOf(chain: ChainConfig): Chain {
  return defineChain({
    id: chain.id,
    name: chain.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: chain.rpcUrls } },
    blockTime: chain.blockTimeMs,
    testnet: chain.testnet ?? chain.local,
    ...(chain.explorer ? { blockExplorers: { default: { name: new URL(chain.explorer).host, url: chain.explorer } } } : {}),
  });
}

/** How each request of a transport is tried: viem's default is 10 s and three retries. */
export interface TransportTiming {
  timeout?: number;
  retryCount?: number;
}

/**
 * The block watcher's timing (FINDINGS E-5): one read of the latest block gets 4 s and one retry.
 * With viem's defaults (10 s, three retries) an RPC that hangs was noticed only after about 40 s,
 * and the Hand view went on saying "open" all that time.
 */
export const WATCH_TIMING: Required<TransportTiming> = { timeout: 4_000, retryCount: 1 };

/** The RPC transport: the first URL, the others as fallbacks in order. */
export function transportOf(chain: ChainConfig, timing: TransportTiming = {}): Transport {
  const [first, ...rest] = chain.rpcUrls;
  if (!first) throw new Error("a chain needs at least one RPC URL");
  const one = (url: string) => http(url, timing);
  return rest.length === 0 ? one(first) : fallback([one(first), ...rest.map(one)], timing.retryCount === undefined ? {} : { retryCount: timing.retryCount });
}

/**
 * A public client that polls at the chain's polling interval (`pollMsOf`). Its `ccipRead` names
 * viem's CCIP-Read helper (./ccip.ts), so the helper ships with the chain layer and a failed call
 * on any screen never asks the site for one more file; with the helper present the setting is
 * viem's default. Where the chain names a `logWindow`, the client's log reads start at it (the
 * SDK's `setLogWindow`), so the first read on Base Sepolia is not a refused one of 2 000 blocks.
 */
export function publicClientOf(chain: ChainConfig, timing: TransportTiming = {}): PublicClient {
  const client = createPublicClient({ chain: chainOf(chain), transport: transportOf(chain, timing), pollingInterval: pollMsOf(chain), ...(ccipReadIsHere ? {} : { ccipRead: false }) }) as PublicClient;
  if (chain.logWindow !== undefined) setLogWindow(client, chain.logWindow);
  return client;
}

/** The block watcher's own client: the same RPC, with WATCH_TIMING, so a dead network shows within seconds. */
export function watchClientOf(chain: ChainConfig): PublicClient {
  return publicClientOf(chain, WATCH_TIMING);
}

/** One client per chain id, for the SDK's `getHandFor`. */
export function clientsOf(chains: readonly ChainConfig[]): Record<number, PublicClient> {
  return Object.fromEntries(chains.map((chain) => [chain.id, publicClientOf(chain)]));
}
