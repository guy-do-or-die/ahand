import { describe, expect, test } from "bun:test";

import { FALLBACK_ID, foundOptions } from "./fallback";
import type { WalletOption } from "./state";
import { WALLET_WORDS } from "./words";

/**
 * A phone wallet's built-in browser that sets only `window.ethereum` (no EIP-6963 announcement)
 * was told "Nothing to connect was found" (review of the public test deployment). The page's own
 * `window.ethereum` is now offered, but only when nothing announced, so one app never shows twice.
 */

const fallback: WalletOption = { id: FALLBACK_ID, name: "Injected", kind: "found", fallback: true };
const announced: WalletOption = { id: "io.metamask", name: "MetaMask", kind: "found" };
const dev: WalletOption = { id: "dev-1", name: "Test account 1", kind: "dev" };

describe("foundOptions", () => {
  test("only window.ethereum: the fallback is listed", () => {
    expect(foundOptions([dev, fallback], true)).toEqual([fallback]);
  });

  test("an announced wallet hides the fallback (it is the same app's window.ethereum)", () => {
    expect(foundOptions([fallback, announced, dev], true)).toEqual([announced]);
  });

  test("no window.ethereum and nothing announced: nothing, and the sheet says what to do on a phone", () => {
    expect(foundOptions([fallback, dev], false)).toEqual([]);
    expect(WALLET_WORDS.en.none).toContain("On a phone, open this page in the browser inside your crypto app");
    expect(WALLET_WORDS.ru.none).toContain("На телефоне открой эту страницу в браузере внутри своего криптоприложения");
  });
});
