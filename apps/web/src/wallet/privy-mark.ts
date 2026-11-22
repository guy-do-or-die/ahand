/**
 * Whether this browser may hold a Privy session, answered without loading Privy (wallet/privy.ts):
 * the page's first paint reads this, so it imports nothing.
 *
 * The mark is one word in localStorage under the literal key "ahand-privy", written when someone
 * logs in through Privy and removed when they log out or their session is found gone. It says only
 * "a Privy session may be here"; Privy's own session lives in Privy's own storage. With the mark,
 * the app loads Privy once the page is idle and lets the person back in without a new code; without
 * it, Privy loads only when someone presses "Log in" or an action that needs an account. Storage
 * that refuses (a private window, blocked site data) reads as no mark: the person logs in again.
 */

export function privyMarked(): boolean {
  try {
    return localStorage.getItem("ahand-privy") === "1";
  } catch {
    return false;
  }
}

export function markPrivy(on: boolean): void {
  try {
    if (on) localStorage.setItem("ahand-privy", "1");
    else localStorage.removeItem("ahand-privy");
  } catch {
    // Storage refused: the session is simply not restored after a reload.
  }
}

/**
 * Whether this page is the way back from a social login (Google, Apple, X): Privy sent the person
 * to the provider and the provider sent them back here with Privy's code in the query. Privy must
 * then load at once to finish the login.
 */
export function privyReturning(): boolean {
  if (typeof location === "undefined") return false;
  const query = new URLSearchParams(location.search);
  return query.has("privy_oauth_code") && query.has("privy_oauth_state");
}

/**
 * Whether this page was opened as the way back from a social login, read once as the app's code
 * first runs: Privy takes its code out of the query as it finishes, so a screen that renders later
 * asks this, not `privyReturning()`.
 */
export const cameBackFromSocial: boolean = privyReturning();
