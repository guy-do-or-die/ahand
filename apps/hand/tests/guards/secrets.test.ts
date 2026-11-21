import { describe, expect, test } from "bun:test";

import { code, filesUnder, hits } from "./files";

/**
 * The hash and seed guard, static half (ARCHITECTURE §11, brief 08 §3). A link's text, its seed,
 * the fragment and the twelve words must never reach the console, storage in the clear, a query
 * string or a request. Data flow cannot be traced by grep, so the guard closes the sinks
 * themselves across apps/hand/src:
 *
 * - `location.hash`, `location.href` and `document.URL` are read only by link-intake.ts;
 * - no `console` at all;
 * - no `sessionStorage`, `document.cookie`, `indexedDB` outside store/db.ts, and `localStorage`
 *   only for the theme override (the literal key "ahand-theme") and the mark that a Privy session
 *   may be here (the literal key "ahand-privy", wallet/privy-mark.ts), neither a secret;
 * - no request but RPC and relays (made by viem and packages/deliver, not here): `fetch` only of a
 *   same-site path written as a literal, and no XMLHttpRequest, sendBeacon, WebSocket or
 *   EventSource in the app's own code;
 * - no query string written: no `searchParams.set/append` and no `new URLSearchParams` built from
 *   anything but `location.search` (the SDK's toAddress writes `?d=`, the public part, and
 *   nothing else);
 * - in store/, the word "seed" appears only in db.ts, the one module that writes the locked copy;
 *   escrow.test.ts proves at run time that what it writes is ciphertext only.
 *
 * gallery/ (the kit's own page, gallery.html, local builds only) keeps its view switches (language,
 * theme, lens) in its query string and history; it never holds a link, so the query and history
 * rules skip it. Every other rule covers it.
 *
 * The runtime half (an end-to-end run searching every request, console line and storage entry for
 * a seed) belongs to tests/e2e/guards (wave 5).
 */

const APP = filesUnder("", /\.(ts|tsx)$/);

function scan(pattern: RegExp, allowed: (file: string) => boolean = () => false): string[] {
  return APP.filter((file) => !allowed(file)).flatMap((file) => hits(file, code(file), pattern));
}

describe("secrets: the fragment and the link's text have nowhere to go", () => {
  test("the app's sources are found", () => {
    expect(APP).toContain("link-intake.ts");
    expect(APP).toContain("store/db.ts");
  });

  test("only link-intake.ts reads the address with its fragment", () => {
    expect(scan(/location\.hash|location\.href|document\.URL|document\.documentURI/, (f) => f === "link-intake.ts")).toEqual([]);
  });

  test("nothing writes to the console", () => {
    expect(scan(/\bconsole\s*[.[]/)).toEqual([]);
  });

  test("no session storage and no cookies", () => {
    expect(scan(/\bsessionStorage\b|document\s*\.\s*cookie|\bcookieStore\b/)).toEqual([]);
  });

  test("localStorage holds only the theme override and the Privy session mark", () => {
    // The one unit test that stands a Map in for localStorage (the mark's own tests) writes nothing anywhere.
    const uses = scan(/\blocalStorage\b/, (f) => f === "wallet/privy.test.ts");
    const other = uses.filter((line) => !/localStorage\.(setItem|getItem|removeItem)\(\s*(THEME_KEY|"ahand-theme"|"ahand-privy")/.test(line.split(": ").slice(1).join(": ")));
    // A line that only names localStorage in a type or a guard is still a use: list them all.
    expect(other).toEqual([]);
  });

  test("only store/db.ts opens IndexedDB", () => {
    expect(scan(/\bindexedDB\b|\bIDBFactory\b\s*\(/, (f) => f === "store/db.ts")).toEqual([]);
  });

  test("no request but a same-site file: fetch takes a literal path starting with /", () => {
    // A method named fetch (a test server's `async fetch(request) {` handler) defines, not requests.
    const fetches = scan(/\bfetch\s*\(/).filter((line) => !/(?:^|[\s,{])(?:async\s+)?fetch\s*\([\w\s,:<>]*\)\s*(?::[^{]+)?\{/.test(line.split(": ").slice(1).join(": ")));
    const offSite = fetches.filter((line) => !/\bfetch\s*\(\s*(["'`])\/(?!\/)[^"'`$]*\1/.test(line));
    expect(offSite).toEqual([]);
  });

  test("no XMLHttpRequest, beacon, WebSocket or EventSource in the app's own code", () => {
    expect(scan(/\bXMLHttpRequest\b|\bsendBeacon\b|new\s+WebSocket\b|new\s+EventSource\b/)).toEqual([]);
  });

  const gallery = (file: string) => file.startsWith("gallery/");

  test("no query string is written", () => {
    expect(scan(/searchParams\s*\.\s*(set|append)\s*\(/, gallery)).toEqual([]);
    expect(scan(/new\s+URLSearchParams\s*\(\s*(?!\)|(window\.)?location\.search\s*\))/, gallery)).toEqual([]);
  });

  test("no navigation carries a fragment the app wrote", () => {
    // pushState/replaceState belong to router.ts and link-intake.ts; window.open and assigning
    // location could carry a link elsewhere.
    expect(scan(/\b(pushState|replaceState)\s*\(/, (f) => f === "router.ts" || f === "link-intake.ts" || gallery(f))).toEqual([]);
    expect(scan(/window\.open\s*\(|location\s*\.\s*assign\s*\(|location\s*=(?!=)/)).toEqual([]);
  });

  test("in the store, only db.ts handles a seed", () => {
    const store = filesUnder("store", /\.(ts|tsx)$/).filter((f) => f !== "store/db.ts");
    expect(store.flatMap((file) => hits(file, code(file), /seed/i))).toEqual([]);
  });

  test("the router refuses a fragment and link intake strips it", () => {
    const router = code("router.ts");
    expect(router).toMatch(/includes\("#"\)\) throw/);
    const intake = code("link-intake.ts");
    expect(intake).toMatch(/replaceState\(/);
  });
});
