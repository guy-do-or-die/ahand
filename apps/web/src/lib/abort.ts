/**
 * One controller for the two ways a piece of work ends: its own stop, and a caller's signal, whose
 * abort is passed on with its reason. `AbortSignal.any([a, b])` says the same, but Safari has it
 * only from 17.4, and a phone that was never updated keeps an older one.
 *
 * `release` lets go of the caller's signal: call it when the work is over, so a signal that lives
 * as long as a screen does not keep a listener for every piece of work that ran under it.
 */
export function stopWith(outer?: AbortSignal): { stop: AbortController; release: () => void } {
  const stop = new AbortController();
  if (!outer) return { stop, release: () => {} };
  if (outer.aborted) {
    stop.abort(outer.reason);
    return { stop, release: () => {} };
  }
  const pass = () => stop.abort(outer.reason);
  outer.addEventListener("abort", pass, { once: true });
  return { stop, release: () => outer.removeEventListener("abort", pass) };
}
