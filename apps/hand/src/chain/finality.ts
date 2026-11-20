import { finalityOf } from "@ahand/sdk";
import { BlockNotFoundError, TransactionNotFoundError, TransactionReceiptNotFoundError, type Address, type Hex, type PublicClient, type TransactionReceipt } from "viem";

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
 *
 * A hash alone can be followed forever: a wallet may speed a transaction up (same nonce, new
 * hash), cancel it, or the pool may drop it, and the page may never have learnt the hash at all
 * (the wallet's answer was lost). So a send also keeps who sent it, the account's nonce taken just
 * before the wallet was asked, and the block it was asked at (`Sent`). `fateOf` reads those:
 * while nothing at that nonce is in a block, it waits; once the nonce is used and the hash has no
 * receipt, the action's own effect on the chain decides (`Probe`, supplied by each screen): found,
 * the action landed in another transaction; not found, nothing from this action left the account.
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

/**
 * Looks for an action's own effect on the chain from `fromBlock` on (a `Raised` with this raiser,
 * root key and description; a `Funded` for this Hand; a `Withdrawn` for this payee…) and returns
 * the hash of the transaction that made it, or undefined when there is none.
 */
export type Probe = (client: PublicClient, since: { fromBlock: bigint; from: Address }) => Promise<Hex | undefined>;

/** What a page knows of one send. Every field may be missing on a record from an older build. */
export interface Sent {
  hash?: Hex;
  /** The account that was asked to send. */
  from?: Address;
  /** That account's `pending` transaction count, read just before the wallet was asked. */
  nonce?: number;
  /** The latest block then. */
  fromBlock?: number;
}

export type Fate = { state: "waiting" } | { state: "landed"; receipt: TransactionReceipt } | { state: "dropped" };

/**
 * How many blocks a send may stay unknown to the node, with nothing at its nonce in the node's
 * pool, before it is called dropped. Its effect is still looked for first.
 */
export const DROP_BLOCKS = 10;

/** Thrown by `follow` when the hash will never land and the action's effect is not on the chain. */
export class DroppedError extends Error {
  constructor(readonly hash: Hex | undefined) {
    super("nothing from this send is on the chain, and its nonce is used or free for good");
    this.name = "DroppedError";
  }
}

async function poolKnows(client: PublicClient, hash: Hex): Promise<boolean> {
  try {
    await client.getTransaction({ hash });
    return true;
  } catch (error) {
    if (error instanceof TransactionNotFoundError) return false;
    throw error;
  }
}

/**
 * Where one send stands, read once (no waiting): landed (with the receipt of whichever
 * transaction carried it), dropped (nothing from it left the account), or still waiting. A send
 * with no account or nonce (an older record) can only wait for its hash.
 */
export async function fateOf(client: PublicClient, sent: Sent, probe?: Probe, dropAfter: number = DROP_BLOCKS): Promise<Fate> {
  if (sent.hash) {
    const receipt = await receiptOrNothing(client, sent.hash);
    if (receipt) return { state: "landed", receipt };
  }
  if (!sent.from || sent.nonce === undefined) return { state: "waiting" };
  const latest = await client.getTransactionCount({ address: sent.from, blockTag: "latest" });
  if (latest <= sent.nonce) {
    // Nothing at this nonce is in a block. Wait while the node holds the hash or anything at this
    // nonce, and for `dropAfter` blocks after the send in any case.
    const [pending, tip, known] = await Promise.all([
      client.getTransactionCount({ address: sent.from, blockTag: "pending" }),
      client.getBlockNumber({ cacheTime: 0 }),
      sent.hash ? poolKnows(client, sent.hash) : Promise.resolve(false),
    ]);
    if (known || pending > sent.nonce || sent.fromBlock === undefined || tip < BigInt(sent.fromBlock + dropAfter)) return { state: "waiting" };
  } else if (sent.hash) {
    // The nonce is used: the hash's receipt may have arrived between the two reads.
    const receipt = await receiptOrNothing(client, sent.hash);
    if (receipt) return { state: "landed", receipt };
  }
  // The hash will not land: the action's own effect decides.
  if (probe && sent.fromBlock !== undefined) {
    const found = await probe(client, { fromBlock: BigInt(sent.fromBlock), from: sent.from });
    if (found) {
      const receipt = await receiptOrNothing(client, found);
      return receipt ? { state: "landed", receipt } : { state: "waiting" };
    }
  }
  // While a block is being replaced the nonce can read as used and the transaction still be held.
  if (latest > sent.nonce && sent.hash && (await poolKnows(client, sent.hash))) return { state: "waiting" };
  return { state: "dropped" };
}

export interface FollowOptions {
  /** Waits until the next block is worth a look (a poll interval, or the block watcher's next tip). */
  tick: () => Promise<void>;
  onProgress?: (progress: Progress) => void;
  /** Stops following; the returned promise then rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Resolve at this state instead of following to the end. Default "final". */
  until?: Reached;
  /**
   * Who sent it, at which nonce and block: while the hash has no receipt, every look also asks
   * `fateOf`, so a replaced send lands under its new hash and a dropped one ends in `DroppedError`.
   */
  sent?: Omit<Sent, "hash">;
  /** The action's effect, for a send whose nonce was used by another transaction. */
  probe?: Probe;
}

const ORDER: readonly Reached[] = ["sent", "in-block", "safe", "final"];
const atLeast = (reached: Reached, goal: Reached) => ORDER.indexOf(reached) >= ORDER.indexOf(goal);

function stopIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("stopped");
}

/**
 * Follows one hash from Sent to `until` (default Final) and resolves with the last receipt read.
 * A network error during a look is not a state: the look is tried again on the next tick. With
 * `sent`, a hash that will never land ends the follow: under the hash of the transaction that
 * carried the action instead, or with `DroppedError`. It always stops on `signal`.
 */
export async function follow(client: PublicClient, first: Hex, options: FollowOptions): Promise<{ reached: Reached; receipt: TransactionReceipt }> {
  const { tick, onProgress, signal, until = "final", sent, probe } = options;
  let hash = first;
  let reorged = false;
  for (;;) {
    // Sent: wait for the receipt of this very hash, or learn that another carried the action.
    onProgress?.({ reached: "sent", hash, ...(reorged ? { reorged } : {}) });
    let receipt: TransactionReceipt | undefined;
    while (!receipt) {
      stopIfAborted(signal);
      receipt = await receiptOrNothing(client, hash).catch(() => undefined);
      if (!receipt && sent) {
        const fate = await fateOf(client, { ...sent, hash }, probe).catch((): Fate => ({ state: "waiting" }));
        stopIfAborted(signal);
        if (fate.state === "dropped") throw new DroppedError(hash);
        if (fate.state === "landed") {
          receipt = fate.receipt;
          if (receipt.transactionHash !== hash) {
            hash = receipt.transactionHash;
            onProgress?.({ reached: "sent", hash });
          }
        }
      }
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
