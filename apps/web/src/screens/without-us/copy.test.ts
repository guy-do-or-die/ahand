import { describe, expect, test } from "bun:test";

import en from "./en";
import ru from "./ru";

describe("without-us: the explorer's lines read whole in both languages", () => {
  test("the refund line is one sentence a person can read", () => {
    expect(en["without-us.explorer.refund"]).toBe("Send it back. Anyone may, from the second the hand's end date passes.");
    expect(ru["without-us.explorer.refund"]).toBe("Вернуть. Может кто угодно, начиная с секунды, когда наступил срок руки.");
  });

  test("the Russian prose names no field of the contract in English, except where a field is meant", () => {
    // `hands(handId)`, `expiry` in the line that reads that field, and `payee` as a form field are Core's own names.
    const prose = Object.entries(ru).filter(([key]) => key.startsWith("without-us.explorer.") && key !== "without-us.explorer.body");
    for (const [key, text] of prose) expect(text, key).not.toMatch(/\bexpiry\b/);
    expect(en["without-us.explorer.refund"]).not.toContain("expiry is reached");
  });
});
