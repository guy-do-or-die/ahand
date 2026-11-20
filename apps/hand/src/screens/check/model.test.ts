import { describe, expect, test } from "bun:test";
import { checkOrder, readHand, type StepResult } from "@ahand/sdk";
import { zeroAddress, zeroHash, type Hex, type PublicClient } from "viem";

import en from "./en";
import { agree, answerName, coreSentences, hereAnswer, standingOf, stepKey } from "./model";
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

/* F1: Core's checkRoute and checkGive ignore the expiry and closedAt, so the page says the state. */

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
  const { view, stateAt } = await readHand(chainWith(closedAt, giveHash), CORE, 3n);
  return standingOf(stateAt(now), view);
}

describe("check: the hand's state comes before Core's sentence (F1)", () => {
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
    expect(standingOf("missing", { expiry: 0, closedAt: 0 })).toBeUndefined();
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

describe("check: Russian that reads as written in Russian (F10, F16)", () => {
  test("the ruler's byte unit is the reader's own", () => {
    expect(en["check.ruler.span"]).toBe("{from}–{to} · {n} B");
    expect(ru["check.ruler.span"]).toBe("{from}–{to} · {n} Б");
  });

  test("the lead and column 2 say what the page does in plain Russian", () => {
    expect(ru["check.intro"]).toContain("Страница разберёт её по байтам без сети");
    expect(ru["check.here.chainOnly"]).toBe("Три вещи знает только сеть — открыта ли рука, кто обращается и который час, — поэтому здесь они не проверяются.");
  });
});
