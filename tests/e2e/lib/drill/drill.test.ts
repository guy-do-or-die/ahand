/**
 * The drill's own parsing, with no chain: bun test tests/e2e/lib/drill/drill.test.ts
 * (Playwright only collects *.spec.ts, so this file stays out of the browser runs.)
 */
import { describe, expect, test } from "bun:test";

import { gasLimitOf, listening as drillListening, parseDrillArgs, requestPart, statusField } from "../../../../infra/stand/drill.ts";
import { listening } from "./ports.ts";

const STATUS = `Hand 4: CLOSED, thanked at 2026-12-30 10:00:01 UTC
  state        thanked   (latest block's time: 2026-12-30 10:00:05 UTC)
  raiser       0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  reward       30 mUSD (30000000 units)
  token        0x6B867aFa284Ce84eE76424373420E1170da2eE7b
  expiry       2027-01-29 10:00:00 UTC   (1801216800)
  give hash    0x9486168fc13641d962fb0d9da16ed730019955bdd80c5a8248acce3e0214bb83`;

describe("drill parsing", () => {
  test("arguments: --slot, --reuse, STAND_SLOT, and refusals", () => {
    expect(parseDrillArgs(["--slot", "7"], {})).toEqual({ slot: 7, reuse: false });
    expect(parseDrillArgs(["--reuse", "--slot", "0"], {})).toEqual({ slot: 0, reuse: true });
    expect(parseDrillArgs([], { STAND_SLOT: "3" })).toEqual({ slot: 3, reuse: false });
    expect(() => parseDrillArgs([], {})).toThrow(/name the slot/);
    expect(() => parseDrillArgs(["--slot", "12"], {})).toThrow(/0 to 9/);
    expect(() => parseDrillArgs(["--fast"], {})).toThrow(/unknown argument/);
  });

  test("the part of an address a browser sends stops before #", () => {
    expect(requestPart("http://127.0.0.1:18370/#GOn0AQ")).toBe("http://127.0.0.1:18370/");
    expect(requestPart("http://127.0.0.1:18370/31337/2?d=Ag#GOn0")).toBe("http://127.0.0.1:18370/31337/2?d=Ag");
    expect(requestPart("http://127.0.0.1:18370/31337/2")).toBe("http://127.0.0.1:18370/31337/2");
  });

  test("the gas limit comes from thank-calldata's send line only", () => {
    const out = "worst gas:   679 971 (every payee burns its 250k limit)\nsend  RPC=x CORE=y bash contracts/exit/ahand.sh thank f -- --gas-limit 679971 <the raiser's signing option>\nthank 0x00";
    expect(gasLimitOf(out)).toBe(679_971n);
    expect(() => gasLimitOf("worst gas: 679 971")).toThrow(/no send line/);
  });

  test("status fields are the rest of their line", () => {
    expect(statusField(STATUS, "state")?.split(" ")[0]).toBe("thanked");
    expect(statusField(STATUS, "raiser")).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    expect(statusField(STATUS, "reward")).toContain("(30000000 units)");
    expect(statusField(STATUS, "expiry")).toContain("(1801216800)");
    expect(statusField(STATUS, "give hash")).toBe("0x9486168fc13641d962fb0d9da16ed730019955bdd80c5a8248acce3e0214bb83");
    expect(statusField(STATUS, "closed")).toBeUndefined();
  });

  test("a connection attempt tells a free port from a listening one", async () => {
    const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    try {
      expect(await listening(server.port)).toBe(true);
      expect(await drillListening(server.port)).toBe(true);
    } finally {
      server.stop(true);
    }
    expect(await listening(server.port)).toBe(false);
    expect(await drillListening(server.port)).toBe(false);
  });
});
