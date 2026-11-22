import type { WalletOption } from "./state";

/**
 * The fallback for an app's built-in browser that sets `window.ethereum` without announcing itself
 * through EIP-6963 (many phone wallets): wagmi's `injected()` with this id (wallet/config.ts),
 * listed by "Connect a wallet" only when no wallet announced, so the same app never shows twice.
 * Pure, so it is tested without the app's configuration.
 */

/** The fallback connector's id: wagmi's `injected()` with no target. */
export const FALLBACK_ID = "injected";

/** Whether this page has a `window.ethereum` at all (read when the sheet draws: some apps set it late). */
export function hasWindowEthereum(): boolean {
  const win = globalThis as { ethereum?: unknown; window?: unknown };
  return typeof win.window !== "undefined" && typeof win.ethereum === "object" && win.ethereum !== null;
}

/**
 * The browser's wallets as the sheet lists them: every announced one, or, when none announced,
 * `window.ethereum` if the page has one.
 */
export function foundOptions(options: readonly WalletOption[], windowEthereum = hasWindowEthereum()): WalletOption[] {
  const found = options.filter((o) => o.kind === "found");
  const announced = found.filter((o) => !o.fallback);
  return announced.length > 0 ? announced : windowEthereum ? found.filter((o) => o.fallback) : [];
}
