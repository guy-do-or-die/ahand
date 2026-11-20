import { describe, expect, test } from "bun:test";
import { CORE_ABI, type Give, type HandLog, type SignedShake } from "@ahand/sdk";
import { encodeAbiParameters, encodeEventTopics, zeroAddress, zeroHash, type Address, type Hex } from "viem";

import { droppedShares, handLogsOf, landedFlags, payeeFindings, payeeRefusedIn, predictPayouts, verifyThanked, type RawLog } from "./model";

const CORE: Address = "0x65ac707E2AE7392583de5d6192C619F1D8862309";
const TOKEN: Address = "0x6B867aFa284Ce84eE76424373420E1170da2eE7b";
const RAISER: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const A: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const B: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const GIVER: Address = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const KEY1: Address = "0x1111111111111111111111111111111111111111";
const KEY2: Address = "0x2222222222222222222222222222222222222222";
const TX: Hex = `0x${"ab".repeat(32)}`;

function shake(payee: Address, claimBps: number, nextClaimBps: number, nextKey: Address = KEY1): SignedShake {
  return { shake: { nextKey, payee, claimBps, nextClaimBps, dataHash: zeroHash }, keySig: "0x" };
}

const give = (claimBps: number, payee: Address = GIVER): Give => ({ signer: GIVER, payee, claimBps, routeHash: zeroHash, dataHash: zeroHash });

let index = 0;
function log(eventName: HandLog["eventName"], args: Record<string, unknown>): HandLog {
  return { eventName, args: { handId: 7n, ...args } as HandLog["args"], blockNumber: 10n, blockHash: `0x${"cd".repeat(32)}`, transactionHash: TX, logIndex: index++ };
}

describe("predictPayouts: Core's arithmetic", () => {
  test("a margin is the reward times its share, rounded down; the helper gets the rest", () => {
    const rows = predictPayouts(30_000_000n, [shake(A, 10_000, 9_500)], give(9_500));
    expect(rows.map((r) => [r.kind, r.payee, r.bps, r.amount])).toEqual([
      ["passed", A, 500, 1_500_000n],
      ["helped", GIVER, 9_500, 28_500_000n],
    ]);
  });

  test("rounding down leaves the remainder to the helper, so the rows add up to the reward", () => {
    const rows = predictPayouts(1_001n, [shake(A, 10_000, 9_667), shake(B, 9_667, 9_334)], give(9_334));
    expect(rows[0]!.amount).toBe(33n);
    expect(rows[1]!.amount).toBe(33n);
    expect(rows.reduce((sum, r) => sum + r.amount, 0n)).toBe(1_001n);
  });

  test("a reward of zero pays nothing to anyone", () => {
    const rows = predictPayouts(0n, [], give(10_000));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(0n);
  });
});

describe("payeeFindings", () => {
  const ctx = { core: CORE, raiser: RAISER, token: TOKEN };
  test("Core's own address is refused, the asker and the token flagged, a Shake that keeps nothing skipped", () => {
    const rows = predictPayouts(100n, [shake(CORE, 10_000, 9_000), shake(zeroAddress, 9_000, 9_000), shake(RAISER, 9_000, 8_000)], give(8_000, TOKEN));
    const found = payeeFindings(rows, ctx);
    expect(found.map((f) => [f.row, f.problem])).toEqual([
      [0, "core"],
      [2, "raiser"],
      [3, "token"],
    ]);
    expect(payeeRefusedIn(found)).toBe(true);
    expect(payeeRefusedIn(found.filter((f) => f.problem !== "core"))).toBe(false);
  });
});

describe("verifyThanked: success only from the transaction's own logs", () => {
  const shakes = [shake(A, 10_000, 9_500)];
  const thanked = () => {
    index = 0;
    return [
      log("Thanked", { token: TOKEN, reward: 30_000_000n, dataHash: zeroHash }),
      log("Shaken", { payee: A, position: 0n, margin: 1_500_000n, nextKey: KEY1, claimBps: 10_000, nextClaimBps: 9_500, dataHash: zeroHash }),
      log("Paid", { token: TOKEN, payee: A, amount: 1_500_000n }),
      log("Given", { signer: GIVER, payee: GIVER, amount: 28_500_000n, claimBps: 9_500, routeHash: zeroHash, dataHash: zeroHash }),
      log("Pending", { token: TOKEN, payee: GIVER, amount: 28_500_000n }),
    ];
  };

  test("Thanked, Given and one payout per nonzero row: success", () => {
    const verdict = verifyThanked(thanked(), { signedShakes: shakes, give: give(9_500) });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.receipt.rows.map((r) => r.eventName)).toEqual(["Thanked", "Shaken", "Paid", "Given", "Pending"]);
  });

  test("a missing payout is no success", () => {
    const logs = thanked().filter((l) => l.eventName !== "Paid");
    expect(verifyThanked(logs, { signedShakes: shakes, give: give(9_500) }).ok).toBe(false);
  });

  test("a Given for another signer is no success", () => {
    const other = { ...give(9_500), signer: B };
    expect(verifyThanked(thanked(), { signedShakes: shakes, give: other }).ok).toBe(false);
  });

  test("no Thanked is no success", () => {
    expect(verifyThanked(thanked().slice(1), { signedShakes: shakes, give: give(9_500) }).ok).toBe(false);
    expect(verifyThanked([], { signedShakes: shakes, give: give(9_500) }).ok).toBe(false);
  });

  test("a reward of zero: Thanked and Given with no payout is success", () => {
    index = 0;
    const logs = [
      log("Thanked", { token: TOKEN, reward: 0n, dataHash: zeroHash }),
      log("Given", { signer: GIVER, payee: GIVER, amount: 0n, claimBps: 10_000, routeHash: zeroHash, dataHash: zeroHash }),
    ];
    const verdict = verifyThanked(logs, { signedShakes: [], give: give(10_000) });
    expect(verdict.ok).toBe(true);
  });

  test("landed flags follow a second read of the chain's logs", () => {
    const logs = thanked();
    const verdict = verifyThanked(logs, { signedShakes: shakes, give: give(9_500) });
    if (!verdict.ok) throw new Error(verdict.why);
    expect(landedFlags(verdict.receipt, logs.slice(0, 3))).toEqual([true, true, true, false, false]);
    expect(landedFlags(verdict.receipt, logs)).toEqual([true, true, true, true, true]);
  });
});

describe("handLogsOf", () => {
  function raw(eventName: "Thanked" | "Paid", args: Record<string, unknown>, address: Address = CORE, logIndex = 0): RawLog {
    const topics = encodeEventTopics({ abi: CORE_ABI, eventName, args } as never) as Hex[];
    const data =
      eventName === "Thanked"
        ? encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [args.reward as bigint, zeroHash])
        : encodeAbiParameters([{ type: "uint256" }], [args.amount as bigint]);
    return { address, topics, data, blockNumber: 3n, blockHash: `0x${"01".repeat(32)}`, transactionHash: TX, logIndex };
  }

  test("keeps Core's events about this Hand, decoded; drops other Hands and other contracts", () => {
    const logs = [
      raw("Thanked", { handId: 7n, token: TOKEN, reward: 5n }, CORE, 0),
      raw("Paid", { handId: 8n, token: TOKEN, payee: A, amount: 5n }, CORE, 1),
      raw("Paid", { handId: 7n, token: TOKEN, payee: A, amount: 5n }, TOKEN, 2),
      raw("Paid", { handId: 7n, token: TOKEN, payee: A, amount: 5n }, CORE, 3),
    ];
    const out = handLogsOf(logs, CORE, 7n);
    expect(out.map((l) => [l.eventName, l.logIndex])).toEqual([
      ["Thanked", 0],
      ["Paid", 3],
    ]);
    expect(out[1]!.args.amount).toBe(5n);
  });
});

describe("droppedShares", () => {
  test("a dropped holder's share comes from the earlier route that holds its key", () => {
    const earlier = [{ keys: [RAISER, KEY1, KEY2], signedShakes: [shake(A, 10_000, 9_500, KEY1), shake(B, 9_500, 9_000, KEY2)] }];
    expect(droppedShares([{ position: 1, key: KEY1, payee: B }], earlier)).toEqual([{ position: 1, key: KEY1, payee: B, bps: 500 }]);
  });
});
