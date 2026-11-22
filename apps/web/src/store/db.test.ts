import "fake-indexeddb/auto";

import { afterEach, describe, expect, test } from "bun:test";

import { all, closeDb, configureDb, get, put, putIfAbsent, remove, type InboxRecord, type SendRecord } from "./db";

let run = 0;
afterEach(() => closeDb());
function fresh(): string {
  const name = `ahand-db-${process.pid}-${++run}`;
  configureDb({ name });
  return name;
}

const record = (firstSeen: number): InboxRecord => ({ id: "0xgive", hand: "31337:0xcore:1", giveLink: "https://x/#g", firstSeen });

describe("putIfAbsent: write once", () => {
  test("the first write wins; a second with the same key is refused and changes nothing", async () => {
    fresh();
    expect(await putIfAbsent("inbox", record(1))).toBe(true);
    expect(await putIfAbsent("inbox", record(2))).toBe(false);
    expect((await get("inbox", "0xgive"))?.firstSeen).toBe(1);
    expect(await all("inbox")).toHaveLength(1);
  });

  test("two writes at once: exactly one is written", async () => {
    fresh();
    const answers = await Promise.all([putIfAbsent("inbox", record(1)), putIfAbsent("inbox", record(2))]);
    expect(answers.filter(Boolean)).toHaveLength(1);
    expect(await all("inbox")).toHaveLength(1);
  });
});

describe("sends: a money action on its way", () => {
  test("is kept by action and place, read back, and removed", async () => {
    fresh();
    const kept: SendRecord = {
      id: "fund:31337:0xcore:7",
      intent: { kind: "tx", chainId: 31337, step: 0, of: 1, from: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", nonce: 4, fromBlock: 120, action: "fund", hash: "0x01" },
    };
    await put("sends", kept);
    expect(await get("sends", kept.id)).toEqual(kept);
    await remove("sends", kept.id);
    expect(await get("sends", kept.id)).toBeUndefined();
  });
});
