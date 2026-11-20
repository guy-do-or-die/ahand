import type { Call } from "@ahand/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";

import { config as app } from "../config";
import type { Reached } from "../chain/finality";
import { clientOf, watcherOf } from "../chain/hooks";
import { resume as resumeIntent, sendCalls, type Intent, type SendEnv, type SendOptions, type SendProgress, type SendResult } from "./send";
import { connectedWallet, switchToAppChain } from "./state";

/**
 * `useSend()` (ARCHITECTURE §7 Sending): what a screen calls to move money. It simulates first,
 * sends one atomic batch or steps, hands the intent to `onIntent` before waiting, never resends,
 * resumes a stored intent after a reload, and reports the four states for `TxRail`.
 *
 *   const tx = useSend();
 *   const result = await tx.send([approveCall(…), raiseCall(…)], { onIntent: store, between: recheck });
 *   <TxRail reached={tx.state.reached ?? "sent"} local={!hasL1} />
 *
 * The send resolves when the last step is in a block (its receipt is in `result.receipt`); the
 * state goes on to Final by itself. Leaving the screen stops the following, never the action.
 */

export interface SendState {
  phase: "idle" | SendProgress["phase"] | "done" | "failed";
  /** 0-based step and the number of steps (a batch is one step carrying several calls). */
  step: number;
  of: number;
  atomic: boolean;
  reached?: Reached;
  hash?: Hex;
  /** The last look found the block replaced; the same hash is being watched again. */
  reorged?: boolean;
  result?: SendResult;
}

const IDLE: SendState = { phase: "idle", step: 0, of: 0, atomic: false };

export interface UseSend {
  state: SendState;
  send(calls: readonly Call[], options?: Pick<SendOptions, "onIntent" | "between">): Promise<SendResult>;
  /** Watches a stored intent; sends nothing. */
  resume(intent: Intent, options?: Pick<SendOptions, "onIntent">): Promise<SendResult>;
  reset(): void;
}

/** One block of the build's chain: the pace of every look at a sent action. */
function nextBlock(): Promise<void> {
  return watcherOf(app.chain.id)
    .nextTip()
    .then(() => undefined);
}

export function useSend(): UseSend {
  const [state, setState] = useState<SendState>(IDLE);
  const stop = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => stop.current?.abort(new Error("the screen was left")), []);

  const begin = useCallback((): SendEnv => {
    stop.current?.abort(new Error("a new send began"));
    const controller = new AbortController();
    stop.current = controller;
    return { client: clientOf(app.chain.id), chainId: app.chain.id, tick: nextBlock, signal: controller.signal };
  }, []);

  const onProgress = useCallback((progress: SendProgress) => {
    setState((before) => ({
      ...before,
      phase: before.phase === "done" ? "done" : progress.phase,
      step: progress.step,
      of: progress.of,
      atomic: progress.atomic,
      ...(progress.reached ? { reached: progress.reached } : {}),
      ...(progress.hash ? { hash: progress.hash } : {}),
      reorged: progress.reorged === true,
    }));
  }, []);

  const finish = useCallback((result: SendResult): SendResult => {
    setState((before) => ({ ...before, phase: result.ok ? "done" : "failed", result }));
    if (result.ok) result.settled.catch(() => undefined);
    return result;
  }, []);

  const send = useCallback<UseSend["send"]>(
    async (calls, options = {}) => {
      const env = begin();
      setState({ ...IDLE, phase: "checking", of: calls.length });
      let wallet = await connectedWallet();
      if (!wallet) return finish({ ok: false, reason: "needs-wallet", step: 0, sent: [], message: "no wallet is connected" });
      if ((await wallet.getChainId().catch(() => undefined)) !== app.chain.id) {
        if (!(await switchToAppChain())) return finish({ ok: false, reason: "error", step: 0, sent: [], message: "the wallet is on another network" });
        wallet = (await connectedWallet()) ?? wallet;
      }
      return finish(await sendCalls(env, wallet, calls, { ...options, onProgress }));
    },
    [begin, finish, onProgress],
  );

  const resume = useCallback<UseSend["resume"]>(
    async (intent, options = {}) => {
      const env = begin();
      setState({ ...IDLE, phase: "watching", of: intent.of, atomic: intent.kind === "batch", reached: "sent", ...(intent.hash ? { hash: intent.hash } : {}) });
      const wallet = intent.kind === "batch" && !intent.hash ? await connectedWallet() : undefined;
      return finish(await resumeIntent(env, intent, { ...options, onProgress, ...(wallet ? { wallet } : {}) }));
    },
    [begin, finish, onProgress],
  );

  const reset = useCallback(() => {
    stop.current?.abort(new Error("reset"));
    setState(IDLE);
  }, []);

  return { state, send, resume, reset };
}
