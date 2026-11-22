import { describe, expect, test } from "bun:test";
import { HttpRequestError } from "viem";

import { failureOf } from "./failure";

describe("thank: what a failed check says", () => {
  test("a plain TypeError (a bug, an odd link field) is a failed check, not offline", () => {
    expect(failureOf(new TypeError("Cannot read properties of undefined (reading 'signer')"))).toEqual({ kind: "core", messageId: "thank.error.checkFailed" });
    expect(failureOf({ name: "CallExecutionError", cause: new TypeError("x is not iterable") })).toEqual({ kind: "core", messageId: "thank.error.checkFailed" });
  });

  test("the network not answering is offline", () => {
    expect(failureOf(new HttpRequestError({ url: "http://127.0.0.1:1" }))).toEqual({ kind: "offline", messageId: "common.time.offline" });
    expect(failureOf(new TypeError("Failed to fetch"))).toEqual({ kind: "offline", messageId: "common.time.offline" });
  });
});
