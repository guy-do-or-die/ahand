import { useSyncExternalStore } from "react";

/**
 * The opened link, held in this tab's memory and nowhere else (ARCHITECTURE §11, D-39).
 *
 * `link-intake.ts` puts here what arrived after `#` together with the address before it, then
 * removes the fragment from the address bar. The landing's paste box, /my handing a give
 * address to /thank, and a pass that wrote a new address put theirs here the same way. "Copy"
 * and "Share" read the address from here, never from `location`. A reload forgets it, and the
 * screen says so: nothing here is ever written to storage, the console, a query string or a
 * request.
 */

export interface OpenedLink {
  /** What stood before `#`: the site, the path and any `?d=`; empty when only a bare link was pasted. */
  before: string;
  /** What stood after `#`, exactly as written (the link). */
  fragment: string;
  /** How it came: in the address this tab was opened with, pasted into a box, or handed over by a screen. */
  via: "address" | "paste" | "handover";
}

let opened: OpenedLink | undefined;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Keeps a link in memory, replacing the one held before. */
export function remember(link: OpenedLink): void {
  opened = { ...link };
  changed();
}

/**
 * Keeps a pasted or handed-over address or bare link: split at its first `#`. Text with no `#`
 * is kept whole as the link (a bare link or QR digits); the screen that opens it judges it.
 */
export function rememberText(text: string, via: "paste" | "handover" = "paste"): void {
  const trimmed = text.trim();
  const mark = trimmed.indexOf("#");
  remember(mark < 0 ? { before: "", fragment: trimmed, via } : { before: trimmed.slice(0, mark), fragment: trimmed.slice(mark + 1), via });
}

/** The link held now, if any. */
export function openedLink(): OpenedLink | undefined {
  return opened;
}

/** The whole address to copy or share: what stood before `#`, then the link. */
export function addressOf(link: OpenedLink | undefined = opened): string | undefined {
  if (!link) return undefined;
  return link.before ? `${link.before}#${link.fragment}` : link.fragment;
}

/** Forgets the link held now. */
export function forget(): void {
  if (!opened) return;
  opened = undefined;
  changed();
}

export function subscribeOpened(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The link held now, re-rendering the caller when it changes. */
export function useOpened(): OpenedLink | undefined {
  return useSyncExternalStore(subscribeOpened, openedLink, openedLink);
}
