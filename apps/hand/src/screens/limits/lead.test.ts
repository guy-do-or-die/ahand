import { describe, expect, test } from "bun:test";

import en from "./en";
import { leadOf } from "./lead";
import ru from "./ru";

describe("limits: only the limit itself is bold (F13)", () => {
  test("the first sentence is the lead and the rest follows in body weight", () => {
    expect(leadOf(en["limits.voluntary.say"])).toEqual({
      lead: "Thanking is voluntary.",
      rest: "The asker can get help and let the hand run out; the reward then goes back to them.",
    });
    expect(leadOf(ru["limits.voluntary.say"]).lead).toBe("Благодарить — по желанию.");
    expect(leadOf("One sentence only")).toEqual({ lead: "One sentence only", rest: "" });
  });

  test("a number or a figure with a point is not a sentence's end", () => {
    expect(leadOf("Fees of 1.5% apply. Then more.")).toEqual({ lead: "Fees of 1.5% apply.", rest: "Then more." });
  });

  test("every entry's lead is shorter than the entry in both languages, so no entry is set bold whole", () => {
    const ids = Object.keys(en).flatMap((key) => /^limits\.(.+)\.say$/.exec(key)?.[1] ?? []);
    expect(ids).toHaveLength(16);
    for (const id of ids) {
      for (const words of [en, ru] as Record<string, string>[]) {
        const say = words[`limits.${id}.say`]!;
        const { lead, rest } = leadOf(say);
        expect(`${lead} ${rest}`.trim(), id).toBe(say);
        if (id !== "unaudited") expect(rest.length, id).toBeGreaterThan(0);
      }
    }
  });

  test("the Russian says what the asker does not do, not a calque of letting the hand expire", () => {
    expect(ru["limits.voluntary.say"]).toBe("Благодарить — по желанию. Автор может получить помощь и так и не сказать спасибо до конца срока; тогда награда вернётся ему.");
    expect(Object.values(ru).join("\n")).not.toContain("дать руке истечь");
  });
});
