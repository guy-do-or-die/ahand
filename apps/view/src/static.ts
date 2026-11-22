import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

/** The built app's files, served as they are. */

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
};

export function typeOf(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/**
 * The file a path names inside `dist`, or undefined. The path is percent-decoded once; a path that
 * does not decode, holds a zero byte, or leads outside `dist` names no file, by its words or by a
 * symbolic link inside `dist` that points outside it. A folder names none either: every path that
 * is not a file is the app's own (index.html).
 */
export async function fileIn(dist: string, pathname: string): Promise<string | undefined> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return undefined;
  const root = resolve(dist);
  const path = resolve(root, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  if (path !== root && !path.startsWith(root + sep)) return undefined;
  try {
    const [realRoot, real] = await Promise.all([realpath(root), realpath(path)]);
    if (!real.startsWith(realRoot + sep)) return undefined;
    return (await stat(real)).isFile() ? path : undefined;
  } catch {
    return undefined;
  }
}

export function readDist(path: string): Promise<Buffer> {
  return readFile(path);
}

/** Hashed build output never changes under its name; everything else is checked each time. */
export function cacheControlOf(pathname: string): string {
  return pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
}
