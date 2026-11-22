import { metaOf, type Lang } from "@ahand/card";

import { factsOf, type Preview } from "./preview.ts";

export { oneLine } from "@ahand/card";

/** Text for an HTML attribute or element: the five characters that could end it are escaped. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export interface Card {
  title: string;
  description: string;
  /** Absolute address of the 1200×630 image. */
  image: string;
  imageAlt: string;
  /** Absolute address of the page, without any fragment. */
  url: string;
  lang: Lang;
  /** The page's own <title>, only when the Hand's title matched; otherwise the page keeps its own. */
  pageTitle?: string;
}

/** The query the page passes on to its image: the matched `d`, the theme and the language. */
function imageQuery(d: string | undefined, dark: boolean, lang: Lang): string {
  const parts: string[] = [];
  if (d) parts.push(`d=${d}`);
  if (dark) parts.push("th=d");
  if (lang !== "en") parts.push(`l=${lang}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/**
 * What the preview tags say for an address, in the reader's language: the shared card's title
 * and description (packages/card `metaOf`), the very lines the raise screen shows under its card.
 */
export function cardOf(preview: Preview, site: string, lang: Lang, dark: boolean, pathname = "/"): Card {
  const text = metaOf(factsOf(preview, lang), lang);
  if (preview.kind === "generic") {
    return {
      ...text,
      image: `${site}/og/generic.png${imageQuery(undefined, dark, lang)}`,
      url: `${site}${pathname}`,
      lang,
    };
  }
  const titled = preview.title !== undefined;
  return {
    ...text,
    image: `${site}/og${preview.path}.png${imageQuery(preview.d, dark, lang)}`,
    url: `${site}${preview.path}${preview.d ? `?d=${preview.d}` : ""}`,
    lang,
    ...(titled ? { pageTitle: `${text.title} · aHand` } : {}),
  };
}

/** The tags a messenger's preview robot reads (Open Graph and Twitter's). */
export function metaTags(card: Card): string {
  const e = escapeHtml;
  const og = (property: string, content: string) => `<meta property="${property}" content="${e(content)}" />`;
  const tw = (name: string, content: string) => `<meta name="${name}" content="${e(content)}" />`;
  return [
    og("og:type", "website"),
    og("og:site_name", "aHand"),
    og("og:locale", card.lang === "ru" ? "ru_RU" : "en_GB"),
    og("og:url", card.url),
    og("og:title", card.title),
    og("og:description", card.description),
    og("og:image", card.image),
    og("og:image:type", "image/png"),
    og("og:image:width", "1200"),
    og("og:image:height", "630"),
    og("og:image:alt", card.imageAlt),
    tw("twitter:card", "summary_large_image"),
    tw("twitter:title", card.title),
    tw("twitter:description", card.description),
    tw("twitter:image", card.image),
    tw("twitter:image:alt", card.imageAlt),
    tw("description", card.description),
  ].join("\n    ");
}

/**
 * index.html with the tags added before `</head>` and the page title set to the card's. Tags the
 * page already carries under the same names are removed first, so a robot never reads two.
 */
export function withCard(indexHtml: string, card: Card): string {
  const cleaned = indexHtml.replace(
    /\s*<meta\s+(?:property="(?:og|twitter):[^"]*"|name="(?:twitter:[^"]*|description)")[^>]*>/gi,
    "",
  );
  const titled = card.pageTitle
    ? cleaned.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(card.pageTitle!)}</title>`)
    : cleaned;
  const tags = `    ${metaTags(card)}\n  `;
  const at = titled.search(/<\/head>/i);
  return at < 0 ? `${tags}${titled}` : `${titled.slice(0, at)}${tags}${titled.slice(at)}`;
}
