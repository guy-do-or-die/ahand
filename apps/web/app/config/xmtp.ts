/// <reference types="vite/client" />
/**
 * XMTP config. The XMTP network is chain-agnostic — the hosted `dev`
 * network coexists fine with anvil and Base Sepolia, but XMTP may wipe it,
 * so a mainnet build sets VITE_XMTP_ENV=production ("local" pairs with
 * xmtp-local-node docker). Identities and conversations never carry across
 * networks.
 */
export type XmtpEnv = "local" | "dev" | "production";

export function resolveXmtpEnv(raw: string | undefined): XmtpEnv {
  if (!raw) return "dev";
  if (raw === "local" || raw === "dev" || raw === "production") return raw;
  throw new Error(`VITE_XMTP_ENV must be local, dev or production, not "${raw}"`);
}

export const XMTP_ENV = resolveXmtpEnv(import.meta.env.VITE_XMTP_ENV as string | undefined);

/**
 * Marker that an address already registered its XMTP identity from this
 * browser, so the client can rehydrate silently (Client.build) instead of
 * asking the pocket for an OK again (Client.create). Scoped per network;
 * `dev` keeps the original unscoped key so existing markers stay valid.
 */
export function xmtpRegisteredKey(address: string, env: XmtpEnv = XMTP_ENV): string {
  const scope = env === "dev" ? "" : `${env}.`;
  return `ahand.xmtp.${scope}registered.${address.toLowerCase()}`;
}
