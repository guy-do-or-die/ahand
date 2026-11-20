import { describe, expect, test } from "bun:test";
import type { Check } from "@ahand/sdk";

import en from "./en";
import ru from "./ru";
import { receiptAmounts } from "../../ui/receipt";
import { amountOfCheck, bundleLine, markOf, notCheckableKeyOf, payoutRowsOf, sectionsOf, sentenceKeyOf, tallyOf, verdictOf, verifyLine } from "./model";

const A = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
/** The SDK's sentence key for each id (proof.ts). */
const SENTENCE: Record<string, string> = {
  "reward-time": "proof.rewardTime",
  "route-hash": "proof.routeHash",
  "give-claim": "proof.giveClaim",
  "give-hash": "proof.giveHash",
  "give-key": "proof.giveKey",
  giver: "proof.giver.key",
  "giver-amount": "proof.giverAmount",
};
const sentenceOf = (id: string) => SENTENCE[id] ?? `proof.${id.split(".")[0]}`;
const chain = (id: string, extra: Partial<Check> = {}): Check => ({
  id,
  sentence: sentenceOf(id),
  inputs: {},
  expected: "1",
  actual: "1",
  ok: true,
  source: { event: "Given", block: 9n, tx: "0x01", logIndex: 2 },
  basis: "recorded",
  ...extra,
});

const thanked: Check[] = [
  chain("core", { source: "computed here" }),
  chain("raised", { source: { view: "hands(id)", block: 9n } }),
  chain("reward-time"),
  chain("description", { ok: "not-checkable" }),
  chain("route.0"),
  chain("keys.0", { source: "computed here" }),
  chain("share.0", { actual: "1500000" }),
  chain("route-hash"),
  chain("give-claim"),
  chain("give-hash"),
  chain("give-key", { source: "computed here" }),
  chain("giver", { source: "computed here" }),
  chain("giver-amount"),
  chain("payout.shake.0", { sentence: "proof.payout", actual: "Paid · 1500000 · x", inputs: { payee: A, amount: "1500000" } }),
  chain("payout.giver", { sentence: "proof.payout", actual: "Pending · 3 · x", inputs: { payee: A, amount: "3" } }),
  chain("payouts"),
  chain(`now.${A}`, { sentence: "proof.now", actual: "5", source: { view: "pending(token, payee)", block: 9n } }),
];

describe("proof: the timeline's arrangement", () => {
  test("a thanked Hand fills the eleven parts in UX-SPEC's order", () => {
    const sections = sectionsOf(thanked);
    expect(sections.map((s) => [s.key, s.index])).toEqual([
      ["core", 1],
      ["raised", 2],
      ["reward-time", 3],
      ["description", 4],
      ["route", 5],
      ["shares", 6],
      ["route-hash", 7],
      ["give", 8],
      ["giver-amount", 9],
      ["payouts", 10],
      ["now", 11],
    ]);
    expect(sections.flatMap((s) => s.checks.map((c) => c.id))).toEqual(thanked.map((c) => c.id));
  });

  test("a refunded Hand: the first four, then the reward going back, with its payout and what waits", () => {
    const refunded = [...thanked.slice(0, 4), chain("refunded"), chain("payout.raiser", { sentence: "proof.payout" }), chain(`now.${A}`, { actual: "0" })];
    const sections = sectionsOf(refunded);
    expect(sections.map((s) => s.key)).toEqual(["core", "raised", "reward-time", "description", "back"]);
    expect(sections.at(-1)!.checks[0]!.id).toBe("refunded");
  });

  test("marks come from the source; money still waiting is marked waiting", () => {
    expect(markOf(thanked[0]!)).toBe("checked");
    expect(markOf(thanked[1]!)).toBe("chain");
    expect(markOf(thanked.at(-1)!)).toBe("waiting");
    expect(markOf(chain(`now.${A}`, { actual: "0", source: { view: "pending", block: 1n } }))).toBe("chain");
  });

  test("verdicts: not checkable is never a failure", () => {
    expect(verdictOf(thanked[3]!)).toBe("not-checkable");
    expect(verdictOf(chain("x", { ok: false }))).toBe("fail");
    expect(tallyOf(thanked)).toEqual({ ok: 16, fail: 0, notCheckable: 1 });
    expect(notCheckableKeyOf(thanked[3]!)).toBe("proof.nc.description");
  });

  test("every sentence key a line can take exists in both languages", () => {
    for (const check of [...thanked, chain(`now.${A}`, { sentence: "proof.now", actual: "0" }), chain("description", { expected: "none" })]) {
      const key = sentenceKeyOf(check);
      expect((en as Record<string, string>)[key], key).toBeTruthy();
      expect((ru as Record<string, string>)[key], key).toBeTruthy();
    }
    expect(sentenceKeyOf(thanked[14]!)).toBe("proof.payout.pending");
    expect(sentenceKeyOf(thanked[13]!)).toBe("proof.payout.paid");
  });

  test("amounts are read from the inputs or the actual value", () => {
    expect(amountOfCheck(thanked[6]!)).toBe(1_500_000n);
    expect(amountOfCheck(thanked[13]!)).toBe(1_500_000n);
    expect(amountOfCheck(thanked[0]!)).toBeUndefined();
  });

  test("the payout rows decide cents or every digit as the receipt does, so the lines add up (M-4)", () => {
    expect(payoutRowsOf(thanked)).toEqual([1_500_000n, 3n]);
    const payout = (id: string, amount: string) => chain(id, { sentence: "proof.payout", actual: `Paid · ${amount} · x`, inputs: { payee: A, amount } });
    // Hand E of the review: $0.165 + $0.000033 + $0.164967 = $0.33; cut to cents the rows read $0.16 + under $0.01 + $0.16.
    const handE = [payout("payout.shake.0", "165000"), payout("payout.shake.1", "33"), payout("payout.giver", "164967")];
    const rows = payoutRowsOf(handE);
    expect(rows).toEqual([165_000n, 33n, 164_967n]);
    const written = receiptAmounts(rows, 330_000n, 6, "en");
    expect(written.exact).toBe(true);
    expect(written.rows).toEqual(["$0.165", "$0.000033", "$0.164967"]);
    // Whole cents stay in cents.
    expect(receiptAmounts(payoutRowsOf([payout("payout.shake.0", "1500000"), payout("payout.giver", "38500000")]), 40_000_000n, 6, "en").exact).toBe(false);
  });

  test("a position on the route is a pass, the word /check uses, never a hand (F6)", () => {
    for (const key of ["proof.route", "proof.keys", "proof.share", "proof.share.none"]) {
      expect((en as Record<string, string>)[key], key).toStartWith("Pass {n} ");
      expect((ru as Record<string, string>)[key], key).toStartWith("Передача {n} ");
    }
  });

  test("the description line says whose words they are and that nobody checked them, not that they are true (E-8)", () => {
    expect(en["proof.description"]).toBe("These are the asker's own words, unchanged since the hand was raised. Nobody checked whether they are true.");
    expect(ru["proof.description"]).toBe("Это слова самого автора, и с момента, как рука поднята, они не менялись. Правдивы ли они, никто не проверял.");
  });

  test("a pass that kept nothing is said in words, as the receipt says it, not as $0 (M-4)", () => {
    const zero = chain("share.0", { actual: "0", expected: "0" });
    expect(sentenceKeyOf(zero)).toBe("proof.share.none");
    expect(en["proof.share.none"]).not.toContain("{amount}");
    expect(ru["proof.share.none"]).not.toContain("{amount}");
    expect(sentenceKeyOf(thanked[6]!)).toBe("proof.share");
  });

  test("the mono line under the title is the catalogue's, in Russian too (F10)", () => {
    expect(en["proof.meta"]).toBe("Chain {chain} · Core {core} · Hand {hand}");
    expect(ru["proof.meta"]).toBe("Сеть {chain} · Core {core} · Рука {hand}");
  });

  test("the lines without this site name the CLI from a clone, never a registry package", () => {
    const line = verifyLine({ commit: "ab".repeat(20), rpc: "http://127.0.0.1:18585", core: A, handId: 7n });
    expect(line).toBe(`git checkout ${"ab".repeat(20)} && bun install && bun tools/ahand.ts verify --rpc http://127.0.0.1:18585 --core ${A} 7`);
    expect(bundleLine(31337, 7n)).toBe("bun tools/ahand.ts verify --bundle ahand-proof-31337-7.json");
    expect(bundleLine(31337, 7n, "http://127.0.0.1:8545")).toBe("bun tools/ahand.ts verify --bundle ahand-proof-31337-7.json --rpc http://127.0.0.1:8545");
  });
});
