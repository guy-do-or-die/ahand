import { describe, expect, test } from "bun:test";
import type { Check, HandLog, HandRecord } from "@ahand/sdk";
import type { Address, Hex } from "viem";

import en from "./en";
import ru from "./ru";
import { notCheckableKeyOf, sectionsOf, sentenceKeyOf } from "./model";
import { bundleExtra, ethShort, feeOf, isPageCheck, moveFor, sentLines, timeChecks, withoutCoreBuild, withPageChecks, type PageFacts, type Sent } from "./sent";

const CORE: Address = "0x65ac707E2AE7392583de5d6192C619F1D8862309";
const TOKEN: Address = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const RAISER: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const HOLDER: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const GIVER: Address = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const ZERO = `0x${"0".repeat(64)}` as Hex;
const TX_RAISE = `0x${"a1".repeat(32)}` as Hex;
const TX_THANK = `0x${"b2".repeat(32)}` as Hex;
const HASH_RAISE = `0x${"c3".repeat(32)}` as Hex;
const HASH_THANK = `0x${"d4".repeat(32)}` as Hex;

const log = (eventName: HandLog["eventName"], logIndex: number, args: HandLog["args"] = {}, closing = true): HandLog => ({
  eventName,
  args: { handId: 1n, ...args },
  blockNumber: closing ? 40n : 30n,
  blockHash: closing ? HASH_THANK : HASH_RAISE,
  transactionHash: closing ? TX_THANK : TX_RAISE,
  logIndex,
});

/** A thanked Hand as the reviewer met it: the token's Transfers at 2, 5 between Core's Paid at 3, 6. */
const record: HandRecord = {
  chainId: 31337,
  core: CORE,
  handId: 1n,
  block: 50n,
  coreHand: { handId: 1n, raiser: RAISER, expiry: 9_000, openedAt: 1_000, closedAt: 2_000, token: TOKEN, payoutGasK: 250, minClaimBps: 7_000, reward: 40_000_000n, rootKey: HOLDER, dataHash: ZERO },
  thank: { giveHash: `0x${"ee".repeat(32)}`, dataHash: ZERO },
  logs: [
    log("Raised", 0, { reward: 40_000_000n }, false),
    log("Thanked", 0),
    log("Shaken", 1, { payee: HOLDER, margin: 2_000_000n }),
    log("Paid", 3, { payee: HOLDER, amount: 2_000_000n }),
    log("Given", 4, { payee: GIVER, amount: 38_000_000n }),
    log("Paid", 6, { payee: GIVER, amount: 38_000_000n }),
  ],
  pending: [],
  coreHasCode: true,
  closingTx: TX_THANK,
};

const sent: Sent = {
  hash: TX_THANK,
  from: RAISER,
  to: CORE,
  blockNumber: 40n,
  status: "success",
  gasUsed: 195_123n,
  effectiveGasPrice: 1_000_000_007n,
  moves: [
    { token: TOKEN, from: CORE, to: HOLDER, amount: 2_000_000n, logIndex: 2 },
    { token: TOKEN, from: CORE, to: GIVER, amount: 38_000_000n, logIndex: 5 },
  ],
};
const facts: PageFacts = { sent, opened: { block: 30n, timestamp: 1_000 }, closed: { block: 40n, timestamp: 2_000 } };

const payout = (id: string, payee: Address, amount: bigint, logIndex: number, kind = "Paid"): Check => ({
  id,
  basis: "recorded",
  messageId: "proof.payout",
  inputs: { payee, amount: String(amount) },
  expected: `Paid or Pending · ${amount} · ${payee}`,
  actual: `${kind} · ${amount} · ${payee}`,
  verdict: true,
  source: { event: kind, block: 40n, tx: TX_THANK, logIndex },
});

describe("proof: the blocks' own times", () => {
  test("both lines hold when each event's block carries the time the contract keeps", () => {
    const [opened, closed] = timeChecks(record, facts);
    expect(opened).toMatchObject({ id: "time.opened", verdict: true, expected: "1000", actual: "1000", formula: "block(Raised).timestamp = hands(id).openedAt" });
    expect(opened!.source).toEqual({ event: "Raised", block: 30n, tx: TX_RAISE, logIndex: 0 });
    expect(closed).toMatchObject({ id: "time.closed", verdict: true, expected: "2000", actual: "2000", formula: "block(Thanked).timestamp = hands(id).closedAt" });
    expect(closed!.inputs.blockHash).toBe(HASH_THANK);
  });

  test("a block whose time differs from the kept one is a finding", () => {
    const [opened, closed] = timeChecks(record, { ...facts, opened: { block: 30n, timestamp: 999 }, closed: { block: 40n, timestamp: 2_001 } });
    expect(opened!.verdict).toBe(false);
    expect(opened!.actual).toBe("999");
    expect(closed!.verdict).toBe(false);
  });

  test("a time that was not read, or of another block, is not checkable, never failed", () => {
    for (const given of [undefined, {}, { opened: { block: 31n, timestamp: 1_000 }, closed: { block: 41n, timestamp: 2_000 } }] as (PageFacts | undefined)[]) {
      const checks = timeChecks(record, given);
      expect(checks.map((check) => check.verdict)).toEqual(["not-checkable", "not-checkable"]);
      for (const check of checks) expect(notCheckableKeyOf(check)).toBe("proof.nc.time");
    }
  });

  test("an open Hand has only the opening line; a refunded one names the return", () => {
    const open: HandRecord = { ...record, coreHand: { ...record.coreHand, closedAt: 0 }, logs: [record.logs[0]!] };
    expect(timeChecks(open, facts).map((check) => check.id)).toEqual(["time.opened"]);
    const refunded: HandRecord = { ...record, logs: [record.logs[0]!, log("Refunded", 0, { reward: 40_000_000n })] };
    const closed = timeChecks(refunded, facts)[1]!;
    expect(closed.formula).toBe("block(Refunded).timestamp = hands(id).closedAt");
    expect(sentenceKeyOf(closed)).toBe("proof.time.closed.refund");
    expect(sentenceKeyOf(timeChecks(record, facts)[1]!)).toBe("proof.time.closed.thank");
    // No Raised in the record: the SDK's own `raised` line says so; no time line is invented.
    expect(timeChecks({ ...record, logs: [] }, facts)).toEqual([]);
  });

  test("every sentence of the page's own lines exists in both languages", () => {
    const keys = ["proof.time.opened", "proof.time.closed.thank", "proof.time.closed.refund", "proof.nc.time", "proof.sent.thank", "proof.sent.refund", "proof.sent.none", "proof.move", "proof.move.none", "proof.core.caveat"];
    for (const key of keys) {
      expect((en as Record<string, string>)[key], key).toBeTruthy();
      expect((ru as Record<string, string>)[key], key).toBeTruthy();
    }
  });
});

describe("proof: where the page's lines stand", () => {
  const sdk = (ids: string[]): Check[] => ids.map((id) => ({ id, messageId: `proof.${id}`, inputs: {}, expected: "1", actual: "1", verdict: true, source: "computed here", basis: "computed" }));
  const times = timeChecks(record, facts);

  test("a site built without deployment facts: only the core line becomes not checkable", () => {
    const lines = withoutCoreBuild(sdk(["core", "raised"]));
    expect(lines.map((check) => check.verdict)).toEqual(["not-checkable", true]);
  });

  test("a thank: the opening time after the raise, the closing time before the first payout", () => {
    const merged = withPageChecks(sdk(["core", "raised", "reward-time", "description", "route.0", "giver-amount", "payout.shake.0", "payout.giver", "payouts", `now.${GIVER}`]), times);
    expect(merged.map((check) => check.id)).toEqual(["core", "raised", "time.opened", "reward-time", "description", "route.0", "giver-amount", "time.closed", "payout.shake.0", "payout.giver", "payouts", `now.${GIVER}`]);
    const sections = sectionsOf(merged);
    expect(sections.find((section) => section.key === "raised")!.checks.map((check) => check.id)).toEqual(["raised", "time.opened"]);
    expect(sections.find((section) => section.key === "payouts")!.checks[0]!.id).toBe("time.closed");
    expect(sections.map((section) => section.index)).toEqual([1, 2, 3, 4, 5, 9, 10, 11]);
  });

  test("a thank with no reward has no payout lines: the closing time stands before the total", () => {
    const merged = withPageChecks(sdk(["core", "raised", "reward-time", "description", "giver-amount", "payouts"]), times);
    expect(merged.map((check) => check.id).slice(-2)).toEqual(["time.closed", "payouts"]);
  });

  test("a return: the closing time right after it, in the part where the reward goes back", () => {
    const merged = withPageChecks(sdk(["core", "raised", "reward-time", "description", "refunded", "payout.raiser", `now.${RAISER}`]), times);
    expect(merged.map((check) => check.id)).toEqual(["core", "raised", "time.opened", "reward-time", "description", "refunded", "time.closed", "payout.raiser", `now.${RAISER}`]);
    expect(sectionsOf(merged).map((section) => section.key)).toEqual(["core", "raised", "reward-time", "description", "back"]);
  });

  test("the SDK's own lines keep their order, and only the two ids are the page's", () => {
    const ids = ["core", "raised", "reward-time", "description"];
    expect(withPageChecks(sdk(ids), times.slice(0, 1)).filter((check) => !isPageCheck(check.id)).map((check) => check.id)).toEqual(ids);
    expect(isPageCheck("time.opened") && isPageCheck("time.closed")).toBe(true);
    expect(isPageCheck("raised")).toBe(false);
  });
});

describe("proof: the token's own record of a payout", () => {
  test("each Paid line finds the Transfer that stands right before it", () => {
    expect(moveFor(payout("payout.shake.0", HOLDER, 2_000_000n, 3), record, sent)).toEqual(sent.moves[0]);
    expect(moveFor(payout("payout.giver", GIVER, 38_000_000n, 6), record, sent)).toEqual(sent.moves[1]);
  });

  test("another payee, another amount or a Transfer outside its place is not taken", () => {
    expect(moveFor(payout("payout.shake.0", GIVER, 2_000_000n, 3), record, sent)).toBeUndefined();
    expect(moveFor(payout("payout.shake.0", HOLDER, 2_000_001n, 3), record, sent)).toBeUndefined();
    // The helper's Paid must not borrow a Transfer that stands before the Given event.
    const early: Sent = { ...sent, moves: [{ ...sent.moves[1]!, logIndex: 2 }] };
    expect(moveFor(payout("payout.giver", GIVER, 38_000_000n, 6), record, early)).toBeUndefined();
    // Two equal payouts to one address each take their own Transfer.
    const twice: HandRecord = { ...record, logs: [...record.logs.slice(0, 4), log("Shaken", 4, { payee: HOLDER, margin: 2_000_000n }), log("Paid", 6, { payee: HOLDER, amount: 2_000_000n })] };
    const two: Sent = { ...sent, moves: [sent.moves[0]!, { ...sent.moves[0]!, logIndex: 5 }] };
    expect(moveFor(payout("payout.shake.0", HOLDER, 2_000_000n, 3), twice, two)!.logIndex).toBe(2);
    expect(moveFor(payout("payout.shake.1", HOLDER, 2_000_000n, 6), twice, two)!.logIndex).toBe(5);
  });

  test("a waiting payout moved nothing, and no receipt means no claim", () => {
    expect(moveFor(payout("payout.giver", GIVER, 38_000_000n, 6, "Pending"), record, sent)).toBeUndefined();
    expect(moveFor(payout("payout.giver", GIVER, 38_000_000n, 6), record, undefined)).toBeUndefined();
    expect(moveFor(payout("payout.giver", GIVER, 38_000_000n, 6), record, { ...sent, hash: TX_RAISE })).toBeUndefined();
    expect(moveFor({ ...payout("payouts", GIVER, 1n, 6), id: "payouts" }, record, sent)).toBeUndefined();
  });
});

describe("proof: what sending the closing cost", () => {
  test("gas used at the price paid, plus the L1 fee where there is one", () => {
    expect(feeOf(sent)).toBe(195_123n * 1_000_000_007n);
    expect(feeOf({ ...sent, l1Fee: 5n })).toBe(195_123n * 1_000_000_007n + 5n);
  });

  test("ether is written with three significant figures and never as an exponent", () => {
    expect(ethShort(195_123n * 1_000_000_007n)).toBe("0.000195");
    expect(ethShort(0n)).toBe("0");
    expect(ethShort(1_250_000_000_000_000_000n)).toBe("1.25");
    expect(ethShort(2_000_000_000_000_000_000n)).toBe("2");
    expect(ethShort(123_456_000_000_000_000_000n)).toBe("123");
    expect(ethShort(31_000_000n)).toBe("0.000000000031");
    expect(ethShort(100_000_000_000_000n)).toBe("0.0001");
  });

  test("the lens lines name the receipt's own fields and where the logs stand", () => {
    const lines = sentLines(sent, record);
    expect(lines).toContain(`tx ${TX_THANK}`);
    expect(lines).toContain(`from ${RAISER}`);
    expect(lines).toContain("gasUsed 195123 · effectiveGasPrice 1.000000007 gwei");
    expect(lines).toContain("fee 0.000195123001365861 ETH");
    expect(lines.at(-1)).toBe("this Hand's logs 0–6 · the token's Transfer logs 2, 5");
    expect(sentLines({ ...sent, l1Fee: 1_000_000_000_000n }, record)).toContain("l1Fee 0.000001 ETH");
  });

  test("the file's extra part holds what the page read, tagged with its own format", () => {
    expect(bundleExtra(undefined)).toEqual({ format: "aHand.proof-page/1" });
    const extra = bundleExtra(facts);
    expect(extra.format).toBe("aHand.proof-page/1");
    expect(extra.sent).toBe(sent);
    expect(extra.opened).toEqual({ block: 30n, timestamp: 1_000 });
  });
});
