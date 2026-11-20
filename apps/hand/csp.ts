/**
 * The Content Security Policy of the built app (ARCHITECTURE §11), written from the app's own
 * configuration so the build can carry it as a `<meta>` tag for hosts that send no headers.
 * Face (apps/face/src/headers.ts) and the stand's static server send the same policy as a header;
 * `tests/csp.test.ts` and face's own test hold the three together.
 *
 *   default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
 *   font-src 'self'; connect-src 'self' <rpc urls> <relay urls>; worker-src 'none';
 *   object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
 *
 * In a `<meta>` tag `frame-ancestors` is left out: browsers ignore it there and Chromium reports
 * the ignored directive as a console error. It only works as a header, which face sends.
 */

export interface CspSources {
  rpcUrls: readonly string[];
  relays: readonly string[];
}

/** A CSP source for a URL: its origin (scheme, host, port). */
function originOf(url: string): string {
  return new URL(url).origin;
}

export function appCsp(sources: CspSources, delivery: "header" | "meta" = "header"): string {
  const connect = [...new Set(["'self'", ...sources.rpcUrls.map(originOf), ...sources.relays.map(originOf)])];
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
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
 * The headers `vite preview` sends, the same as face's base headers (apps/face/src/headers.ts):
 * the CSP, no-referrer, nosniff, COOP same-origin (an opener keeps no handle on our tab) and a
 * Permissions-Policy that turns off what the app never uses. HSTS is face's alone: it depends on
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
