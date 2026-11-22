import "fake-indexeddb/auto";

import { beforeEach, describe, expect, test } from "bun:test";

import { closeDb, configureDb, escrowStamps, lockSeed, lockedIntents, openSeed, put, stampSeed, type HandRecord } from "../../store/db";
import { SHOWN_BOUND, sweepLockedCopies, type HandTimes } from "./sweep";

const SEED = "0x00112233445566778899aabbccddeeff";
const NOW = 1_800_000_000;
let run = 0;

beforeEach(() => {
  closeDb();
  configureDb({ name: `ahand-sweep-${run++}` });
});

function record(intent: string, more: Partial<HandRecord> = {}): HandRecord {
  return { intent, raiser: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", chainId: 31337, core: "0x65ac", book: "0x0102030405060708", n: 0, mode: "unlisted", title: "t", status: "up", handId: "7", ...more };
}

async function locked(intent: string, more: Partial<HandRecord> | null = {}, stamps: { lockedAt?: number; shownAt?: number } = {}) {
  if (more !== null) await put("hands", record(intent, more));
  await lockSeed(intent, SEED);
  if (stamps.lockedAt !== undefined) await stampSeed(intent, "lockedAt", stamps.lockedAt);
  if (stamps.shownAt !== undefined) await stampSeed(intent, "shownAt", stamps.shownAt);
}

const open: HandTimes = { expiry: NOW + 3_600, closedAt: 0 };

describe("the sweep of locked copies", () => {
  test("keeps a copy whose Hand is open and whose link was shown less than a day ago, and one still on its way", async () => {
    await locked("open", {}, { lockedAt: NOW - 600, shownAt: NOW - SHOWN_BOUND + 1 });
    await locked("sending", { status: "sent", handId: undefined }, { lockedAt: NOW - 10 * SHOWN_BOUND });
    expect(await sweepLockedCopies(NOW, async () => open)).toEqual([]);
    expect((await lockedIntents()).sort()).toEqual(["open", "sending"]);
    expect(await openSeed("open")).toBe(SEED);
  });

  test("deletes after a day from the first showing, by the chain's clock", async () => {
    await locked("shown", {}, { shownAt: NOW - SHOWN_BOUND });
    expect(await sweepLockedCopies(NOW, async () => open)).toEqual([{ intent: "shown", reason: "shown" }]);
    expect(await lockedIntents()).toEqual([]);
    expect(await openSeed("shown")).toBeUndefined();
  });

  test("deletes when the Hand is closed or past its end, when its raise reverted or was dropped, and when nothing names the copy", async () => {
    await locked("closed");
    await locked("expired", { handId: "8" });
    await locked("reverted", { status: "reverted" });
    await locked("dropped", { status: "dropped", handId: undefined });
    await locked("orphan", null);
    const times = async (r: HandRecord): Promise<HandTimes> => (r.handId === "8" ? { expiry: NOW, closedAt: 0 } : { expiry: NOW + 10, closedAt: NOW - 5 });
    const swept = await sweepLockedCopies(NOW, times);
    expect(swept.sort((a, b) => a.intent.localeCompare(b.intent))).toEqual([
      { intent: "closed", reason: "closed" },
      { intent: "dropped", reason: "dropped" },
      { intent: "expired", reason: "expired" },
      { intent: "orphan", reason: "orphan" },
      { intent: "reverted", reason: "reverted" },
    ]);
    expect(await lockedIntents()).toEqual([]);
  });

  test("never deletes on a failed read", async () => {
    await locked("unreadable");
    expect(await sweepLockedCopies(NOW, async () => { throw new Error("offline"); })).toEqual([]);
    expect(await sweepLockedCopies(NOW, async () => undefined)).toEqual([]);
    expect(await lockedIntents()).toEqual(["unreadable"]);
  });

  test("a stamp is written once; the copy's contents never leave it", async () => {
    await locked("stamped", {}, { lockedAt: NOW - 100, shownAt: NOW - 50 });
    await stampSeed("stamped", "shownAt", NOW);
    expect(await escrowStamps()).toEqual([{ intent: "stamped", lockedAt: NOW - 100, shownAt: NOW - 50 }]);
  });
});
