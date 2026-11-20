/**
 * A wallet's icon, as EIP-6963 announces it, is any string the extension chose. It is accepted only
 * as a `data:` URL of a raster or SVG image and shown only through <img> (where an SVG cannot run
 * script or load anything), so an icon can never make this page fetch from elsewhere (the CSP's
 * `img-src 'self' data:` says the same). Anything else is dropped and the wallet shows its initial.
 */

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|svg\+xml|avif)(;[a-z0-9=._+-]+)*(;base64)?,/i;

/** The icon if it is a `data:` image URL of reasonable size, else undefined. */
export function safeIcon(icon: unknown): string | undefined {
  if (typeof icon !== "string") return undefined;
  const text = icon.trim();
  if (text.length > 200_000 || !DATA_IMAGE.test(text)) return undefined;
  return text;
}
