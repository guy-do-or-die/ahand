import { readFileSync } from "node:fs";

import { cardModelOf, type CardModel, type Lang } from "@ahand/card";
import { Card, CARD_HEIGHT, CARD_WIDTH } from "@ahand/card/Card";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

import { Lru } from "./lru.ts";
import { factsOf, type Preview } from "./preview.ts";

export { drawable, type CardModel } from "@ahand/card";

/**
 * The preview card as a 1200×630 PNG. What it shows and how it is laid out is the shared card's
 * (packages/card `Card`, `cardModelOf`), which the raise screen draws in the page from the draft;
 * this file adds only what a server needs to make a picture of it: the fonts and the lockup as
 * files read once, satori and resvg.
 *
 * Faces: the app's own, in its order: Schibsted Grotesk for Latin, Onest for Cyrillic, Noto Sans
 * for any other script (`FAMILY`). The receiver's screen sets the asker's words in the reader's
 * device font; a picture made on a server cannot know the reader's device, so it carries the
 * app's display faces instead. No emoji: aHand draws emoji in the reader's own set and an image
 * cannot, so they are left out of the picture (`drawable`) and kept in the title the messenger
 * shows beside it.
 *
 * Nothing here reads a clock, a random number or the network, so the same card gives the same bytes.
 */

const file = (name: string) => readFileSync(new URL(name, import.meta.url));

type Weight = 400 | 700;
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
    { name: "Onest", data: file("./fonts/onest-cyrillic-400-normal.woff"), weight: 400, style: "normal" },
    { name: "Onest", data: file("./fonts/onest-cyrillic-700-normal.woff"), weight: 700, style: "normal" },
    { name: "Noto Sans", data: file("./fonts/NotoSans-400.ttf"), weight: 400, style: "normal" },
    { name: "Noto Sans", data: file("./fonts/NotoSans-700.ttf"), weight: 700, style: "normal" },
  ];
  return fonts;
}

let marks: { light: string; dark: string } | undefined;
function marksOnce() {
  const uri = (name: string) => `data:image/svg+xml;base64,${file(name).toString("base64")}`;
  // The canonical lockup the app's header uses (apps/web/public/ahand-mark-*.svg, the same bytes).
  marks ??= { light: uri("./og/ahand-mark-light.svg"), dark: uri("./og/ahand-mark-dark.svg") };
  return marks;
}

/** The card's model for what the service read of an address. */
export function modelOf(preview: Preview, lang: Lang, dark: boolean): CardModel {
  return cardModelOf(factsOf(preview, lang), lang, dark);
}

/**
 * The human voice in the app's own fallback order (apps/web/src/design/tokens.css
 * `--font-display`): Schibsted Grotesk, then Onest for the Cyrillic Schibsted lacks, then Noto Sans
 * for every other script. satori falls from one to the next glyph by glyph, as a browser does, so
 * a Russian card reads in the faces the raise screen shows it in.
 */
const FAMILY = "Schibsted Grotesk, Onest, Noto Sans";

/** The card as SVG, then PNG at 1200×630. */
export async function renderCard(model: CardModel): Promise<Uint8Array> {
  const svg = await satori(<Card model={model} target="png" family={FAMILY} marks={marksOnce()} />, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: fontsOnce(),
  });
  // satori has already turned every glyph into a path, so resvg needs no font. Left to itself it
  // loads every font of the machine for each card: on a host with a few thousand fonts that was
  // ~130 ms of a ~140 ms render. Off, a card takes ~11 ms, with the same bytes on any host.
  const png = new Resvg(svg, { fitTo: { mode: "width", value: CARD_WIDTH }, font: { loadSystemFonts: false } }).render().asPng();
  return new Uint8Array(png);
}

/**
 * A memory of drawn cards in front of `draw` (the render pool), keyed by the card's model: the
 * model is everything the picture depends on (words, terms, theme, language) and nothing else, so
 * two addresses that draw the same card share one entry, and a card whose Hand changed on chain
 * gets a new model and so a new entry. Least recently used out first, at most `entries` cards and
 * `bytes` bytes (a card is 25 to 40 kB). A card being drawn is shared by every request that asks
 * for it meanwhile. When `draw` refuses (every renderer busy, queue full) the answer is undefined.
 */
export function cardCache(
  draw: (model: CardModel) => Promise<Uint8Array> | undefined,
  limits: { entries?: number; bytes?: number } = {},
) {
  const cache = new Lru<Promise<Uint8Array>>(limits.entries ?? 2_048, limits.bytes ?? 32 * 1024 * 1024);
  return (model: CardModel): Promise<Uint8Array> | undefined => {
    const key = JSON.stringify(model);
    const found = cache.get(key);
    if (found) return found;
    const drawn = draw(model);
    if (!drawn) return undefined;
    cache.set(key, drawn);
    drawn.then(
      (png) => cache.weigh(key, drawn, png.byteLength),
      () => cache.delete(key, drawn),
    );
    return drawn;
  };
}
