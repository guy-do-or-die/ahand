import { afterEach, describe, expect, it, vi } from "vitest";
import { size } from "viem";

import { describeHand, newBook, newSeed } from "../src/index.js";

/**
 * Link keys (the root key's seed when it is not derived, and every later one), the book and
 * the salts come only from the system's cryptographic generator, never from the time, a counter or
 * Math.random. Here the generator is watched and the two weak sources are made to throw: every
 * fresh value must still come out, and each must have asked the generator.
 */
describe("fresh secrets come from crypto.getRandomValues only", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("newSeed, newBook and a Hand's salt ask the generator and never Math.random or the clock", () => {
    const generator = vi.spyOn(globalThis.crypto, "getRandomValues");
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random was asked");
    });
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("the clock was asked");
    });

    const made: { what: string; value: string; bytes: number }[] = [];
    const watch = (what: string, bytes: number, make: () => string) => {
      const before = generator.mock.calls.length;
      const value = make();
      expect(generator.mock.calls.length, `${what} did not ask the generator`).toBeGreaterThan(before);
      made.push({ what, value, bytes });
    };
    for (let i = 0; i < 4; ++i) {
      watch("newSeed", 16, () => newSeed());
      watch("newBook", 8, () => newBook());
      watch("salt", 32, () => describeHand({ mode: "dark", title: "the same words" }).salt!);
    }
    for (const { what, value, bytes } of made) expect(size(value as `0x${string}`), what).toBe(bytes);
    // Eight bytes and more from a working generator never repeat in a few draws.
    expect(new Set(made.map(({ value }) => value)).size).toBe(made.length);
  });
});
