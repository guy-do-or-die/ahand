import { plugin } from "bun";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The receiver's card as the route's spine (ui/DealCard.tsx `spine`, ui/Spine.tsx): three beats
 * whatever the route's length, each amount with whose it is, and the card as it ever was under
 * the lens. The browser half is tests/e2e/smoke/nav.spec.ts.
 */

const example = readFileSync(join(import.meta.dir, "../config/config.example.json"), "utf8");
plugin({
  name: "ahand-config",
  setup(build) {
    build.module("virtual:ahand-config", () => ({ contents: `export default ${example};`, loader: "js" }));
  },
});

const { Ambient } = await import("./ambient");
const { DealCard } = await import("./DealCard");
const { wordsOf } = await import("./words");
const fx = await import("../gallery/fixtures");
type RailHand = import("./rail").RailHand;

function draw(lens: boolean, node: ReactNode): string {
  return renderToStaticMarkup(<Ambient lens={lens}>{node}</Ambient>);
}

function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const route = (passes: number, flagged = false): RailHand[] => [
  { role: "asker", address: fx.ASKER },
  ...Array.from({ length: passes }, (_, index): RailHand => (index % 2 === 0 ? { role: "passer", address: fx.HOLDER_A, ...(flagged && index === 0 ? { flag: "asker" as const } : {}) } : { role: "passer" })),
];

const card = (hands: RailHand[], over: { reward?: number; claimBps?: number; state?: "open" | undefined } = {}) => (
  <DealCard
    state={"state" in over ? over.state : "open"}
    description={{ status: "attached", title: fx.HAND_WORDS.en.title, content: fx.HAND_WORDS.en.content }}
    reward={fx.dollars(over.reward ?? 40)}
    decimals={fx.DECIMALS}
    expiry={fx.EXPIRY}
    claimBps={over.claimBps ?? 9_000}
    raiser={fx.ASKER}
    handId={12n}
    block={fx.BLOCK}
    timeZone="UTC"
    spine={{ hands }}
  />
);

describe("the receiver's card as the route's spine", () => {
  test("three beats: who asked with the whole reward, who passed it on with what they kept, you with what reaches you", () => {
    const markup = draw(false, card(route(2)));
    const calm = text(markup);
    expect(markup.match(/class="ah-spine__row"/g)?.length).toBe(3);
    expect(markup).toContain('data-value="3"');
    expect(calm).toContain("Someone raised a hand:");
    expect(calm).toContain(fx.HAND_WORDS.en.title);
    expect(calm).toContain("Reward $40 · open until 20 Dec");
    expect(calm).toContain("2 people passed it on");
    expect(calm).toContain("kept $4");
    expect(calm).toMatch(/It reached you \$36 If you help and they thank you/);
    expect(markup).toContain('data-plate="reaches"');
    // The whole and the kept stand with whose they are, so the sentence that joined them is gone.
    expect(calm).not.toContain("of $40:");
    // What happens when nobody is thanked is still said.
    expect(calm).toContain("If nobody is thanked by");
    // No bubble around the words, no plate under a mark, and the people stay folded until asked for.
    expect(markup).not.toContain("ah-asker__bubble");
    expect(markup).not.toContain("ah-deal__gesture");
    expect(markup).not.toContain("kit-spine-pass");
    expect(markup).toContain('aria-expanded="false"');
  });

  test("the row of those who passed it on is one line whatever their number, and is absent when nobody did", () => {
    expect(text(draw(false, card(route(1))))).toContain("Someone passed it on");
    const many = draw(false, card(route(33)));
    expect(text(many)).toContain("33 people passed it on");
    expect(many.match(/class="ah-spine__row"/g)?.length).toBe(3);
    expect(many).toContain('data-value="34"');
    const none = draw(false, card(route(0), { claimBps: 10_000 }));
    expect(none.match(/class="ah-spine__row"/g)?.length).toBe(2);
    expect(none).toContain('data-plate="reward"');
    expect(text(none)).toMatch(/It reached you \$40 If you help and they thank you/);
    expect(text(none)).not.toContain("kept");
  });

  test("a pass that named the asker's own address is said without opening anything", () => {
    const markup = draw(false, card(route(2, true)));
    expect(markup.match(/data-flag="asker"/g)?.length).toBe(1);
    expect(markup).toMatch(/data-role="passer" data-flag="asker"/);
    expect(text(markup)).toContain("A pass here named the asker's own address");
    expect(draw(false, card(route(2)))).not.toContain("data-flag");
  });

  test("a hand with no reward says so at the viewer's place and sets no amount on amber", () => {
    const markup = draw(false, card(route(1), { reward: 0 }));
    const calm = text(markup);
    expect(markup).toContain('data-plate="none"');
    expect(calm).toContain("No reward: a thank-you only");
    expect(calm).not.toContain("Reward $");
    expect(calm).not.toContain("kept");
    expect(calm).toContain("open until 20 Dec");
  });

  test("with no time from the network the card claims nothing about now", () => {
    const calm = text(draw(false, card(route(2), { state: undefined })));
    expect(calm).toContain("until 20 Dec");
    expect(calm).not.toContain("open until");
    expect(calm).not.toContain("If you help and they thank you");
  });

  test("under the lens the card is drawn in full: Core's own figure, no spine, and no bubble either", () => {
    const markup = draw(true, card(route(2)));
    expect(markup).not.toContain("ah-spine");
    expect(markup).not.toContain("ah-asker__bubble");
    expect(markup).toContain("ah-asker__words");
    expect(markup).toContain("ah-figure");
  });

  test("a card that knows no route still reads as the spine: who asked, then the viewer's place, with what was kept said beside the amount", () => {
    const plain = (
      <DealCard state="open" description={{ status: "attached", title: fx.HAND_WORDS.en.title }} reward={fx.dollars(40)} decimals={fx.DECIMALS} expiry={fx.EXPIRY} claimBps={9_000} raiser={fx.ASKER} handId={12n} timeZone="UTC" />
    );
    const markup = draw(false, plain);
    expect(markup.match(/class="ah-spine__row"/g)?.length).toBe(2);
    expect(markup).toContain('data-value="0"');
    expect(text(markup)).toContain("of $40: $4 was kept along the way");
    // The public view has no place on the route: the asker's row only.
    const noPlace = draw(false, <DealCard state="open" description={{ status: "none" }} reward={fx.dollars(40)} decimals={fx.DECIMALS} expiry={fx.EXPIRY} raiser={fx.ASKER} handId={12n} timeZone="UTC" />);
    expect(noPlace.match(/class="ah-spine__row"/g)?.length).toBe(1);
    expect(text(noPlace)).toContain("Someone raised a hand.");
    expect(text(noPlace)).toContain("Reward $40 · open until 20 Dec");
    expect(noPlace).not.toContain("ah-deal__sum");
  });

  test("the last beat of a Hand that is over is what it came to, and nobody has a place on it", () => {
    const hands: RailHand[] = [...route(1), { role: "helper", address: fx.HELPER }];
    const base = { description: { status: "attached" as const, title: fx.HAND_WORDS.en.title }, reward: fx.dollars(40), decimals: fx.DECIMALS, expiry: fx.EXPIRY, claimBps: 9_000, raiser: fx.ASKER, handId: 12n, timeZone: "UTC", spine: { hands } };
    const thanked = draw(false, <DealCard {...base} state="thanked" closedAt={fx.THANKED_AT} />);
    expect([...thanked.matchAll(/class="ah-spine__row" data-role="([a-z]+)"/g)].map((found) => found[1])).toEqual(["asker", "passers", "helper", "end"]);
    expect(text(thanked)).toContain("Someone answered");
    expect(text(thanked)).toContain("Thanked on 3 Dec.");
    expect(thanked).not.toContain("ah-deal__sum");
    expect(text(thanked)).toContain("Reward $40");
    const expired = text(draw(false, <DealCard {...base} state="expired" spine={{ hands: route(1) }} />));
    expect(expired).toContain("was open until 20 Dec");
    expect(expired).toContain("Time's up.");
    expect(expired).not.toContain("It reached you");
  });

  test("the asker's own card is the same spine in the asker's words, with the floor they set and no amount on amber", () => {
    const markup = draw(false, <DealCard state="open" viewer="asker" description={{ status: "attached", title: fx.HAND_WORDS.en.title }} reward={fx.dollars(40)} decimals={fx.DECIMALS} expiry={fx.EXPIRY} claimBps={7_000} raiser={fx.ASKER} handId={12n} timeZone="UTC" />);
    const calm = text(markup);
    expect(markup.match(/class="ah-spine__row"/g)?.length).toBe(1);
    expect(calm).toContain("You raised a hand:");
    expect(calm).toContain("Reward $40 · open until 20 Dec");
    expect(calm).toContain("$28");
    expect(markup).not.toContain("ah-deal__sum");
    expect(calm).not.toContain("It reached you");
  });

  test("Russian counts people as Russian does", () => {
    const ru = wordsOf("ru").spine;
    expect(ru.passed(1)).toBe("Кто-то передал дальше");
    expect(ru.passed(2)).toBe("2 человека передали дальше");
    expect(ru.passed(5)).toBe("5 человек передали дальше");
    expect(ru.passed(21)).toBe("21 человек передал дальше");
    expect(ru.passed(33)).toBe("33 человека передали дальше");
    expect(ru.kept("$3", 1)).toBe("оставил себе $3");
    expect(ru.kept("$3", 33)).toBe("оставили себе $3");
    expect(ru.you).toBe("Дошло до тебя");
  });
});

describe("each fact of a Hand stands once on its card", () => {
  const { span } = require("./format") as typeof import("./format");
  const at = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h) / 1000;

  test("how far off a date is, as a person counts it on the calendar", () => {
    expect(span(at(2026, 12, 24), at(2027, 1, 31), "en", "UTC")).toBe("1 month and 7 days");
    expect(span(at(2026, 12, 24), at(2027, 1, 31), "ru", "UTC")).toBe("1 месяц и 7 дней");
    expect(span(at(2027, 3, 1), at(2027, 3, 13), "en", "UTC")).toBe("12 days");
    expect(span(at(2027, 3, 1), at(2027, 9, 1), "ru", "UTC")).toBe("6 месяцев");
    expect(span(at(2027, 1, 31), at(2027, 3, 1), "en", "UTC")).toBe("1 month and 1 day");
    // Under a day whole hours; under an hour, or not ahead at all, nothing to count.
    expect(span(at(2027, 3, 1, 9), at(2027, 3, 1, 14), "en", "UTC")).toBe("5 hours");
    expect(span(at(2027, 3, 1, 9), at(2027, 3, 1, 9) + 1800, "en", "UTC")).toBeUndefined();
    expect(span(at(2027, 3, 2), at(2027, 3, 1), "en", "UTC")).toBeUndefined();
  });

  test("the reward is said at the asker only where the viewer's own beat does not show that amount; the date once, with how far off it is; the last row points back at it", () => {
    const base = { description: { status: "attached" as const, title: fx.HAND_WORDS.en.title }, reward: fx.dollars(40), decimals: fx.DECIMALS, expiry: fx.EXPIRY, raiser: fx.ASKER, handId: 12n, block: fx.BLOCK, timeZone: "UTC" };
    // Nothing was kept on the way: the amount stands once, on amber.
    const whole = text(draw(false, <DealCard {...base} state="open" claimBps={10_000} />));
    expect(whole).not.toContain("Reward $40");
    expect(whole.match(/\$40/g)?.length).toBe(1);
    expect(whole).toMatch(/open until 20 Dec ?, in 1 month/);
    expect(whole.match(/20 Dec/g)?.length).toBe(1);
    expect(whole).toContain("If nobody is thanked by then the whole reward goes back");
    // A share was kept: both amounts stand, each with whose it is.
    const kept = text(draw(false, <DealCard {...base} state="open" claimBps={9_000} spine={{ hands: route(1) }} />));
    expect(kept).toContain("Reward $40 · open until 20 Dec");
    expect(kept).toMatch(/It reached you \$36/);
    // A Hand that is over says no "in …": there is nothing ahead.
    expect(text(draw(false, <DealCard {...base} state="expired" claimBps={10_000} />))).not.toMatch(/, in \d/);
  });
});
