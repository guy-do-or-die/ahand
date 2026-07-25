import { useCallback, useEffect, useRef, useState } from "react";
import { loadThread, sendToThread, type ThreadMessage } from "../lib/xmtpClient";
import { useXmtp } from "./useXmtp";

/**
 * One open conversation: history + a way to answer. Sync-on-open with
 * manual refresh — the sheet is a place to talk, not a live wire.
 */
export function useThread(conversationId: string | null) {
  const xmtp = useXmtp();
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const client = xmtp.client;
  const keyRef = useRef<string | null>(conversationId);
  keyRef.current = conversationId;

  const refresh = useCallback(async () => {
    const key = conversationId;
    if (!client || !key) return;
    setRefreshing(true);
    try {
      const list = await loadThread(client, key);
      if (keyRef.current === key) setMessages(list);
    } catch {
      // Keep whatever is on screen; the next refresh tries again.
    } finally {
      if (keyRef.current === key) setRefreshing(false);
    }
  }, [client, conversationId]);

  useEffect(() => {
    setMessages(null);
    if (!client || !conversationId) return;
    void refresh();
  }, [client, conversationId, refresh]);

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const words = text.trim();
      if (!client || !conversationId || !words || sending) return false;
      setSending(true);
      try {
        await sendToThread(client, conversationId, words);
        await refresh();
        return true;
      } catch {
        return false;
      } finally {
        setSending(false);
      }
    },
    [client, conversationId, sending, refresh],
  );

  return { ready: Boolean(client), messages, sending, refreshing, send, refresh };
}
