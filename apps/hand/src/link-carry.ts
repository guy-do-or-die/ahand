import { useEffect } from "react";

import { navigate, placeNow } from "./router";
import { deviceClock } from "./store/db";
import { openedLink, remember, subscribeOpened, type OpenedLink } from "./store/memory";
import { privyReturning } from "./wallet/privy-mark";

/**
 * An opened link carried across one social login (docs/defaults.md question 11, option b; the one
 * exception to D-39). Google, Apple and X through Privy send the person to the provider and back
 * by a fresh load of the same address (Privy 3.51.3 calls `window.location.assign`), and a fresh
 * load forgets a link that lives only in this tab's memory (store/memory.ts). Decided by the
 * owner on 2026-11-21 (option b): carry it across that trip in this tab's `sessionStorage` and
 * erase it on return. A per-person setting kept encrypted in ENS data records is a note for later,
 * not built.
 *
 * How narrow it is:
 *
 *   - Written only at the moment the page leaves (`pagehide`) while Privy's login window is open
 *     (`armLinkCarry`, called by wallet/privy-host.tsx `openLogin`) on a screen that holds an opened
 *     link (`useHoldsLink`: the Hand view showing a link, /give, /pass) and while memory holds one.
 *     Privy navigates by itself from inside its own window, so the app never sees the press on
 *     Google; the page leaving while that window is open is the narrowest moment the app can see,
 *     and an email, passkey or wallet login, which never leaves the page, writes nothing.
 *   - One key for the link, the literal "ahand-link-carry", and one for an answer draft that goes
 *     with it (below), the literal "ahand-give-draft", both in this tab's `sessionStorage` (not
 *     localStorage, not IndexedDB): another tab never reads them, and closing the tab drops them.
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
 * The answer typed on /give goes with the link (docs/defaults.md question 11, decided by the owner on
 * 2026-11-22): a helper who writes first and only then presses "Log in to get paid" would otherwise
 * come back to an empty field. It is written by `writeCarry` at the same moment, under a second key,
 * "ahand-give-draft", only when the link itself was written and /give holds a non-empty draft
 * (`useHoldsDraft`); it names the Hand it was typed for (chain, Core, number) and carries the link
 * record's own time. It is erased with the link on every path above, taken out with it on every
 * load, and kept for the screen (in memory only) only when the link itself was put back and the
 * time matches; /give then fills it in only for that same Hand and while memory still holds that
 * same restored link (`takeCarriedDraft`). Anything else erases it unused.
 *
 * What stays: between the write and the return the link's text sits in this tab's session storage,
 * which the browser may keep on disk (a crash or a restored session leaves it until the next load
 * of the app in that tab, which erases it unused); a tab opened from this one by script may get a
 * copy of the tab's session storage. The same holds for an answer draft carried with it. Nothing
 * here reaches the console, a query string or a request.
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

/** The Hand an answer draft was typed for: its chain, its Core (lower case) and its number. */
export interface DraftHand {
  chainId: number;
  core: string;
  handId: string;
}

/** What is written under the second key: the draft, its Hand, and the link record's own `at`. */
export interface CarriedDraft extends DraftHand {
  text: string;
  at: number;
}

/** What `takeCarried` hands back: the link, and the draft written with it, if any. */
export type TakenCarry = Carried & { draft?: CarriedDraft };

/**
 * The longest draft taken back, in UTF-16 units: the answer field stops at 1000 characters
 * (screens/give/flow.ts `MAX_WORDS`), which is at most 2000 units.
 */
export const DRAFT_MAX_UNITS = 2000;

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

/* ────────────────────────────────────────────────────── the answer draft ── */

let draft: { hand: DraftHand; text: string } | undefined;

/** /give says what is typed in its answer field now, for which Hand; the returned function takes it back. */
export function holdDraft(hand: DraftHand, text: string): () => void {
  const mine = { hand: { chainId: hand.chainId, core: hand.core.toLowerCase(), handId: hand.handId }, text };
  draft = mine;
  return () => {
    if (draft === mine) draft = undefined;
  };
}

/** `holdDraft` for as long as the calling screen shows this draft for this Hand (none: `hand` undefined). */
export function useHoldsDraft(hand: DraftHand | undefined, text: string): void {
  const chainId = hand?.chainId;
  const core = hand?.core;
  const handId = hand?.handId;
  useEffect(() => (chainId !== undefined && core !== undefined && handId !== undefined ? holdDraft({ chainId, core, handId }, text) : undefined), [chainId, core, handId, text]);
}

/** The draft put back with a restored link, for /give to take once; with the link object memory held then. */
let restored: { link: OpenedLink; draft: CarriedDraft } | undefined;
/** Stops watching memory for the restored link; set while `restored` is. */
let unwatchRestored: (() => void) | undefined;

/** Lets go of the restored draft and stops watching memory for its link. */
function letGoRestored(): void {
  restored = undefined;
  unwatchRestored?.();
  unwatchRestored = undefined;
}

/**
 * Keeps the restored draft only while memory holds the link restored with it: forgotten or
 * replaced, the link takes the draft with it, so the text does not outlive it in memory when /give
 * never takes it (a Hand that is not live, an opening that failed).
 */
function keepRestored(link: OpenedLink, typed: CarriedDraft): void {
  letGoRestored();
  restored = { link, draft: typed };
  unwatchRestored = subscribeOpened(() => {
    if (openedLink() !== link) letGoRestored();
  });
}

/**
 * The draft carried across a social login, for this Hand: handed back once, and only while memory
 * still holds the very link that was restored with it. Any call lets it go, whatever it returns.
 */
export function takeCarriedDraft(hand: DraftHand): string | undefined {
  const kept = restored;
  letGoRestored();
  if (!kept || openedLink() !== kept.link) return undefined;
  const same = kept.draft.chainId === hand.chainId && kept.draft.core === hand.core.toLowerCase() && kept.draft.handId === hand.handId;
  return same ? kept.draft.text : undefined;
}

/* ──────────────────────────────────────────────────────────── the keys ── */

/** Where the page stands now: its path and whether "/" is the Hand view. */
function here(): { path: string; hand: boolean } | undefined {
  if (typeof location === "undefined") return undefined;
  const state = typeof history === "undefined" ? null : (history.state as { view?: string } | null);
  return { path: location.pathname, hand: location.pathname === "/" && state?.view === "hand" };
}

/**
 * Writes the opened link, if a screen holds one now, and with it the answer draft /give holds, if
 * any (none: its key is erased). Storage that refuses keeps nothing.
 */
export function writeCarry(now: number = deviceClock()): boolean {
  const link = openedLink();
  const where = here();
  if (holders === 0 || !link?.fragment || !where) return false;
  const carried: Carried = { before: link.before, fragment: link.fragment, via: link.via, path: where.path, hand: where.hand, at: now };
  try {
    sessionStorage.setItem("ahand-link-carry", JSON.stringify(carried));
  } catch {
    return false;
  }
  const typed: CarriedDraft | undefined = draft && draft.text.trim() !== "" && draft.text.length <= DRAFT_MAX_UNITS ? { ...draft.hand, text: draft.text, at: now } : undefined;
  try {
    if (typed) sessionStorage.setItem("ahand-give-draft", JSON.stringify(typed));
    else sessionStorage.removeItem("ahand-give-draft");
  } catch {
    // Storage refused the draft: the link still goes, the field comes back empty as before.
  }
  return true;
}

/** Erases both keys, whatever they hold. Storage that refuses held nothing. */
export function eraseCarry(): void {
  try {
    sessionStorage.removeItem("ahand-link-carry");
  } catch {
    // Storage refused: nothing was written either.
  }
  try {
    sessionStorage.removeItem("ahand-give-draft");
  } catch {
    // As above.
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

/** Whether a parsed value has the shape of a draft `writeCarry` writes. */
function isDraft(value: unknown): value is CarriedDraft {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.chainId === "number" &&
    Number.isSafeInteger(v.chainId) &&
    typeof v.core === "string" &&
    /^0x[0-9a-f]{40}$/.test(v.core) &&
    typeof v.handId === "string" &&
    /^[0-9]{1,78}$/.test(v.handId) &&
    typeof v.text === "string" &&
    v.text.trim() !== "" &&
    v.text.length <= DRAFT_MAX_UNITS &&
    typeof v.at === "number"
  );
}

/** Reads one key and erases it; undefined when it held nothing or does not parse. Throws where storage refuses. */
function takeKey(key: "link" | "draft"): unknown {
  let raw: string | null;
  if (key === "link") {
    raw = sessionStorage.getItem("ahand-link-carry");
    if (raw !== null) sessionStorage.removeItem("ahand-link-carry");
  } else {
    raw = sessionStorage.getItem("ahand-give-draft");
    if (raw !== null) sessionStorage.removeItem("ahand-give-draft");
  }
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Takes both keys out: they are erased first, on every call; what the link key held comes back
 * only when this load is the way back from a social login (`returning`) and it was written within
 * `CARRY_MS`, and the draft with it only when it was written at that same moment.
 */
export function takeCarried(returning: boolean = privyReturning(), now: number = deviceClock()): TakenCarry | undefined {
  let value: unknown;
  let typed: unknown;
  try {
    value = takeKey("link");
  } catch {
    value = undefined; // the draft key is still tried below, so both are erased wherever storage allows
  }
  try {
    typed = takeKey("draft");
  } catch {
    typed = undefined;
  }
  if (!returning || !isCarried(value)) return undefined;
  if (!(value.at <= now && now - value.at < CARRY_MS)) return undefined;
  return isDraft(typed) && typed.at === value.at ? { ...value, draft: typed } : value;
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
 * page is on the path it left from, and the address brought no link of its own; an answer draft
 * carried with it is kept in memory for /give (`takeCarriedDraft`). Returns whether a link was put
 * back.
 */
export function restoreCarriedLink(returning: boolean = privyReturning(), now: number = deviceClock()): boolean {
  letGoRestored();
  const carried = takeCarried(returning, now);
  if (!carried || openedLink()) return false;
  const where = here();
  if (!where || where.path !== carried.path) return false;
  remember({ before: carried.before, fragment: carried.fragment, via: carried.via });
  const link = openedLink();
  if (carried.draft && link) keepRestored(link, carried.draft);
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
