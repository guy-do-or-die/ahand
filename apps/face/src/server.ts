import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, join } from "node:path";

import type { PublicClient } from "viem";

import { configFromEnv, type FaceConfig } from "./config.ts";
import { baseHeaders, cspFor, inlineScriptHashes } from "./headers.ts";
import { cardOf, withCard } from "./meta.ts";
import { codingFor, compress, compressible, fileCompressor, type Coding } from "./compress.ts";
import { cardCache, modelOf } from "./og.tsx";
import { GENERIC, readerFor, type Reader } from "./preview.ts";
import { cacheControlOf, fileIn, readDist, typeOf } from "./static.ts";
import { renderPool } from "./render-pool.ts";
import { LANGS, langOf, type Lang } from "./words.ts";

/**
 * Face: the optional front of the site (ARCHITECTURE §9, §14).
 *
 * It serves the built app's files, and for an address of a Hand it adds what a messenger's
 * preview robot reads: Open Graph and Twitter tags, and a 1200×630 card at /og/…png. It sees only
 * what stands before `#` (a browser never sends the link itself) and holds no key. Everything it
 * says about a Hand is read from the chain, and its title only after `d` matched the dataHash
 * Core keeps. Anything it cannot check gives the generic card, never an error page.
 *
 *   GET /healthz                                200 "ok"
 *   GET /<chain>/<hand>[?d=…]                   index.html with the Hand's card
 *   GET /<chain>/<core>/<hand>[?d=…]            the same, for a Core named in the path
 *   GET /og/<chain>[/<core>]/<hand>.png[?d=…]   the card as a PNG; th=d for dark
 *   GET /og/generic.png                         the generic card
 *   GET anything else                           the file when it exists, else index.html
 *
 * Cards are drawn by a small pool of worker threads (render-pool.ts), so a burst of cold cards
 * never holds up any other answer; beyond the pool's queue a card request gets the generic card
 * (no-store) or 503 at once. Text is sent in brotli or gzip when the request accepts it
 * (compress.ts). GET /index.html is the built file byte for byte; only / and a Hand's address
 * carry the added tags.
 *
 * It logs one line per request: method, path without the query, status. Nothing else.
 *
 *   FACE_PORT=… FACE_DIST=… FACE_RPC=… FACE_CHAIN=… FACE_CORES=… FACE_CANONICAL=… FACE_SITE=… \
 *     bun apps/face/src/server.ts
 */

export interface FaceOptions {
  /** A client of the chain to read instead of one over FACE_RPC (tests). */
  client?: PublicClient;
  /** Where the one line per request goes; stdout by default. */
  log?: (line: string) => void;
  /** How long one reading of a Hand answers for the same address (preview.ts; default 5 000 ms). */
  previewTtlMs?: number;
  /** Card renderers (worker threads) and how many cards may wait for one (default 2 and 16). */
  renderers?: number;
  renderQueue?: number;
}

const OG_PATH = /^\/og(\/.+)\.png$/;

const TEXT = "text/plain; charset=utf-8";

export function createFace(config: FaceConfig, options: FaceOptions = {}): Server {
  const reader: Reader = readerFor(config, options.client, { ttlMs: options.previewTtlMs });
  const pool = renderPool({ workers: options.renderers, queue: options.renderQueue });
  const render = cardCache((model) => pool.render(model));
  const files = fileCompressor();
  const log = options.log ?? ((line: string) => console.log(line));
  const appCsp = cspFor(config);
  const https = config.site.startsWith("https:");

  // The generic card in each language and theme, drawn once at the start and never forgotten: it
  // is the answer when the renderers are all busy, so it must not need one.
  const generic = new Map<string, Uint8Array>();
  const genericKey = (lang: Lang, dark: boolean) => `${lang}${dark ? "d" : "l"}`;
  for (const lang of LANGS) {
    for (const dark of [false, true]) {
      pool.render(modelOf(GENERIC, lang, dark))?.then(
        (png) => generic.set(genericKey(lang, dark), png),
        () => undefined,
      );
    }
  }
  void files.warm(config.dist, typeOf);

  async function respond(req: IncomingMessage, res: ServerResponse): Promise<number> {
    const target = req.url ?? "/";
    const mark = target.indexOf("?");
    const pathname = mark < 0 ? target : target.slice(0, mark);
    const rawQuery = mark < 0 ? "" : target.slice(mark + 1);
    const query = new URLSearchParams(rawQuery);
    const head = req.method === "HEAD";
    const coding = codingFor(req.headers["accept-encoding"]);

    const send = (status: number, headers: Record<string, string>, body: string | Uint8Array, csp = appCsp) => {
      const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
      res.writeHead(status, { ...baseHeaders(csp, { https }), ...headers, "Content-Length": String(bytes.byteLength) });
      res.end(head ? undefined : bytes);
      return status;
    };

    /**
     * Text in the coding the request accepts. `compressed` gives the coded bytes (from memory for
     * a file of the build, made now for a page face wrote). Vary names Accept-Encoding whenever
     * the answer could have been coded, so a shared cache keeps each form apart.
     */
    const sendText = async (
      status: number,
      headers: Record<string, string>,
      bytes: Uint8Array,
      csp: string,
      compressed: (coding: Coding) => Promise<Uint8Array>,
    ) => {
      const type = headers["Content-Type"] ?? "";
      if (!compressible(type, bytes.byteLength)) return send(status, headers, bytes, csp);
      const vary = [headers.Vary, "Accept-Encoding"].filter(Boolean).join(", ");
      if (!coding) return send(status, { ...headers, Vary: vary }, bytes, csp);
      return send(status, { ...headers, Vary: vary, "Content-Encoding": coding }, await compressed(coding), csp);
    };

    if (req.method !== "GET" && !head) {
      return send(405, { Allow: "GET, HEAD", "Content-Type": TEXT }, "only GET and HEAD\n");
    }
    if (!pathname.startsWith("/")) return send(400, { "Content-Type": TEXT }, "bad request\n");

    if (pathname === "/healthz") return send(200, { "Content-Type": TEXT, "Cache-Control": "no-store" }, "ok\n");

    const lang = langOf(query, req.headers["accept-language"]);
    const dark = query.get("th") === "d";

    const og = OG_PATH.exec(pathname);
    if (og) {
      const preview = og[1] === "/generic" ? GENERIC : await reader.preview(og[1]!, rawQuery);
      const ready = preview.kind === "generic" ? generic.get(genericKey(lang, dark)) : undefined;
      const drawing = ready ? Promise.resolve(ready) : render(modelOf(preview, lang, dark));
      if (drawing) {
        return send(200, {
          "Content-Type": "image/png",
          // The card follows the chain (a state, a reward that grew), so robots keep it only briefly.
          "Cache-Control": "public, max-age=300",
          Vary: "Accept-Language",
        }, await drawing);
      }
      // Every renderer is busy and the queue is full: answer at once rather than wait. The generic
      // card is true of every Hand, but it is not this one's, so nobody may keep it.
      const fallback = generic.get(genericKey(lang, dark));
      if (fallback) return send(200, { "Content-Type": "image/png", "Cache-Control": "no-store", Vary: "Accept-Language" }, fallback);
      return send(503, { "Content-Type": TEXT, "Cache-Control": "no-store", "Retry-After": "5" }, "busy drawing cards, try again shortly\n");
    }

    // A file of the build, exactly as built: /index.html too, so the bytes a visitor gets can be
    // hashed against build.json. Only the app's own paths (/, a Hand's address) get preview tags.
    const file = await fileIn(config.dist, pathname);
    if (file) {
      const bytes = await readDist(file);
      const type = typeOf(file);
      let csp = appCsp;
      if (type.startsWith("text/html")) {
        csp = cspFor(config, { inline: inlineScriptHashes(bytes.toString("utf8")), anyRpc: basename(file) === "exit.html" });
      }
      const headers = { "Content-Type": type, "Cache-Control": cacheControlOf(pathname) };
      return sendText(200, headers, bytes, csp, (c) => files.compressed(file, bytes, c));
    }

    const index = await fileIn(config.dist, "/index.html");
    if (!index) return send(404, { "Content-Type": TEXT, "Cache-Control": "no-store" }, "the app is not built here\n");
    const html = (await readDist(index)).toString("utf8");
    const preview = await reader.preview(pathname, rawQuery);
    const page = Buffer.from(withCard(html, cardOf(preview, config.site, lang, dark, pathname)), "utf8");
    return sendText(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      Vary: "Accept-Language",
    }, page, cspFor(config, { inline: inlineScriptHashes(page.toString("utf8")) }), (c) => compress(page, c, "fast"));
  }

  const server = createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0];
    respond(req, res)
      .catch(() => {
        // Nothing about the failure is written: it could carry what the address held.
        if (!res.headersSent) {
          res.writeHead(500, { ...baseHeaders(appCsp, { https }), "Content-Type": TEXT });
          res.end("something went wrong\n");
        } else res.end();
        return 500;
      })
      .then((status) => log(`${req.method} ${pathname} ${status}`));
  });
  server.on("close", () => void pool.close());
  return server;
}

/** Starts face from the environment; FACE_HOST (default 127.0.0.1) is where it listens. */
export function main(env = process.env): Server {
  const config = configFromEnv(env);
  const server = createFace(config);
  server.listen(config.port, env.FACE_HOST || "127.0.0.1", () => {
    console.log(`face on http://${env.FACE_HOST || "127.0.0.1"}:${config.port} serving ${join(config.dist)}`);
  });
  const stop = () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  return server;
}

if (import.meta.main) main();
