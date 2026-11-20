import { describe, expect, test } from "bun:test";
import { ContractFunctionExecutionError, HttpRequestError, SocketClosedError, TimeoutError, WebSocketRequestError } from "viem";

import { isNetworkError } from "./errors";

describe("isNetworkError: the network not answering, and nothing else", () => {
  test("viem's transport errors, deep in the cause chain too", () => {
    expect(isNetworkError(new HttpRequestError({ url: "http://127.0.0.1:1" }))).toBe(true);
    expect(isNetworkError(new TimeoutError({ body: {}, url: "http://127.0.0.1:1" }))).toBe(true);
    expect(isNetworkError(new WebSocketRequestError({ url: "ws://127.0.0.1:1" }))).toBe(true);
    expect(isNetworkError(new SocketClosedError({ url: "ws://127.0.0.1:1" }))).toBe(true);
    const wrapped = new ContractFunctionExecutionError(new HttpRequestError({ url: "http://127.0.0.1:1" }) as never, { abi: [], functionName: "checkGive" });
    expect(isNetworkError(wrapped)).toBe(true);
  });

  test("fetch's own rejection in each browser's words", () => {
    for (const message of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "fetch failed", "Network request failed"]) {
      expect(isNetworkError(new TypeError(message))).toBe(true);
      expect(isNetworkError({ name: "CallExecutionError", cause: new TypeError(message) })).toBe(true);
    }
  });

  test("a plain TypeError is a bug, not the network", () => {
    expect(isNetworkError(new TypeError("Cannot read properties of undefined (reading 'giverSig')"))).toBe(false);
    expect(isNetworkError({ name: "Error", cause: new TypeError("x is not a function") })).toBe(false);
  });

  test("refusals and ordinary errors are not the network", () => {
    expect(isNetworkError(new Error("execution reverted"))).toBe(false);
    expect(isNetworkError(new Error("Failed to fetch"))).toBe(false); // the sentence only counts on fetch's TypeError
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError("Failed to fetch")).toBe(false);
  });

  test("a cause chain that loops ends", () => {
    const a: { name: string; cause?: unknown } = { name: "A" };
    a.cause = { name: "B", cause: a };
    expect(isNetworkError(a)).toBe(false);
  });
});
