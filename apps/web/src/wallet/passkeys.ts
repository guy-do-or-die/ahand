/**
 * The passkeys of a Privy account, without Privy's code: the person sheet's row (shell/passkey.tsx)
 * and the connector (privy.ts) both read this file, so the sheet loads no wallet code for it.
 */

/** The most passkeys Privy keeps on one account: its own check refuses a sixth (3.51.3). */
export const PASSKEYS_MOST = 5;

/**
 * What became of "Add a passkey" (`privyAddPasskey`): a new passkey on the account, one fewer
 * (removed in Privy's window), the same ones (the window was closed, or the device said no), the
 * account already at `PASSKEYS_MOST`, a browser without passkeys (WebAuthn), or Privy's window that
 * did not open.
 */
export type PasskeyOutcome = "added" | "removed" | "none" | "full" | "unsupported" | "failed";

/**
 * The outcome read from the account's passkeys (their credential ids) before and after Privy's
 * window: a passkey that was not there before is "added" even when another was removed in the same
 * window, so the line says nothing was added only when nothing was.
 */
export function passkeyOutcome(before: readonly string[], after: readonly string[]): "added" | "removed" | "none" {
  const had = new Set(before);
  if (after.some((id) => !had.has(id))) return "added";
  return after.length < before.length ? "removed" : "none";
}
