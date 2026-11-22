import { describe, expect, test } from "bun:test";
import { checkOrder, readHand, type StepResult } from "@ahand/sdk";
import { zeroAddress, zeroHash, type Hex, type PublicClient } from "viem";

import en from "./en";
import { agree, answerName, canStillThank, coreSentences, handNow, hereAnswer, standingOf, stepKey } from "./model";
import ru from "./ru";

const pass = (shakes: number, give: boolean): StepResult[] => checkOrder(shakes, give).map((step) => ({ ...step, status: "pass" }));

function failAt(steps: StepResult[], index: number): StepResult[] {
  return steps.map((step, at) => ({ ...step, status: at < index ? "pass" : at === index ? "fail" : "not-reached" }));
}

describe("check: the two columns", () => {
  test("all pass here and Core accepts: they agree", () => {
    expect(hereAnswer(pass(2, true), true)).toEqual({ kind: "accepted" });
    expect(agree(hereAnswer(pass(2, true), true), { kind: "accepted" })).toBe(true);
  });

  test("the first failing step is the answer, with Core's position", () => {
    const steps = failAt(pass(2, false), 3); // the second Shake's InvalidClaim
    const here = hereAnswer(steps, true);
    expect(here).toEqual({ kind: "refused", name: "InvalidClaim", position: 1 });
    expect(agree(here, { kind: "refused", name: "InvalidClaim", position: 1 })).toBe(true);
    expect(agree(here, { kind: "refused", name: "InvalidClaim", position: 0 })).toBe(false);
    expect(agree(here, { kind: "accepted" })).toBe(false);
    expect(answerName(here, "accepted")).toBe("InvalidClaim(1)");
  });

  test("an account's confirmation is left to Core", () => {
    const steps = pass(1, true);
    steps[steps.length - 1]!.status = "fail";
    const here = hereAnswer(steps, false);
    expect(here.undecided).toBe(true);
    expect(agree(here, { kind: "accepted" })).toBe(true);
    expect(agree(here, { kind: "refused", name: "InvalidGiverSig" })).toBe(true);
    expect(agree(here, { kind: "refused", name: "InvalidRouteHash" })).toBe(false);
    // A key's own confirmation that fails here is a refusal, not left to Core.
    expect(hereAnswer(steps, true)).toEqual({ kind: "refused", name: "InvalidGiverSig" });
  });

  test("every step of Core's order has a sentence", () => {
    for (const step of checkOrder(1, true)) expect((en as Record<string, string>)[stepKey(step)]).toBeTruthy();
  });
});

describe("check: what the Hand is at the block Core answered at", () => {
  const ZERO = `0x${"0".repeat(64)}`;
  const KEPT = `0x${"ab".repeat(32)}`;
  const open = { closedAt: 0, expiry: 1_000, thankedGiveHash: ZERO };

  test("open until its expiry, by the block's clock; from that second on its time is up", () => {
    expect(handNow({ ...open, now: 999 })).toEqual({ state: "open", expiry: 1_000 });
    // Core: `thank` refuses from block.timestamp >= expiry, `refund` passes from the same second.
    expect(handNow({ ...open, now: 1_000 })).toEqual({ state: "expired", expiry: 1_000 });
    expect(handNow({ ...open, now: 5_000, pastedGiveHash: KEPT })).toEqual({ state: "expired", expiry: 1_000 });
  });

  test("a thanked Hand: the pasted answer is the one kept, another one, or no answer at all", () => {
    const thanked = { closedAt: 700, expiry: 1_000, thankedGiveHash: KEPT, now: 800 };
    expect(handNow({ ...thanked, pastedGiveHash: KEPT.toUpperCase().replace("0X", "0x") })).toEqual({ state: "thanked-this", closedAt: 700 });
    expect(handNow({ ...thanked, pastedGiveHash: `0x${"cd".repeat(32)}` })).toEqual({ state: "thanked-other", closedAt: 700 });
    expect(handNow(thanked)).toEqual({ state: "thanked", closedAt: 700 });
  });

  test("closed with no Give kept: the reward went back, whatever was pasted", () => {
    const refunded = { closedAt: 1_200, expiry: 1_000, thankedGiveHash: ZERO, now: 1_300 };
    expect(handNow(refunded)).toEqual({ state: "refunded", closedAt: 1_200 });
    // A pasted answer whose hash is zero can never be "the one that was thanked".
    expect(handNow({ ...refunded, pastedGiveHash: ZERO })).toEqual({ state: "refunded", closedAt: 1_200 });
  });

  test("only an open Hand in time can still be thanked", () => {
    expect(canStillThank({ state: "open", expiry: 1 })).toBe(true);
    for (const state of ["expired", "thanked-this", "thanked-other", "thanked", "refunded"] as const) {
      expect(canStillThank(state === "expired" ? { state, expiry: 1 } : { state, closedAt: 1 })).toBe(false);
    }
  });

  test("every state has its sentence in both kinds of paste", () => {
    const words = en as Record<string, string>;
    for (const key of ["open.route", "open.give", "open.refused", "thanked-this", "thanked-other"]) {
      expect(words[`check.now.${key}`], key).toBeTruthy();
    }
    // A closed or ended Hand is said by the fix round's sentences (check.state.*), with its date.
    for (const key of ["thanked", "refunded", "expired"]) expect(words[`check.state.${key}`], key).toContain("{date}");
  });
});

/* Core's checkRoute and checkGive ignore the expiry and closedAt, so the page says the state. */

const CORE = "0x65ac707E2AE7392583de5d6192C619F1D8862309" as const;
const RAISER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const EXPIRY = 1_801_210_959;
const CLOSED = 1_798_618_000;

/** A chain that answers `hands(id)` and `thanks(id)` the way Core does, and nothing else. */
function chainWith(closedAt: number, giveHash: Hex): PublicClient {
  const readContract = async ({ functionName }: { functionName: string }) => {
    if (functionName === "hands") return [RAISER, EXPIRY, 1_798_000_000, closedAt, zeroAddress, 250, 7000, 40_000_000n, zeroAddress, zeroHash];
    if (functionName === "thanks") return [giveHash, zeroHash];
    throw new Error(`unexpected ${functionName}`);
  };
  return { readContract } as unknown as PublicClient;
}

/** What column 3 says at the latest block's time `now`, read as the screen reads it. */
async function standingAt(closedAt: number, giveHash: Hex, now: number) {
  const { coreHand } = await readHand(chainWith(closedAt, giveHash), CORE, 3n);
  return standingOf(handNow({ closedAt: coreHand.closedAt, expiry: coreHand.expiry, thankedGiveHash: giveHash, now }), coreHand);
}

describe("check: the hand's state comes before Core's sentence", () => {
  const before = EXPIRY - 3600;

  test("a thanked hand: closed, thanked at closedAt; Core's acceptance promises no share", async () => {
    const standing = await standingAt(CLOSED, `0x${"ab".repeat(32)}`, before);
    expect(standing).toEqual({ state: "thanked", at: CLOSED });
    expect(coreSentences(standing!.state, { kind: "accepted" }, true)).toEqual({ state: "check.state.thanked", valid: "check.state.closed.valid", core: "check.core.accepted.give.ended" });
    expect(coreSentences(standing!.state, { kind: "accepted" }, false).core).toBe("check.core.accepted.route.ended");
  });

  test("a refunded hand is told from a thanked one by thanks(id), as the Hand view does", async () => {
    const standing = await standingAt(CLOSED, zeroHash, before);
    expect(standing).toEqual({ state: "refunded", at: CLOSED });
    expect(coreSentences(standing!.state, { kind: "accepted" }, false)).toEqual({ state: "check.state.refunded", valid: "check.state.closed.valid", core: "check.core.accepted.route.ended" });
  });

  test("a hand past its end and not closed: expired from the second of its expiry, by the block's time", async () => {
    expect(await standingAt(0, zeroHash, EXPIRY - 1)).toEqual({ state: "open" });
    expect(await standingAt(0, zeroHash, EXPIRY)).toEqual({ state: "expired", at: EXPIRY });
    expect(coreSentences("expired", { kind: "accepted" }, false)).toEqual({ state: "check.state.expired", core: "check.core.accepted.route.ended" });
  });

  test("an open hand keeps Core's sentence unchanged", async () => {
    const standing = await standingAt(0, zeroHash, before);
    expect(coreSentences(standing!.state, { kind: "accepted" }, false)).toEqual({ core: "check.core.accepted.route" });
    expect(coreSentences(standing!.state, { kind: "accepted" }, true)).toEqual({ core: "check.core.accepted.give" });
  });

  test("a refusal on a closed hand states the hand's state but never calls the route valid", () => {
    expect(coreSentences("thanked", { kind: "refused", name: "InvalidKeySig", position: 0 }, false)).toEqual({ state: "check.state.thanked", core: "check.core.refused" });
    expect(coreSentences(undefined, { kind: "refused", name: "NotRaised" }, false)).toEqual({ core: "check.core.refused" });
  });

  test("a hand that is not raised has no standing", () => {
    expect(standingOf(handNow({ closedAt: 0, expiry: 0, thankedGiveHash: zeroHash, now: 5 }), { openedAt: 0 })).toBeUndefined();
  });

  test("the standing is handNow told coarsely: one derivation of the Hand's state at a block", () => {
    const raised = { openedAt: 1 };
    expect(standingOf({ state: "thanked-this", closedAt: 7 }, raised)).toEqual({ state: "thanked", at: 7 });
    expect(standingOf({ state: "thanked-other", closedAt: 7 }, raised)).toEqual({ state: "thanked", at: 7 });
    expect(standingOf({ state: "thanked", closedAt: 7 }, raised)).toEqual({ state: "thanked", at: 7 });
    expect(standingOf({ state: "refunded", closedAt: 7 }, raised)).toEqual({ state: "refunded", at: 7 });
    expect(standingOf({ state: "expired", expiry: 9 }, raised)).toEqual({ state: "expired", at: 9 });
    expect(standingOf({ state: "open", expiry: 9 }, raised)).toEqual({ state: "open" });
  });

  test("every sentence exists in both languages and names its date", () => {
    for (const key of ["check.state.thanked", "check.state.refunded", "check.state.expired"]) {
      expect((en as Record<string, string>)[key], key).toContain("{date}");
      expect((ru as Record<string, string>)[key], key).toContain("{date}");
    }
    for (const key of ["check.state.closed.valid", "check.core.accepted.route.ended", "check.core.accepted.give.ended", "check.fromMemory"]) {
      expect((en as Record<string, string>)[key], key).toBeTruthy();
      expect((ru as Record<string, string>)[key], key).toBeTruthy();
    }
  });
});

describe("check: Russian that reads as written in Russian", () => {
  test("the ruler's byte unit is the reader's own", () => {
    expect(en["check.ruler.span"]).toBe("{from}–{to} · {n} B");
    expect(ru["check.ruler.span"]).toBe("{from}–{to} · {n} Б");
  });

  test("the lead and column 2 say what the page does in plain Russian", () => {
    expect(ru["check.intro"]).toContain("Страница разберёт её по байтам без сети");
    expect(ru["check.here.chainOnly"]).toContain("три вещи знает только сеть — кто отправляет благодарность, открыта ли рука и не вышло ли её время, — поэтому здесь они не проверяются");
    expect(ru["check.here.chainOnly"]).toContain("в части 3");
  });
});
