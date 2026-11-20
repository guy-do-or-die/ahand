import { refresh } from "./router";
import { remember } from "./store/memory";

/**
 * Link intake (D-39, brief 08 §3). On load, and whenever the fragment changes in this tab, the
 * text after `#` is read once into memory (store/memory.ts) together with the address before it,
 * and the address bar is rewritten without it by history.replaceState. A fragment that arrives
 * on "/" marks that history entry as the Hand view. This is the only module that reads
 * `location.hash` or `location.href`; the secrets guard checks that.
 *
 * Not promised: that every browser also drops the original address from its history list.
 */

interface Where {
  location: Pick<Location, "href" | "hash" | "pathname" | "search">;
  history: Pick<History, "replaceState" | "state">;
}

/** Reads the fragment, if any, into memory and removes it from the address. Returns whether a link arrived. The `where` of a test must be the window the router reads. */
export function intake(where: Where = window): boolean {
  const href = where.location.href;
  const mark = href.indexOf("#");
  if (mark < 0) return false;
  const fragment = href.slice(mark + 1);
  const before = href.slice(0, mark);
  const path = where.location.pathname + where.location.search;
  const onRoot = where.location.pathname === "/";
  const state = onRoot && fragment ? { view: "hand" as const } : where.history.state;
  where.history.replaceState(state, "", path);
  if (fragment) remember({ before, fragment, via: "address" });
  refresh(); // the router read the address when it loaded; it now reads the one without the fragment
  return fragment !== "";
}

/** Runs intake now and again on every `hashchange` (a link pasted into this tab's address bar). */
export function startIntake(): () => void {
  intake();
  const again = () => void intake();
  window.addEventListener("hashchange", again);
  return () => window.removeEventListener("hashchange", again);
}
