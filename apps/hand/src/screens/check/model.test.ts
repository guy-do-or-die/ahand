import { describe, expect, test } from "bun:test";
import { checkOrder, type StepResult } from "@ahand/sdk";

import en from "./en";
import { agree, answerName, canStillThank, handNow, hereAnswer, stepKey } from "./model";

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
    for (const key of ["open.route", "open.give", "expired", "thanked-this", "thanked-other", "thanked", "refunded"]) {
      expect(words[`check.now.${key}`], key).toBeTruthy();
    }
  });
});
