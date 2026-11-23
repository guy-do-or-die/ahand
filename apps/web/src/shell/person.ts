import { useSyncExternalStore } from "react";
import type { Address } from "viem";

/**
 * Which person's sheet is open over the page, if any: the viewer's own ("me": the header's
 * button) or anyone else's by address (a name pressed on a card or on the route). One store, so
 * any screen can open it and the shell draws it once. The sheet is a layer, not a place: it
 * changes no address and no history, so a link held in this tab and a half-filled form stay.
 */
export type PersonShown =
  | { who: "me" }
  /** `role` says how this screen knows them: the asker of the hand on screen, or someone on its route. */
  | { who: "other"; address: Address; name?: string; role?: "asker" | "onRoute" };

let shown: PersonShown | undefined;
const listeners = new Set<() => void>();

function set(next: PersonShown | undefined): void {
  shown = next;
  for (const listener of listeners) listener();
}

export function showMe(): void {
  set({ who: "me" });
}

export function showPerson(address: Address, about: { name?: string; role?: "asker" | "onRoute" } = {}): void {
  set({ who: "other", address, ...about });
}

export function hidePerson(): void {
  set(undefined);
}

/**
 * The way in, asked for from the viewer's sheet. The sheet is a modal dialog, which the browser
 * draws above everything else on the page; Privy's own window is an ordinary layer of the page and
 * would open under it, unseen and out of reach (seen on the public build on 2026-11-21). So the
 * sheet closes first, the way in opens over the page itself, and the sheet comes back once
 * someone is in.
 */
let entering = false;

export function askToEnter(): void {
  entering = true;
  set(undefined);
}

export function doneEntering(connected: boolean): void {
  entering = false;
  set(connected ? { who: "me" } : undefined);
}

/**
 * The viewer's sheet steps aside while `run` lasts and comes back after it, whatever its end: for
 * a window of Privy's own asked for from the sheet ("Add a passkey"), which would open under the
 * sheet for the reason `askToEnter` gives.
 */
export async function asideWhile<T>(run: () => Promise<T>): Promise<T> {
  set(undefined);
  try {
    return await run();
  } finally {
    set({ who: "me" });
  }
}

export function useEntering(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => entering,
    () => false,
  );
}

/** The sheet shown now, read outside React. */
export function personShown(): PersonShown | undefined {
  return shown;
}

export function usePersonShown(): PersonShown | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => shown,
    () => undefined,
  );
}
