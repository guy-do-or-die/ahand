/// <reference types="vite/client" />
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { b64urlDecode, Envelope } from "../../lib/metadata";

// All render assets are baked into the chunk: the SVG marks as ?raw imports,
// the fonts as generated base64 (fonts.b64.ts) — runtime fs reads don't
// survive serverless bundling, and the vinxi server build ignores both
// ?inline and static new URL(..., import.meta.url) asset emission.
import markLightSvg from "../../../public/ahand-mark-light.svg?raw";
import markDarkSvg from "../../../public/ahand-mark-dark.svg?raw";
import { SG400, SG700, NS400, NS700 } from "./fonts.b64";

/**
 * OG card renderer — 1200×630 PNG for /api/og/$id.png. Everything comes
 * from the `e` envelope in the URL (same source as the og:* meta tags):
 * chain-free, deterministic per URL, so responses cache forever.
 * Fonts are vendored TTFs (OFL): Schibsted Grotesk + Noto Sans fallback
 * (broad script coverage — titles arrive in any language).
 */

// The app's raw palette (styles/tokens.css) — keep in sync.
const INK = "#101014";
const PAPER = "#fafaf7";
const AMBER = "#f5b841";

const font = (b64: string) => Buffer.from(b64, "base64");

// THE canonical marks — same files the app header uses (single point of
// truth, regenerate via scripts/generate-mark.ts). Fully outlined, so they
// render identically here and in every browser.
const markUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const MARK_LIGHT = markUri(markLightSvg); // ink text, for paper bg
const MARK_DARK = markUri(markDarkSvg); // paper text, for ink bg

let fonts: { name: string; data: Buffer; weight: 400 | 700; style: "normal" }[] | null = null;
function getFonts() {
  fonts ??= [
    { name: "Schibsted Grotesk", data: font(SG400), weight: 400, style: "normal" },
    { name: "Schibsted Grotesk", data: font(SG700), weight: 700, style: "normal" },
    { name: "Noto Sans", data: font(NS400), weight: 400, style: "normal" },
    { name: "Noto Sans", data: font(NS700), weight: 700, style: "normal" },
  ];
  return fonts;
}

/** Tiny hyperscript for satori's object tree — keeps this file JSX-free. */
const el = (type: string, style: Record<string, unknown>, children?: unknown) => ({
  type,
  props: { style, children },
});

/** The canonical lockup, straight from the shared SVG (1280×500 viewBox).
 *  The file carries ~118px of internal left padding — pull it back so the
 *  mark aligns with the title column. */
function wordmark(dark: boolean, height = 72) {
  const width = height * 2.56;
  return {
    type: "img",
    props: {
      src: dark ? MARK_DARK : MARK_LIGHT,
      width,
      height,
      style: { marginLeft: -(118 / 1280) * width },
    },
  };
}

function card(title: string, teaser: string | undefined, dark: boolean) {
  const family = "Schibsted Grotesk, Noto Sans";
  return el(
    "div",
    {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      backgroundColor: dark ? INK : PAPER,
      color: dark ? PAPER : INK,
      fontFamily: family,
      padding: "56px 72px 0",
    },
    [
      // header: the canonical mark + tagline
      el("div", { display: "flex", justifyContent: "space-between", alignItems: "center" }, [
        wordmark(dark, 72),
        el("div", { fontSize: 24, opacity: 0.45, fontWeight: 400 }, "ask your people"),
      ]),
      // title
      el(
        "div",
        {
          display: "flex",
          flexGrow: 1,
          flexDirection: "column",
          justifyContent: "center",
          paddingBottom: 24,
        },
        [
          el(
            "div",
            {
              fontSize: title.length > 60 ? 56 : 72,
              fontWeight: 700,
              lineHeight: 1.12,
              letterSpacing: "-0.025em",
              lineClamp: 3,
            },
            title,
          ),
          ...(teaser
            ? [el("div", { fontSize: 30, lineHeight: 1.4, opacity: 0.6, marginTop: 24, lineClamp: 2 }, teaser)]
            : []),
        ],
      ),
      // footer: amber band — minimal words + an unmistakable button. The
      // mechanic is explained on the page; the card's only job is the click.
      el(
        "div",
        {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: AMBER,
          color: INK, // band is amber in both themes — text must not inherit paper
          margin: "0 -72px",
          padding: "20px 72px",
        },
        [
          el("div", { fontSize: 26, fontWeight: 700 }, "a friend is asking"),
          el(
            "div",
            {
              display: "flex",
              backgroundColor: INK,
              color: PAPER,
              fontSize: 24,
              fontWeight: 700,
              borderRadius: 9999,
              padding: "16px 34px",
            },
            "see how you can help →",
          ),
        ],
      ),
    ],
  );
}

function decodePreview(e: string | null): { title: string; teaser?: string } {
  const fallback = { title: "Someone needs a hand." };
  if (!e) return fallback;
  try {
    const envelope = Envelope.parse(JSON.parse(new TextDecoder().decode(b64urlDecode(e))));
    if (envelope.visibility === "dark" || !envelope.preview?.title) return fallback;
    return { title: envelope.preview.title, teaser: envelope.preview.teaser };
  } catch {
    return fallback;
  }
}

export async function renderOgResponse(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const { title, teaser } = decodePreview(url.searchParams.get("e"));
    // Raiser's app theme at share time travels as ?th=d — scrapers have no
    // theme context of their own.
    const dark = url.searchParams.get("th") === "d";

    const svg = await satori(card(title, teaser, dark) as never, {
      width: 1200,
      height: 630,
      fonts: getFonts(),
    });
    const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();

    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        // the e param content-addresses the card — safe to cache hard
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err: any) {
    console.error("[og] render failed:", err);
    return new Response("og render error", { status: 500 });
  }
}
