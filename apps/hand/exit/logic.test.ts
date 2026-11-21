import { describe, expect, test } from "bun:test";

import type { Give, SignedShake } from "@ahand/sdk";

import { bpsText, castCall, castSend, explorerValue, fileServe, shareOf, span, stateBadge, unitsText } from "./logic";

const A = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const B = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
const G = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const H0 = `0x${"0".repeat(64)}` as const;

const shake = (payee: `0x${string}`, claimBps: number, nextClaimBps: number): SignedShake => ({
  shake: { nextKey: B, payee, claimBps, nextClaimBps, dataHash: H0 },
  keySig: "0x01",
});
const give = (claimBps: number): Give => ({ signer: G, payee: G, claimBps, routeHash: H0, dataHash: H0 });

describe("shareOf: who gets what, by Core's arithmetic", () => {
  test("each pass keeps reward × margin / 10 000, rounded down; the giver gets the rest", () => {
    const rows = shareOf(30_000_000n, [shake(A, 10_000, 9_500)], give(9_500));
    expect(rows).toEqual([
      { role: "pass", position: 0, payee: A, bps: 500, amount: 1_500_000n },
      { role: "give", payee: G, bps: 9_500, amount: 28_500_000n },
    ]);
  });

  test("rounding leftovers go to the giver, so the parts always add up to the reward", () => {
    const rows = shareOf(10n, [shake(A, 10_000, 9_667), shake(B, 9_667, 9_334)], give(9_334));
    expect(rows.map((r) => r.amount)).toEqual([0n, 0n, 10n]);
    const odd = shareOf(1_000_001n, [shake(A, 10_000, 9_999)], give(9_999));
    expect(odd.reduce((sum, r) => sum + r.amount, 0n)).toBe(1_000_001n);
    expect(odd[0]!.amount).toBe(100n);
  });

  test("a pass that keeps nothing is listed as passing on, with no payee", () => {
    const rows = shareOf(60_000_000n, [shake(A, 10_000, 9_500), shake(ZERO, 9_500, 9_500)], give(9_500));
    expect(rows[1]).toEqual({ role: "pass", position: 1, payee: ZERO, bps: 0, amount: 0n });
    expect(rows[2]!.amount).toBe(57_000_000n);
  });

  test("a reward of zero pays zero to everyone", () => {
    expect(shareOf(0n, [], give(10_000))).toEqual([{ role: "give", payee: G, bps: 10_000, amount: 0n }]);
  });
});

describe("words for numbers", () => {
  test("bpsText", () => {
    expect(bpsText(7_000)).toBe("70%");
    expect(bpsText(9_500)).toBe("95%");
    expect(bpsText(1_250)).toBe("12.5%");
    expect(bpsText(1)).toBe("0.01%");
  });
  test("unitsText trims trailing zeros and keeps the exact units beside", () => {
    expect(unitsText(15_000_000n, 6, "mUSD")).toBe("15 mUSD");
    expect(unitsText(1_500_000n, 6, "mUSD")).toBe("1.5 mUSD");
    expect(unitsText(1n, 6, "mUSD")).toBe("0.000001 mUSD");
    expect(unitsText(7n, undefined, undefined)).toBe("7 units");
  });
  test("span counts from the chain's clock in days, hours and minutes", () => {
    expect(span(3 * 86_400 + 4 * 3_600 + 5 * 60 + 59)).toBe("3d 4h 5m");
    expect(span(59)).toBe("0m");
    expect(span(3_600)).toBe("1h 0m");
  });
});

describe("stateBadge: judged by the latest block, never this device", () => {
  test("each state has its own badge key", () => {
    expect(stateBadge("open")).toBe("state.open");
    expect(stateBadge("expired")).toBe("state.expired");
    expect(stateBadge("thanked")).toBe("state.thanked");
    expect(stateBadge("refunded")).toBe("state.refunded");
    expect(stateBadge("missing")).toBe("state.missing");
  });
});

describe("explorerValue: what to type into a block explorer's form", () => {
  test("numbers bare, strings quoted, tuples as nested brackets", () => {
    expect(explorerValue(12n)).toBe("12");
    expect(explorerValue(A)).toBe(`"${A}"`);
    expect(explorerValue([[A, true, "0xabcd"]])).toBe(`[["${A}", true, "0xabcd"]]`);
    expect(explorerValue([])).toBe("[]");
  });
  test("a signed Give in the README's order: [[signer, payee, claimBps, routeHash, dataHash], keySig, giverSig]", () => {
    const value = explorerValue([[G, G, 9_500, H0, H0], "0x01", "0x02"]);
    expect(value).toBe(`[["${G}", "${G}", 9500, "${H0}", "${H0}"], "0x01", "0x02"]`);
  });
});

describe("cast lines", () => {
  test("castSend is the SDK's line, with the worst gas when one is given", () => {
    expect(castSend({ to: A, data: "0xabcd" }, "http://127.0.0.1:8545")).toBe(`cast send ${A} 0xabcd --rpc-url http://127.0.0.1:8545`);
    expect(castSend({ to: A, data: "0xabcd" }, "http://127.0.0.1:8545", 312_000)).toBe(
      `cast send ${A} 0xabcd --rpc-url http://127.0.0.1:8545 --gas-limit 312000`,
    );
  });
  test("a typed RPC with shell characters is quoted", () => {
    expect(castSend({ to: A, data: "0x00" }, "https://x.example/?k=a&b")).toBe(`cast send ${A} 0x00 --rpc-url 'https://x.example/?k=a&b'`);
  });
  test("castCall reads a view with its signature quoted", () => {
    expect(castCall(A, "hands(uint256)(address)", ["12"], "http://127.0.0.1:8545")).toBe(
      `cast call ${A} 'hands(uint256)(address)' 12 --rpc-url http://127.0.0.1:8545`,
    );
  });
});

describe("fileServe: the one line that serves this file's folder", () => {
  test("a Unix path", () => {
    const serve = fileServe("file:///home/me/ahand/dist/exit.html", 8000);
    expect(serve).toEqual({
      folder: "/home/me/ahand/dist",
      command: "cd /home/me/ahand/dist && python3 -m http.server 8000 --bind 127.0.0.1",
      open: "http://127.0.0.1:8000/exit.html",
    });
  });
  test("spaces and quotes in the folder are quoted for the shell", () => {
    const serve = fileServe("file:///Users/me/My%20Files/it's/exit.html", 8000)!;
    expect(serve.folder).toBe("/Users/me/My Files/it's");
    expect(serve.command).toBe(`cd '/Users/me/My Files/it'\\''s' && python3 -m http.server 8000 --bind 127.0.0.1`);
  });
  test("a Windows path loses the slash before the drive", () => {
    expect(fileServe("file:///C:/Users/me/exit.html", 8000)!.folder).toBe("C:/Users/me");
  });
  test("a page served over http has no such line", () => {
    expect(fileServe("http://127.0.0.1:18300/exit.html", 8000)).toBeUndefined();
  });
});

describe("the footer's words", () => {
  // The owner had "Unaudited · No owner · No fee" taken out of the app's footer on 2026-11-21 and,
  // asked about this page's own copy of it, answered «Убрать и там».
  test("the old line is gone from the page and from both languages", async () => {
    const { say } = await import("./words");
    const main = await Bun.file(new URL("./main.ts", import.meta.url)).text();
    expect(main).not.toContain("foot.plain");
    // `say` gives the key back when no sentence exists for it.
    for (const lang of ["en", "ru"] as const) expect(say(lang, "foot.plain" as never)).toBe("foot.plain");
  });
});
