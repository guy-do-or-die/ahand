/**
 * Generates the canonical aHand mark as SELF-CONTAINED SVGs (text outlined
 * to paths, 🙌 embedded) — the single point of truth used by both the app
 * header (public/ahand-mark-*.svg) and the OG card renderer.
 *
 * Why: the legacy logo SVGs used <text font-family="Arial"> — every OS
 * substituted its own font, so the "logo" rendered differently everywhere
 * and not at all in server-side rasterizers.
 *
 * Geometry mirrors the legacy files (viewBox 0 0 1280 500, text at
 * baseline ~368, 🙌 centered at 432,230). Face: Schibsted Grotesk 900 —
 * the app's own display family.
 *
 * Run after changing anything here:  bun run scripts/generate-mark.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { MARK } from "../app/lib/markSpec";

// Legacy-file canvas: 1280×500, wordmark 330px on baseline 368.
const FONT_SIZE = 330;
const BASELINE = 368;
const TEXT_TOP = BASELINE - MARK.ascent * FONT_SIZE;
const EMOJI = FONT_SIZE * MARK.emojiScale;

const OG_DIR = new URL("../app/server/og/", import.meta.url);
const PUB_DIR = new URL("../public/", import.meta.url);

const font900 = readFileSync(new URL("fonts/SchibstedGrotesk-900.ttf", OG_DIR));
const raisedHandsSvg = readFileSync(new URL("raised-hands.svg", OG_DIR), "utf8");
const raisedHands = `data:image/svg+xml;base64,${Buffer.from(raisedHandsSvg).toString("base64")}`;

/**
 * Replace satori's <image> reference to the emoji with the emoji's actual
 * vector content. Rasterizers only resolve one level of nested SVG images —
 * a flat, paths-only file renders everywhere (resvg, browsers, print).
 */
function flattenEmoji(svg: string): string {
  const imgTag = svg.match(/<image[^>]*\/>/)?.[0];
  if (!imgTag) throw new Error("no <image> element found in satori output");
  const attr = (name: string) => Number(imgTag.match(new RegExp(`${name}="([\\d.]+)"`))?.[1]);
  const [x, y, w] = [attr("x"), attr("y"), attr("width")];
  const vb = raisedHandsSvg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!vb || [x, y, w].some(Number.isNaN)) throw new Error("could not parse geometry");
  const inner = raisedHandsSvg
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    // Illustrator exports use the xlink namespace, which the satori-generated
    // root doesn't declare — strict parsers (resvg) reject the whole file.
    .replaceAll("xlink:href", "href");
  return svg.replace(
    imgTag,
    `<g transform="translate(${x},${y}) scale(${w / Number(vb[1])})">${inner}</g>`,
  );
}

/** Ink bbox of a text probe rendered exactly like the wordmark. */
async function inkBox(text: string) {
  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          position: "absolute",
          left: 118,
          top: TEXT_TOP,
          fontSize: FONT_SIZE,
          lineHeight: 1,
          fontWeight: MARK.fontWeight,
          letterSpacing: MARK.letterSpacing,
          color: "#000",
        },
        children: text,
      },
    } as never,
    { width: 1280, height: 500, fonts: [{ name: "Schibsted Grotesk", data: font900, weight: 900, style: "normal" }] },
  );
  const box = new Resvg(svg).innerBBox();
  if (!box) throw new Error(`no ink for probe "${text}"`);
  return { left: box.x, right: box.x + box.width };
}

// Center the hands on the H by MEASUREMENT, not by hardcoded x: the legacy
// file's 432 was Arial's H position — every font puts the H elsewhere.
const H_WIDTH = await (async () => (await inkBox("H")).right - (await inkBox("H")).left)();
const H_RIGHT = (await inkBox("aH")).right;
const H_CENTER = H_RIGHT - H_WIDTH / 2;
console.log(`measured H: width ${H_WIDTH.toFixed(1)}, center x ${H_CENTER.toFixed(1)}`);

async function mark(color: string): Promise<string> {
  return satori(
    {
      type: "div",
      props: {
        style: { display: "flex", width: "100%", height: "100%", position: "relative" },
        children: [
          // Legacy-file geometry: text baseline ~y=368 at 330px, emoji em-box
          // 250 centered on (432,230) — the hands span nearly the full H
          // (y≈105–355), not a hat on top of it.
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                left: 118,
                top: TEXT_TOP,
                fontSize: FONT_SIZE,
                lineHeight: 1,
                fontWeight: MARK.fontWeight,
                letterSpacing: MARK.letterSpacing,
                color,
              },
              children: "aHand",
            },
          },
          {
            type: "img",
            props: {
              src: raisedHands,
              width: EMOJI,
              height: EMOJI,
              // horizontally: measured H center; vertically: wrists on the baseline (368)
              style: { position: "absolute", left: H_CENTER - EMOJI / 2, top: BASELINE - EMOJI },
            },
          },
        ],
      },
    } as never,
    {
      width: 1280,
      height: 500,
      fonts: [{ name: "Schibsted Grotesk", data: font900, weight: 900, style: "normal" }],
    },
  );
}

// Colors = the app's raw palette (styles/tokens.css): ink & paper.
writeFileSync(new URL("ahand-mark-light.svg", PUB_DIR), flattenEmoji(await mark("#101014")));
writeFileSync(new URL("ahand-mark-dark.svg", PUB_DIR), flattenEmoji(await mark("#fafaf7")));
console.log("wrote public/ahand-mark-light.svg + ahand-mark-dark.svg (flattened)");
