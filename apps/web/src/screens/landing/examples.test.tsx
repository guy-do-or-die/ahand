import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { i18n } from "@lingui/core";
import { renderToStaticMarkup } from "react-dom/server";

import { compileCatalogue } from "../../i18n/catalogue";
import commonEn from "../../i18n/common/en";
import commonRu from "../../i18n/common/ru";
import { bannedIn } from "../../../tests/guards/words.test";
import en from "./en";
import { DECIMALS, EXAMPLES, detailsKey, keptOf, reachesOf, titleKey, type Example, type Kind } from "./examples";
import ru from "./ru";

/**
 * The landing's example Hands (screens/landing/examples.ts, Sample.tsx): the set covers the range
 * it is there to show, its words keep the rules of the words a person reads, its amounts are ones
 * a real Hand could show, and each example is drawn as the receiver's real card would draw the
 * same Hand. The browser half is tests/e2e/smoke/about.spec.ts.
 */

const example = readFileSync(join(import.meta.dir, "../../config/config.example.json"), "utf8");
plugin({
  name: "ahand-config",
  setup(build) {
    build.module("virtual:ahand-config", () => ({ contents: `export default ${example};`, loader: "js" }));
  },
});

type Lang = "en" | "ru";
const WORDS: Record<Lang, Record<string, string>> = { en, ru };
const LANGS: readonly Lang[] = ["en", "ru"];
const dollar = 10n ** BigInt(DECIMALS);

const titleOf = (one: Example, lang: Lang) => WORDS[lang][titleKey(one)]!;
const detailsOf = (one: Example, lang: Lang) => WORDS[lang][detailsKey(one)];

describe("the set: many examples that differ in kind, in reward and in the route's shape", () => {
  test("twelve to twenty of them, each with its own id", () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(12);
    expect(EXAMPLES.length).toBeLessThanOrEqual(20);
    expect(new Set(EXAMPLES.map((one) => one.id)).size).toBe(EXAMPLES.length);
    for (const one of EXAMPLES) expect(one.id).toMatch(/^[a-z]+$/);
  });

  test("every kind of need stands at least once, and none takes more than a quarter of the set", () => {
    const kinds: Kind[] = ["person", "home", "thing", "expert", "lost", "work", "local", "favour", "memory"];
    for (const kind of kinds) expect(EXAMPLES.filter((one) => one.kind === kind).length, kind).toBeGreaterThanOrEqual(1);
    for (const kind of kinds) expect(EXAMPLES.filter((one) => one.kind === kind).length, kind).toBeLessThanOrEqual(Math.ceil(EXAMPLES.length / 4));
  });

  test("the reward runs from none through a few dollars, tens and hundreds to thousands", () => {
    const sizes = (from: bigint, below: bigint) => EXAMPLES.filter((one) => one.reward >= from * dollar && one.reward < below * dollar).length;
    expect(EXAMPLES.filter((one) => one.reward === 0n).length).toBeGreaterThanOrEqual(2);
    expect(sizes(1n, 20n)).toBeGreaterThanOrEqual(2);
    expect(sizes(20n, 100n)).toBeGreaterThanOrEqual(3);
    expect(sizes(100n, 1000n)).toBeGreaterThanOrEqual(3);
    expect(sizes(1000n, 1_000_000n)).toBeGreaterThanOrEqual(2);
  });

  test("the route runs from no pass through one that kept nothing and a few with different shares to a dozen and more", () => {
    const shares = (one: Example) => one.route.filter((share) => share > 0n);
    expect(EXAMPLES.filter((one) => one.route.length === 0).length).toBeGreaterThanOrEqual(2);
    expect(EXAMPLES.filter((one) => one.reward > 0n && one.route.length === 1 && keptOf(one) === 0n).length).toBeGreaterThanOrEqual(1);
    expect(EXAMPLES.filter((one) => one.route.length === 1 && keptOf(one) > 0n).length).toBeGreaterThanOrEqual(1);
    expect(EXAMPLES.filter((one) => [2, 3].includes(one.route.length) && shares(one).length >= 2 && new Set(shares(one)).size === shares(one).length).length).toBeGreaterThanOrEqual(2);
    const long = EXAMPLES.filter((one) => one.route.length >= 12);
    expect(long.length).toBeGreaterThanOrEqual(2);
    // A long route where nobody kept anything, and one where some did.
    expect(long.some((one) => keptOf(one) === 0n)).toBe(true);
    expect(long.some((one) => keptOf(one) > 0n)).toBe(true);
    expect(EXAMPLES.some((one) => one.reward === 0n && one.route.length >= 12)).toBe(true);
  });

  test("the first is the plain case, and no two neighbours share a kind or a route's length", () => {
    const first = EXAMPLES[0]!;
    expect(first.route.length).toBe(2);
    expect(first.route.every((share) => share > 0n)).toBe(true);
    for (let at = 0; at < EXAMPLES.length; at++) {
      const one = EXAMPLES[at]!;
      const next = EXAMPLES[(at + 1) % EXAMPLES.length]!;
      expect(one.kind, `${one.id} then ${next.id}`).not.toBe(next.kind);
      expect(one.route.length, `${one.id} then ${next.id}`).not.toBe(next.route.length);
    }
  });
});

describe("the amounts: ones a real Hand could show", () => {
  test("whole dollars, the shares add up to less than half the reward, and a Hand with no reward has no share", () => {
    for (const one of EXAMPLES) {
      expect(one.reward % dollar, one.id).toBe(0n);
      for (const share of one.route) expect(share % dollar, one.id).toBe(0n);
      expect(keptOf(one) + reachesOf(one), one.id).toBe(one.reward);
      if (one.reward === 0n) expect(keptOf(one), one.id).toBe(0n);
      else expect(reachesOf(one) * 2n, one.id).toBeGreaterThan(one.reward);
    }
  });

  test("each share is a whole number of Core's basis points of the reward", () => {
    for (const one of EXAMPLES) for (const share of one.route) if (share > 0n) expect((share * 10_000n) % one.reward, one.id).toBe(0n);
  });
});

describe("the words: a person's message in both languages, by the rules of the words a person reads", () => {
  test("each example has a title in both languages, details where it says so, and no key is left without an example", () => {
    for (const lang of LANGS) {
      for (const one of EXAMPLES) {
        expect(titleOf(one, lang), `${lang} ${one.id}`).toBeTruthy();
        expect(detailsOf(one, lang) !== undefined, `${lang} ${one.id}`).toBe(one.details);
      }
      const keys = Object.keys(WORDS[lang]).filter((key) => key.startsWith("landing.example."));
      expect(keys.sort()).toEqual(EXAMPLES.flatMap((one) => (one.details ? [titleKey(one), detailsKey(one)] : [titleKey(one)])).sort());
    }
    expect(EXAMPLES.some((one) => !one.details)).toBe(true);
  });

  test("short and of a like length: a title of at most 70 characters, details of at most 80", () => {
    for (const lang of LANGS) {
      for (const one of EXAMPLES) {
        expect(titleOf(one, lang).length, `${lang} ${one.id}`).toBeGreaterThanOrEqual(30);
        expect(titleOf(one, lang).length, `${lang} ${one.id}`).toBeLessThanOrEqual(70);
        const details = detailsOf(one, lang);
        if (details !== undefined) {
          expect(details.length, `${lang} ${one.id}`).toBeLessThanOrEqual(80);
          expect(details, `${lang} ${one.id}`).toMatch(/[.?]$/);
        }
      }
    }
  });

  test("no semicolon, no dash, no banned word, no amount of money, no link and nothing shouted", () => {
    for (const lang of LANGS) {
      for (const one of EXAMPLES) {
        for (const [key, said] of [[titleKey(one), titleOf(one, lang)] as const, [detailsKey(one), detailsOf(one, lang) ?? ""] as const]) {
          const where = `${lang} ${key}`;
          expect(said, where).not.toMatch(/[;—–!]/);
          expect(bannedIn(key, said, lang), where).toEqual([]);
          expect(said, where).not.toMatch(/[$€₽£]|\b(usd|eur|dollars?|euros?)\b|доллар|рубл|евро/i);
          expect(said, where).not.toMatch(/https?:|www\.|@|\.(com|ru|org|io)\b/i);
          // Nothing in capitals but a short abbreviation a native writes so (ВНЖ).
          expect(said.match(/\p{Lu}{4,}/gu) ?? [], where).toEqual([]);
          expect(said, where).toBe(said.trim());
        }
      }
    }
  });

  test("Russian speaks to one person, as the rest of the app does", () => {
    for (const one of EXAMPLES) {
      const said = `${titleOf(one, "ru")} ${detailsOf(one, "ru") ?? ""}`;
      expect(said, one.id).not.toMatch(/(?<!\p{L})(вы|вас|вам|вами|ваш\p{L}*)(?!\p{L})/iu);
      expect(said, one.id).not.toMatch(/\p{L}+(йте|ите)(?!\p{L})/u);
    }
  });

  test("the caption, the control and the pause's two names are the only words of the landing's own about the examples", () => {
    expect(en["landing.sample.label"]).toBe("What your people see");
    expect(ru["landing.sample.label"]).toBe("Что увидят твои люди");
    expect(en["landing.sample.next"]).toBe("Another example");
    expect(ru["landing.sample.next"]).toBe("Другой пример");
    expect(Object.keys(en).filter((key) => key.startsWith("landing.sample.")).sort()).toEqual(["landing.sample.label", "landing.sample.next", "landing.sample.pause", "landing.sample.play"]);
  });
});

describe("the picture: each example is the receiver's real card, drawn by the card itself", () => {
  let Sample: typeof import("./Sample").Sample;
  let DealCard: typeof import("../../ui").DealCard;
  let DealPicture: typeof import("../../ui").DealPicture;
  let Ambient: typeof import("../../ui").Ambient;
  let judge: typeof import("../../ui/judge");
  let fx: typeof import("../../gallery/fixtures");

  beforeAll(async () => {
    GlobalRegistrator.register({ url: "http://127.0.0.1:18301/" });
    i18n.load("en", compileCatalogue({ ...commonEn, ...en }));
    i18n.load("ru", compileCatalogue({ ...commonRu, ...ru }));
    ({ Sample } = await import("./Sample"));
    ({ DealCard, DealPicture, Ambient } = await import("../../ui"));
    judge = await import("../../ui/judge");
    fx = await import("../../gallery/fixtures");
  });
  afterAll(async () => {
    await GlobalRegistrator.unregister();
  });

  const parse = (markup: string): Document => new DOMParser().parseFromString(markup, "text/html");
  const squeezed = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();
  const said = (doc: Document, selector: string): string[] => [...doc.querySelectorAll(selector)].map((node) => squeezed(node.textContent));

  /** The example as the landing draws it. */
  function picture(one: Example, lang: Lang, lens = false): Document {
    return parse(
      renderToStaticMarkup(
        <Ambient lang={lang} lens={lens}>
          <DealPicture title={titleOf(one, lang)} content={detailsOf(one, lang)} reward={one.reward} decimals={DECIMALS} shares={one.route} />
        </Ambient>,
      ),
    );
  }

  /** The same Hand on the Hand view: open, the reader at the end of the route, every pass with its share. */
  function real(one: Example, lang: Lang): Document {
    const details = detailsOf(one, lang);
    return parse(
      renderToStaticMarkup(
        <Ambient lang={lang} lens={false}>
          <DealCard
            state="open"
            description={{ status: "attached", title: titleOf(one, lang), ...(details ? { content: details } : {}) }}
            reward={one.reward}
            decimals={DECIMALS}
            expiry={fx.EXPIRY}
            claimBps={one.reward > 0n ? Number((reachesOf(one) * 10_000n) / one.reward) : 10_000}
            raiser={fx.ASKER}
            handId={12n}
            block={fx.BLOCK}
            timeZone="UTC"
            spine={{ hands: [{ role: "asker", address: fx.ASKER }, ...one.route.map(() => ({ role: "passer" as const }))], shares: one.route }}
          />
        </Ambient>,
      ),
    );
  }

  test("the fixtures' dollar is the examples' dollar", () => {
    expect(fx.DECIMALS).toBe(DECIMALS);
  });

  test("a picture is the real card of the same open Hand less its date: the same beats, sentences, amounts and marks, in both languages", () => {
    for (const lang of LANGS) {
      for (const one of EXAMPLES) {
        const where = `${lang} ${one.id}`;
        const drawn = picture(one, lang);
        const card = real(one, lang);
        // Take the date out of the real card, and the dot that parts it from the reward.
        for (const node of card.querySelectorAll('.ah-spine__when, .ah-spine__terms > [aria-hidden="true"]')) node.remove();
        const rows = (doc: Document) => [...doc.querySelectorAll(".ah-spine__row")].map((row) => `${row.getAttribute("data-role")}: ${squeezed(row.textContent)}`);
        expect(rows(drawn), where).toEqual(rows(card));
        expect(said(drawn, ".ah-marker"), where).toEqual(one.reward > 0n ? [said(card, ".ah-marker")[0]!] : []);
        const marks = (doc: Document) => [...doc.querySelectorAll("[data-gesture]")].map((mark) => mark.className);
        expect(marks(drawn), where).toEqual(marks(card));
        // The same root, so the same styles reach it.
        expect(drawn.querySelector("article")!.className, where).toBe(card.querySelector("article")!.className);
      }
    }
  });

  test("the real card finds nothing in the words to warn about", () => {
    for (const lang of LANGS) {
      for (const one of EXAMPLES) {
        const where = `${lang} ${one.id}`;
        const words = `${titleOf(one, lang)} ${detailsOf(one, lang) ?? ""}`;
        expect(judge.readAskerWords(words).found, where).toEqual([]);
        expect(judge.amountsIn(words, DECIMALS), where).toEqual([]);
        expect(real(one, lang).querySelectorAll(".ah-asker__flag, .ah-note").length, where).toBe(0);
        expect(picture(one, lang).querySelectorAll(".ah-asker__flag, .ah-note").length, where).toBe(0);
      }
    }
  });

  test("a picture has nothing to press and no clock: no date, no row that points at one, a line of passes that does not open, words that stand whole, and no heading", () => {
    for (const one of EXAMPLES) {
      const drawn = picture(one, "en");
      expect(drawn.querySelectorAll("button, a, input, [tabindex]").length, one.id).toBe(0);
      expect(drawn.querySelectorAll(".ah-deal__rows, .ah-deal__foot, .ah-spine__when, .ah-clamp, h1, h2").length, one.id).toBe(0);
      expect(drawn.body.textContent, one.id).not.toMatch(/until|\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
      const fold = drawn.querySelector('[data-testid="kit-spine-fold"]');
      if (one.route.length > 0) expect(fold?.tagName, one.id).toBe("P");
      else expect(fold, one.id).toBeNull();
    }
  });

  test("the lens does not turn a picture: there is no chain behind it to show", () => {
    for (const one of [EXAMPLES[0]!, EXAMPLES.find((other) => other.reward === 0n)!]) {
      expect(picture(one, "en", true).body.innerHTML).toBe(picture(one, "en", false).body.innerHTML);
    }
  });

  test("the landing draws no beat of its own: every beat comes from the card, and the landing's styles only time its arrival", () => {
    const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
    // The example's component draws the card's picture and names no class or sentence of the card.
    for (const file of ["./Sample.tsx", "./index.tsx"]) {
      const code = source(file).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
      expect(code, file).not.toMatch(/ah-spine|ah-deal|ah-marker|ah-asker|kit\.spine|kit\.deal|useWords|wordsOf/);
    }
    const drawn = source("./Sample.tsx");
    expect(drawn.match(/<DealPicture /g)).toHaveLength(1);
    expect(drawn).not.toMatch(/GestureEmoji|<ol|<li/);
    // Drawn: each beat stands inside the card's own root, one card for each example.
    i18n.activate("en");
    const page = parse(renderToStaticMarkup(<Sample />));
    expect(page.querySelectorAll("article.ah-deal.ah-deal--spine").length).toBe(EXAMPLES.length);
    const beats = [...page.querySelectorAll(".ah-spine__row, .ah-marker, .ah-deal__title, .ah-deal__content, [data-gesture]")];
    expect(beats.length).toBeGreaterThan(EXAMPLES.length * 4);
    for (const beat of beats) expect(beat.closest("article.ah-deal")).not.toBeNull();
    // The landing's stylesheet may time a beat's arrival (by a move, or by tone alone) and nothing else about the card.
    const css = source("./landing.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const touching = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].filter(([, selector]) => /\.ah-(spine|deal|marker|asker)|\[data-gesture/.test(selector!));
    expect(touching.length).toBeGreaterThan(0);
    for (const [, selector, body] of touching) {
      const properties = body!.split(";").map((line) => line.split(":")[0]!.trim()).filter(Boolean);
      expect(properties.filter((property) => !/^(animation(-delay)?|opacity|transition(-delay)?)$/.test(property)), selector!.trim()).toEqual([]);
    }
  });

  test("one example is in turn and the rest are out of a reader's way. Two quiet controls stand beside the caption, and no action of a real Hand is drawn", () => {
    i18n.activate("en");
    const plain = parse(renderToStaticMarkup(<Sample />));
    const all = [...plain.querySelectorAll('[data-testid="landing-example"]')];
    expect(all.map((one) => one.getAttribute("data-value"))).toEqual(EXAMPLES.map((one) => one.id));
    expect(all.filter((one) => one.getAttribute("data-current") === "true").map((one) => one.getAttribute("data-value"))).toEqual([EXAMPLES[0]!.id]);
    for (const one of all.slice(1)) expect(one.getAttribute("aria-hidden")).toBe("true");
    expect(all[0]!.getAttribute("aria-hidden")).toBeNull();
    const buttons = [...plain.querySelectorAll("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label") ?? squeezed(button.textContent))).toEqual(["Pause the examples", "Another example"]);
    // Nothing has arrived yet: the example the page opens with stands still.
    expect(plain.querySelector('[data-testid="landing-sample"]')!.hasAttribute("data-moved")).toBe(false);
    // Said to a screen reader only once the reader has asked for another.
    expect(said(plain, '[role="status"]')).toEqual([""]);
    expect(plain.querySelectorAll(".ah-swipe").length).toBe(0);
  });
});
