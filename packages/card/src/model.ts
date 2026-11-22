import { isolate, visible } from "./bidi.ts";
import { WORDS, endLine, lineText, termsLine, type Lang, type Line, type Terms } from "./words.ts";

/**
 * What the card says of a Hand, all of it known from the part of its address before `#` and from
 * the chain: the words `d` carried (only once they matched the dataHash Core keeps) and the terms.
 * Which Hand it is (its chain and number) is not drawn: a reader in a chat learns nothing from it,
 * and the address beside the picture names it. Never the viewer's place on a route: that rides
 * after `#`, so the preview has no "It reached you" amount. The view server builds it from a
 * read Hand, the raise screen from the draft, and both hand it to the same `cardModelOf` and `metaOf`.
 */
export type HandFacts =
  /** A bare address, a mismatched `d`, an unknown Core or Hand: nothing is said about any Hand. */
  | { kind: "generic" }
  | {
      kind: "hand";
      /** The asker's title, as it matched. Absent when the address carries no words (no `d`). */
      title?: string;
      /** The asker's details, only when the raiser made them public too. */
      details?: string;
      terms: Terms;
    };

/** Everything the card draws, already in the reader's words. Two equal models draw equal cards. */
export interface CardModel {
  lang: Lang;
  dark: boolean;
  /** "Someone raised a hand:" over the asker's words; absent when there are none. */
  intro?: string;
  /** The largest line: the asker's title, or "Someone raised a hand." when there is none. */
  heading: string;
  /** The asker's details, public Hands only. */
  details?: string;
  /** The terms in one quiet line, the amount on amber; absent on the generic card. */
  terms?: Line;
  /** What a Hand that is over came to, or the generic card's "Open to see." */
  end?: string;
  /** At the foot of an open Hand's card, quiet: what opening the link is for. */
  invite?: string;
}

/** What a messenger sets beside the image: its title line, its description and the image's alt. */
export interface MetaText {
  title: string;
  description: string;
  imageAlt: string;
}

/** The most characters of a title the card draws: three lines at the smallest size. */
export const TITLE_MAX = 110;
/** The most characters of details the card draws: two lines. */
export const DETAILS_MAX = 140;

export function cardModelOf(facts: HandFacts, lang: Lang, dark: boolean): CardModel {
  const w = WORDS[lang];
  if (facts.kind === "generic") return { lang, dark, heading: w.bare, end: w.genericLine };
  const title = facts.title === undefined ? "" : oneLine(drawable(facts.title), TITLE_MAX);
  const details = facts.details === undefined ? "" : oneLine(drawable(facts.details), DETAILS_MAX);
  const end = endLine(facts.terms, lang);
  return {
    lang,
    dark,
    ...(title ? { intro: w.intro, heading: title } : { heading: w.bare }),
    ...(title && details ? { details } : {}),
    terms: termsLine(facts.terms, lang),
    ...(end ? { end } : {}),
    ...(facts.terms.state === "open" ? { invite: w.invite } : {}),
  };
}

/**
 * The title and description a messenger shows. The chain's terms come first and stand alone; the
 * asker's words follow, quoted, labelled and isolated, so nothing they say runs into the terms or
 * turns them around. Emoji stay: a messenger draws them in its own set.
 */
export function metaOf(facts: HandFacts, lang: Lang): MetaText {
  const w = WORDS[lang];
  if (facts.kind === "generic") return { title: w.bare, description: w.genericLine, imageAlt: `${w.bare} ${w.genericLine.replace(/\.$/, "")} · ${w.siteName}` };
  const title = facts.title === undefined ? undefined : isolate(oneLine(facts.title, 160));
  const terms = lineText(termsLine(facts.terms, lang));
  const end = endLine(facts.terms, lang);
  const said = `${terms}.${end ? ` ${end}` : ""}`;
  const details = title && facts.details ? ` ${w.quoted(isolate(oneLine(facts.details, 200)))}` : "";
  return {
    title: title ?? w.bare,
    description: `${said}${details}`,
    imageAlt: `${title ? `${w.intro} ${w.quote(title)}.` : w.bare} ${terms}${end ? `. ${end.replace(/\.$/, "")}` : ""} · ${w.siteName}`,
  };
}

/** A description fit for a preview: one line, at most `max` characters, cut at a word. */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** One pictograph with its modifiers and tags, and the pictographs a joiner ties to it. */
const PICTOGRAPH =
  /\p{Extended_Pictographic}[︎️\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]*(?:‍\p{Extended_Pictographic}[︎️\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]*)*/gu;

/**
 * The words as the card can draw them. The image has no emoji font of its own (aHand draws emoji
 * in the reader's own set, and an image cannot), and a missing glyph would draw as an empty box,
 * so pictographs (with their joiners, variation selectors and skin tones) are left out of the
 * card only; the title a messenger shows keeps the words exactly, and the messenger draws its
 * emoji there. The card has no bidi either, so every direction control and invisible character
 * left is drawn as a token (`visible`): the card reads the bytes in their order and cannot read
 * differently from the app.
 */
export function drawable(text: string): string {
  const pictureless = text
    .replace(PICTOGRAPH, "")
    .replace(/[\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}︎️⃣]/gu, "");
  return visible(pictureless).replace(/[ \t]{2,}/g, " ").trim();
}
