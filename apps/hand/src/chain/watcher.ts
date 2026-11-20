import type { Hex, PublicClient } from "viem";

/**
 * The app's one clock (D-61, ARCHITECTURE §7 Time): the latest block of a chain, polled at the
 * chain's block time. Every "now" a screen needs (open or time's up, days left, expiry chips, the
 * ten-minute warning) is `tip.timestamp`; nothing here or in the hooks reads the device's clock.
 *
 * Staleness is counted in polls, not in seconds of the device's clock: after `staleAfter` polls in
 * a row that brought no new block, the tip is marked stale (the network may have stopped, or this
 * RPC fell behind). A poll that fails counts as one with no new block, so "stale" comes within a
 * bounded time whether the RPC answers or not. A poll that fails, or that gets no answer within
 * `readTimeoutMs`, marks the chain offline at once, until one succeeds again (FINDINGS E-5: an RPC
 * that hangs must not keep a Hand "open"). The last tip read stays, so a screen can say which
 * block it last saw. Before the first block there is no tip at all, and the screens claim nothing
 * that depends on "now".
 */

/** The latest block as last read. */
export interface Tip {
  number: bigint;
  /** Seconds, as Core compares them with `block.timestamp`. */
  timestamp: number;
  hash: Hex;
}

export interface ChainStatus {
  /** Undefined until the first block arrives. */
  tip?: Tip;
  /** No new block for `staleAfter` polls in a row (a failed poll counts as one). */
  stale: boolean;
  /** The last poll failed or got no answer in time: the network can't be reached right now. */
  offline: boolean;
}

/** Polls with no new block before the tip counts as stale: five, and at least ten blocks' worth of 1 s. */
export function staleAfterPolls(intervalMs: number): number {
  return Math.max(5, Math.ceil(10_000 / Math.max(1, intervalMs)));
}

/** Reads the latest block of a client as a `Tip`. */
export function latestTip(client: PublicClient): () => Promise<Tip> {
  return async () => {
    const block = await client.getBlock({ blockTag: "latest" });
    if (block.number === null || block.hash === null) throw new Error("the latest block has no number");
    return { number: block.number, timestamp: Number(block.timestamp), hash: block.hash };
  };
}

export interface BlockWatcherOptions {
  /** How often to poll, in milliseconds: the chain's block time. */
  intervalMs: number;
  staleAfter?: number;
  /** A read with no answer by then counts as failed: the chain is marked offline. Default 5 s. */
  readTimeoutMs?: number;
}

/** How long one read of the tip may take before the chain counts as unreachable. */
export const READ_TIMEOUT_MS = 5_000;

class ReadTimeout extends Error {
  constructor(ms: number) {
    super(`no answer for the latest block within ${ms} ms`);
    this.name = "ReadTimeout";
  }
}

/** `read()`, or a ReadTimeout once `ms` pass with no answer. A late answer is dropped. */
function within<T>(read: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ReadTimeout(ms)), ms);
    read().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * One watcher per chain. It polls only while someone listens, and every listener sees the same
 * status object until something changes (so `useSyncExternalStore` re-renders only on news).
 */
export class BlockWatcher {
  private readonly read: () => Promise<Tip>;
  private readonly intervalMs: number;
  private readonly staleAfter: number;
  private readonly readTimeoutMs: number;
  private readonly listeners = new Set<() => void>();
  private current: ChainStatus = { stale: false, offline: false };
  private quiet = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private polling: Promise<void> | undefined;

  constructor(read: () => Promise<Tip>, options: BlockWatcherOptions) {
    this.read = read;
    this.intervalMs = options.intervalMs;
    this.staleAfter = options.staleAfter ?? staleAfterPolls(options.intervalMs);
    this.readTimeoutMs = options.readTimeoutMs ?? READ_TIMEOUT_MS;
  }

  /** The status now. The same object until it changes. */
  readonly status = (): ChainStatus => this.current;

  /** Listens for changes; the first listener starts polling, the last one to leave stops it. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) void this.poll();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.halt();
    };
  };

  /** Reads the latest block now, without waiting for the next poll. */
  refresh(): Promise<void> {
    return this.poll();
  }

  /** Resolves with the first tip at or after `number` (or with the next tip when none is given). */
  nextTip(after?: bigint): Promise<Tip> {
    return new Promise((resolve) => {
      const target = after ?? (this.current.tip ? this.current.tip.number + 1n : 0n);
      const check = () => {
        const tip = this.current.tip;
        if (tip && tip.number >= target) {
          stop();
          resolve(tip);
        }
      };
      const stop = this.subscribe(check);
      check();
    });
  }

  private halt(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private set(next: ChainStatus): void {
    const before = this.current;
    if (before.tip === next.tip && before.stale === next.stale && before.offline === next.offline) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener();
  }

  private poll(): Promise<void> {
    if (this.polling) return this.polling;
    this.halt();
    this.polling = (async () => {
      try {
        const tip = await within(this.read, this.readTimeoutMs);
        const before = this.current.tip;
        const news = !before || tip.number !== before.number || tip.hash !== before.hash;
        this.quiet = news ? 0 : this.quiet + 1;
        this.set({ tip: news ? tip : before, stale: this.quiet >= this.staleAfter, offline: false });
      } catch {
        // No new block came with this poll either: it counts toward stale, and the chain is offline now.
        this.quiet += 1;
        this.set({ ...this.current, stale: this.quiet >= this.staleAfter, offline: true });
      } finally {
        this.polling = undefined;
        if (this.listeners.size > 0) this.timer = setTimeout(() => void this.poll(), this.intervalMs);
      }
    })();
    return this.polling;
  }
}
