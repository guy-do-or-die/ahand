import { describe, expect, test } from "bun:test";
import { checkOrder, type StepResult } from "@ahand/sdk";

import en from "./en";
import { agree, answerName, hereAnswer, stepKey } from "./model";

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
