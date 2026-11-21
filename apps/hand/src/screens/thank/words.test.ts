import { describe, expect, test } from "bun:test";

import en from "./en";
import ru from "./ru";

/**
 * The thank screen's own word rules, beside the app-wide words guard (tests/guards/words.test.ts).
 * The contract has no owner (/limits and /core say so), so no sentence here may speak of one:
 * a payout that waits belongs to its payee, "whoever it belongs to".
 */
describe("thank words", () => {
  test("no sentence speaks of an owner", () => {
    const hits = (catalogue: Record<string, string>, word: RegExp) => Object.entries(catalogue).filter(([, message]) => word.test(message)).map(([key]) => key);
    expect(hits(en, /\bowners?\b/i)).toEqual([]);
    expect(hits(ru, /(?<!\p{L})владел/iu)).toEqual([]);
  });

  test("the fine print under who gets what says who can take a waiting payout out, and that anyone can deliver it", () => {
    expect(en["thank.predicted.waitsIfBlocked"]).toBe(
      "If a payment can't get through, it is held until whoever it belongs to takes it, or anyone delivers it to them.",
    );
    expect(ru["thank.predicted.waitsIfBlocked"]).toBe(
      "Если выплата не может пройти, она хранится, пока её не заберёт тот, кому она причитается, или пока кто-нибудь не доставит её ему.",
    );
  });

  test("what was spent is said on the human layer without the specialist's words, and the transaction stands in the lens", () => {
    for (const catalogue of [en, ru] as Record<string, string>[]) {
      expect(catalogue["thank.spent"]).toContain("{usd}");
      expect(catalogue["thank.spent"]).toContain("{date}");
      expect(catalogue["thank.spent.steps"]).toContain("{usd}");
      // The calm view's sentences leave the price snapshot's date to the lens.
      expect(catalogue["thank.spent.calm"]).toContain("{usd}");
      expect(catalogue["thank.spent.calm"]).not.toContain("{date}");
      expect(catalogue["thank.spent.steps.calm"]).not.toContain("{date}");
      for (const key of ["thank.lens.tx", "thank.lens.tx.hash", "thank.lens.tx.from", "thank.lens.tx.block", "thank.lens.tx.gas", "thank.lens.tx.fee"]) {
        expect(catalogue[key]).toBeTruthy();
      }
    }
    expect(en["thank.lens.tx.gas"]).toContain("{gas}");
    expect(en["thank.lens.tx.fee"]).toContain("{eth}");
  });
});
