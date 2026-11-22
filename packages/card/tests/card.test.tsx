import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { cardModelOf, endLine, lineText, metaOf, termsLine, WORDS, LANGS, type CardModel, type HandFacts, type Terms } from "../src/index.ts";
import { Card } from "../src/Card.tsx";

// 2026-12-20 00:00 UTC
const DEC_20 = 1_797_724_800;
const NB = " ";
const FSI = "⁨";
const PDI = "⁩";

const terms = (over: Partial<Terms> = {}): Terms => ({ state: "open", amount: "$40", date: DEC_20, ...over });
const hand = (over: Partial<Extract<HandFacts, { kind: "hand" }>> = {}): HandFacts => ({
  kind: "hand",
  title: "Help me move a sofa",
  terms: terms(),
  ...over,
});

/** Every word a person can read off a model. */
function wordsOf(model: CardModel): string {
  return [model.intro, model.heading, model.details, model.terms && lineText(model.terms), model.end].filter(Boolean).join(" ");
}

describe("the model: what the card says for each visibility", () => {
  it("unlisted: whose words they are, the title, then the reward and the date in one line", () => {
    const model = cardModelOf(hand(), "en", false);
    expect(model).toEqual({
      lang: "en",
      dark: false,
      intro: "Someone raised a hand:",
      heading: "Help me move a sofa",
      terms: { before: "Reward ", amount: "$40", after: ` · open until 20${NB}Dec` },
      invite: "Open it to help or pass it on.",
    });
  });

  it("public: the details stand under the title; without a title they are never drawn alone", () => {
    expect(cardModelOf(hand({ details: "Third floor, no lift." }), "en", false).details).toBe("Third floor, no lift.");
    expect(cardModelOf(hand({ title: undefined, details: "Third floor" }), "en", false).details).toBeUndefined();
  });

  it("hidden, or any address the service cannot match: the card names no Hand", () => {
    for (const lang of LANGS) {
      const model = cardModelOf({ kind: "generic" }, lang, true);
      expect(model).toEqual({ lang, dark: true, heading: WORDS[lang].bare, end: WORDS[lang].genericLine });
      expect(model.terms).toBeUndefined();
    }
  });

  it("a numbered address with no words: the bare line, then the terms", () => {
    const model = cardModelOf(hand({ title: undefined }), "ru", false);
    expect(model.intro).toBeUndefined();
    expect(model.heading).toBe("Кто-то поднял руку.");
    expect(lineText(model.terms!)).toBe(`Награда $40 · рука открыта до 20${NB}дек`);
  });

  it("never says which Hand or which chain: a reader in a chat learns nothing from a number, and the address names it", () => {
    for (const lang of LANGS) expect(wordsOf(cardModelOf(hand({ details: "x" }), lang, false))).not.toMatch(/HAND|CHAIN|84532|\b12\b/);
  });

  it("each fact once: a Hand that is over says its end on its own line, and its terms line drops the date", () => {
    const say = (t: Terms, lang: "en" | "ru" = "en") => [lineText(termsLine(t, lang)), endLine(t, lang)];
    expect(say(terms({ state: "expired" }))).toEqual([`Reward $40 · was open until 20${NB}Dec`, "Time's up."]);
    expect(say(terms({ state: "thanked" }))).toEqual(["Reward $40", `Thanked on 20${NB}Dec.`]);
    expect(say(terms({ state: "refunded" }))).toEqual(["Reward $40", `The reward went back on 20${NB}Dec.`]);
    expect(say(terms({ state: "refunded", amount: undefined }))).toEqual(["No reward: a thank-you only", `This hand closed on 20${NB}Dec.`]);
    expect(say(terms({ state: "refunded" }), "ru")).toEqual(["Награда $40", `Награда вернулась 20${NB}дек.`]);
    expect(say(terms({ state: "open", amount: undefined, unknownToken: true }))).toEqual([`A reward in a token aHand does not list · open until 20${NB}Dec`, undefined]);
  });

  it("only an open Hand invites: a closed or expired one says what it came to, and the generic card says open to see", () => {
    expect(cardModelOf(hand(), "ru", false).invite).toBe("Открой, чтобы помочь или передать дальше.");
    for (const state of ["expired", "thanked", "refunded"] as const) expect(cardModelOf(hand({ terms: terms({ state }) }), "en", false).invite).toBeUndefined();
    expect(cardModelOf({ kind: "generic" }, "en", false).invite).toBeUndefined();
  });

  it("no word on the card claims a place on a route: the preview never knows it", () => {
    for (const lang of LANGS) {
      const text = wordsOf(cardModelOf(hand({ details: "x" }), lang, false));
      expect(text).not.toMatch(/reached you|дошла до тебя|at least|не меньше/i);
    }
  });
});

describe("the words", () => {
  const every = (lang: "en" | "ru") => {
    const out: string[] = [];
    for (const state of ["open", "expired", "thanked", "refunded"] as const) {
      for (const over of [{}, { amount: undefined }, { amount: undefined, unknownToken: true }]) {
        const t = terms({ state, ...over });
        const facts = hand({ terms: t, details: "the details" });
        out.push(wordsOf(cardModelOf(facts, lang, false)));
        const meta = metaOf(facts, lang);
        out.push(meta.title, meta.description, meta.imageAlt);
      }
    }
    const generic = metaOf({ kind: "generic" }, lang);
    out.push(wordsOf(cardModelOf({ kind: "generic" }, lang, false)), generic.title, generic.description, generic.imageAlt);
    return out.join("\n");
  };

  it("say nothing with a semicolon, in either language", () => {
    for (const lang of LANGS) expect(every(lang)).not.toContain(";");
  });

  it("use none of the words the human layer bans", () => {
    const banned = /\b(wallet|gas|transaction|sign|escrow|custody|donation|bounty|fee|pot|pocket|hop|recipient)s?\b|кошел|газ|транзакц|подпис|эскроу|комисси|пожертвов/i;
    for (const lang of LANGS) expect(every(lang)).not.toMatch(banned);
  });

  it("are the same set in English and Russian", () => {
    expect(Object.keys(WORDS.ru).sort()).toEqual(Object.keys(WORDS.en).sort());
  });

  it("put the chain's terms before the asker's words in a messenger's description, each isolated", () => {
    const meta = metaOf(hand({ title: "Title ‮", details: "Details" }), "en");
    expect(meta.title).toBe(`${FSI}Title ‮${PDI}`);
    expect(meta.description).toBe(`Reward $40 · open until 20${NB}Dec. The asker wrote: “${FSI}Details${PDI}”`);
    expect(meta.imageAlt).toBe(`Someone raised a hand: “${FSI}Title ‮${PDI}”. Reward $40 · open until 20${NB}Dec · aHand`);
  });

  it("keep the emoji in the messenger's lines and leave them out of the picture only", () => {
    const facts = hand({ title: "Sofa 🛋️ help" });
    expect(metaOf(facts, "en").title).toBe(`${FSI}Sofa 🛋️ help${PDI}`);
    expect(cardModelOf(facts, "en", false).heading).toBe("Sofa help");
  });
});

describe("the drawing", () => {
  const props = { family: "sans-serif", marks: { light: "/l.svg", dark: "/d.svg" } };

  it("draws the same elements for both painters, differing only in how a line is clamped", () => {
    const model = cardModelOf(hand({ details: "Third floor" }), "en", false);
    const dom = renderToStaticMarkup(<Card model={model} target="dom" {...props} />);
    const png = renderToStaticMarkup(<Card model={model} target="png" {...props} />);
    for (const html of [dom, png]) {
      expect(html).toContain("Someone raised a hand:");
      expect(html).toContain("Help me move a sofa");
      expect(html).toContain("Third floor");
      expect(html).toContain("$40");
      expect(html).not.toContain("CHAIN");
      expect(html).toContain('src="/l.svg"');
    }
    expect(dom).toContain("-webkit-line-clamp:2");
    expect(png).not.toContain("-webkit-line-clamp");
    const strip = (html: string) => html.replace(/display:-webkit-box;-webkit-line-clamp:\d;-webkit-box-orient:vertical;overflow:hidden|display:block;line-clamp:\d/g, "");
    expect(strip(dom)).toBe(strip(png));
  });

  it("puts amber only under an amount, and draws no band and no button", () => {
    const amber = /#F5B841/gi;
    const funded = renderToStaticMarkup(<Card model={cardModelOf(hand(), "en", false)} target="dom" {...props} />);
    expect(funded.match(amber)).toHaveLength(1);
    for (const model of [cardModelOf(hand({ terms: terms({ amount: undefined }) }), "en", false), cardModelOf({ kind: "generic" }, "en", false)]) {
      expect(renderToStaticMarkup(<Card model={model} target="dom" {...props} />)).not.toMatch(amber);
    }
    expect(funded).not.toMatch(/<button|border:/);
  });

  it("follows the theme with the lockup made for it", () => {
    const dark = renderToStaticMarkup(<Card model={cardModelOf(hand(), "en", true)} target="dom" {...props} />);
    expect(dark).toContain('src="/d.svg"');
    expect(dark).toContain("background-color:#101014");
  });
});
