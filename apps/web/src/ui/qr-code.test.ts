import { expect, test } from "bun:test";

import { toDigits } from "@ahand/sdk";

import { QR_QUIET_MODULES, qrOf, qrSegments } from "./qr-code";

const SITE = "https://ahand.example/#";

/** Bytes that stand in for a link of a given length: a fixed sequence, first byte not zero. */
function sampleLink(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = 0x45;
  for (let index = 0; index < length; ++index) {
    bytes[index] = state;
    state = (state * 73 + 41) & 0xff;
  }
  return bytes;
}

test("an address splits into a byte segment for the site and a numeric segment for the link", () => {
  const digits = toDigits(sampleLink(428));
  const utf8 = (text: string) => new TextEncoder().encode(text);
  expect(qrSegments(SITE + digits)).toEqual([
    { data: utf8(SITE), mode: "byte" },
    { data: digits, mode: "numeric" },
  ]);
  expect(qrSegments("no digits at the end")).toEqual([{ data: utf8("no digits at the end"), mode: "byte" }]);
  expect(qrSegments("12345")).toEqual([{ data: "12345", mode: "numeric" }]);
});

test("a 428-byte dark link reports its version and draws", () => {
  const code = qrOf(SITE + toDigits(sampleLink(428)));
  expect(code.dense).toBe(false);
  expect(code.version).toBeGreaterThanOrEqual(13);
  expect(code.version).toBeLessThanOrEqual(15);
  expect(code.modules).toBe(17 + 4 * code.version!);
  expect(code.side).toBe(code.modules + 2 * QR_QUIET_MODULES);
  expect(code.path.startsWith("M")).toBe(true);
});

test("the numeric segment is what keeps the code small", () => {
  const digits = toDigits(sampleLink(428));
  const mixed = qrOf(SITE + digits);
  const asBytes = qrOf(`${SITE}x${digits}`.replace(/[0-9]/g, (digit) => String.fromCharCode(97 + Number(digit))));
  expect(asBytes.version!).toBeGreaterThan(mixed.version!);
});

test("the drawing keeps a quiet zone of four modules on every side", () => {
  const code = qrOf(SITE + toDigits(sampleLink(100)));
  const starts = [...code.path.matchAll(/M(\d+) (\d+)h(\d+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]) }));
  expect(Math.min(...starts.map((s) => s.x))).toBe(QR_QUIET_MODULES);
  expect(Math.min(...starts.map((s) => s.y))).toBe(QR_QUIET_MODULES);
  expect(Math.max(...starts.map((s) => s.x + s.w))).toBe(code.side - QR_QUIET_MODULES);
  expect(Math.max(...starts.map((s) => s.y))).toBe(code.side - QR_QUIET_MODULES - 1);
});

test("a link past version 25 is too dense, and says which version it would need", () => {
  const code = qrOf(SITE + toDigits(sampleLink(1500)));
  expect(code.dense).toBe(true);
  expect(code.version).toBeGreaterThan(25);
  expect(code.path).toBe("");
});

test("a link no version holds is too dense with no version", () => {
  const code = qrOf(SITE + toDigits(sampleLink(4000)));
  expect(code).toEqual({ version: undefined, modules: 0, side: 0, path: "", dense: true });
});

test("the limit can be lowered for print", () => {
  const value = SITE + toDigits(sampleLink(428));
  expect(qrOf(value, 13).dense || qrOf(value, 13).version === 13).toBe(true);
  expect(qrOf(value, 10).dense).toBe(true);
});
