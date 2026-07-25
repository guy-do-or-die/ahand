/**
 * XMTP config. The XMTP network is chain-agnostic — the hosted `dev`
 * network coexists fine with the local anvil chain. Hardcoded like
 * web3.ts; switch to "production" (or "local" + xmtp-local-node docker)
 * when the app leaves the local stand.
 */
export const XMTP_ENV = "dev" as const;

/**
 * Marker that an address already registered its XMTP identity from this
 * browser, so the client can rehydrate silently (Client.build) instead of
 * asking the pocket for an OK again (Client.create).
 */
export function xmtpRegisteredKey(address: string): string {
  return `ahand.xmtp.registered.${address.toLowerCase()}`;
}
