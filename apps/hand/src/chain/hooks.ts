import { costOf, l1FeeOf, readHand, readPending, type Call, type Cost, type CoreRefusal, type Hand, type HandState, type HandView } from "@ahand/sdk";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { serializeTransaction, type Address, type Hex, type PublicClient } from "viem";

import { config as app } from "../config";
import { clientsOf, watchClientOf } from "./clients";
import { standingOf, type Reached } from "./finality";
import { simulateAll } from "./simulate";
import { BlockWatcher, latestTip, type ChainStatus, type Tip } from "./watcher";

/**
 * The chain hooks screens use (ARCHITECTURE §7). One public client and one block watcher per
 * configured chain; every hook that needs "now" takes it from the watcher's latest block. Nothing
 * here reads the device's clock (the clock guard checks).
 */

/** One viem public client per configured chain. */
export const CLIENTS: Record<number, PublicClient> = clientsOf([app.chain]);

const watchers = new Map<number, BlockWatcher>();

/**
 * The block watcher of a chain (the build's own by default). It reads through its own client
 * with a short timeout and one retry (clients.ts WATCH_TIMING), so "can't reach the network"
 * shows within seconds rather than after viem's 40.
 */
export function watcherOf(chainId: number = app.chain.id): BlockWatcher {
  let watcher = watchers.get(chainId);
  if (!watcher) {
    const client = chainId === app.chain.id ? watchClientOf(app.chain) : clientOf(chainId);
    const blockTimeMs = chainId === app.chain.id ? app.chain.blockTimeMs : 2000;
    watcher = new BlockWatcher(latestTip(client), { intervalMs: blockTimeMs });
    watchers.set(chainId, watcher);
  }
  return watcher;
}

/** The public client of a configured chain; throws for any other. */
export function clientOf(chainId: number = app.chain.id): PublicClient {
  const client = CLIENTS[chainId];
  if (!client) throw new Error(`chain ${chainId} is not configured in this build`);
  return client;
}

/** The chain's status: its latest block (none before the first), stale and offline flags. */
export function useChainStatus(chainId: number = app.chain.id): ChainStatus {
  const watcher = watcherOf(chainId);
  return useSyncExternalStore(watcher.subscribe, watcher.status, watcher.status);
}

export interface Now {
  number: bigint;
  /** Seconds: compare with a Hand's expiry exactly as Core does. */
  timestamp: number;
  /** Blocks stopped arriving: what depends on "now" may be behind. */
  stale: boolean;
}

/** The network's time: the latest block's timestamp and number, or undefined before the first block. */
export function useNow(chainId: number = app.chain.id): Now | undefined {
  const { tip, stale } = useChainStatus(chainId);
  return useMemo(() => (tip ? { number: tip.number, timestamp: tip.timestamp, stale } : undefined), [tip, stale]);
}

export interface BlockRead<T> {
  data?: T;
  error?: unknown;
  /** True until the first answer (or error) for the current key. */
  loading: boolean;
  /** The block whose arrival triggered the read that gave `data`. */
  atBlock?: bigint;
}

/**
 * Runs `read` when `key` changes and again on every new block, keeping the last answer while a
 * new one is on its way. Answers that come back out of order are dropped. `key` undefined: idle.
 */
export function useBlockRead<T>(key: string | undefined, read: (tip: Tip) => Promise<T>, chainId: number = app.chain.id): BlockRead<T> {
  const { tip } = useChainStatus(chainId);
  const [state, setState] = useState<BlockRead<T> & { key?: string }>({ loading: key !== undefined });
  const ask = useRef(0);
  const reader = useRef(read);
  reader.current = read;

  useEffect(() => {
    if (key === undefined || !tip) return;
    const mine = ++ask.current;
    reader.current(tip).then(
      (data) => {
        if (mine === ask.current) setState({ key, data, loading: false, atBlock: tip.number });
      },
      (error: unknown) => {
        if (mine === ask.current) setState((before) => ({ ...(before.key === key ? before : {}), key, error, loading: false }));
      },
    );
  }, [key, tip]);

  if (key === undefined) return { loading: false };
  if (state.key !== key) return { loading: true };
  return state;
}

export interface HandRead {
  view: HandView;
  hand: Hand;
  /** `stateAt(now)` at the latest block; undefined before the first block. */
  state?: HandState;
}

/** A Hand from Core's `hands(id)`, read again on every block, with its state at the network's time. */
export function useHand(core: Address | undefined, handId: bigint | undefined, chainId: number = app.chain.id): BlockRead<HandRead> {
  const now = useNow(chainId);
  const key = core && handId !== undefined ? `${chainId}:${core}:${handId}` : undefined;
  const read = useBlockRead(key, async () => readHand(clientOf(chainId), core!, handId!), chainId);
  if (!read.data) return read as BlockRead<HandRead>;
  const { view, hand, stateAt } = read.data;
  return { ...read, data: { view, hand, ...(now ? { state: stateAt(now.timestamp) } : {}) } };
}

/** What Core holds for a payee in a token (`pending`), read again on every block. */
export function usePending(core: Address | undefined, token: Address | undefined, payee: Address | undefined, chainId: number = app.chain.id): BlockRead<bigint> {
  const key = core && token && payee ? `${chainId}:${core}:${token}:${payee}` : undefined;
  return useBlockRead(key, () => readPending(clientOf(chainId), core!, token!, payee!), chainId);
}

/**
 * Where a landed action stands, looked at again on every block: In a block, Recorded on Ethereum
 * (safe), Final, or "reorged" when the block at its height is no longer the one it landed in.
 * The block's hash is checked until it is safe.
 */
export function useFinality(landed: { blockNumber: bigint; blockHash: Hex } | undefined, chainId: number = app.chain.id): BlockRead<Exclude<Reached, "sent"> | "reorged"> {
  const key = landed ? `${chainId}:${landed.blockNumber}:${landed.blockHash}` : undefined;
  const best = useRef<Exclude<Reached, "sent"> | "reorged" | undefined>(undefined);
  const read = useBlockRead(
    key,
    async () => {
      const before = best.current;
      const checkHash = before !== "safe" && before !== "final";
      const standing = await standingOf(clientOf(chainId), landed!, checkHash);
      // Once final it stays final; a tag that lags never moves it back.
      if (before === "final" || (before === "safe" && standing === "in-block")) return before;
      best.current = standing;
      return standing;
    },
    chainId,
  );
  useEffect(() => {
    best.current = undefined;
  }, [key]);
  return read;
}

export type CostRead =
  | { status: "idle" | "checking" }
  | { status: "ok"; gas: bigint; cost: Cost; l1Fee?: bigint; /** Only the first call could be checked ahead. */ partial: boolean }
  | { status: "refused"; step: number; refusal: CoreRefusal }
  | { status: "failed"; step: number; message: string }
  | { status: "offline" };

/**
 * What these calls would cost, in money (D-28: ETH only): simulated first, in order, as `from`
 * would send them, then priced with the build's dated snapshot (`costOf`). On a chain with
 * Ethereum behind it the L1 data fee of each call comes from the OP Stack oracle. A refusal is
 * returned instead of a price, so a screen says it before anyone presses anything.
 */
export function useCost(calls: readonly Call[] | undefined, from: Address | undefined, chainId: number = app.chain.id): CostRead {
  const key = calls && calls.length > 0 && from ? JSON.stringify([chainId, from, calls], (_, v) => (typeof v === "bigint" ? v.toString() : v)) : undefined;
  const [state, setState] = useState<{ key?: string; read: CostRead }>({ read: { status: "idle" } });

  useEffect(() => {
    if (!key) return;
    let live = true;
    setState({ key, read: { status: "checking" } });
    (async (): Promise<CostRead> => {
      const client = clientOf(chainId);
      let simulation: Awaited<ReturnType<typeof simulateAll>>;
      try {
        simulation = await simulateAll(client, calls!, from!);
      } catch {
        return { status: "offline" };
      }
      if (!simulation.ok) {
        return "refusal" in simulation
          ? { status: "refused", step: simulation.step, refusal: simulation.refusal }
          : { status: "failed", step: simulation.step, message: simulation.failure };
      }
      const gas = simulation.gas.reduce((sum, g) => sum + g, 0n);
      let l1Fee: bigint | undefined;
      if (chainId === app.chain.id && app.chain.hasL1) {
        try {
          const fees = await Promise.all(
            calls!.map((call) => l1FeeOf(client, serializeTransaction({ chainId, to: call.to, data: call.data, value: call.value ?? 0n, gas: 0n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, nonce: 0 }))),
          );
          l1Fee = fees.every((fee) => fee !== undefined) ? fees.reduce<bigint>((sum, fee) => sum + fee!, 0n) : undefined;
        } catch {
          l1Fee = undefined; // the price without the L1 part is still shown, with its date
        }
      }
      return { status: "ok", gas, cost: costOf(gas, app.prices, l1Fee), ...(l1Fee !== undefined ? { l1Fee } : {}), partial: !simulation.complete };
    })().then((read) => {
      if (live) setState({ key, read });
    });
    return () => {
      live = false;
    };
  }, [key]); // `key` carries calls, from and chain

  if (!key) return { status: "idle" };
  return state.key === key ? state.read : { status: "checking" };
}
