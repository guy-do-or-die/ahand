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

/**
 * What a node answered, when it answered at all: the HTTP status of a failed response (viem's
 * `HttpRequestError` carries `status` only when a response came back) and the node's own words
 * (viem's `details`: the JSON-RPC error's message, or the response's status text). `undefined`
 * when nothing in the cause chain shows an answer. An error that has an answer is a refusal, not
 * "the network did not answer", even when `isNetworkError` matches it by name: a 429 or a 503 came
 * from someone.
 */
export function answerOf(error: unknown): { status?: number; words?: string } | undefined {
  const seen = new Set<unknown>();
  let status: number | undefined;
  let words: string | undefined;
  for (let node: unknown = error; node && typeof node === "object" && !seen.has(node); node = (node as { cause?: unknown }).cause) {
    seen.add(node);
    const { name, status: code, details } = node as { name?: unknown; status?: unknown; details?: unknown };
    if (status === undefined && typeof code === "number") status = code;
    // A transport error's details are the browser's sentence about the failure, not a node's words.
    if (words === undefined && typeof details === "string" && details && !(typeof name === "string" && TRANSPORT.has(name) && typeof code !== "number")) words = details;
  }
  if (status === undefined && (words === undefined || isNetworkError(error))) return undefined;
  return { ...(status === undefined ? {} : { status }), ...(words === undefined ? {} : { words }) };
}
