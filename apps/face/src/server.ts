import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, join } from "node:path";

import type { PublicClient } from "viem";

import { configFromEnv, type FaceConfig } from "./config.ts";
import { baseHeaders, cspFor, inlineScriptHashes } from "./headers.ts";
import { cardOf, withCard } from "./meta.ts";
import { cardCache, modelOf } from "./og.tsx";
import { GENERIC, readerFor, type Reader } from "./preview.ts";
import { cacheControlOf, fileIn, readDist, typeOf } from "./static.ts";
import { langOf } from "./words.ts";

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
}

const OG_PATH = /^\/og(\/.+)\.png$/;

export function createFace(config: FaceConfig, options: FaceOptions = {}): Server {
  const reader: Reader = readerFor(config, options.client);
  const render = cardCache();
  const log = options.log ?? ((line: string) => console.log(line));
  const appCsp = cspFor(config);

  async function respond(req: IncomingMessage, res: ServerResponse): Promise<number> {
    const target = req.url ?? "/";
    const mark = target.indexOf("?");
    const pathname = mark < 0 ? target : target.slice(0, mark);
    const rawQuery = mark < 0 ? "" : target.slice(mark + 1);
    const query = new URLSearchParams(rawQuery);
    const head = req.method === "HEAD";

    const send = (status: number, headers: Record<string, string>, body: string | Uint8Array, csp = appCsp) => {
      const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
      res.writeHead(status, { ...baseHeaders(csp), ...headers, "Content-Length": String(bytes.byteLength) });
      res.end(head ? undefined : bytes);
      return status;
    };

    if (req.method !== "GET" && !head) {
      return send(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }, "only GET and HEAD\n");
    }
    if (!pathname.startsWith("/")) return send(400, { "Content-Type": "text/plain; charset=utf-8" }, "bad request\n");

    if (pathname === "/healthz") return send(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }, "ok\n");

    const lang = langOf(query, req.headers["accept-language"]);
    const dark = query.get("th") === "d";

    const og = OG_PATH.exec(pathname);
    if (og) {
      const preview = og[1] === "/generic" ? GENERIC : await reader.preview(og[1]!, rawQuery);
      const png = await render(modelOf(preview, lang, dark));
      return send(200, {
        "Content-Type": "image/png",
        // The card follows the chain (a state, a reward that grew), so robots keep it only briefly.
        "Cache-Control": "public, max-age=300",
        Vary: "Accept-Language",
      }, png);
    }

    const file = await fileIn(config.dist, pathname);
    if (file && basename(file) !== "index.html") {
      const bytes = await readDist(file);
      const type = typeOf(file);
      let csp = appCsp;
      if (type.startsWith("text/html")) {
        csp = cspFor(config, { inline: inlineScriptHashes(bytes.toString("utf8")), anyRpc: basename(file) === "exit.html" });
      }
      return send(200, { "Content-Type": type, "Cache-Control": cacheControlOf(pathname) }, bytes, csp);
    }

    const index = await fileIn(config.dist, "/index.html");
    if (!index) return send(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }, "the app is not built here\n");
    const html = (await readDist(index)).toString("utf8");
    const preview = await reader.preview(pathname, rawQuery);
    const page = withCard(html, cardOf(preview, config.site, lang, dark, pathname));
    return send(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      Vary: "Accept-Language",
    }, page, cspFor(config, { inline: inlineScriptHashes(page) }));
  }

  return createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0];
    respond(req, res)
      .catch(() => {
        // Nothing about the failure is written: it could carry what the address held.
        if (!res.headersSent) {
          res.writeHead(500, { ...baseHeaders(appCsp), "Content-Type": "text/plain; charset=utf-8" });
          res.end("something went wrong\n");
        } else res.end();
        return 500;
      })
      .then((status) => log(`${req.method} ${pathname} ${status}`));
  });
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
