import { setLogWindow } from "@ahand/sdk";
import { createPublicClient, defineChain, fallback, http, type Chain, type PublicClient, type Transport } from "viem";

import { knownChain } from "../config/chains";
import { pollMsOf, type ChainConfig } from "../config/schema";
import { ccipReadIsHere } from "./ccip";

/**
 * One viem chain and one public client per configured chain. Pure: the
 * configuration is passed in, so tests build clients for their own anvil. `chain/index.ts` makes
 * the app's one set from the build configuration.
 */

/**
 * The viem chain a configuration describes: viem's own description of its id (config/chains.ts),
 * with the configuration's RPC URLs in place of viem's public ones. The name, currency, explorer,
 * pace, Multicall3, ENS and Base's OP Stack formatters are viem's. Throws for an id aHand does not
 * know (the configuration was refused before that).
 */
export function chainOf(chain: Pick<ChainConfig, "id" | "rpcUrls">): Chain {
  const known = knownChain(chain.id);
  if (!known) throw new Error(`chain ${chain.id} is not one aHand knows`);
  return defineChain({ ...known, rpcUrls: { default: { http: chain.rpcUrls } } });
}

/** How each request of a transport is tried: viem's default is 10 s and three retries. */
export interface TransportTiming {
  timeout?: number;
  retryCount?: number;
}

/**
 * The block watcher's timing: one read of the latest block gets 4 s and one retry.
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
