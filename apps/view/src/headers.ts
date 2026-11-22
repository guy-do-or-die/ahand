import { createHash } from "node:crypto";

import type { ViewConfig } from "./config.ts";

/**
 * The headers on every response the view server sends. The CSP is the built app's:
 *
 *   default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
 *   font-src 'self'; connect-src 'self' <rpc urls> <relay urls>; worker-src 'none';
 *   object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
 *
 * Two additions, both for pages of the build that carry their code inline (exit.html is one
 * self-contained file): script-src also names the sha256 of each inline script of the very file
 * served, so exactly the shipped code runs and nothing injected does; and exit.html, which takes
 * any RPC address its reader types, may connect to any https address and to this machine, and
 * may load the fonts it carries inside itself as data: URLs (a font cannot send anything anywhere).
 *
 * With `privy` (the app logs in through Privy) the app's pages also name Privy's login frame, its
 * API and WalletConnect's (`PRIVY_SOURCES`, the same as the app's own policy); exit.html never does.
 */

/** What logging in through Privy needs beyond the app's own policy (the app's CSP holds the same sources). */
export const PRIVY_SOURCES = {
  frame: ["https://auth.privy.io", "https://verify.walletconnect.com", "https://verify.walletconnect.org"],
  connect: ["https://auth.privy.io", "https://*.rpc.privy.systems", "wss://relay.walletconnect.com", "wss://relay.walletconnect.org", "wss://www.walletlink.org", "https://explorer-api.walletconnect.com"],
  img: ["https://explorer-api.walletconnect.com"],
} as const;

/** A CSP source for a URL: its origin (scheme, host, port). */
const sourceOf = (url: string): string => new URL(url).origin;

/** The sha256 sources of the inline scripts of an HTML file, as CSP writes them. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(match[1]!)) continue;
    const body = match[2]!;
    if (body === "") continue;
    hashes.push(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }
  return hashes;
}

export function cspFor(config: Pick<ViewConfig, "rpc" | "relays" | "privy">, page: { inline?: string[]; anyRpc?: boolean } = {}): string {
  const privy = config.privy === true && !page.anyRpc;
  const connect = ["'self'", sourceOf(config.rpc), ...config.relays.map(sourceOf), ...(privy ? PRIVY_SOURCES.connect : [])];
  if (page.anyRpc) connect.push("https:", "http://127.0.0.1:*", "http://localhost:*");
  const script = ["'self'", ...(page.inline ?? [])];
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${["'self'", "data:", ...(privy ? PRIVY_SOURCES.img : [])].join(" ")}`,
    page.anyRpc ? "font-src 'self' data:" : "font-src 'self'",
    `connect-src ${[...new Set(connect)].join(" ")}`,
    ...(privy ? [`frame-src ${PRIVY_SOURCES.frame.join(" ")}`, `child-src ${PRIVY_SOURCES.frame.join(" ")}`] : []),
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * The headers every response carries, whatever it is. Beyond the CSP, no-referrer and nosniff:
 *
 *   Cross-Origin-Opener-Policy: same-origin   a page that opened ours (a messenger's web client)
 *       keeps no handle on our tab, so it cannot later send the tab to a look-alike asking for
 *       the keys signature. The app opens no pop-up that would need the handle either.
 *   Permissions-Policy: camera=(), microphone=(), geolocation=()   the app uses none of them.
 *   Strict-Transport-Security: max-age=31536000   only when the site is served over https
 *       (VIEW_SITE); without includeSubDomains, which would bind every other host of the domain.
 */
export function baseHeaders(csp: string, options: { https?: boolean } = {}): Record<string, string> {
  return {
    "Content-Security-Policy": csp,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    ...(options.https ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
  };
}
