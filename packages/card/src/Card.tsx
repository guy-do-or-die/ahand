import type { CSSProperties } from "react";

import type { CardModel } from "./model.ts";

/**
 * The link's preview card, 1200×630: one drawing for two painters. The view server hands it to
 * satori and resvg and sends the PNG to a messenger; the raise screen draws the very same elements
 * in the page, scaled down, from the draft as it is typed. Both read one `CardModel`, so what the
 * asker sees before raising is what a chat will show.
 *
 * It reads as the receiver's card does (docs/app.md, "A Hand's card is the route's spine"): who
 * asked and their words first ("Someone raised a hand:", then the title in the asker's words),
 * then the money and the date in one quiet line, amber only under the amount, each fact once, and
 * last what a Hand that is over came to. At the foot of an open Hand, one quiet line says what
 * opening the link is for. No frame, no band, no button: a picture in a chat cannot be pressed, and
 * the whole preview already opens the link.
 *
 * Only what satori lays out is used: flex boxes, inline styles, one image. The style that differs
 * between the two painters is the line clamp, which satori spells `lineClamp` and a browser
 * `-webkit-line-clamp` (`clampStyle`). Colours are the app's raw palette (apps/web/src/design/
 * tokens.css), fixed by the model's theme, so a card looks the same in both places.
 */

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const INK = "#101014";
const PAPER = "#FAFAF7";
const AMBER = "#F5B841";

/** The quiet voice: the foreground at 62%, as a colour, since satori draws a span's opacity unevenly. */
function quiet(dark: boolean): string {
  return dark ? "rgba(250, 250, 247, 0.62)" : "rgba(16, 16, 20, 0.62)";
}

export interface CardProps {
  model: CardModel;
  /** Who paints it: "png" for satori, "dom" for a browser. Only the line clamp is spelled differently. */
  target: "png" | "dom";
  /**
   * The human voice's families, in fallback order: the app's own display face for Latin and Onest
   * for Cyrillic, as the page sets them (`--font-display`), so a glyph falls to the same face in
   * both painters.
   */
  family: string;
  /** The lockup the app's header uses, light and dark: a data: URI for satori, a URL for a page. */
  marks: { light: string; dark: string };
}

/** A block of at most `lines` lines, cut with an ellipsis. */
function clampStyle(target: CardProps["target"], lines: number): CSSProperties {
  if (target === "png") return { display: "block", lineClamp: lines } as CSSProperties;
  return { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" };
}

/** Large for a short title, smaller as it grows; three lines at most either way. */
export function headingSize(heading: string, generic: boolean): number {
  if (generic) return 84;
  const n = [...heading].length;
  if (n <= 28) return 80;
  if (n <= 56) return 66;
  if (n <= 90) return 56;
  return 48;
}

export function Card({ model, target, family, marks }: CardProps) {
  const { dark, intro, heading, details, terms, end, invite } = model;
  const fg = dark ? PAPER : INK;
  const bg = dark ? INK : PAPER;
  const soft = quiet(dark);
  const generic = terms === undefined;
  const markHeight = 56;
  const markWidth = markHeight * 2.56;
  return (
    <div
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        display: "flex",
        flexDirection: "column",
        backgroundColor: bg,
        color: fg,
        fontFamily: family,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", padding: "52px 72px 0" }}>
        {/* The lockup's file has about 118 of its 1280 units of space on the left. */}
        <img src={dark ? marks.dark : marks.light} width={markWidth} height={markHeight} alt="" style={{ marginLeft: -(118 / 1280) * markWidth }} />
      </div>
      <div style={{ display: "flex", flexGrow: 1, flexDirection: "column", justifyContent: "center", padding: invite ? "0 72px" : "0 72px 56px" }}>
        {intro ? (
          <div style={{ display: "flex", marginBottom: 14, fontFamily: family, fontSize: 32, fontWeight: 400, color: soft }}>{intro}</div>
        ) : null}
        <div
          style={{
            ...clampStyle(target, details ? 2 : 3),
            fontFamily: family,
            fontSize: headingSize(heading, generic),
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
          }}
        >
          {heading}
        </div>
        {details ? (
          <div style={{ ...clampStyle(target, 2), marginTop: 16, fontFamily: family, fontSize: 30, fontWeight: 400, lineHeight: 1.3 }}>{details}</div>
        ) : null}
        {terms ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              marginTop: 32,
              fontSize: 30,
              fontWeight: 400,
              color: soft,
              fontFamily: family,
            }}
          >
            {terms.before ? <span style={{ whiteSpace: "pre" }}>{terms.before}</span> : null}
            {terms.amount ? (
              <span style={{ backgroundColor: AMBER, color: INK, borderRadius: 6, padding: "0 10px", fontWeight: 700 }}>{terms.amount}</span>
            ) : null}
            {terms.after ? <span style={{ whiteSpace: "pre" }}>{terms.after}</span> : null}
          </div>
        ) : null}
        {end ? (
          <div
            style={{
              display: "flex",
              marginTop: generic ? 24 : 10,
              fontFamily: family,
              fontSize: generic ? 34 : 30,
              fontWeight: generic ? 400 : 700,
              color: generic ? soft : fg,
            }}
          >
            {end}
          </div>
        ) : null}
      </div>
      {invite ? (
        <div style={{ display: "flex", padding: "0 72px 52px", fontFamily: family, fontSize: 28, fontWeight: 400, color: soft }}>{invite}</div>
      ) : null}
    </div>
  );
}
