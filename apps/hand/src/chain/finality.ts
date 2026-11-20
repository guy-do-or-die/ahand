import { finalityOf } from "@ahand/sdk";
import { BlockNotFoundError, TransactionReceiptNotFoundError, type Hex, type PublicClient, type TransactionReceipt } from "viem";

/**
 * How far a sent action has got, in the four states of UX-SPEC §2 and D-52:
 * Sent → In a block → Recorded on Ethereum (the chain's `safe` tag) → Final (`finalized`).
 * On the local stand, anvil runs with `--slots-in-an-epoch 1`, so the same code reads real tags
 * one and two blocks later; the screen tags those two steps LOCAL STAND-IN.
 *
 * A block can still be replaced before it is safe. Until then every look re-reads the block at
 * the receipt's height and compares its hash; a different hash means the action fell out of the
 * chain, and the state goes back to Sent while the same hash is watched again. Nothing is ever
 * sent again from here.
 */

export type Reached = "sent" | "in-block" | "safe" | "final";

export interface Progress {
  reached: Reached;
  hash: Hex;
  receipt?: TransactionReceipt;
  /** Set on the look that found the block replaced. */
  reorged?: boolean;
}

/** Where a landed action stands now, or "reorged" when its block is no longer in the chain. */
export async function standingOf(
  client: PublicClient,
  landed: { blockNumber: bigint; blockHash: Hex },
  checkHash = true,
): Promise<"in-block" | "safe" | "final" | "reorged"> {
  if (checkHash) {
    try {
      const block = await client.getBlock({ blockNumber: landed.blockNumber });
      if (block.hash !== landed.blockHash) return "reorged";
    } catch (error) {
      if (error instanceof BlockNotFoundError) return "reorged";
      throw error;
    }
  }
  return finalityOf(client, landed.blockNumber);
}

/** The receipt of a hash, or undefined while it is not in a block. */
export async function receiptOrNothing(client: PublicClient, hash: Hex): Promise<TransactionReceipt | undefined> {
  try {
    return await client.getTransactionReceipt({ hash });
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) return undefined;
    throw error;
  }
}

export interface FollowOptions {
  /** Waits until the next block is worth a look (a poll interval, or the block watcher's next tip). */
  tick: () => Promise<void>;
  onProgress?: (progress: Progress) => void;
  /** Stops following; the returned promise then rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Resolve at this state instead of following to the end. Default "final". */
  until?: Reached;
}

const ORDER: readonly Reached[] = ["sent", "in-block", "safe", "final"];
const atLeast = (reached: Reached, goal: Reached) => ORDER.indexOf(reached) >= ORDER.indexOf(goal);

function stopIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("stopped");
}

/**
 * Follows one hash from Sent to `until` (default Final) and resolves with the last receipt read.
 * A network error during a look is not a state: the look is tried again on the next tick.
 */
export async function follow(client: PublicClient, hash: Hex, options: FollowOptions): Promise<{ reached: Reached; receipt: TransactionReceipt }> {
  const { tick, onProgress, signal, until = "final" } = options;
  let reorged = false;
  for (;;) {
    // Sent: wait for the receipt of this very hash.
    onProgress?.({ reached: "sent", hash, ...(reorged ? { reorged } : {}) });
    let receipt: TransactionReceipt | undefined;
    while (!receipt) {
      stopIfAborted(signal);
      receipt = await receiptOrNothing(client, hash).catch(() => undefined);
      if (!receipt) await tick();
    }
    let reached: Reached = "in-block";
    onProgress?.({ reached, hash, receipt });
    if (atLeast(reached, until)) return { reached, receipt };

    // In a block: look again on every tick, checking the block's hash until it is safe.
    reorged = false;
    while (!reorged) {
      await tick();
      stopIfAborted(signal);
      let standing: Awaited<ReturnType<typeof standingOf>>;
      try {
        standing = await standingOf(client, receipt, !atLeast(reached, "safe"));
      } catch {
        continue;
      }
      if (standing === "reorged") {
        reorged = true;
        break;
      }
      // A tag that lags behind an earlier look never moves the state back.
      if (ORDER.indexOf(standing) > ORDER.indexOf(reached)) {
        reached = standing;
        onProgress?.({ reached, hash, receipt });
      }
      if (atLeast(reached, until)) return { reached, receipt };
    }
  }
}
