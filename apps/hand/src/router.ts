import { useSyncExternalStore } from "react";

/**
 * A pathname router (D-3): patterns with `:params`, pushState and popstate, scroll reset, and a
 * flag in history.state (`view: "hand"`) for the Hand view of a bare link on "/". The fragment is
 * never routed: `navigate` refuses a target with `#`, so a link's text cannot enter history here.
 */

export interface Place {
  path: string;
  search: string;
  state: { view?: "hand" } | null;
}
export type Params = Record<string, string>;

const listeners = new Set<() => void>();
let place: Place = read();

function read(): Place {
  if (typeof window === "undefined") return { path: "/", search: "", state: null };
  const state = window.history.state as Place["state"];
  return { path: window.location.pathname, search: window.location.search, state: state && typeof state === "object" ? state : null };
}

/** Re-reads the address after something else changed it (popstate, link intake). */
export function refresh(): void {
  place = read();
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") window.addEventListener("popstate", refresh);

/** Goes to a path on this site (with an optional query). Never with a fragment. */
export function navigate(to: string, options: { replace?: boolean; state?: Place["state"] } = {}): void {
  if (to.includes("#")) throw new Error("navigate: a fragment is never routed");
  if (!to.startsWith("/")) throw new Error("navigate: a path on this site starts with /");
  window.history[options.replace ? "replaceState" : "pushState"](options.state ?? null, "", to);
  if (!options.replace) window.scrollTo(0, 0);
  refresh();
}

/** Matches a pattern like "/:chain/:hand/proof" against a path; each param must pass its rule. */
export function matchPath(pattern: string, path: string, rules: Record<string, RegExp> = {}): Params | undefined {
  const want = pattern.split("/").filter(Boolean);
  const have = path.split("/").filter(Boolean);
  if (want.length !== have.length) return undefined;
  const params: Params = {};
  for (let i = 0; i < want.length; i++) {
    const part = want[i]!;
    let value: string;
    try {
      value = decodeURIComponent(have[i]!);
    } catch {
      return undefined;
    }
    if (part.startsWith(":")) {
      const name = part.slice(1);
      if (rules[name] && !rules[name]!.test(value)) return undefined;
      params[name] = value;
    } else if (part !== value) return undefined;
  }
  return params;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const current = () => place;

/** Where this tab is, re-rendering the caller when it moves. */
export function usePlace(): Place {
  return useSyncExternalStore(subscribe, current, current);
}

/** Lets plain same-site `<a href="/…">` links move without a page load (no modifier, no target, no `#`). */
export function interceptLinks(root: HTMLElement): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.("a");
    const href = anchor?.getAttribute("href");
    if (!anchor || !href || !href.startsWith("/") || href.startsWith("//") || href.includes("#")) return;
    if (anchor.target || anchor.hasAttribute("download") || anchor.dataset.reload !== undefined) return;
    event.preventDefault();
    navigate(href);
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
