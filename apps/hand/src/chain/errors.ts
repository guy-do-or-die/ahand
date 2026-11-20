/**
 * The app's one test of "the network did not answer" (as opposed to anyone refusing, or a bug),
 * so every screen says "Can't reach the network right now." for the same errors and no others.
 * Walked down the `cause` chain, since viem wraps a transport failure in its call errors:
 *
 *  - viem's transport errors, by name: HttpRequestError, TimeoutError, WebSocketRequestError,
 *    SocketClosedError;
 *  - `fetch`'s own rejection, which is a TypeError with the browser's sentence: "Failed to fetch"
 *    (Chromium), "NetworkError when attempting to fetch resource." (Firefox), "Load failed"
 *    (Safari), "fetch failed" (Node and Bun), "Network request failed" (React Native polyfills).
 *
 * A TypeError with any other message is a programming error or a malformed input, never "offline".
 */

const TRANSPORT = new Set(["HttpRequestError", "TimeoutError", "WebSocketRequestError", "SocketClosedError"]);
const FETCH_FAILED = /^(failed to fetch|fetch failed|load failed|network request failed)\b|networkerror/i;

export function isNetworkError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let node: unknown = error;
  while (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    const { name, message } = node as { name?: unknown; message?: unknown };
    if (typeof name === "string" && TRANSPORT.has(name)) return true;
    if (name === "TypeError" && typeof message === "string" && FETCH_FAILED.test(message)) return true;
    node = (node as { cause?: unknown }).cause;
  }
  return false;
}
