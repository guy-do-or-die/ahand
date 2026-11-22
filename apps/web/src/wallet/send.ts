import { decodeCoreError, type Call, type CoreRefusal } from "@ahand/sdk";
import type { Account, Address, Chain, Hex, PublicClient, TransactionReceipt, Transport, WalletClient } from "viem";

import { DroppedError, fateOf, follow, type Fate, type Probe, type Progress, type Reached, type Sent } from "../chain/finality";
import { simulateAll, simulateOne } from "../chain/simulate";

/**
 * Sending, without React. `useSend` wraps it.
 *
 * 1. Every call is simulated first, in order. A refusal comes back as data (Core's error, or the
 *    chain's message) and nothing is sent.
 * 2. When the wallet reports atomic support for this chain (EIP-5792 `atomic`: supported or
 *    ready), all calls go as one batch that must run whole. Otherwise one call after another, each
 *    waited for in a block before the next; before each later step `between(step, of)` lets the
 *    screen check again (a thank re-asks Core's `checkGive`), and the step is simulated again.
 * 3. The intent is handed to `onIntent` before the wallet is asked (who sends, the account's
 *    `pending` nonce, the latest block, the action), and again once the wallet answers with the
 *    hash or the batch's id, then the batch's hash: a reload always finds it and can `resume` it.
 * 4. Nothing is ever sent twice from here: no retry, no resend after a drop or a reorg.
 * 5. A wallet error that is not a refusal (4001) or "this account can't" (4100, 4200) may come
 *    after the transaction left: it is "unknown", carries the intent, and never reads "nothing was
 *    sent". `resume` then settles it from the account's nonce and the action's own effect
 *    (`fateOf`, chain/finality.ts): landed (under whichever hash carried it), or "dropped" when
 *    nothing from it left the account. A followed hash ends the same way when it is replaced or
 *    dropped, so no follow runs for ever on a hash nobody knows.
 * 6. After the last step lands, `settled` follows it to Final through the chain's own tags.
 */

/** What a send does, kept with its intent so a reload knows which effect to look for. */
export type SendAction = "raise" | "approve" | "fund" | "extend" | "withdraw" | "refund" | "thank" | "setup";

/** One call's action and the probe of its effect (see wallet/effects.ts). */
export interface StepInfo {
  action: SendAction;
  probe?: Probe;
}

interface Known {
  chainId: number;
  /** The account the wallet was asked to send from. */
  from?: Address;
  /** Its `pending` transaction count just before the wallet was asked. */
  nonce?: number;
  /** The latest block then: the effect of this send is looked for from here on. */
  fromBlock?: number;
  action?: SendAction;
}

export type Intent =
  | (Known & { kind: "tx"; /** Unknown until the wallet answers. */ hash?: Hex; /** 0-based */ step: number; of: number })
  | (Known & { kind: "batch"; /** Unknown until the wallet answers. */ id?: string; of: number; hash?: Hex });

export type { Probe } from "../chain/finality";

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
  /** The screen stopped following (or `between` said no); a send already made may still land. */
  | (Failed<"stopped"> & { intent?: Intent })
  | (Failed<"reverted"> & { hash: Hex; refusal?: CoreRefusal })
  /** Not known whether the transaction left the wallet: never "nothing was sent". */
  | (Failed<"unknown"> & { intent: Intent; message: string })
  /** Its nonce was used by another transaction, or stayed free for good, and its effect is not on the chain: nothing from it left the account. */
  | (Failed<"dropped"> & { intent: Intent })
  /** The wallet is on another network and would not switch: nothing was sent. */
  | Failed<"wrong-network">
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
  /** Each call's action and effect probe, in order (a batch uses the last). */
  steps?: readonly StepInfo[];
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

/** viem's errors thrown before the request reaches the wallet: nothing left. */
function beforeAsking(error: unknown): "wrong-network" | "error" | undefined {
  const name = (error as { name?: unknown } | undefined)?.name;
  if (name === "ChainMismatchError") return "wrong-network";
  if (name === "ChainNotFoundError" || name === "AccountNotFoundError" || name === "AccountTypeNotSupportedError") return "error";
  return undefined;
}

/**
 * How a wallet's error is read: 4001 the person said no; 4100/4200 the account can't do it; an
 * error viem raised before asking. Anything else may come after the transaction left the wallet
 * (an internal error, a timeout, the page's own RPC failing after the broadcast): unknown.
 */
function walletFailure(error: unknown, step: number, sent: Hex[], intent: Intent): SendResult {
  const code = codeOf(error);
  if (code === 4001) return { ok: false, reason: "rejected", step, sent };
  if (code === 4100 || code === 4200) return { ok: false, reason: "cannot-send", step, sent };
  const before = beforeAsking(error);
  if (before === "wrong-network") return { ok: false, reason: "wrong-network", step, sent };
  if (before === "error") return { ok: false, reason: "error", step, sent, message: messageOf(error) };
  return { ok: false, reason: "unknown", step, sent, intent, message: messageOf(error) };
}

/** A follow that ended without a receipt: dropped, stopped by the screen, or (anything else) unknown. */
function followFailure(error: unknown, step: number, sent: Hex[], intent: Intent, signal: AbortSignal | undefined): SendResult {
  if (error instanceof DroppedError) return { ok: false, reason: "dropped", step, sent, intent };
  if (signal?.aborted) return { ok: false, reason: "stopped", step, sent, intent };
  return { ok: false, reason: "unknown", step, sent, intent, message: messageOf(error) };
}

/** What the wallet is about to be asked: the account's pending nonce and the latest block, read now. */
async function knownBefore(env: SendEnv, from: Address): Promise<{ nonce: number; fromBlock: number }> {
  const [nonce, block] = await Promise.all([env.client.getTransactionCount({ address: from, blockTag: "pending" }), env.client.getBlockNumber({ cacheTime: 0 })]);
  return { nonce, fromBlock: Number(block) };
}

function sentOf(intent: Intent): Omit<Sent, "hash"> | undefined {
  if (!intent.from || intent.nonce === undefined) return undefined;
  return { from: intent.from, nonce: intent.nonce, ...(intent.fromBlock !== undefined ? { fromBlock: intent.fromBlock } : {}) };
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
function watch(env: SendEnv, hash: Hex, report: (progress: Progress) => void, known?: { sent?: Omit<Sent, "hash">; probe?: Probe }) {
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
    ...(known?.sent ? { sent: known.sent } : {}),
    ...(known?.probe ? { probe: known.probe } : {}),
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
  const { onIntent, between, onProgress, steps } = options;
  const from = wallet.account.address;
  const of = calls.length;
  const sent: Hex[] = [];
  if (of === 0) throw new Error("nothing to send");
  if (steps && steps.length !== of) throw new Error("one step description per call");

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

    // Before the wallet is asked: the nonce and the block, and the intent handed over.
    let before: { nonce: number; fromBlock: number };
    try {
      before = await knownBefore(env, from);
    } catch (error) {
      return { ok: false, reason: "offline", step, sent, message: messageOf(error) };
    }
    const info = steps?.[step];
    const asked: Intent = { kind: "tx", chainId: env.chainId, step, of, from, ...before, ...(info ? { action: info.action } : {}) };
    await onIntent?.(asked);

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
      return walletFailure(error, step, sent, asked);
    }
    sent.push(hash);
    const intent: Intent = { ...asked, hash };
    await onIntent?.(intent);

    const followed = watch(
      env,
      hash,
      (p) => onProgress?.({ phase: "watching", step, of, atomic, reached: p.reached, hash: p.hash, ...(p.reorged ? { reorged: true } : {}) }),
      { sent: { from, ...before }, ...(info?.probe ? { probe: info.probe } : {}) },
    );
    let receipt: TransactionReceipt;
    try {
      receipt = await followed.landed;
    } catch (error) {
      return followFailure(error, step, sent, intent, env.signal);
    }
    if (receipt.transactionHash !== hash) {
      // Replaced (a speed-up): the action landed under another hash, which is the one kept.
      sent[sent.length - 1] = receipt.transactionHash;
      await onIntent?.({ ...intent, hash: receipt.transactionHash });
    }
    if (receipt.status === "reverted") {
      followed.stop();
      return { ok: false, reason: "reverted", step, sent, hash: receipt.transactionHash, refusal: await refusalOfRevert(env.client, from, call, receipt) };
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
  const { onIntent, onProgress, steps } = options;
  const of = calls.length;
  const sent: Hex[] = [];
  const from = wallet.account.address;
  let before: { nonce: number; fromBlock: number };
  try {
    before = await knownBefore(env, from);
  } catch (error) {
    return { ok: false, reason: "offline", step: 0, sent, message: messageOf(error) };
  }
  const last = steps?.[of - 1];
  const asked: Intent = { kind: "batch", chainId: env.chainId, of, from, ...before, ...(last ? { action: last.action } : {}) };
  await onIntent?.(asked);
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
    return walletFailure(error, 0, sent, asked);
  }
  const intent: Intent = { ...asked, id };
  await onIntent?.(intent);
  return followBatch(env, wallet, intent, { ...options, ...(last?.probe ? { probe: last.probe } : {}) });
}

/** Waits for a batch's hash through the wallet (EIP-5792 `wallet_getCallsStatus`), then follows it. */
async function followBatch(
  env: SendEnv,
  wallet: SignedInWallet,
  intent: Extract<Intent, { kind: "batch" }>,
  options: Pick<SendOptions, "onIntent" | "onProgress"> & { probe?: Probe },
): Promise<SendResult> {
  const { onIntent, onProgress } = options;
  const { of } = intent;
  let hash = intent.hash;
  onProgress?.({ phase: "watching", step: 0, of, atomic: true, reached: "sent" });
  while (!hash) {
    if (env.signal?.aborted) return { ok: false, reason: "stopped", step: 0, sent: [], intent };
    const status = intent.id ? await wallet.getCallsStatus({ id: intent.id }).catch(() => undefined) : undefined;
    const receipts = status?.receipts ?? [];
    if (receipts.length > 0) hash = receipts[receipts.length - 1]!.transactionHash;
    else if (status?.status === "failure") return { ok: false, reason: "error", step: 0, sent: [], message: "the wallet reports that the batch failed" };
    else await env.tick();
  }
  const withHash = { ...intent, hash };
  await onIntent?.(withHash);
  return followLast(env, withHash, 0, of, true, options);
}

async function followLast(
  env: SendEnv,
  intent: Intent & { hash: Hex },
  step: number,
  of: number,
  atomic: boolean,
  options: Pick<SendOptions, "onIntent" | "onProgress"> & { probe?: Probe },
): Promise<SendResult> {
  const { onProgress, onIntent, probe } = options;
  const { hash } = intent;
  const sent = sentOf(intent);
  const followed = watch(
    env,
    hash,
    (p) => onProgress?.({ phase: "watching", step, of, atomic, reached: p.reached, hash: p.hash, ...(p.reorged ? { reorged: true } : {}) }),
    { ...(sent ? { sent } : {}), ...(probe ? { probe } : {}) },
  );
  let receipt: TransactionReceipt;
  try {
    receipt = await followed.landed;
  } catch (error) {
    return followFailure(error, step, [hash], intent, env.signal);
  }
  if (receipt.transactionHash !== hash) await onIntent?.({ ...intent, hash: receipt.transactionHash });
  if (receipt.status === "reverted") {
    followed.stop();
    return { ok: false, reason: "reverted", step, sent: [receipt.transactionHash], hash: receipt.transactionHash };
  }
  return { ok: true, atomic, step, of, hashes: [receipt.transactionHash], receipt, settled: followed.settled };
}

/**
 * An intent with no hash (the wallet's answer was lost, or a reload came before it): its fate,
 * read on every tick from the account's nonce and the action's effect, until it landed (then
 * followed like any hash) or was dropped. Sends nothing.
 */
async function settleUnknown(env: SendEnv, intent: Intent, options: Pick<SendOptions, "onIntent" | "onProgress"> & { probe?: Probe }): Promise<SendResult> {
  const step = intent.kind === "tx" ? intent.step : 0;
  const atomic = intent.kind === "batch";
  onProgress(options, { phase: "watching", step, of: intent.of, atomic, reached: "sent" });
  for (;;) {
    if (env.signal?.aborted) return { ok: false, reason: "stopped", step, sent: [], intent };
    const fate = await fateOf(env.client, intent, options.probe).catch((): Fate => ({ state: "waiting" }));
    if (env.signal?.aborted) return { ok: false, reason: "stopped", step, sent: [], intent };
    if (fate.state === "dropped") return { ok: false, reason: "dropped", step, sent: [], intent };
    if (fate.state === "landed") {
      const found = { ...intent, hash: fate.receipt.transactionHash };
      await options.onIntent?.(found);
      return followLast(env, found, step, intent.of, atomic, options);
    }
    await env.tick();
  }
}

function onProgress(options: Pick<SendOptions, "onProgress">, progress: SendProgress): void {
  options.onProgress?.(progress);
}

/**
 * Picks up a stored intent after a reload, or settles one whose answer was "unknown": watches the
 * known hash, or reads the account's nonce and the action's effect (`probe`), and sends nothing.
 * A batch whose hash was not known yet asks the wallet that holds it, when there is one.
 */
export async function resume(
  env: SendEnv,
  intent: Intent,
  options: Pick<SendOptions, "onIntent" | "onProgress"> & { wallet?: SignedInWallet; probe?: Probe } = {},
): Promise<SendResult> {
  if (intent.chainId !== env.chainId) throw new Error(`this intent is on chain ${intent.chainId}, not ${env.chainId}`);
  if (intent.hash) return followLast(env, { ...intent, hash: intent.hash }, intent.kind === "tx" ? intent.step : 0, intent.of, intent.kind === "batch", options);
  if (intent.kind === "batch" && intent.id && options.wallet) return followBatch(env, options.wallet, intent, options);
  if (sentOf(intent)) return settleUnknown(env, intent, options);
  return { ok: false, reason: "needs-wallet", step: 0, sent: [], message: "connect the wallet that holds this batch to find it" };
}

/** Waits `ms` with the event loop's timer (a pause, not a reading of any clock). */
export function pause(ms: number): () => Promise<void> {
  return () => new Promise((resolve) => setTimeout(resolve, ms));
}
