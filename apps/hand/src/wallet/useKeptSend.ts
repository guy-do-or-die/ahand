import type { Call } from "@ahand/sdk";
import { useCallback, useEffect, useRef, useState } from "react";

import { config as app } from "../config";
import { get, put, remove } from "../store/db";
import type { Intent, Probe, SendAction, SendOptions, SendResult } from "./send";
import { useSend, type UseSend } from "./useSend";

/**
 * One send intent per money action and place, kept on the device (FINDINGS E-1, W-6): /care's
 * add and extend, /waiting's take-out and deliver, and the send-back. The intent is stored before
 * the wallet is asked and with every answer, so a reload finds it; on load the screen follows it
 * again (the TxRail shows the send in flight) and holds its button until it lands, reverts or is
 * dropped. A send whose wallet answer was "unknown" is settled the same way, by the account's
 * nonce and the action's own effect (`probes`), and never sent a second time. /raise keeps its own
 * record (HandRecord), and /thank its inbox record's `thank` field.
 */

export interface KeptSend {
  tx: UseSend;
  /** Reading the device's record, or following a send from before: the button is held. */
  holding: boolean;
  /** The last answer was "unknown" and is being checked now. */
  unknown: boolean;
  /** A send found on the device when the screen opened (not one pressed here). */
  resumed: boolean;
  send(calls: readonly Call[], options?: Pick<SendOptions, "steps" | "between">): Promise<SendResult>;
}

/** Whether a result ends the intent: anything but "the screen stopped following". */
function ends(result: SendResult): boolean {
  return result.ok || result.reason !== "stopped";
}

export function useKeptSend(id: string | undefined, probes: Partial<Record<SendAction, Probe>>, onResumed?: (result: SendResult) => void): KeptSend {
  const tx = useSend();
  const [holding, setHolding] = useState(id !== undefined);
  const [unknown, setUnknown] = useState(false);
  const [resumed, setResumed] = useState(false);
  const latest = useRef({ probes, onResumed });
  latest.current = { probes, onResumed };

  const keep = useCallback(
    async (intent: Intent) => {
      if (id) await put("sends", { id, intent }).catch(() => undefined); // without storage the send still goes; a reload just won't find it
    },
    [id],
  );
  const probeOf = (intent: Intent) => (intent.action ? latest.current.probes[intent.action] : undefined);

  const settle = useCallback(
    async (intent: Intent): Promise<SendResult> => {
      const probe = probeOf(intent);
      const result = await tx.resume(intent, { onIntent: keep, ...(probe ? { probe } : {}) });
      if (ends(result) && id) await remove("sends", id).catch(() => undefined);
      return result;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, keep, tx.resume],
  );

  // On load: a send of this action and place from before is followed, never offered again.
  useEffect(() => {
    if (!id) {
      setHolding(false);
      return;
    }
    let live = true;
    setHolding(true);
    get("sends", id)
      .catch(() => undefined)
      .then(async (record) => {
        if (!live) return;
        if (!record || record.intent.chainId !== app.chain.id) {
          setHolding(false);
          return;
        }
        setResumed(true);
        const result = await settle(record.intent);
        if (!live) return;
        setHolding(false);
        latest.current.onResumed?.(result);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const send = useCallback<KeptSend["send"]>(
    async (calls, options = {}) => {
      setResumed(false);
      const first = await tx.send(calls, { ...options, onIntent: keep });
      if (!first.ok && first.reason === "unknown") {
        setUnknown(true);
        const settled = await settle(first.intent);
        setUnknown(false);
        return settled;
      }
      if (ends(first) && id) await remove("sends", id).catch(() => undefined);
      return first;
    },
    [id, keep, settle, tx],
  );

  return { tx, holding, unknown, resumed, send };
}
