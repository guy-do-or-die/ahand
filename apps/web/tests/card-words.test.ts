import { describe, expect, test } from "bun:test";

import { WORDS as CARD } from "@ahand/card";

import { WORDS as APP } from "../src/ui/words";

/**
 * The link's preview speaks with the receiver's card's own sentences (packages/card/src/words.ts
 * names them), so a person reads the same words in the chat and on the page. When one side is
 * reworded, this fails until the other follows.
 */
describe("the preview card and the receiver's card say the same sentences", () => {
  for (const lang of ["en", "ru"] as const) {
    test(lang, () => {
      const card = CARD[lang];
      const app = APP[lang];
      const date = "20 Dec";
      expect(card.intro).toBe(app.deal.intro);
      expect(card.bare).toBe(app.deal.bare);
      expect(card.noReward).toBe(app.deal.noReward);
      expect(card.openUntil(date)).toBe(app.deal.openUntil(date));
      expect(card.wasOpenUntil(date)).toBe(app.deal.wasOpenUntil(date));
      expect(card.timeUp).toBe(app.deal.timeUp);
      expect(card.thanked(date)).toBe(app.deal.thanked(date));
      expect(card.refunded(date)).toBe(app.deal.refunded(date));
      expect(card.closed(date)).toBe(app.deal.closed(date));
      const reward = card.reward("$40");
      expect(`${reward.before}${reward.amount}${reward.after}`).toBe(app.spine.reward("$40"));
    });
  }
});
