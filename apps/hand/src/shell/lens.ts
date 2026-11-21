import { useSyncExternalStore } from "react";

import { setPref } from "../store/db";

/**
 * The lens (UX-SPEC §6): one switch that opens every disclosure in place, so the evidence under
 * each sentence shows without changing the layout. The footer's switch beside the theme switch
 * and the `?` key flip it; the choice is kept in `prefs` on this device. While it is on, <html> carries `data-lens="on"` for
 * styles, and `useLens()` re-renders whoever reads it (Disclose, the Deal card's lens lines). It
 * also brings up Privy's own confirmation windows for an account Privy keeps (wallet/privy-host.tsx
 * `showWalletUIs`, the owner's decision of 2026-11-21).
 */

let on = false;
const listeners = new Set<() => void>();

function apply(next: boolean): void {
  on = next;
  if (typeof document !== "undefined") {
    if (next) document.documentElement.dataset.lens = "on";
    else delete document.documentElement.dataset.lens;
  }
  for (const listener of listeners) listener();
}

/** Starts with the choice this device kept, or off. Called once at boot. */
export function initLens(saved: boolean | undefined): void {
  apply(saved === true);
}

export function lensOn(): boolean {
  return on;
}

/**
 * The writes of the choice, one after another: two flips in quick succession are two IndexedDB
 * transactions, and without the queue the first could commit after the second, bringing back a
 * choice the person had already undone.
 */
let saving: Promise<void> = Promise.resolve();

/** Turns the lens on or off and remembers it on this device; the last choice is the one kept. */
export function setLens(next: boolean): void {
  apply(next);
  saving = saving.then(() => setPref("lens", next)).catch(() => undefined);
}

/** Resolves once every choice made so far is written (for tests and for leaving the page). */
export function lensSaved(): Promise<void> {
  return saving;
}

export function toggleLens(): void {
  setLens(!on);
}

/**
 * Calls `listener` after every flip; returns the way to stop. For whoever follows the lens outside
 * a component of the app's own tree (wallet/privy-host.tsx gives Privy its windows by it).
 */
export function watchLens(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the lens is on, re-rendering the caller when it flips. */
export function useLens(): boolean {
  return useSyncExternalStore(watchLens, lensOn, lensOn);
}

function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== "function") return false;
  return element.isContentEditable || element.closest("input, textarea, select, [contenteditable]") !== null;
}

/** The `?` key flips the lens, except while typing or with Ctrl, Alt or Meta held. */
export function listenForLensKey(): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "?" || event.ctrlKey || event.altKey || event.metaKey || event.repeat || typing(event.target)) return;
    event.preventDefault();
    toggleLens();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
