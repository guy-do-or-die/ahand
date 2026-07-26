import { useCallback, useEffect, useRef, useState } from "react";
import { loadThread, sendToThread, type ThreadMessage } from "../lib/xmtpClient";
import { useXmtp } from "./useXmtp";

/**
 * A quiet poll keeps the open sheet current without a persistent stream —
 * xmtpClient stays sync-on-open by design (no streams, no OPFS worker).
 */
const POLL_MS = 5000;

/** Same tail → same thread; skip the state swap so nothing re-renders. */
function sameThread(a: ThreadMessage[] | null, b: ThreadMessage[]): boolean {
  return a !== null && a.length === b.length && (b.length === 0 || a[a.length - 1].id === b[b.length - 1].id);
}

/**
 * One open conversation: history + a way to answer. Syncs on open, then
 * keeps itself fresh while the tab is visible — no reload button to press.
 */
export function useThread(conversationId: string | null) {
  const xmtp = useXmtp();
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const client = xmtp.client;
  const keyRef = useRef<string | null>(conversationId);
  keyRef.current = conversationId;
  const inFlightRef = useRef<Promise<void> | null>(null);

  const sync = useCallback(
    async (quiet = false) => {
      const key = conversationId;
      if (!client || !key) return;
      if (inFlightRef.current) {
        if (quiet) return; // the poller can wait for its next tick
        await inFlightRef.current; // send/refresh must land on a fresh pass
      }
      if (!quiet) setRefreshing(true);
      const job = (async () => {
        try {
          const list = await loadThread(client, key);
          if (keyRef.current === key) setMessages((prev) => (sameThread(prev, list) ? prev : list));
        } catch {
          // Keep whatever is on screen; the next pass tries again.
        } finally {
          if (!quiet && keyRef.current === key) setRefreshing(false);
        }
      })();
      inFlightRef.current = job;
      try {
        await job;
      } finally {
        if (inFlightRef.current === job) inFlightRef.current = null;
      }
    },
    [client, conversationId],
  );

  const refresh = useCallback(() => sync(), [sync]);

  useEffect(() => {
    setMessages(null);
    if (!client || !conversationId) return;
    void sync();
    const timer = setInterval(() => {
      // A hidden tab doesn't need fresh words — and shouldn't hog the net.
      if (document.visibilityState === "visible") void sync(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [client, conversationId, sync]);

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const words = text.trim();
      if (!client || !conversationId || !words || sending) return false;
      setSending(true);
      try {
        await sendToThread(client, conversationId, words);
        await sync();
        return true;
      } catch {
        return false;
      } finally {
        setSending(false);
      }
    },
    [client, conversationId, sending, sync],
  );

  return { ready: Boolean(client), messages, sending, refreshing, send, refresh };
}
