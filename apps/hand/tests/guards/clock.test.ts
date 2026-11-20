import { describe, expect, test } from "bun:test";

import { code, filesUnder, hits } from "./files";

/**
 * The clock guard (D-61, ARCHITECTURE §7 Time): every "now" a state, a countdown or an expiry
 * depends on is the latest block's timestamp (`useNow`). So screens/, ui/ and chain/ never read
 * the device's clock: no `Date.now()`, no `new Date()` without an argument, no `performance.now()`
 * and no `Date()` called as a function. The shell is held to the same rule. The device's clock is
 * read in one place only, store/db.ts `deviceClock()`, for "first seen on this device" times,
 * which are labelled so.
 */

const DIRS = ["screens", "ui", "chain", "shell"];
const DEVICE_CLOCK = /\bDate\s*\.\s*now\s*\(|new\s+Date\s*\(\s*\)|new\s+Date\b(?!\s*\()|(?<![.\w])Date\s*\(\s*\)|performance\s*\.\s*now\s*\(/;

describe("clock: no device time where the chain's time belongs", () => {
  for (const dir of DIRS) {
    test(`${dir}/ reads no device clock`, () => {
      const files = filesUnder(dir, /\.(ts|tsx)$/);
      expect(files.flatMap((file) => hits(file, code(file), DEVICE_CLOCK))).toEqual([]);
    });
  }

  test("nowhere else in src/ either: wallet, lib, i18n, config, the gallery and the top-level files", () => {
    const covered = new Set([...DIRS.map((dir) => `${dir}/`), "store/"]);
    const rest = filesUnder("", /\.(ts|tsx)$/).filter((file) => ![...covered].some((dir) => file.startsWith(dir)));
    expect(rest.length).toBeGreaterThan(10);
    expect(rest.flatMap((file) => hits(file, code(file), DEVICE_CLOCK))).toEqual([]);
  });

  test("the pattern catches each form and spares a date built from a value", () => {
    for (const bad of ["Date.now()", "new Date()", "new Date", "const d = Date()", "performance.now()"]) expect(DEVICE_CLOCK.test(bad)).toBe(true);
    for (const good of ["new Date(block.timestamp * 1000)", "new Date(ms)", "format(Date.UTC(2026, 0, 1))"]) expect(DEVICE_CLOCK.test(good)).toBe(false);
  });

  test("the store's one device-clock read is the labelled helper", () => {
    const store = filesUnder("store", /\.(ts|tsx)$/);
    const reads = store.flatMap((file) => hits(file, code(file), DEVICE_CLOCK));
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatch(/^store\/db\.ts:\d+: return Date\.now\(\);$/);
  });
});
