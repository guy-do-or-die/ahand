import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hex, PublicClient } from "viem";

import { startChain, type Chain } from "../../../../packages/sdk/tests/helpers/anvil";
import { BlockWatcher, latestTip, staleAfterPolls, type Tip } from "./watcher";
const HAND_PORT_BASE = process.env.HAND_TEST_PORT_BASE ? Number(process.env.HAND_TEST_PORT_BASE) : undefined;

/**
 * The one clock: a block watcher with a scripted reader (no tip before the first block, stale
 * after polls with no news, offline on a failed poll), then the real thing on anvil started 40
 * days ahead of this machine, following a jump made with evm_increaseTime within two blocks (the
 * comparison with the machine's clock is the wallet smoke's: chain/ never reads it).
 * Port 16110 is this file's (app-wallet's range 16100–16149); HAND_TEST_PORT_BASE=B moves it to B.
 */

const tip = (number: number, timestamp = 1000 + number): Tip => ({ number: BigInt(number), timestamp, hash: `0x${number.toString(16).padStart(64, "0")}` as Hex });
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("BlockWatcher with a scripted chain", () => {
  test("nothing before the first block; then the tip; stale after quiet polls; offline on failure", async () => {
    const answers: (Tip | Error)[] = [new Error("down"), tip(1), tip(1), tip(1), tip(2), new Error("down"), tip(3)];
    let at = 0;
    const watcher = new BlockWatcher(
      async () => {
        const next = answers[Math.min(at++, answers.length - 1)]!;
        if (next instanceof Error) throw next;
        return next;
      },
      { intervalMs: 1_000_000, staleAfter: 2 },
    );
    const seen: string[] = [];
    const stop = watcher.subscribe(() => {
      const s = watcher.status();
      seen.push(`${s.tip?.number ?? "-"}${s.stale ? " stale" : ""}${s.offline ? " offline" : ""}`);
    });
    await settle();
    expect(watcher.status().tip).toBeUndefined();
    expect(watcher.status().offline).toBe(true);
    for (let i = 0; i < 6; i++) await watcher.refresh();
    stop();
    expect(seen).toEqual(["- offline", "1", "1 stale", "2", "2 offline", "3"]);
  });

  test("the status object stays the same while nothing changes", async () => {
    const watcher = new BlockWatcher(async () => tip(7), { intervalMs: 1_000_000, staleAfter: 100 });
    const stop = watcher.subscribe(() => undefined);
    await settle();
    const first = watcher.status();
    await watcher.refresh();
    expect(watcher.status()).toBe(first);
    stop();
  });

  test("nextTip resolves at a later block", async () => {
    let n = 1;
    const watcher = new BlockWatcher(async () => tip(n), { intervalMs: 1_000_000 });
    const stop = watcher.subscribe(() => undefined);
    await settle();
    const later = watcher.nextTip();
    n = 2;
    await watcher.refresh();
    expect((await later).number).toBe(2n);
    stop();
  });

  test("stale counts polls, at least five and ten seconds' worth", () => {
    expect(staleAfterPolls(1000)).toBe(10);
    expect(staleAfterPolls(200)).toBe(50);
    expect(staleAfterPolls(5000)).toBe(5);
  });
});

describe("BlockWatcher on anvil (block time 1 s, 40 days ahead)", () => {
  let chain: Chain;
  let client: PublicClient;
  beforeAll(async () => {
    chain = await startChain({ port: HAND_PORT_BASE === undefined ? 16110 : HAND_PORT_BASE, blockTime: 1, slotsInAnEpoch: 1 });
    client = chain.client;
  }, 60_000);
  afterAll(async () => {
    await chain?.stop();
  });

  test("follows a jump made with evm_increaseTime within two blocks", async () => {
    const watcher = new BlockWatcher(latestTip(client), { intervalMs: 250 });
    const stop = watcher.subscribe(() => undefined);
    const before = await watcher.nextTip(0n);
    const jump = 10 * 86_400;
    await client.request({ method: "evm_increaseTime" as never, params: [jump] as never });
    const twoLater = await watcher.nextTip(before.number + 2n);
    stop();
    expect(twoLater.timestamp - before.timestamp).toBeGreaterThanOrEqual(jump);
    expect(twoLater.timestamp - before.timestamp).toBeLessThan(jump + 10);
  }, 20_000);

  test("marks the tip stale when blocks stop, and fresh when they come back", async () => {
    const watcher = new BlockWatcher(latestTip(client), { intervalMs: 100, staleAfter: 5 });
    const stop = watcher.subscribe(() => undefined);
    await watcher.nextTip(0n);
    await client.request({ method: "evm_setIntervalMining" as never, params: [0] as never });
    const stale = new Promise<void>((resolve) => {
      const off = watcher.subscribe(() => {
        if (watcher.status().stale) {
          off();
          resolve();
        }
      });
    });
    await stale;
    expect(watcher.status().stale).toBe(true);
    await client.request({ method: "evm_setIntervalMining" as never, params: [1] as never });
    const tipThen = watcher.status().tip!.number;
    await watcher.nextTip(tipThen + 1n);
    expect(watcher.status().stale).toBe(false);
    stop();
  }, 20_000);
});
