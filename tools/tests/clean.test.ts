import { describe, expect, test } from "bun:test";

import { clean } from "../lib/cli.ts";

/** clean() once promised "no control or direction characters" and let invisible ones through. */
describe("clean", () => {
  const escaped = (code: number) => `\\u${code.toString(16).padStart(4, "0")}`;

  test("escapes the zero-width characters, U+FEFF and the line and paragraph separators", () => {
    for (const code of [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x2028, 0x2029]) {
      expect(clean(`a${String.fromCharCode(code)}b`)).toBe(`a${escaped(code)}b`);
    }
  });

  test("escapes every bidi control: the marks, the embeddings and overrides, the isolates", () => {
    const controls = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
    for (const code of controls) {
      expect(clean(`x${String.fromCharCode(code)}y`)).toBe(`x${escaped(code)}y`);
    }
  });

  test("leaves nothing invisible in the verifier's string", () => {
    const hostile = "a​b‌c‍d⁠e﻿f g h‮i⁦j";
    const safe = clean(hostile);
    expect(safe).toBe("a\\u200bb\\u200cc\\u200dd\\u2060e\\ufefff\\u2028g\\u2029h\\u202ei\\u2066j");
    expect(safe).toMatch(/^[\x20-\x7e]*$/);
  });

  test("keeps letters of any script and writes line ends and tabs as \\n and \\t", () => {
    expect(clean("Ищу квартиру — café № 5 שלום")).toBe("Ищу квартиру — café № 5 שלום");
    expect(clean("one\ntwo\tthree\u0007")).toBe("one\\ntwo\\tthree\\u0007");
    expect(clean("x".repeat(130))).toBe(`${"x".repeat(120)}…`);
  });
});
