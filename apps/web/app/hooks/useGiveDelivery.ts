import { useCallback, useEffect, useState } from "react";
import { FLAGS } from "../config/flags";
import { buildGiveMessage } from "../lib/giveLink";
import { canReachAddress, sendDmText, XmtpBusyError } from "../lib/xmtpClient";
import { useXmtp } from "./useXmtp";

export type DeliveryPhase = "idle" | "sending" | "sent" | "failed";

/**
 * Giver side of direct delivery: is the raiser reachable, and one action
 * to send the proof straight to them. Failure is never a dead end — the
 * copy-link path stays on screen throughout.
 */
export function useGiveDelivery(args: { raiser?: string; solveUrl: string; solutionText: string }) {
  const { raiser, solveUrl, solutionText } = args;
  const xmtp = useXmtp();

  const [reachable, setReachable] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<DeliveryPhase>("idle");
  const [failure, setFailure] = useState<"busy" | "network" | null>(null);
  /** Decided per proof, so the CTA can't change identity under a finger. */
  const [offered, setOffered] = useState(false);

  useEffect(() => {
    if (!FLAGS.xmtpDelivery || !raiser || typeof window === "undefined") return;
    let cancelled = false;
    // A slow answer means "no for now" — the sheet must not wait on it.
    // But the real answer still lands when it arrives (first load pays for
    // the whole messaging engine and can outlive any polite timeout), and
    // the idle-only upgrade below keeps the CTA from flipping mid-action.
    const real = canReachAddress(raiser);
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000));
    Promise.race([real, timeout])
      .then((ok: boolean) => {
        if (!cancelled) setReachable(ok);
      })
      .catch(() => {
        if (!cancelled) setReachable(false);
      });
    real
      .then((ok: boolean) => {
        if (!cancelled) setReachable(ok);
      })
      .catch(() => {
        /* provisional verdict stands */
      });
    return () => {
      cancelled = true;
    };
  }, [raiser]);

  // Every edit mints a new proof link — "sent" only ever describes the
  // proof on screen, and the direct offer locks to what was known then.
  useEffect(() => {
    setPhase("idle");
    setFailure(null);
    setOffered(Boolean(solveUrl) && reachable === true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solveUrl]);

  // A late "yes, reachable" may still upgrade the offer, but only while
  // nothing has been attempted — the CTA never flips after that.
  useEffect(() => {
    if (reachable === true && phase === "idle" && solveUrl) setOffered(true);
  }, [reachable, phase, solveUrl]);

  const enable = xmtp.enable;
  const sendDirect = useCallback(async (): Promise<boolean> => {
    if (!raiser || !solveUrl) return false;
    setPhase("sending");
    setFailure(null);
    try {
      const client = await enable();
      if (!client) {
        // They closed the confirm — a quiet non-event, back where they were.
        setPhase("idle");
        return false;
      }
      await sendDmText(client, raiser, buildGiveMessage({ solveUrl, solutionText }));
      setPhase("sent");
      return true;
    } catch (err) {
      setFailure(err instanceof XmtpBusyError ? "busy" : "network");
      setPhase("failed");
      return false;
    }
  }, [raiser, solveUrl, solutionText, enable]);

  return {
    /** Offer the direct path only when the raiser can actually receive it. */
    canSendDirect: FLAGS.xmtpDelivery && offered,
    phase,
    failure,
    sendDirect,
  };
}
