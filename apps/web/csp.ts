/**
 * The Content Security Policy of the built app, written from the app's own
 * configuration so the build can carry it as a `<meta>` tag for hosts that send no headers.
 * The view server (apps/view/src/headers.ts) and the stand's static server send the same policy as a header;
 * `tests/csp.test.ts` and the view server's own test hold the three together.
 *
 *   default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
 *   font-src 'self'; connect-src 'self' <rpc urls> <relay urls>; worker-src 'none';
 *   object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
 *
 * In a `<meta>` tag `frame-ancestors` is left out: browsers ignore it there and Chromium reports
 * the ignored directive as a console error. It only works as a header, which the view server sends.
 *
 * A configuration with `privy` (logging in through Privy, wallet/privy.ts) adds Privy's sources and
 * nothing else (`PRIVY_CSP`): its login and wallet frame and WalletConnect's verify frame in
 * frame-src and child-src, Privy's API, the RPC its wallets send through and WalletConnect's relay
 * and wallet list in connect-src, and the wallet list's icons in img-src. No script from anywhere
 * but this site: Privy's code is bundled with the app, and its wallet keys live inside its own
 * frame on auth.privy.io.
 */

/**
 * What logging in through Privy needs beyond the app's own policy, as Privy's "Content Security
 * Policy" page lists it (https://docs.privy.io/security/implementation-guide/content-security-policy,
 * read 2026-11-21), for the ways in this app offers: email, social accounts, a passkey, Farcaster
 * and crypto wallets with WalletConnect: all of the page's "required domains", Coinbase's relay
 * (wss://www.walletlink.org) among them, as Privy's SDK may reach a Coinbase wallet through it.
 * Left out: Cloudflare's script and frame (Privy's bot protection stays off), Telegram, the funding
 * kit and Solana. `img` is the WalletConnect list's own icons, which Privy shows from
 * explorer-api.walletconnect.com.
 * apps/view/src/headers.ts PRIVY_SOURCES holds the same; tests/csp.test.ts holds the two together.
 */
export const PRIVY_CSP = {
  frame: ["https://auth.privy.io", "https://verify.walletconnect.com", "https://verify.walletconnect.org"],
  connect: ["https://auth.privy.io", "https://*.rpc.privy.systems", "wss://relay.walletconnect.com", "wss://relay.walletconnect.org", "wss://www.walletlink.org", "https://explorer-api.walletconnect.com"],
  img: ["https://explorer-api.walletconnect.com"],
} as const;

export interface CspSources {
  rpcUrls: readonly string[];
  relays: readonly string[];
  /** The configuration has `privy`: logging in through Privy. */
  privy?: boolean;
}

/** A CSP source for a URL: its origin (scheme, host, port). */
function originOf(url: string): string {
  return new URL(url).origin;
}

export function appCsp(sources: CspSources, delivery: "header" | "meta" = "header"): string {
  const connect = [...new Set(["'self'", ...sources.rpcUrls.map(originOf), ...sources.relays.map(originOf), ...(sources.privy ? PRIVY_CSP.connect : [])])];
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${["'self'", "data:", ...(sources.privy ? PRIVY_CSP.img : [])].join(" ")}`,
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    ...(sources.privy ? [`frame-src ${PRIVY_CSP.frame.join(" ")}`, `child-src ${PRIVY_CSP.frame.join(" ")}`] : []),
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ];
  if (delivery === "header") directives.push("frame-ancestors 'none'");
  return directives.join("; ");
}

/** The `<meta>` tag, with the policy escaped for an HTML attribute. */
export function cspMetaTag(sources: CspSources): string {
  const value = appCsp(sources, "meta").replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return `<meta http-equiv="Content-Security-Policy" content="${value}" />`;
}

/**
 * The headers `vite preview` sends, the same as the view server's base headers (apps/view/src/headers.ts):
 * the CSP, no-referrer, nosniff, COOP same-origin (an opener keeps no handle on our tab) and a
 * Permissions-Policy that turns off what the app never uses. HSTS is the view server's alone: it depends on
 * the site being https.
 */
export function appHeaders(sources: CspSources): Record<string, string> {
  return {
    "Content-Security-Policy": appCsp(sources, "header"),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}
