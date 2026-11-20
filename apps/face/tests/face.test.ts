import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request, type IncomingHttpHeaders, type Server } from "node:http";
import { tmpdir } from "node:os";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createPublicClient, custom, http, type Address, type Hex, type PublicClient } from "viem";
import { foundry } from "viem/chains";

import { fromBase64Url, refundCall, toText, type Call } from "@ahand/sdk";
import { ANVIL_KEYS, startChain, type Chain } from "@ahand/sdk/testing";

import { isolate } from "../src/bidi.ts";
import { USD, metaOf, pngSize, raiseHand, send as sendFrom, unescape, type RaiseOptions } from "./hands.ts";
import type { FaceConfig } from "../src/config.ts";
import { createFace, type FaceOptions } from "../src/server.ts";

/**
 * Face against a chain of its own (the wave 1 helper: anvil 40 days ahead of this machine), with
 * Hands raised directly through the SDK, the way the app raises them. Ports 25100 (face in this
 * process), 25101 (face as its own program), 25102 (the chain), 25103 to 25105 (faces of single
 * tests). FACE_TEST_PORT_BASE=B moves them to B to B+5 in the same order.
 */

const FACE_BASE = process.env.FACE_TEST_PORT_BASE ? Number(process.env.FACE_TEST_PORT_BASE) : 25100;
const PORT = FACE_BASE;
const PROCESS_PORT = FACE_BASE + 1;
/** How long the test face remembers one reading of a Hand; the clock test waits past it. */
const TTL = 250;
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const SITE = `http://127.0.0.1:${PORT}`;

let chain: Chain;
let face: Server;
let dist: string;
const logs: string[] = [];
const raiserKey = ANVIL_KEYS[1]!;

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="referrer" content="no-referrer" />
    <title>aHand</title>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`;
const EXIT = `<!doctype html><html><head><title>exit</title><script type="module">document.title = "exit ran";</script></head><body>exit, byte for byte é</body></html>\n`;

const rpc = (method: string, params: unknown[] = []) =>
  (chain.client.request as (a: { method: string; params: unknown[] }) => Promise<unknown>)({ method, params });

const send = (key: Hex, call: Call) => sendFrom(chain, key, call);

/** Raises a Hand described in `mode` and returns its faced (or bare) address, as the app writes it (hands.ts). */
const raise = (opts: RaiseOptions) => raiseHand(chain, SITE, raiserKey, opts);

async function get(path: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${SITE}${path}`, { headers, redirect: "manual" });
  return { response, status: response.status, text: await response.clone().text(), bytes: new Uint8Array(await response.arrayBuffer()) };
}

beforeAll(async () => {
  chain = await startChain({ port: FACE_BASE + 2 });
  dist = mkdtempSync(join(tmpdir(), "face-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), INDEX);
  writeFileSync(join(dist, "exit.html"), EXIT);
  writeFileSync(join(dist, "build.json"), JSON.stringify({ files: { "index.html": "00" } }));
  // Big enough to be worth compressing; a small file is sent as it is.
  writeFileSync(join(dist, "assets", "index-abc.js"), "console.log('app');\n".repeat(400));
  writeFileSync(join(dist, "assets", "tiny.js"), "console.log('tiny')");
  const config: FaceConfig = {
    port: PORT,
    dist,
    rpc: chain.rpc,
    chainId: chain.chainId,
    trusted: [chain.core],
    canonical: chain.core,
    site: SITE,
    relays: ["ws://127.0.0.1:18547"],
  };
  face = createFace(config, { log: (line) => logs.push(line), previewTtlMs: TTL });
  await new Promise<void>((done) => face.listen(PORT, "127.0.0.1", done));
}, 60_000);

afterAll(async () => {
  await new Promise<void>((done) => {
    face?.close(() => done());
    face?.closeAllConnections();
  });
  await chain?.stop();
});

describe("previews of a Hand", () => {
  it("an unlisted Hand shows its title and reward; one byte of d changed shows the generic card", async () => {
    const title = "Looking for a sublet in Yerevan for June";
    const { before } = await raise({ mode: "unlisted", title, content: "Two rooms, near the metro. Hidden from robots.", reward: 40n * USD });
    expect(before).toMatch(/^\/31337\/\d+\?d=[A-Za-z0-9_-]+$/);

    const page = await get(before);
    expect(page.status).toBe(200);
    expect(unescape(metaOf(page.text, "og:title"))).toBe(isolate(title));
    expect(unescape(metaOf(page.text, "twitter:title"))).toBe(isolate(title));
    expect(metaOf(page.text, "og:description")).toMatch(/^\$40 reward on chain · open until \d{1,2} [A-Z][a-z]{2}\.$/);
    expect(page.text).toContain("$40 reward");
    expect(page.text).not.toContain("Hidden from robots");
    expect(unescape(metaOf(page.text, "og:image"))).toBe(`${SITE}/og${before.replace("?", ".png?")}`);
    expect(page.text).toContain(`<title>${isolate(title)} · aHand</title>`);
    // The app still loads: the page is index.html with tags added.
    expect(page.text).toContain(`<script type="module" crossorigin src="/assets/index-abc.js"></script>`);

    // One byte of d changed: a byte of the title's text, re-encoded as the address writes it.
    const d = before.split("?d=")[1]!;
    const bytes = fromBase64Url(d);
    bytes[bytes.length - 1] ^= 0x01;
    const tampered = await get(`${before.split("?")[0]}?d=${toText(bytes)}`);
    expect(tampered.status).toBe(200);
    expect(unescape(metaOf(tampered.text, "og:title"))).toBe("Someone raised a hand.");
    expect(tampered.text).not.toContain(title);
    expect(tampered.text).not.toContain("$40");

    // One character of the base64 changed, too.
    const flipped = d.slice(0, 10) + (d[10] === "A" ? "B" : "A") + d.slice(11);
    const second = await get(`${before.split("?")[0]}?d=${flipped}`);
    expect(unescape(metaOf(second.text, "og:title"))).toBe("Someone raised a hand.");

    // In Russian, by Accept-Language.
    const ru = await get(before, { "Accept-Language": "ru-RU,ru;q=0.9" });
    expect(unescape(metaOf(ru.text, "og:title"))).toBe(isolate(title));
    expect(metaOf(ru.text, "og:description")).toStartWith("Награда $40 в сети · открыта до ");
    expect(unescape(metaOf(ru.text, "og:image"))).toBe(`${SITE}/og${before.replace("?", ".png?")}&l=ru`);
  });

  it("a numbered address shows the terms from hands() under the generic title", async () => {
    const { before } = await raise({ mode: "unlisted", title: "Not for robots without d", reward: 25n * USD });
    const numbered = before.split("?")[0]!;
    const page = await get(numbered);
    expect(unescape(metaOf(page.text, "og:title"))).toBe("Someone raised a hand.");
    expect(metaOf(page.text, "og:description")).toStartWith("$25 reward on chain · open until ");
    expect(page.text).not.toContain("Not for robots");
  });

  it("a public Hand with no reward says a thank-you only, and shows its details", async () => {
    const { before } = await raise({ mode: "public", title: "Who can fix a 1978 Vespa?", content: "It stalls at idle.", reward: 0n });
    const page = await get(before);
    expect(unescape(metaOf(page.text, "og:title"))).toBe(isolate("Who can fix a 1978 Vespa?"));
    const description = metaOf(page.text, "og:description")!;
    expect(description).toStartWith("No reward on chain: a thank-you only · open until ");
    expect(description).toEndWith(`. The asker wrote: “${isolate("It stalls at idle.")}”`);
    expect(page.text).not.toContain("$");
  });

  it("a dark Hand's bare address, the root, an unknown Hand and an untrusted Core give the generic card with 200", async () => {
    const dark = await raise({ mode: "dark", title: "Dark words", reward: 5n * USD });
    expect(dark.before).toBe("/");
    const other: Address = "0x1111111111111111111111111111111111111111";
    for (const path of ["/", "/raise", "/31337/999999", `/31337/${other.toLowerCase()}/1`, "/1/1", "/31337/1?d=AAAA", "/31337/1?d=a&d=b"]) {
      const page = await get(path);
      expect(page.status).toBe(200);
      expect(unescape(metaOf(page.text, "og:title"))).toBe("Someone raised a hand.");
      expect(metaOf(page.text, "og:description")).toBe("Open to see.");
      expect(unescape(metaOf(page.text, "og:image"))).toBe(`${SITE}/og/generic.png`);
      expect(page.text).not.toContain("Dark words");
    }
  });

  it("judges time's up by the chain's clock, then shows the reward went back", async () => {
    const { handId, before } = await raise({ mode: "unlisted", title: "Short one", reward: 3n * USD, seconds: 3_600 });
    expect(metaOf((await get(before)).text, "og:description")).toStartWith("$3 reward on chain · open until ");

    // The chain moves two hours on; this machine's clock (40 days behind the chain) does not.
    await rpc("evm_increaseTime", [7_200]);
    await rpc("evm_mine");
    await pause(TTL + 50);
    expect(unescape(metaOf((await get(before)).text, "og:description"))).toStartWith("$3 reward on chain · time's up on ");

    await send(ANVIL_KEYS[4]!, refundCall(chain.core, handId));
    await pause(TTL + 50);
    const closed = await get(before);
    expect(metaOf(closed.text, "og:description")).toStartWith("The $3 reward went back on ");
    expect(unescape(metaOf(closed.text, "og:title"))).toBe(isolate("Short one"));
  });
});

describe("the card image", () => {
  it("is a 1200×630 PNG, the same bytes each time, another in dark and in Russian", async () => {
    const { before } = await raise({ mode: "unlisted", title: "A PNG for this hand", reward: 12n * USD });
    const path = `/og${before.replace("?", ".png?")}`;
    const first = await get(path);
    expect(first.status).toBe(200);
    expect(first.response.headers.get("content-type")).toBe("image/png");
    expect(pngSize(first.bytes)).toEqual({ magic: "89504e470d0a1a0a", width: 1200, height: 630 });

    const again = await get(path);
    expect(Buffer.from(again.bytes).equals(Buffer.from(first.bytes))).toBe(true);

    const dark = await get(`${path}&th=d`);
    expect(pngSize(dark.bytes)).toMatchObject({ width: 1200, height: 630 });
    expect(Buffer.from(dark.bytes).equals(Buffer.from(first.bytes))).toBe(false);

    const ru = await get(`${path}&l=ru`);
    expect(Buffer.from(ru.bytes).equals(Buffer.from(first.bytes))).toBe(false);

    // Without d, or with a wrong one, it is a card all the same, never an error.
    const generic = await get("/og/generic.png");
    const wrong = await get("/og/31337/999999.png?d=AAAA");
    expect(generic.status).toBe(200);
    expect(Buffer.from(wrong.bytes).equals(Buffer.from(generic.bytes))).toBe(true);
    const untrusted = await get("/og/31337/0x1111111111111111111111111111111111111111/1.png");
    expect(Buffer.from(untrusted.bytes).equals(Buffer.from(generic.bytes))).toBe(true);
  });
});

describe("files, headers and the log", () => {
  it("answers /healthz, serves exit.html and build.json as they are, and every other path the app", async () => {
    expect((await get("/healthz")).status).toBe(200);

    const exit = await get("/exit.html");
    expect(exit.status).toBe(200);
    expect(Buffer.from(exit.bytes).equals(readFileSync(join(dist, "exit.html")))).toBe(true);
    // Its inline script is allowed by its own hash, and it may reach any RPC its reader types.
    const exitCsp = exit.response.headers.get("content-security-policy")!;
    expect(exitCsp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
    expect(exitCsp).toContain("https:");

    const build = await get("/build.json");
    expect(build.response.headers.get("content-type")).toStartWith("application/json");
    expect(build.text).toBe(readFileSync(join(dist, "build.json"), "utf8"));

    const asset = await get("/assets/index-abc.js");
    expect(asset.response.headers.get("cache-control")).toContain("immutable");

    for (const path of ["/nowhere", "/../../etc/passwd", "/assets", "/31337/1/proof"]) {
      const page = await get(path);
      expect(page.status).toBe(200);
      expect(page.text).toContain('<div id="root"></div>');
    }
    expect((await fetch(`${SITE}/`, { method: "POST" })).status).toBe(405);
  });

  it("sends the CSP and no-referrer on every response", async () => {
    const { before } = await raise({ mode: "unlisted", title: "Headers", reward: USD });
    for (const path of ["/", before, `/og${before.replace("?", ".png?")}`, "/healthz", "/exit.html", "/build.json", "/assets/index-abc.js", "/nowhere"]) {
      const { response } = await get(path);
      const csp = response.headers.get("content-security-policy")!;
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      for (const directive of ["default-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'", "worker-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"]) {
        expect(csp).toContain(directive);
      }
      expect(csp).toContain(`connect-src 'self' ${chain.rpc} ws://127.0.0.1:18547`);
      expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(response.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      // The site here is http: no HSTS, which a browser would ignore over http anyway.
      expect(response.headers.get("strict-transport-security")).toBeNull();
    }
    const refused = await fetch(`${SITE}/`, { method: "POST" });
    expect(refused.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  });

  it("sends Strict-Transport-Security when the site is https", async () => {
    const port = FACE_BASE + 5;
    const secure = await startFace({ port, site: "https://ahand.example" });
    try {
      for (const path of ["/healthz", "/", "/index.html", "/og/generic.png", "/assets/index-abc.js"]) {
        const { headers } = await raw(port, path);
        expect(headers["strict-transport-security"]).toBe("max-age=31536000");
        expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
      }
    } finally {
      await secure.stop();
    }
  });

  it("logs method, path and status, and never a query", async () => {
    const { before } = await raise({ mode: "unlisted", title: "Log me not", reward: USD });
    logs.length = 0;
    await get(before);
    await get(`/og${before.replace("?", ".png?")}&th=d`);
    await new Promise((done) => setTimeout(done, 50));
    const path = before.split("?")[0]!;
    expect(logs).toEqual([`GET ${path} 200`, `GET /og${path}.png 200`]);
    expect(logs.join("\n")).not.toContain("d=");
  });
});

/** A request through node:http, so the body comes back exactly as sent (fetch would decode it). */
function raw(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((done, fail) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => done({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", fail);
    req.end();
  });
}

async function startFace(config: Partial<FaceConfig> & { port: number }, options: FaceOptions = {}) {
  const server = createFace(
    { dist, rpc: chain.rpc, chainId: chain.chainId, trusted: [chain.core], canonical: chain.core, site: `http://127.0.0.1:${config.port}`, relays: [], ...config },
    { log: () => undefined, ...options },
  );
  await new Promise<void>((done) => server.listen(config.port, "127.0.0.1", done));
  return {
    server,
    stop: () =>
      new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}

describe("index.html as built", () => {
  it("GET /index.html is the built file byte for byte; / and a Hand's address carry the tags", async () => {
    const built = readFileSync(join(dist, "index.html"));
    const file = await raw(PORT, "/index.html");
    expect(file.status).toBe(200);
    expect(file.body.equals(built)).toBe(true);
    expect(file.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(file.headers["cache-control"]).toBe("no-cache");
    // The file's own CSP: no inline script in it, so script-src stays 'self'.
    expect(file.headers["content-security-policy"]).toContain("script-src 'self';");

    const { before } = await raise({ mode: "unlisted", title: "Tagged, not the file", reward: USD });
    for (const path of ["/", before]) {
      const page = await raw(PORT, path);
      expect(page.body.equals(built)).toBe(false);
      expect(page.body.toString("utf8")).toContain('<meta property="og:title"');
    }
  });
});

describe("compression", () => {
  const asset = "/assets/index-abc.js";

  it("sends brotli, gzip or the bytes as they are, as Accept-Encoding asks", async () => {
    const built = readFileSync(join(dist, "assets", "index-abc.js"));

    const br = await raw(PORT, asset, { "Accept-Encoding": "gzip, deflate, br, zstd" });
    expect(br.headers["content-encoding"]).toBe("br");
    expect(br.headers.vary).toContain("Accept-Encoding");
    expect(Number(br.headers["content-length"])).toBe(br.body.byteLength);
    expect(br.body.byteLength).toBeLessThan(built.byteLength / 10);
    expect(brotliDecompressSync(br.body).equals(built)).toBe(true);

    const gz = await raw(PORT, asset, { "Accept-Encoding": "gzip" });
    expect(gz.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(gz.body).equals(built)).toBe(true);

    // br refused by q=0: gzip.
    const noBr = await raw(PORT, asset, { "Accept-Encoding": "br;q=0, gzip;q=0.5" });
    expect(noBr.headers["content-encoding"]).toBe("gzip");

    for (const header of [undefined, "identity", "deflate", "*;q=0", "br;q=0, gzip;q=0"]) {
      const plain = await raw(PORT, asset, header === undefined ? {} : { "Accept-Encoding": header });
      expect(plain.headers["content-encoding"]).toBeUndefined();
      expect(plain.headers.vary).toContain("Accept-Encoding");
      expect(plain.body.equals(built)).toBe(true);
    }

    // A HEAD gets the same headers and no body.
    const head = await new Promise<IncomingHttpHeaders>((done, fail) => {
      const req = request({ host: "127.0.0.1", port: PORT, path: asset, method: "HEAD", headers: { "Accept-Encoding": "br" } }, (res) => {
        res.resume();
        res.on("end", () => done(res.headers));
      });
      req.on("error", fail);
      req.end();
    });
    expect(head["content-encoding"]).toBe("br");
    expect(Number(head["content-length"])).toBe(br.body.byteLength);
  });

  it("compresses the page with a Hand's tags, and leaves small files and images alone", async () => {
    const { before } = await raise({ mode: "unlisted", title: "Compressed page", reward: 2n * USD });
    const plain = await raw(PORT, before);
    const br = await raw(PORT, before, { "Accept-Encoding": "br" });
    const gz = await raw(PORT, before, { "Accept-Encoding": "gzip" });
    expect(plain.body.byteLength).toBeGreaterThan(1_024);
    expect(br.headers["content-encoding"]).toBe("br");
    expect(br.headers.vary).toBe("Accept-Language, Accept-Encoding");
    expect(brotliDecompressSync(br.body).equals(plain.body)).toBe(true);
    expect(gunzipSync(gz.body).equals(plain.body)).toBe(true);
    expect(plain.body.toString("utf8")).toContain('content="\u2068Compressed page\u2069"') // the asker's words isolated (H-2);

    const tiny = await raw(PORT, "/assets/tiny.js", { "Accept-Encoding": "br" });
    expect(tiny.headers["content-encoding"]).toBeUndefined();
    const png = await raw(PORT, "/og/generic.png", { "Accept-Encoding": "br, gzip" });
    expect(png.headers["content-encoding"]).toBeUndefined();
    expect(png.body.subarray(0, 4).toString("hex")).toBe("89504e47");
  });
});

describe("under a burst of cold cards", () => {
  it("draws off the request thread: /healthz stays under a second, and every card answer is a PNG or a quick 503", async () => {
    const hands: string[] = [];
    for (let i = 0; i < 6; i++) hands.push((await raise({ mode: "unlisted", title: `Burst hand number ${i}`, reward: BigInt(i + 1) * USD })).before);
    const port = FACE_BASE + 3;
    const burst = await startFace({ port }, { previewTtlMs: TTL });
    try {
      // Let the four generic cards be drawn first, as they are within a second of any start.
      for (let i = 0; i < 100; i++) {
        const generic = await raw(port, "/og/generic.png");
        if (generic.headers["cache-control"] === "public, max-age=300") break;
        await pause(50);
      }
      // Every Hand in two languages and two themes: 24 different cold cards at once, twice over.
      const paths = hands.flatMap((before) =>
        ["", "&l=ru", "&th=d", "&l=ru&th=d"].map((extra) => `/og${before.replace("?", ".png?")}${extra}`),
      );
      let done = false;
      const health: number[] = [];
      const probe = (async () => {
        while (!done) {
          const started = performance.now();
          expect((await raw(port, "/healthz")).status).toBe(200);
          health.push(performance.now() - started);
          await pause(20);
        }
      })();
      const answers = await Promise.all([...paths, ...paths].map((path) => raw(port, path)));
      done = true;
      await probe;

      expect(health.length).toBeGreaterThan(5);
      expect(Math.max(...health)).toBeLessThan(1_000);
      let drawn = 0;
      for (const answer of answers) {
        if (answer.status === 503) {
          expect(answer.headers["retry-after"]).toBe("5");
          continue;
        }
        expect(answer.status).toBe(200);
        expect(answer.body.subarray(0, 4).toString("hex")).toBe("89504e47");
        if (answer.headers["cache-control"] === "public, max-age=300") drawn++;
        else expect(answer.headers["cache-control"]).toBe("no-store");
      }
      // Two renderers and sixteen places in the queue: some cards are drawn, the rest answered at once.
      expect(drawn).toBeGreaterThanOrEqual(10);
      expect(drawn).toBeLessThan(answers.length);
    } finally {
      await burst.stop();
    }
  }, 60_000);

  it("reads the chain once for a page, its card and the card in other themes and languages", async () => {
    const { before } = await raise({ mode: "unlisted", title: "Read once", reward: 4n * USD });
    let calls = 0;
    const counting = createPublicClient({
      chain: foundry,
      transport: custom({
        request: (args: { method: string; params?: unknown }) => {
          calls++;
          return (chain.client.request as (a: unknown) => Promise<unknown>)(args);
        },
      }),
    }) as PublicClient;
    const port = FACE_BASE + 4;
    const counted = await startFace({ port }, { client: counting, previewTtlMs: 5_000 });
    try {
      const card = `/og${before.replace("?", ".png?")}`;
      expect(metaOf((await raw(port, before)).body.toString("utf8"), "og:title")).toBe("\u2068Read once\u2069"); // the asker's words isolated (H-2)
      const once = calls;
      expect(once).toBeGreaterThan(0);
      await Promise.all([raw(port, before), raw(port, `${before}&l=ru`), raw(port, card), raw(port, `${card}&th=d`), raw(port, `${card}&l=ru`)]);
      expect(calls).toBe(once);
    } finally {
      await counted.stop();
    }
  }, 30_000);
});

describe("face as its own program", () => {
  let child: ChildProcess | undefined;
  afterAll(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise((done) => child!.once("exit", done));
      child.kill("SIGTERM");
      await exited;
    }
  });

  it("reads ARCHITECTURE §14's environment, answers /healthz and logs no query", async () => {
    child = spawn(process.execPath, [join(import.meta.dir, "../src/server.ts")], {
      env: {
        ...process.env,
        FACE_PORT: String(PROCESS_PORT),
        FACE_DIST: dist,
        FACE_RPC: chain.rpc,
        FACE_CHAIN: String(chain.chainId),
        FACE_CORES: chain.core,
        FACE_CANONICAL: chain.core,
        FACE_SITE: `http://127.0.0.1:${PROCESS_PORT}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout!.on("data", (chunk) => (out += chunk));
    child.stderr!.on("data", (chunk) => (out += chunk));
    const base = `http://127.0.0.1:${PROCESS_PORT}`;
    let healthy = false;
    for (let i = 0; i < 100 && !healthy; i++) {
      healthy = await fetch(`${base}/healthz`).then((r) => r.ok, () => false);
      if (!healthy) await new Promise((done) => setTimeout(done, 50));
    }
    expect(healthy).toBe(true);

    const { before } = await raise({ mode: "unlisted", title: "From the program", reward: 2n * USD });
    const page = await fetch(`${base}${before}`).then((r) => r.text());
    expect(page).toContain(`content="${isolate("From the program")}"`);
    const png = await fetch(`${base}/og${before.replace("?", ".png?")}`);
    expect(png.headers.get("content-type")).toBe("image/png");
    await png.arrayBuffer();
    await new Promise((done) => setTimeout(done, 100));

    const path = before.split("?")[0]!;
    expect(out).toContain(`GET ${path} 200`);
    expect(out).toContain(`GET /og${path}.png 200`);
    expect(out).not.toContain("?");
    expect(out).not.toContain("d=");
  }, 30_000);
});
