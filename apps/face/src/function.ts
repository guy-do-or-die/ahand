import type { PublicClient } from "viem";

import type { FaceConfig } from "./config.ts";
import { baseHeaders, cspFor, inlineScriptHashes } from "./headers.ts";
import { cardOf, withCard } from "./meta.ts";
import type { CardModel } from "./og.tsx";
import { GENERIC, HAND_PATH, readerFor, type Preview, type Reader } from "./preview.ts";
import { langOf, type Lang } from "./words.ts";

/**
 * Face as one web-standard request handler, `(request: Request) => Promise<Response>`, for a host
 * that serves the built app's files itself and hands face only the addresses that need it: the
 * Vercel Function of the public test deployment (apps/web/api/face.mjs, built by apps/hand/vercel.ts).
 *
 *   GET /<chain>/<hand>[?d=…]                   index.html with the Hand's card (server.ts's answer)
 *   GET /<chain>/<core>/<hand>[?d=…]            the same, for a Core named in the path
 *   GET /og/<chain>[/<core>]/<hand>.png[?d=…]   the card as a PNG; th=d for dark
 *   GET /og/generic.png                         the generic card
 *   GET anything else                           index.html as built, without tags
 *
 * What it says and why is server.ts's: the same reader (preview.ts), the same tags (meta.ts), the
 * same card (og.tsx), the same headers (headers.ts) and Cache-Control. What differs is where it runs:
 *
 *   - cards are drawn on the request's own thread, with no worker pool: a function instance is
 *     made for answering, and threads in it would only add a cold start. The drawn cards are
 *     remembered for as long as the instance lives (og.tsx `cardCache`);
 *   - og.tsx (satori, resvg) is loaded on the first card, not before, so a page's tags never
 *     wait on the renderer and never fail with it;
 *   - the site's origin is the request's own, so og:url and og:image name the address the robot
 *     fetched, on whichever domain the deployment answers (https outside this machine);
 *   - nothing is compressed here and no Strict-Transport-Security is sent: the host does both for
 *     every answer, its static files included;
 *   - when anything goes wrong on a page, the answer is index.html as built: the app still opens.
 */

export type FunctionConfig = Pick<FaceConfig, "rpc" | "chainId" | "trusted" | "canonical" | "relays" | "privy" | "tokens">;

export interface FunctionOptions {
  /** A client of the chain to read instead of one over `config.rpc` (tests). */
  client?: PublicClient;
  /** How long one reading of a Hand answers for the same address (preview.ts; default 5 000 ms). */
  previewTtlMs?: number;
}

/** Cards follow the chain (a state, a reward that grew), so robots keep them only briefly (server.ts). */
export const CARD_CACHE_CONTROL = "public, max-age=300";
/** A page with tags is written for each request and checked again each time (server.ts). */
export const PAGE_CACHE_CONTROL = "no-cache";

const OG_PATH = /^\/og(\/.+)\.png$/;
const TEXT = "text/plain; charset=utf-8";
const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The site's origin as the request names it: the host the visitor asked for (Vercel's proxy sets
 * X-Forwarded-Host to it and overwrites any the visitor sent), else the request URL's; https,
 * except for this machine (tests, a local run). A host that is not a plain host[:port] is ignored.
 */
export function siteOf(request: Request): string {
  const url = new URL(request.url);
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwarded && /^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(forwarded)) return `https://${forwarded}`;
  return LOCAL.has(url.hostname) ? url.origin : `https://${url.host}`;
}

type Drawing = { modelOf: (preview: Preview, lang: Lang, dark: boolean) => CardModel; draw: (model: CardModel) => Promise<Uint8Array> | undefined };

export function faceFunction(config: FunctionConfig, indexHtml: string, options: FunctionOptions = {}): (request: Request) => Promise<Response> {
  // The reader checks an address's form with the SDK, which wants a whole web address; the site
  // part of it is not read, so any origin does. The page's own origin comes from each request.
  const reader: Reader = readerFor({ ...config, port: 0, dist: "", site: "https://face.invalid" }, options.client, { ttlMs: options.previewTtlMs });
  const index = new TextEncoder().encode(indexHtml);
  const indexCsp = cspFor(config, { inline: inlineScriptHashes(indexHtml) });
  let drawing: Promise<Drawing> | undefined;
  const drawer = () =>
    (drawing ??= import("./og.tsx").then((og) => ({ modelOf: og.modelOf, draw: og.cardCache((model) => og.renderCard(model)) })));

  const answer = (head: boolean, status: number, csp: string, headers: Record<string, string>, body: Uint8Array | string) => {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    return new Response(head ? null : (bytes as Uint8Array<ArrayBuffer>), {
      status,
      headers: { ...baseHeaders(csp), ...headers, "Content-Length": String(bytes.byteLength) },
    });
  };
  const asBuilt = (head: boolean) => answer(head, 200, indexCsp, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": PAGE_CACHE_CONTROL }, index);

  return async function handle(request: Request): Promise<Response> {
    const head = request.method === "HEAD";
    if (request.method !== "GET" && !head) {
      return answer(head, 405, indexCsp, { Allow: "GET, HEAD", "Content-Type": TEXT }, "only GET and HEAD\n");
    }
    const url = new URL(request.url);
    const pathname = url.pathname;
    const rawQuery = url.search.slice(1);
    const lang = langOf(url.searchParams, request.headers.get("accept-language") ?? undefined);
    const dark = url.searchParams.get("th") === "d";

    const og = OG_PATH.exec(pathname);
    if (og) {
      try {
        const preview = og[1] === "/generic" ? GENERIC : await reader.preview(og[1]!, rawQuery);
        const { modelOf, draw } = await drawer();
        const png = await draw(modelOf(preview, lang, dark))!;
        return answer(head, 200, indexCsp, { "Content-Type": "image/png", "Cache-Control": CARD_CACHE_CONTROL, Vary: "Accept-Language" }, png);
      } catch {
        // Nothing about the failure is written: it could carry what the address held.
        return answer(head, 500, indexCsp, { "Content-Type": TEXT, "Cache-Control": "no-store" }, "something went wrong\n");
      }
    }

    if (!HAND_PATH.test(pathname)) return asBuilt(head);
    try {
      const preview = await reader.preview(pathname, rawQuery);
      const page = withCard(indexHtml, cardOf(preview, siteOf(request), lang, dark, pathname));
      return answer(
        head,
        200,
        cspFor(config, { inline: inlineScriptHashes(page) }),
        { "Content-Type": "text/html; charset=utf-8", "Cache-Control": PAGE_CACHE_CONTROL, Vary: "Accept-Language" },
        page,
      );
    } catch {
      return asBuilt(head);
    }
  };
}
