import { useSyncExternalStore } from "react";

import { setPref } from "../store/db";

/**
 * The lens (UX-SPEC §6): one switch that opens every disclosure in place, so the evidence under
 * each sentence shows without changing the layout. The header's 🔍 and the `?` key flip it; the
 * choice is kept in `prefs` on this device. While it is on, <html> carries `data-lens="on"` for
 * styles, and `useLens()` re-renders whoever reads it (Disclose, the Deal card's lens lines).
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

/** Turns the lens on or off and remembers it on this device. */
export function setLens(next: boolean): void {
  apply(next);
  void setPref("lens", next).catch(() => undefined);
}

export function toggleLens(): void {
  setLens(!on);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the lens is on, re-rendering the caller when it flips. */
export function useLens(): boolean {
  return useSyncExternalStore(subscribe, lensOn, lensOn);
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
