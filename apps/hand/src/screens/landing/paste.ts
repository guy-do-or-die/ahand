/**
 * What was pasted into the landing's "Open a link" box (UX-SPEC §7.1): an address, a bare link,
 * or a QR code's digits. Pure and offline (paste.test.ts); the screen keeps the result in tab
 * memory (store/memory.ts) and goes to the Hand view, which judges the link itself and fails
 * closed. Nothing here decodes the link or writes it anywhere.
 *
 * An address made for another site is opened here, under this site's own origin: the part
 * before `#` is rebuilt from the Hand's path and its `d` alone, so the router shows it and the
 * Hand view reads exactly what the address carried. The other host is kept only to be named in
 * the sentence the screen shows first.
 */

export type Paste =
  | { kind: "empty" }
  /** Not an aHand address or link: nothing is kept. */
  | { kind: "bad" }
  /** A bare link (base64url or digits): opened on "/" as the Hand view. */
  | { kind: "link"; fragment: string }
  /** An address with its link; `before` is rebuilt on this site, `to` is where the router goes. */
  | { kind: "address"; before: string; fragment: string; to: string; host: string; foreign: boolean }
  /** A numbered or faced address with no link: the Hand's public view. */
  | { kind: "public"; to: string; host: string; foreign: boolean };

/** A link written alone: base64url, or the decimal digits a QR code carries. */
const BARE = /^[A-Za-z0-9_-]+$/;
/** The Hand's part of a path: /<chain>/<hand> or /<chain>/<core>/<hand>, at its end. */
const HAND_PATH = /\/[0-9]+\/(?:0x[0-9a-fA-F]{40}\/)?[0-9]+$/;
/** An address as messengers show it, without its scheme: a host with a dot, then a slash. */
const SCHEMELESS = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::[0-9]+)?\//i;

export function readPaste(text: string, here: string): Paste {
  let value = text.trim();
  if (value === "") return { kind: "empty" };
  if (value.startsWith("#")) value = value.slice(1);
  if (BARE.test(value)) return { kind: "link", fragment: value };
  if (/\s/.test(value)) return { kind: "bad" };
  if (SCHEMELESS.test(value)) value = `https://${value}`;
  if (!/^https?:\/\//i.test(value)) return { kind: "bad" };

  const mark = value.indexOf("#");
  const before = mark < 0 ? value : value.slice(0, mark);
  const fragment = mark < 0 ? "" : value.slice(mark + 1);
  let url: URL;
  let site: URL;
  try {
    url = new URL(before);
    site = new URL(here);
  } catch {
    return { kind: "bad" };
  }

  const numbered = HAND_PATH.exec(url.pathname)?.[0];
  const path = numbered ?? (url.pathname.endsWith("/") ? "/" : undefined);
  if (!path) return { kind: "bad" };
  // Only `d` is the Hand's; any other parameter is someone else's and stays behind. `d` is kept as written.
  const data = url.search.slice(1).split("&").filter((part) => part.startsWith("d="));
  const to = path + (data.length ? `?${data.join("&")}` : "");
  const host = url.host;
  const foreign = url.origin !== site.origin;

  if (fragment === "") return numbered ? { kind: "public", to, host, foreign } : { kind: "bad" };
  if (!BARE.test(fragment)) return { kind: "bad" };
  return { kind: "address", before: `${site.origin}${to}`, fragment, to, host, foreign };
}
