import { createHash } from "node:crypto";

import type { FaceConfig } from "./config.ts";

/**
 * The headers of ARCHITECTURE §11, on every response face sends. The CSP is the built app's:
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
 */

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

export function cspFor(config: Pick<FaceConfig, "rpc" | "relays">, page: { inline?: string[]; anyRpc?: boolean } = {}): string {
  const connect = ["'self'", sourceOf(config.rpc), ...config.relays.map(sourceOf)];
  if (page.anyRpc) connect.push("https:", "http://127.0.0.1:*", "http://localhost:*");
  const script = ["'self'", ...(page.inline ?? [])];
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    page.anyRpc ? "font-src 'self' data:" : "font-src 'self'",
    `connect-src ${[...new Set(connect)].join(" ")}`,
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * The headers every response carries, whatever it is. Beyond §11's CSP, no-referrer and nosniff:
 *
 *   Cross-Origin-Opener-Policy: same-origin   a page that opened ours (a messenger's web client)
 *       keeps no handle on our tab, so it cannot later send the tab to a look-alike asking for
 *       the keys signature. The app opens no pop-up that would need the handle either.
 *   Permissions-Policy: camera=(), microphone=(), geolocation=()   the app uses none of them.
 *   Strict-Transport-Security: max-age=31536000   only when the site is served over https
 *       (FACE_SITE); without includeSubDomains, which would bind every other host of the domain.
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
