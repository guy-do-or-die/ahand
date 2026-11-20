import { readFileSync } from "node:fs";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

import { termsOf, type Preview } from "./preview.ts";
import { WORDS, type Lang } from "./words.ts";

/**
 * The preview card: 1200×630 PNG, ported from the old renderer (apps/web/app/server/og/render.ts)
 * onto this build's design language (UX-SPEC §2, §11). Ink on paper, one amber accent used only as
 * a fill with ink on it, no shadows; the human voice in Schibsted Grotesk with Noto Sans after it
 * for scripts Schibsted lacks (Cyrillic, Greek, Vietnamese…), the machine voice in IBM Plex Mono.
 *
 * Fonts and the lockup are files beside this one, read once. Nothing here reads a clock, a random
 * number or the network, so the same card gives the same bytes.
 */

// The palette of apps/hand/src/design/tokens.css (ink, paper, amber), the only raw colours here.
const INK = "#101014";
const PAPER = "#FAFAF7";
const AMBER = "#F5B841";

const WIDTH = 1200;
const HEIGHT = 630;

const file = (name: string) => readFileSync(new URL(name, import.meta.url));

type Weight = 400 | 500 | 700 | 900;
interface FontEntry {
  name: string;
  data: Buffer;
  weight: Weight;
  style: "normal";
}

let fonts: FontEntry[] | undefined;
function fontsOnce(): FontEntry[] {
  fonts ??= [
    { name: "Schibsted Grotesk", data: file("./fonts/SchibstedGrotesk-400.ttf"), weight: 400, style: "normal" },
    { name: "Schibsted Grotesk", data: file("./fonts/SchibstedGrotesk-700.ttf"), weight: 700, style: "normal" },
    { name: "Schibsted Grotesk", data: file("./fonts/SchibstedGrotesk-900.ttf"), weight: 900, style: "normal" },
    { name: "Noto Sans", data: file("./fonts/NotoSans-400.ttf"), weight: 400, style: "normal" },
    { name: "Noto Sans", data: file("./fonts/NotoSans-700.ttf"), weight: 700, style: "normal" },
    { name: "IBM Plex Mono", data: file("./fonts/ibm-plex-mono-latin-500-normal.woff"), weight: 500, style: "normal" },
  ];
  return fonts;
}

let marks: { light: string; dark: string } | undefined;
function marksOnce() {
  const uri = (name: string) => `data:image/svg+xml;base64,${file(name).toString("base64")}`;
  // The canonical lockup the app's header uses (1280×500, about 118px of padding on the left).
  marks ??= { light: uri("./og/ahand-mark-light.svg"), dark: uri("./og/ahand-mark-dark.svg") };
  return marks;
}

/** Everything a card shows, already in the reader's words. Two equal models give equal bytes. */
export interface CardModel {
  lang: Lang;
  dark: boolean;
  /** The Hand's title, only when it matched the dataHash Core keeps. */
  title?: string;
  /** The terms line in three parts; the amount, if any, sits on the amber marker. */
  terms?: { before: string; amount?: string; after: string };
  /** Machine truth for the top right: "HAND 12 · CHAIN 31337". */
  label?: string;
  closed: boolean;
}

export function modelOf(preview: Preview, lang: Lang, dark: boolean): CardModel {
  if (preview.kind === "generic") return { lang, dark, closed: false };
  const words = WORDS[lang];
  return {
    lang,
    dark,
    ...(preview.title && drawable(preview.title) ? { title: drawable(preview.title) } : {}),
    terms: words.terms(termsOf(preview, lang)),
    label: `HAND ${preview.handId} · CHAIN ${preview.chainId}`,
    closed: preview.state === "thanked" || preview.state === "refunded",
  };
}

/**
 * The title as the card can draw it. The card has no emoji font, and a missing glyph would draw
 * as an empty box, so pictographs (with their joiners, variation selectors and skin tones) are
 * left out of the picture only; og:title keeps the words exactly, and messengers draw emoji there.
 */
export function drawable(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}\u200D\uFE0E\uFE0F\u20E3]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * The family for one piece of text. Schibsted Grotesk covers Latin only; a line that mixes it
 * with Noto Sans glyph by glyph changes weight and width mid-word, so a line with any letter
 * beyond Latin is set in Noto Sans throughout.
 */
export function familyFor(text: string): string {
  return /[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F\u20A0-\u20CF\u2190-\u21FF]/u.test(text)
    ? "Noto Sans"
    : "Schibsted Grotesk, Noto Sans";
}

/** Large for a short title, smaller as it grows; three lines at most either way. */
function titleSize(title: string): number {
  const n = [...title].length;
  if (n <= 28) return 84;
  if (n <= 56) return 70;
  if (n <= 100) return 58;
  return 50;
}

function Card({ model }: { model: CardModel }) {
  const { dark, lang, title, terms, label, closed } = model;
  const words = WORDS[lang];
  const fg = dark ? PAPER : INK;
  const bg = dark ? INK : PAPER;
  const heading = title ?? words.genericTitle;
  const markWidth = 64 * 2.56;
  return (
    <div
      style={{
        width: WIDTH,
        height: HEIGHT,
        display: "flex",
        flexDirection: "column",
        backgroundColor: bg,
        color: fg,
        fontFamily: "Schibsted Grotesk, Noto Sans",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "52px 72px 0" }}>
        <img
          src={dark ? marksOnce().dark : marksOnce().light}
          width={markWidth}
          height={64}
          style={{ marginLeft: -(118 / 1280) * markWidth }}
        />
        {label ? (
          <div
            style={{
              display: "flex",
              fontFamily: "IBM Plex Mono",
              fontWeight: 500,
              fontSize: 22,
              letterSpacing: "0.08em",
              opacity: 0.6,
            }}
          >
            {label}
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          flexGrow: 1,
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 72px 28px",
        }}
      >
        <div
          style={{
            display: "block",
            fontFamily: familyFor(heading),
            fontSize: titleSize(heading),
            fontWeight: 900,
            lineHeight: 1.08,
            letterSpacing: "-0.03em",
            lineClamp: 3,
          }}
        >
          {heading}
        </div>
        {terms ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              marginTop: 30,
              fontSize: 34,
              fontWeight: 700,
              fontFamily: familyFor(`${terms.before}${terms.amount ?? ""}${terms.after}`),
            }}
          >
            {terms.before ? <span style={{ whiteSpace: "pre" }}>{terms.before}</span> : null}
            {terms.amount ? (
              <span style={{ backgroundColor: AMBER, color: INK, borderRadius: 6, padding: "0 12px", fontWeight: 900 }}>
                {terms.amount}
              </span>
            ) : null}
            {terms.after ? <span style={{ whiteSpace: "pre" }}>{terms.after}</span> : null}
          </div>
        ) : (
          <div style={{ display: "flex", marginTop: 28, fontSize: 34, fontWeight: 400, opacity: 0.6, fontFamily: familyFor(words.genericLine) }}>
            {words.genericLine}
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: AMBER,
          color: INK,
          fontFamily: familyFor(`${words.asking}${words.closed}${words.cta}`),
          padding: "22px 72px",
        }}
      >
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>{closed ? words.closed : words.asking}</div>
        {closed ? null : (
          <div
            style={{
              display: "flex",
              backgroundColor: INK,
              color: PAPER,
              fontSize: 26,
              fontWeight: 700,
              borderRadius: 9999,
              padding: "14px 32px",
            }}
          >
            {words.cta}
          </div>
        )}
      </div>
    </div>
  );
}

/** The card as SVG, then PNG at 1200×630. */
export async function renderCard(model: CardModel): Promise<Uint8Array> {
  const svg = await satori(<Card model={model} />, { width: WIDTH, height: HEIGHT, fonts: fontsOnce() });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } }).render().asPng();
  return new Uint8Array(png);
}

/**
 * A small memory of rendered cards, keyed by the model: a robot that fetches the same image twice
 * waits once. Oldest out first.
 */
export function cardCache(limit = 128) {
  const cache = new Map<string, Promise<Uint8Array>>();
  return (model: CardModel): Promise<Uint8Array> => {
    const key = JSON.stringify(model);
    let found = cache.get(key);
    if (found) return found;
    found = renderCard(model);
    found.catch(() => cache.delete(key));
    cache.set(key, found);
    if (cache.size > limit) cache.delete(cache.keys().next().value!);
    return found;
  };
}
