import { useEffect } from "react";

import { navigate, placeNow } from "./router";
import { deviceClock } from "./store/db";
import { openedLink, remember, type OpenedLink } from "./store/memory";
import { privyReturning } from "./wallet/privy-mark";

/**
 * An opened link carried across one social login (docs/defaults.md question 11, option b; the one
 * exception to D-39). Google, Apple and X through Privy send the person to the provider and back
 * by a fresh load of the same address (Privy 3.51.3 calls `window.location.assign`), and a fresh
 * load forgets a link that lives only in this tab's memory (store/memory.ts). The owner on
 * 2026-11-21, asked whether to carry it across that trip in this tab's `sessionStorage` and erase
 * it on return: «ну, надо, да. нужно предоставлять возможность хоть какими-то удобствами
 * пользоваться. это пожже всё можно сделать настраиваемым (как и многие другие предпочтения юзера)
 * и хранить в дата рекордс ENS зашифрованными , например...» ("well, yes, we need to. We have to let
 * people use at least some conveniences. All of this can later be made configurable (like many of
 * the user's other preferences) and kept encrypted in ENS data records, for example..."). The later
 * idea is a note for later, not built.
 *
 * How narrow it is:
 *
 *   - Written only at the moment the page leaves (`pagehide`) while Privy's login window is open
 *     (`armLinkCarry`, called by wallet/privy-host.tsx `openLogin`) on a screen that holds an opened
 *     link (`useHoldsLink`: the Hand view showing a link, /give, /pass) and while memory holds one.
 *     Privy navigates by itself from inside its own window, so the app never sees the press on
 *     Google; the page leaving while that window is open is the narrowest moment the app can see,
 *     and an email, passkey or wallet login, which never leaves the page, writes nothing.
 *   - One key, the literal "ahand-link-carry", in this tab's `sessionStorage` (not localStorage,
 *     not IndexedDB): another tab never reads it, and closing the tab drops it.
 *   - Erased: when the login ends on this page (in, closed, failed: the disarm), when the page
 *     comes back from the browser's back-forward cache with its memory intact (`pageshow` with
 *     `persisted`), and on every load of the app (`restoreCarriedLink` in main.tsx), before it is
 *     used. It is used only when that load is the way back from a social login (Privy's code and
 *     state in the query), on the same path it left from, within `CARRY_MS` by this device's
 *     clock, and when the address did not bring a link of its own.
 *   - Restored into memory only, as link intake would have put it (the same `before`, the same
 *     `via`), never back into the address bar: putting `#…` back and letting intake read it would
 *     set `before` to the address with Privy's one-time code in its query, which "Copy" and "Share"
 *     would hand on, and would show the secret in the address bar a second time. On "/" the history
 *     entry is marked as the Hand view again (the provider's way back is a new entry with no state),
 *     and once more after Privy's own cleanup wipes that mark (`keepHandMark`).
 *   - Storage that refuses (a private window, blocked site data) carries nothing and throws
 *     nothing: the person opens the link once more, and `LinkAgain` (wallet/ConnectSheet.tsx) says so.
 *
 * What stays: between the write and the return the link's text sits in this tab's session storage,
 * which the browser may keep on disk (a crash or a restored session leaves it until the next load
 * of the app in that tab, which erases it unused); a tab opened from this one by script may get a
 * copy of the tab's session storage. Nothing here reaches the console, a query string or a request.
 */

/**
 * How long a carried link stays good: ten minutes, by this device's clock. The trip is Privy's
 * window, the provider's own sign-in (a password, a second factor) and back: a minute or two. The
 * raise form's `KEPT_MS` (30 minutes) is the login window's whole limit, which covers fetching an
 * email code; no inbox lies on a social trip, and a link is a secret where the form is not.
 */
export const CARRY_MS = 10 * 60_000;

/** What is written: the opened link as memory held it, where the screen stood, and when. */
export interface Carried extends OpenedLink {
  /** The path the page left from (no query, no fragment); the way back must land on it. */
  path: string;
  /** "/" was marked as the Hand view (a bare link opened on the root). */
  hand: boolean;
  /** When it was written (this device's clock, ms). */
  at: number;
}

/* ────────────────────────────────────────────────── screens that hold a link ── */

let holders = 0;

/** A screen showing an opened link says so while it does; the returned function takes it back. */
export function holdLink(): () => void {
  holders++;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holders--;
  };
}

/** `holdLink` for as long as the calling screen shows a link (`holding`). */
export function useHoldsLink(holding: boolean): void {
  useEffect(() => (holding ? holdLink() : undefined), [holding]);
}

/* ──────────────────────────────────────────────────────────── the one key ── */

/** Where the page stands now: its path and whether "/" is the Hand view. */
function here(): { path: string; hand: boolean } | undefined {
  if (typeof location === "undefined") return undefined;
  const state = typeof history === "undefined" ? null : (history.state as { view?: string } | null);
  return { path: location.pathname, hand: location.pathname === "/" && state?.view === "hand" };
}

/** Writes the opened link, if a screen holds one now. Storage that refuses keeps nothing. */
export function writeCarry(now: number = deviceClock()): boolean {
  const link = openedLink();
  const where = here();
  if (holders === 0 || !link?.fragment || !where) return false;
  const carried: Carried = { before: link.before, fragment: link.fragment, via: link.via, path: where.path, hand: where.hand, at: now };
  try {
    sessionStorage.setItem("ahand-link-carry", JSON.stringify(carried));
    return true;
  } catch {
    return false;
  }
}

/** Erases the key, whatever it holds. Storage that refuses held nothing. */
export function eraseCarry(): void {
  try {
    sessionStorage.removeItem("ahand-link-carry");
  } catch {
    // Storage refused: nothing was written either.
  }
}

/** Whether a parsed value has the shape `writeCarry` writes. */
function isCarried(value: unknown): value is Carried {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.before === "string" &&
    typeof v.fragment === "string" &&
    v.fragment !== "" &&
    (v.via === "address" || v.via === "paste" || v.via === "handover") &&
    typeof v.path === "string" &&
    v.path.startsWith("/") &&
    !v.path.includes("#") &&
    typeof v.hand === "boolean" &&
    typeof v.at === "number"
  );
}

/**
 * Takes the key out: it is erased first, on every call; what it held comes back only when this
 * load is the way back from a social login (`returning`) and it was written within `CARRY_MS`.
 */
export function takeCarried(returning: boolean = privyReturning(), now: number = deviceClock()): Carried | undefined {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem("ahand-link-carry");
    if (raw !== null) sessionStorage.removeItem("ahand-link-carry");
  } catch {
    return undefined;
  }
  if (!returning || raw === null) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isCarried(value)) return undefined;
  if (!(value.at <= now && now - value.at < CARRY_MS)) return undefined;
  return value;
}

/* ──────────────────────────────────────────────────────── leave and come back ── */

/**
 * While Privy's login window is open: if the page leaves, the opened link is written; if the page
 * comes back from the back-forward cache (its memory intact), the key is erased. The returned
 * function disarms and erases: the login ended on this page, so there is nothing to carry.
 */
export function armLinkCarry(target: Pick<EventTarget, "addEventListener" | "removeEventListener"> | undefined = typeof window === "undefined" ? undefined : window): () => void {
  if (!target) return () => undefined;
  const leave = () => void writeCarry();
  const back = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) eraseCarry();
  };
  target.addEventListener("pagehide", leave);
  target.addEventListener("pageshow", back);
  let armed = true;
  return () => {
    if (!armed) return;
    armed = false;
    target.removeEventListener("pagehide", leave);
    target.removeEventListener("pageshow", back);
    eraseCarry();
  };
}

/**
 * On load, right after link intake (main.tsx): the key is taken out (erased) in any case, and a
 * link carried across a social login is put back into memory when it is good (`takeCarried`), the
 * page is on the path it left from, and the address brought no link of its own. Returns whether a
 * link was put back.
 */
export function restoreCarriedLink(returning: boolean = privyReturning(), now: number = deviceClock()): boolean {
  const carried = takeCarried(returning, now);
  if (!carried || openedLink()) return false;
  const where = here();
  if (!where || where.path !== carried.path) return false;
  remember({ before: carried.before, fragment: carried.fragment, via: carried.via });
  if (carried.hand) {
    if (!where.hand) navigate(location.pathname + location.search, { replace: true, state: { view: "hand" } });
    keepHandMark(carried.fragment);
  }
  return true;
}

/** How often, and for how long, `keepHandMark` looks for Privy's cleanup (Privy's own wait for a social return is a minute). */
export const MARK_EVERY_MS = 100;
export const MARK_WITHIN_MS = 60_000;

/**
 * Marks "/" as the Hand view again once Privy has taken its code out of the query. Privy 3.51.3
 * finishes a social return with `window.history.replaceState({}, "", url)` (its `Dr()`, in the
 * `finally` of its OAuth login, so after a failed one too), which wipes the mark `restoreCarriedLink`
 * put on the entry without telling the router: the screen stays on the Hand view, but Back from the
 * next screen, or the next social login from this one (which reads `history.state`), would find the
 * start page with the restored link in memory and no screen showing it. Found in review on
 * 2026-11-21. Nothing tells the app when Privy is done, so this looks every `every` ms until the
 * query is clean, for at most `within` ms, and re-marks only while the router still shows the Hand
 * view on "/" and memory still holds this link (not after the person moved on). The re-mark is a
 * `navigate` with `replace`, which also re-reads the address, so the router drops Privy's stale query.
 */
export function keepHandMark(fragment: string, every: number = MARK_EVERY_MS, within: number = MARK_WITHIN_MS): void {
  // Counted in looks, not read from the device clock (tests/guards/clock.test.ts).
  let left = Math.ceil(within / every);
  const look = () => {
    if (privyReturning()) {
      if (--left > 0) setTimeout(look, every);
      return;
    }
    const shown = placeNow();
    if (location.pathname !== "/" || shown.path !== "/" || shown.state?.view !== "hand") return;
    if (openedLink()?.fragment !== fragment) return;
    if ((history.state as { view?: string } | null)?.view === "hand") return;
    navigate(location.pathname + location.search, { replace: true, state: { view: "hand" } });
  };
  setTimeout(look, every);
}
