/**
 * Slot ports (ARCHITECTURE §14): the fixed layout by default, and the compact layout that
 * STAND_PORT_BASE moves anywhere in 1024–65000 when the fixed ports are taken.
 */
import { describe, expect, test } from "bun:test";

import { portBaseFromEnv, portsOf, SLOT_COUNT } from "../ports.ts";

describe("portsOf", () => {
  test("without STAND_PORT_BASE: the fixed layout, unchanged", () => {
    expect(portsOf(0, {})).toEqual({ chain: 18545, relay: 18547, site: 18300, dev: 18301 });
    expect(portsOf(3, {})).toEqual({ chain: 18575, relay: 18577, site: 18330, dev: 18331 });
    expect(portsOf(9, { STAND_PORT_BASE: "" })).toEqual({ chain: 18635, relay: 18637, site: 18390, dev: 18391 });
  });

  test("with STAND_PORT_BASE: slot s takes base + 10s … base + 10s + 3", () => {
    const env = { STAND_PORT_BASE: "25300" };
    expect(portsOf(0, env)).toEqual({ chain: 25300, relay: 25301, site: 25302, dev: 25303 });
    expect(portsOf(4, env)).toEqual({ chain: 25340, relay: 25341, site: 25342, dev: 25343 });
    expect(portsOf(9, { STAND_PORT_BASE: "65000" })).toEqual({ chain: 65090, relay: 65091, site: 65092, dev: 65093 });
    expect(portsOf(0, { STAND_PORT_BASE: "1024" }).chain).toBe(1024);
  });

  test("with STAND_PORT_BASE: no two ports of any two slots meet", () => {
    const all = Array.from({ length: SLOT_COUNT }, (_, slot) => Object.values(portsOf(slot, { STAND_PORT_BASE: "30000" }))).flat();
    expect(new Set(all).size).toBe(4 * SLOT_COUNT);
    expect(Math.max(...all)).toBeLessThanOrEqual(30000 + 10 * (SLOT_COUNT - 1) + 3);
  });

  test("reads process.env when no environment is passed", () => {
    const before = process.env.STAND_PORT_BASE;
    try {
      process.env.STAND_PORT_BASE = "25310";
      expect(portsOf(1).chain).toBe(25320);
      delete process.env.STAND_PORT_BASE;
      expect(portsOf(1).chain).toBe(18555);
    } finally {
      if (before === undefined) delete process.env.STAND_PORT_BASE;
      else process.env.STAND_PORT_BASE = before;
    }
  });

  test("a STAND_PORT_BASE that is not a whole number from 1024 to 65000 is refused", () => {
    for (const bad of ["1023", "65001", "0", "-5", "25300.5", "2.53e4", "0x62d4", " 25300", "25300 ", "abc", "+25300", "025300"]) {
      expect(() => portsOf(0, { STAND_PORT_BASE: bad })).toThrow("STAND_PORT_BASE");
    }
  });

  test("a slot outside 0–9 is still refused", () => {
    expect(() => portsOf(10, { STAND_PORT_BASE: "25300" })).toThrow("slot");
    expect(() => portsOf(-1, {})).toThrow("slot");
  });
});

describe("portBaseFromEnv", () => {
  test("undefined when unset or empty, the number when valid", () => {
    expect(portBaseFromEnv({})).toBeUndefined();
    expect(portBaseFromEnv({ STAND_PORT_BASE: "" })).toBeUndefined();
    expect(portBaseFromEnv({ STAND_PORT_BASE: "40000" })).toBe(40000);
  });
});
