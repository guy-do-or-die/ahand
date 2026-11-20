import { decodeCoreError, type Call, type CoreRefusal } from "@ahand/sdk";
import type { Account, Address, Chain, Hex, PublicClient, TransactionReceipt, Transport, WalletClient } from "viem";

import { follow, type Progress, type Reached } from "../chain/finality";
import { simulateAll, simulateOne } from "../chain/simulate";

/**
 * Sending, without React (ARCHITECTURE §6 step 3, §7 Sending; brief 08 §2). `useSend` wraps it.
 *
 * 1. Every call is simulated first, in order. A refusal comes back as data (Core's error, or the
 *    chain's message) and nothing is sent.
 * 2. When the wallet reports atomic support for this chain (EIP-5792 `atomic`: supported or
 *    ready), all calls go as one batch that must run whole. Otherwise one call after another, each
 *    waited for in a block before the next; before each later step `between(step, of)` lets the
 *    screen check again (a thank re-asks Core's `checkGive`), and the step is simulated again.
 * 3. The intent (the hash, or the batch's id and then its hash) is handed to `onIntent` before
 *    anything is waited for, so a screen can store it and `resume` it after a reload.
 * 4. Nothing is ever sent twice from here: no retry, no resend after a drop or a reorg. A send
 *    that is not answered keeps waiting; the screen decides what to offer.
 * 5. After the last step lands, `settled` follows it to Final through the chain's own tags.
 */

export type Intent =
  | { kind: "tx"; chainId: number; hash: Hex; /** 0-based */ step: number; of: number }
  | { kind: "batch"; chainId: number; id: string; of: number; hash?: Hex };

export interface SendProgress {
  phase: "checking" | "between" | "asking" | "watching";
  /** 0-based; the batch is step 0 of 1 on screen, though it carries `calls.length` calls. */
  step: number;
  of: number;
  atomic: boolean;
  reached?: Reached;
  hash?: Hex;
  reorged?: boolean;
}

interface Failed<R extends string> {
  ok: false;
  reason: R;
  /** The step that did not go: 0-based. */
  step: number;
  /** Hashes of the steps that were sent before it, in order. */
  sent: Hex[];
}

export type SendResult =
  | {
      ok: true;
      atomic: boolean;
      /** The last step that landed (0-based) and how many there were; a resumed step may not be the last. */
      step: number;
      of: number;
      hashes: Hex[];
      receipt: TransactionReceipt;
      /** Resolves with "final" once the chain says so (or rejects when stopped). */
      settled: Promise<Reached>;
    }
  | (Failed<"refused"> & { refusal: CoreRefusal })
  | (Failed<"failed-check"> & { message: string })
  | Failed<"rejected">
  | Failed<"cannot-send">
  | Failed<"stopped">
  | (Failed<"reverted"> & { hash: Hex; refusal?: CoreRefusal })
  | (Failed<"offline" | "error" | "needs-wallet"> & { message: string });

export type SignedInWallet = WalletClient<Transport, Chain, Account>;

export interface SendEnv {
  client: PublicClient;
  chainId: number;
  /** Waits until the next look is worth it: the block watcher's next tip, or a poll interval. */
  tick: () => Promise<void>;
  signal?: AbortSignal;
}

export interface SendOptions {
  onIntent?: (intent: Intent) => void | Promise<void>;
  /** Before each later step (1-based count of steps already done = `step`); false stops. */
  between?: (step: number, of: number) => boolean | void | Promise<boolean | void>;
  onProgress?: (progress: SendProgress) => void;
}

function codeOf(error: unknown): number | undefined {
  let node: unknown = error;
  const seen = new Set<unknown>();
  while (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    const code = (node as { code?: unknown }).code;
    if (typeof code === "number" && code >= 4000 && code < 5000) return code;
    node = (node as { cause?: unknown }).cause;
  }
  return undefined;
}

function messageOf(error: unknown): string {
  const short = (error as { shortMessage?: unknown } | undefined)?.shortMessage;
  if (typeof short === "string" && short) return short;
  return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

/** How a wallet's "no" is read: 4001 the person said no; 4100/4200 the account can't do it. */
function walletFailure(error: unknown, step: number, sent: Hex[]): SendResult {
  const code = codeOf(error);
  if (code === 4001) return { ok: false, reason: "rejected", step, sent };
  if (code === 4100 || code === 4200) return { ok: false, reason: "cannot-send", step, sent };
  return { ok: false, reason: "error", step, sent, message: messageOf(error) };
}

/** Whether the wallet can run these calls as one that must go whole (EIP-5792 `atomic`). */
export async function canBatch(wallet: SignedInWallet, chainId: number): Promise<boolean> {
  try {
    const capabilities = (await wallet.getCapabilities({ account: wallet.account, chainId })) as { atomic?: { status?: string } } | undefined;
    const status = capabilities?.atomic?.status;
    return status === "supported" || status === "ready";
  } catch {
    return false; // a wallet without EIP-5792 answers with an error: one call after another
  }
}

/** Replays a reverted call on the block before it, to name Core's error (as `ahand.sh` does). */
async function refusalOfRevert(client: PublicClient, from: Address, call: Call, receipt: TransactionReceipt): Promise<CoreRefusal | undefined> {
  try {
    await client.call({
      account: from,
      to: call.to,
      data: call.data,
      ...(call.value ? { value: call.value } : {}),
      blockNumber: receipt.blockNumber > 0n ? receipt.blockNumber - 1n : 0n,
    });
    return undefined; // an earlier action in the same block changed what Core saw
  } catch (error) {
    return decodeCoreError(error);
  }
}

/** Follows a hash: `landed` resolves with its first receipt, `settled` with the last state reached. */
function watch(env: SendEnv, hash: Hex, report: (progress: Progress) => void) {
  const stop = new AbortController();
  const signal = env.signal ? AbortSignal.any([env.signal, stop.signal]) : stop.signal;
  let land!: (receipt: TransactionReceipt) => void;
  let fail!: (error: unknown) => void;
  const landed = new Promise<TransactionReceipt>((resolve, reject) => {
    land = resolve;
    fail = reject;
  });
  const settled = follow(env.client, hash, {
    tick: env.tick,
    signal,
    onProgress: (progress) => {
      report(progress);
      if (progress.reached === "in-block" && progress.receipt) land(progress.receipt);
    },
  }).then((result) => result.reached);
  settled.catch(fail);
  // Nobody may be listening to `settled` (an earlier step): its end must not be an unhandled rejection.
  settled.catch(() => undefined);
  return { landed, settled, stop: () => stop.abort(new Error("stopped following")) };
}

/** Simulates, then sends `calls` from the wallet's account as a batch or as steps. */
export async function sendCalls(env: SendEnv, wallet: SignedInWallet, calls: readonly Call[], options: SendOptions = {}): Promise<SendResult> {
  const { onIntent, between, onProgress } = options;
  const from = wallet.account.address;
  const of = calls.length;
  const sent: Hex[] = [];
  if (of === 0) throw new Error("nothing to send");

  onProgress?.({ phase: "checking", step: 0, of, atomic: false });
  let simulation: Awaited<ReturnType<typeof simulateAll>>;
  try {
    simulation = await simulateAll(env.client, calls, from);
  } catch (error) {
    return { ok: false, reason: "offline", step: 0, sent, message: messageOf(error) };
  }
  if (!simulation.ok) {
    return "refusal" in simulation
      ? { ok: false, reason: "refused", step: simulation.step, sent, refusal: simulation.refusal }
      : { ok: false, reason: "failed-check", step: simulation.step, sent, message: simulation.failure };
  }

  const atomic = of > 1 && (await canBatch(wallet, env.chainId));
  if (atomic) return sendBatch(env, wallet, calls, options);

  for (let step = 0; step < of; step++) {
    const call = calls[step]!;
    if (step > 0) {
      onProgress?.({ phase: "between", step, of, atomic });
      try {
        if ((await between?.(step, of)) === false) return { ok: false, reason: "stopped", step, sent };
      } catch {
        return { ok: false, reason: "stopped", step, sent };
      }
      // The chain may have moved while the earlier step was waited for: ask again.
      onProgress?.({ phase: "checking", step, of, atomic });
      try {
        const again = await simulateOne(env.client, call, from, step);
        if (!again.ok) {
          return "refusal" in again
            ? { ok: false, reason: "refused", step, sent, refusal: again.refusal }
            : { ok: false, reason: "failed-check", step, sent, message: again.failure };
        }
      } catch (error) {
        return { ok: false, reason: "offline", step, sent, message: messageOf(error) };
      }
    }

    onProgress?.({ phase: "asking", step, of, atomic });
    let hash: Hex;
    try {
      hash = await wallet.sendTransaction({
        account: wallet.account,
        chain: wallet.chain,
        to: call.to,
        data: call.data,
        ...(call.value ? { value: call.value } : {}),
      });
    } catch (error) {
      return walletFailure(error, step, sent);
    }
    sent.push(hash);
    await onIntent?.({ kind: "tx", chainId: env.chainId, hash, step, of });

    const followed = watch(env, hash, (p) => onProgress?.({ phase: "watching", step, of, atomic, reached: p.reached, hash, ...(p.reorged ? { reorged: true } : {}) }));
    let receipt: TransactionReceipt;
    try {
      receipt = await followed.landed;
    } catch (error) {
      return { ok: false, reason: "error", step, sent, message: messageOf(error) };
    }
    if (receipt.status === "reverted") {
      followed.stop();
      return { ok: false, reason: "reverted", step, sent, hash, refusal: await refusalOfRevert(env.client, from, call, receipt) };
    }
    if (step < of - 1) {
      followed.stop(); // the last step's block comes later and settles every block before it
      continue;
    }
    return { ok: true, atomic, step, of, hashes: sent, receipt, settled: followed.settled };
  }
  throw new Error("unreachable");
}

async function sendBatch(env: SendEnv, wallet: SignedInWallet, calls: readonly Call[], options: SendOptions): Promise<SendResult> {
  const { onIntent, onProgress } = options;
  const of = calls.length;
  const sent: Hex[] = [];
  onProgress?.({ phase: "asking", step: 0, of, atomic: true });
  let id: string;
  try {
    ({ id } = await wallet.sendCalls({
      account: wallet.account,
      chain: wallet.chain,
      calls: calls.map((call) => ({ to: call.to, data: call.data, ...(call.value ? { value: call.value } : {}) })),
      forceAtomic: true,
    }));
  } catch (error) {
    return walletFailure(error, 0, sent);
  }
  await onIntent?.({ kind: "batch", chainId: env.chainId, id, of });
  return followBatch(env, wallet, { kind: "batch", chainId: env.chainId, id, of }, options);
}

/** Waits for a batch's hash through the wallet (EIP-5792 `wallet_getCallsStatus`), then follows it. */
async function followBatch(
  env: SendEnv,
  wallet: SignedInWallet,
  intent: Extract<Intent, { kind: "batch" }>,
  options: SendOptions,
): Promise<SendResult> {
  const { onIntent, onProgress } = options;
  const { of } = intent;
  let hash = intent.hash;
  onProgress?.({ phase: "watching", step: 0, of, atomic: true, reached: "sent" });
  while (!hash) {
    if (env.signal?.aborted) return { ok: false, reason: "stopped", step: 0, sent: [] };
    const status = await wallet.getCallsStatus({ id: intent.id }).catch(() => undefined);
    const receipts = status?.receipts ?? [];
    if (receipts.length > 0) hash = receipts[receipts.length - 1]!.transactionHash;
    else if (status?.status === "failure") return { ok: false, reason: "error", step: 0, sent: [], message: "the wallet reports that the batch failed" };
    else await env.tick();
  }
  await onIntent?.({ ...intent, hash });
  return followLast(env, hash, 0, of, true, onProgress);
}

async function followLast(
  env: SendEnv,
  hash: Hex,
  step: number,
  of: number,
  atomic: boolean,
  onProgress: SendOptions["onProgress"],
): Promise<SendResult> {
  const followed = watch(env, hash, (p) => onProgress?.({ phase: "watching", step, of, atomic, reached: p.reached, hash, ...(p.reorged ? { reorged: true } : {}) }));
  let receipt: TransactionReceipt;
  try {
    receipt = await followed.landed;
  } catch (error) {
    return { ok: false, reason: "error", step, sent: [hash], message: messageOf(error) };
  }
  if (receipt.status === "reverted") {
    followed.stop();
    return { ok: false, reason: "reverted", step, sent: [hash], hash };
  }
  return { ok: true, atomic, step, of, hashes: [hash], receipt, settled: followed.settled };
}

/**
 * Picks up a stored intent after a reload: watches the known hash and sends nothing. A batch
 * whose hash was not known yet needs the wallet that holds it.
 */
export async function resume(env: SendEnv, intent: Intent, options: Pick<SendOptions, "onIntent" | "onProgress"> & { wallet?: SignedInWallet } = {}): Promise<SendResult> {
  if (intent.chainId !== env.chainId) throw new Error(`this intent is on chain ${intent.chainId}, not ${env.chainId}`);
  if (intent.kind === "tx") return followLast(env, intent.hash, intent.step, intent.of, false, options.onProgress);
  if (intent.hash) return followLast(env, intent.hash, 0, intent.of, true, options.onProgress);
  if (!options.wallet) return { ok: false, reason: "needs-wallet", step: 0, sent: [], message: "connect the wallet that holds this batch to find it" };
  return followBatch(env, options.wallet, intent, options);
}

/** Waits `ms` with the event loop's timer (a pause, not a reading of any clock). */
export function pause(ms: number): () => Promise<void> {
  return () => new Promise((resolve) => setTimeout(resolve, ms));
}
