import { useSyncExternalStore } from "react";
import type { Address } from "viem";

/**
 * Who is connected, for the frame alone (the header's own button). It imports nothing of the
 * wallet layer and starts nothing: the layer itself (state.ts) writes here whenever its
 * connection changes, so a page that never needed an account loads no wallet code because its
 * header shows one. Until the layer has started, nobody is connected as far as the frame knows.
 */
let who: Address | undefined;
const listeners = new Set<() => void>();

export function setWho(address: Address | undefined): void {
  if (who === address) return;
  who = address;
  for (const listener of [...listeners]) listener();
}

export function useWho(): Address | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => who,
    () => undefined,
  );
}
