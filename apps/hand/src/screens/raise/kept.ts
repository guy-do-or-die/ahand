import { deviceClock, loadPrefs, setPref, type KeptRaise } from "../../store/db";

/**
 * The raise form across a social login (docs/app.md "Logging in through Privy"). Google, Apple and
 * X through Privy send the person away and back by a fresh load of /raise, which would forget a
 * form that lives only in the screen's state. So when the swipe asks someone to log in, the form is
 * written to this device's prefs; whatever way the login ends on this page, it is removed; and when
 * /raise opens it is taken out (removed in any case) and filled back in if it was written within
 * `KEPT_MS` by this device's clock (store/db.ts `deviceClock`: the trip is this device's own, not
 * the chain's). The asker's own words only, the same that `hands` keeps once a Hand is raised: no seed,
 * no key, no link (an opened link is never kept, D-39).
 */

export type RaiseForm = Omit<KeptRaise, "at">;

/** How long a kept form stays good: the login window's own limit (wallet/privy-host.tsx LOGIN_MS). */
export const KEPT_MS = 30 * 60_000;

/** Keeps the form while the login window is open. Storage that refuses keeps nothing. */
export function keepRaise(form: RaiseForm, now: number = deviceClock()): Promise<void> {
  return setPref("raiseForm", { ...form, at: now }).catch(() => undefined);
}

/** The login ended on this page: nothing to carry. */
export function dropKeptRaise(): Promise<void> {
  return setPref("raiseForm", undefined).catch(() => undefined);
}

/** The form kept before a social login, removed from storage; undefined when none, or older than `KEPT_MS`. */
export async function takeKeptRaise(now: number = deviceClock()): Promise<RaiseForm | undefined> {
  const kept = await loadPrefs()
    .then((prefs) => prefs.raiseForm)
    .catch(() => undefined);
  if (!kept) return undefined;
  await dropKeptRaise();
  if (!(kept.at <= now && now - kept.at < KEPT_MS)) return undefined;
  const { at: _at, ...form } = kept;
  return form;
}
