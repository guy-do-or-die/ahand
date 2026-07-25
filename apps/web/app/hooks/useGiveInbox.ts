import { useCallback, useEffect, useRef, useState } from "react";
import { listInbox, type Inbox, type XmtpClient } from "../lib/xmtpClient";
import { useXmtp } from "./useXmtp";

/**
 * Everything the pocket hears over XMTP, sync-on-open: incoming gives
 * (raiser side) and the word that came back per conversation (giver side).
 * Rides the shared client from useXmtp — if delivery was never switched on
 * here, this stays inert and never prompts. Refetches on window focus.
 */
export function useGiveInbox() {
  const xmtp = useXmtp();
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [loading, setLoading] = useState(false);
  const client = xmtp.client;
  /** Which client the state on screen belongs to — stale syncs are dropped. */
  const clientRef = useRef<XmtpClient | null>(client);
  clientRef.current = client;
  const inFlightFor = useRef<XmtpClient | null>(null);

  const refresh = useCallback(async () => {
    const c = client;
    if (!c || inFlightFor.current === c) return;
    inFlightFor.current = c;
    setLoading(true);
    try {
      const result = await listInbox(c);
      if (clientRef.current === c) setInbox(result);
    } catch {
      // First sync failing must not strand "checking…" — show nothing;
      // an already-loaded list stays put and the next focus tries again.
      if (clientRef.current === c) setInbox((prev: Inbox | null) => prev ?? { gives: [], replies: [] });
    } finally {
      if (inFlightFor.current === c) inFlightFor.current = null;
      if (clientRef.current === c) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    setInbox(null);
    if (!client) return;
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [client, refresh]);

  return { status: xmtp.status, inbox, loading, refresh };
}
