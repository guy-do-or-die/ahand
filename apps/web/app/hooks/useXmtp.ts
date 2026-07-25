import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useConnection, useSignMessage } from "wagmi";
import { FLAGS } from "../config/flags";
import { xmtpRegisteredKey } from "../config/xmtp";
import { isUserRejection } from "../lib/errors";
import {
  buildClientSilently,
  canReachAddress,
  getOrCreateClient,
  resetClient,
  XmtpBusyError,
  type SignHex,
  type XmtpClient,
} from "../lib/xmtpClient";

export type XmtpStatus =
  | "idle" // SSR / flag off / not yet synced
  | "disconnected" // no pocket connected
  | "unregistered" // connected, direct delivery not switched on here yet
  | "connecting"
  | "ready"
  | "busy" // another tab holds the local db
  | "error";

type XmtpSnapshot = {
  address: string | null;
  status: XmtpStatus;
  client: XmtpClient | null;
  /** Network truth: can helpers reach this address (registered anywhere)? */
  reachable: boolean | null;
};

/**
 * Module-level store shared by every useXmtp instance — the XMTP client is
 * a per-tab singleton, so its UI state must be too (a card enabling
 * delivery has to unhide the inbox in the same render pass). Async
 * continuations commit only if the address they started for is still the
 * one on screen.
 */
const IDLE: XmtpSnapshot = { address: null, status: "idle", client: null, reachable: null };
let snapshot: XmtpSnapshot = IDLE;
const listeners = new Set<() => void>();

function commit(patch: Partial<XmtpSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => IDLE;

function syncForAddress(address?: string): void {
  const addr = address?.toLowerCase() ?? null;
  // Already tracking — but a past "error" is worth a silent retry on the
  // next screen; only a live/settled state short-circuits.
  if (snapshot.address === addr && snapshot.status !== "idle" && snapshot.status !== "error") return;
  if (!addr) {
    resetClient();
    commit({ address: null, status: "disconnected", client: null, reachable: null });
    return;
  }

  const marker = localStorage.getItem(xmtpRegisteredKey(addr));
  commit({ address: addr, status: marker ? "connecting" : "unregistered", client: null, reachable: null });

  // Strictly sequential: resume first, reachability after it settles.
  // Both can spin an engine on the SAME address's store — overlap is how
  // the raiser mount kept corrupting itself.
  buildClientSilently(addr)
    .then(
      (client: XmtpClient) => {
        if (snapshot.address === addr) commit({ client, status: "ready", reachable: true });
      },
      (err: unknown) => {
        if (snapshot.address !== addr) return;
        if (err instanceof XmtpBusyError) {
          commit({ status: "busy" });
          return;
        }
        // Nothing to resume here (wiped db, new profile) — back to opt-in.
        if (marker) localStorage.removeItem(xmtpRegisteredKey(addr));
        if (snapshot.status === "connecting") commit({ status: "unregistered" });
      },
    )
    .then(() => {
      if (snapshot.address !== addr || snapshot.reachable !== null) return;
      canReachAddress(addr).then(
        (ok: boolean) => {
          if (snapshot.address === addr) commit({ reachable: ok });
        },
        () => {
          /* network hiccup — stay undecided */
        },
      );
    });
}

async function enableForAddress(address: string, signHex: SignHex): Promise<XmtpClient | null> {
  const addr = address.toLowerCase();
  if (snapshot.address !== addr) return null;
  commit({ status: "connecting" });
  try {
    const client = await getOrCreateClient(addr, signHex);
    if (snapshot.address !== addr) return null; // pocket switched mid-confirm
    commit({ client, status: "ready", reachable: true });
    return client;
  } catch (err) {
    if (snapshot.address !== addr) return null;
    if (isUserRejection(err)) {
      // They closed the confirm — a quiet non-event, back where they were.
      commit({ status: "unregistered" });
      return null;
    }
    // Wallet session still waking up (wagmi "Connector not connected") —
    // transient; keep the switch usable instead of blaming the network.
    if (/connector/i.test(String((err as Error)?.message ?? ""))) {
      commit({ status: "unregistered" });
      return null;
    }
    commit({ status: err instanceof XmtpBusyError ? "busy" : "error" });
    return null;
  }
}

/**
 * XMTP identity lifecycle for the connected address. Mount-time work is
 * silent by design (rehydrate + reachability lookups only) — the one-time
 * registration OK is asked exclusively inside `enable()`, a user action.
 */
export function useXmtp() {
  const { address } = useConnection();
  const { mutateAsync: signMessageAsync } = useSignMessage();

  const signHexRef = useRef(signMessageAsync);
  signHexRef.current = signMessageAsync;

  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!FLAGS.xmtpDelivery) return;
    syncForAddress(address);
  }, [address]);

  /**
   * Switch on direct delivery — may ask the pocket for one OK (first
   * registration only; registering a new device for a known identity also
   * goes through here). Returns the client, or null if the person closed
   * the confirm (a quiet non-event, not an error).
   */
  const enable = useCallback(async (): Promise<XmtpClient | null> => {
    if (!address) return null;
    return enableForAddress(address, (message: string) => signHexRef.current({ message }));
  }, [address]);

  return { status: snap.status, client: snap.client, reachable: snap.reachable, address: snap.address, enable };
}
