import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getTransformedRoutes } from "@vercel/routing-utils";
import { fromBase64Url, refundCall, toText } from "@ahand/sdk";
import { ANVIL_KEYS, startChain, type Chain } from "@ahand/sdk/testing";

import { isolate } from "../../face/src/bidi.ts";
import { faceFunction, type FunctionConfig } from "../../face/src/function.ts";
import { metaOf, pngSize, raiseHand, send, unescape, USD, type RaiseOptions } from "../../face/tests/hands.ts";
import { connectSourcesOf, contentSecurityPolicy, inlineScriptHashes as staticHashes } from "../../../infra/stand/static.ts";
import { appCsp, appHeaders, PRIVY_CSP } from "../csp.ts";
import {
  APP_PATHS,
  buildApp,
  BUN,
  bunProblem,
  copyFunction,
  exitProblem,
  expectedVercelJson,
  formatJson,
  FUNCTION_DIR,
  FUNCTION_ENTRY,
  FUNCTION_URL,
  functionFileList,
  functionFiles,
  MIN_BUN,
  PUBLIC_CONFIG,
  publicConfig,
  stageFunction,
  VERCEL_JSON,
  VERCEL_ROOT,
  vercelJson,
  writePublicConfig,
} from "../vercel.ts";

/**
 * apps/web/vercel.json, the public test deployment's settings (apps/hand/vercel.ts): Vercel reads
 * it before it builds, so its headers are literal. Here a fresh public build is made and the file
 * must be exactly what that build needs: the headers the stand's static server sends for the same
 * configuration, exit.html's own script hash, and routes that Vercel's own route compiler
 * (@vercel/routing-utils) turns into: app paths to index.html, files as they are, a missing file a 404,
 * and a Hand's address and its card to face's Vercel Function (apps/web/api/face.mjs).
 *
 * The function itself is called here as Vercel's Node.js runtime calls it, with a web Request:
 * `faceFunction` against a chain of its own (anvil on VERCEL_TEST_PORT, else a free port) with
 * Hands raised through the SDK, and the built bundle traced with Vercel's own tracer (@vercel/nft,
 * as @vercel/node runs it, plus `includeFiles`), copied out alone and loaded by `node` (NODE_BIN).
 */

const scratch = mkdtempSync(join(tmpdir(), "ahand-vercel-test-"));
const dist = join(scratch, "dist");
const configFile = writePublicConfig(join(scratch, "config"));
const config = JSON.parse(readFileSync(configFile, "utf8"));
const vercel = JSON.parse(readFileSync(VERCEL_JSON, "utf8"));
/** The app's headers for the public configuration: its RPC and relays, and Privy (email), which it has. */
const appOf = () => appHeaders({ rpcUrls: config.chain.rpcUrls, relays: config.relays, privy: true });

beforeAll(() => {
  buildApp(configFile, dist, join(scratch, "vite"));
}, 120_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type Route = { src?: string; dest?: string; headers?: Record<string, string>; continue?: boolean; check?: boolean; status?: number; handle?: string };

/**
 * One request through Vercel's routes as it applies them: header rules, then the filesystem, then
 * rewrites. A rewrite to the function's URL ends there (`fn`): Vercel then calls the function with
 * the request as it came (path and query unchanged; the rewrite names no parameter to add).
 */
function serve(path: string): { status: number; file?: string; fn?: true; headers: Record<string, string> } {
  const { routes, error } = getTransformedRoutes(vercel) as { routes: Route[] | null; error: unknown };
  if (error || !routes) throw new Error(`Vercel refuses the routes: ${JSON.stringify(error)}`);
  const isFile = (p: string) => {
    const file = join(dist, decodeURIComponent(p));
    return existsSync(file) && statSync(file).isFile() ? file : undefined;
  };
  const headers: Record<string, string> = {};
  let afterFs = false;
  for (const route of routes) {
    if (route.handle === "filesystem") {
      afterFs = true;
      const file = isFile(path);
      if (file) return { status: 200, file, headers };
      continue;
    }
    if (!route.src || !new RegExp(route.src).test(path)) continue;
    if (route.status) return { status: route.status, headers: { ...headers, ...route.headers } };
    if (route.headers && route.continue) Object.assign(headers, route.headers);
    if (afterFs && route.dest) {
      if (route.dest === FUNCTION_URL) return { status: 200, fn: true, headers };
      const file = isFile(route.dest.split("?")[0]!);
      if (file) return { status: 200, file, headers };
    }
  }
  return { status: 404, headers };
}

test("the site is built with the Bun that CI pins, so bun.lock installs frozen on both", () => {
  const workflow = readFileSync(join(import.meta.dir, "../../../.github/workflows/check.yml"), "utf8");
  expect(workflow).toContain(`bun-version: ${BUN}`);
});

describe("apps/web/vercel.json (the public test deployment)", () => {
  test("is exactly what a fresh public build needs: bun apps/hand/vercel.ts write", () => {
    expect(readFileSync(VERCEL_JSON, "utf8")).toBe(formatJson(expectedVercelJson(dist, configFile)));
  });

  test("builds the right app where Vercel serves it, with no gallery and no dev wallet", () => {
    expect(vercel.framework).toBeNull();
    expect(vercel.outputDirectory).toBe("dist");
    expect(vercel.installCommand).toBe(`cd ../.. && npx -y bun@${BUN} install --frozen-lockfile`);
    expect(vercel.buildCommand).toBe(`cd ../.. && npx -y bun@${BUN} apps/hand/vercel.ts build`);
    expect(config.chain.local).toBe(false);
    expect(existsSync(join(dist, "gallery.html"))).toBe(false);
    const assets = readdirSync(join(dist, "assets"));
    for (const name of assets) {
      if (!name.endsWith(".js")) continue;
      expect(readFileSync(join(dist, "assets", name), "utf8")).not.toContain("test test test test test test test test test test test junk");
    }
  });

  test("an app page carries the headers the stand's static server sends for this configuration", () => {
    const connect = connectSourcesOf(config);
    expect(readFileSync(join(dist, "index.html"), "utf8").match(/<script\b(?![^>]*\bsrc=)[^>]*>[^<]/g)).toBeNull();
    // The stand's server has no Privy: without it, the policy is the stand's word for word.
    expect(appHeaders({ rpcUrls: config.chain.rpcUrls, relays: config.relays })["Content-Security-Policy"]).toBe(contentSecurityPolicy(connect));
    const app = appOf();
    for (const path of ["/", "/raise", "/84532/12/proof", "/84532/0x65ac707e2ae7392583de5d6192c619f1d8862309/12/proof", "/84532/abc", "/0x65ac707e2ae7392583de5d6192c619f1d8862309/12", "/84532/12/", "/my", "/my/84532/3", "/pass", "/give", "/thank", "/waiting", "/check", "/core", "/care/84532/1", "/print", "/limits", "/defaults", "/without-us", "/nowhere/at/all"]) {
      const answer = serve(path);
      expect({ path, status: answer.status, file: answer.file }).toEqual({ path, status: 200, file: join(dist, "index.html") });
      expect(answer.headers).toEqual(app);
    }
  });

  test("exit.html is served as built, with its own script's hash, any https RPC and data: fonts", () => {
    const html = readFileSync(join(dist, "exit.html"), "utf8");
    const answer = serve("/exit.html");
    expect(answer.file).toBe(join(dist, "exit.html"));
    expect(answer.headers["Content-Security-Policy"]).toBe(contentSecurityPolicy(connectSourcesOf(config), { inline: staticHashes(html), anyRpc: true }));
    expect(answer.headers["Referrer-Policy"]).toBe("no-referrer");
  });

  test("logging in through Privy: the app's pages name Privy's and WalletConnect's sources and nothing else of them; exit.html and the stand never do", () => {
    expect(config.privy).toEqual({ appId: "clt69jwp204btq1o3q72cupji", origins: ["https://ahand.in", "https://*.ahand.in", ...[3000, 3001, 3300, 3400, 3411, 5173].map((port) => `http://localhost:${port}`)] });
    const page = serve("/raise").headers["Content-Security-Policy"]!;
    const plain = appCsp({ rpcUrls: config.chain.rpcUrls, relays: config.relays }, "header");
    // Exactly two directives more, img-src and connect-src longer by Privy's sources; every other directive as before.
    expect(page).toBe(
      plain
        .replace("img-src 'self' data:", `img-src 'self' data: ${PRIVY_CSP.img.join(" ")}`)
        .replace(/connect-src ([^;]*)/, (_all, list: string) => `connect-src ${list} ${PRIVY_CSP.connect.join(" ")}; frame-src ${PRIVY_CSP.frame.join(" ")}; child-src ${PRIVY_CSP.frame.join(" ")}`),
    );
    expect(PRIVY_CSP.frame).toEqual(["https://auth.privy.io", "https://verify.walletconnect.com", "https://verify.walletconnect.org"]);
    expect(PRIVY_CSP.connect).toEqual(["https://auth.privy.io", "https://*.rpc.privy.systems", "wss://relay.walletconnect.com", "wss://relay.walletconnect.org", "wss://www.walletlink.org", "https://explorer-api.walletconnect.com"]);
    // No script, style or worker from Privy: its code ships in the app's own files.
    expect(page).toContain("script-src 'self';");
    expect(page).toContain("worker-src 'none'");
    expect(page).toContain("img-src 'self' data: https://explorer-api.walletconnect.com;");
    // The built page's meta tag says the same (without frame-ancestors, which only works as a header).
    const meta = readFileSync(join(dist, "index.html"), "utf8").match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)![1]!.replaceAll("&quot;", '"').replaceAll("&amp;", "&");
    expect(meta).toBe(page.replace("; frame-ancestors 'none'", ""));
    // A Hand's address (face's function) carries the same policy as any other page.
    expect(serve("/84532/12").headers["Content-Security-Policy"]).toBe(page);
    // exit.html is the reader's own way out: no sign-in, so nothing of Privy, in its policy or its code.
    const exit = serve("/exit.html").headers["Content-Security-Policy"]!;
    expect(exit).not.toContain("privy");
    expect(exit).not.toContain("walletconnect");
    expect(exit).not.toContain("frame-src");
    expect(readFileSync(join(dist, "exit.html"), "utf8")).not.toContain("auth.privy.io");
    // Without privy in the configuration, nothing of Privy anywhere in vercel.json.
    const off = JSON.stringify(vercelJson({ ...config, privy: undefined }, readFileSync(join(dist, "exit.html"), "utf8")));
    expect(off).not.toContain("privy");
  });

  test("Privy's SDK is not on a page's first load: index.html loads none of it, the email connector loads it on first use", () => {
    const index = readFileSync(join(dist, "index.html"), "utf8");
    const loaded = [...index.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((match) => match[1]!);
    expect(loaded.length).toBeGreaterThan(0);
    for (const name of loaded) expect({ name, privy: readFileSync(join(dist, "assets", name), "utf8").includes("auth.privy.io") }).toEqual({ name, privy: false });
    const host = readdirSync(join(dist, "assets")).filter((name) => /^privy-host-.*\.js$/.test(name));
    expect(host.length).toBe(1);
  });

  test("files stay files; a missing file is a 404, never the index", () => {
    const script = readdirSync(join(dist, "assets")).find((name) => name.endsWith(".js"))!;
    const asset = serve(`/assets/${script}`);
    expect(asset.file).toBe(join(dist, "assets", script));
    expect(asset.headers["Cache-Control"]).toBe("public, max-age=31536000, immutable");
    expect(serve("/ahand-logo-dark.svg").file).toBe(join(dist, "ahand-logo-dark.svg"));
    expect(serve("/assets/gone.js").status).toBe(404);
    expect(serve("/build.json").status).toBe(404); // in this scratch build; Vercel's build writes it (next test)
    expect(serve("/favicon.ico").status).toBe(404);
  });

  test("Core's real deployment file, once there, gives the build its block, commit and dirty flag, and must name the same Core", () => {
    const base = JSON.parse(readFileSync(PUBLIC_CONFIG, "utf8"));
    const deployment = {
      chainId: 84532, core: base.cores.canonical, factory: base.deployment.factory, salt: base.deployment.salt,
      initcodeHash: base.deployment.initcodeHash, runtimeHash: `0x${"ab".repeat(32)}`, deployBlock: 61_400_000, tokens: [],
      forwarder: null, accountFactory: null, commit: "c5f6ae0".padEnd(40, "0"), dirty: false,
      solc: "0.8.35", optimizerRuns: 200, evmVersion: "prague", oz: "5.6.1",
    };
    const file = join(scratch, "84532.json");
    writeFileSync(file, JSON.stringify(deployment));
    const merged = publicConfig(PUBLIC_CONFIG, file) as { deployment: { deployBlock: number; commit: string; dirty: boolean } };
    expect(merged.deployment).toEqual({ ...base.deployment, deployBlock: 61_400_000, commit: deployment.commit, dirty: false });
    writeFileSync(file, JSON.stringify({ ...deployment, core: "0x0000000000000000000000000000000000000001" }));
    expect(() => publicConfig(PUBLIC_CONFIG, file)).toThrow(/names Core/);
    expect(publicConfig(PUBLIC_CONFIG, join(scratch, "none.json"))).toEqual(base);
  });

  test("a Bun older than 1.3.2 stops the build, and so does an exit.html that names a file it does not carry", () => {
    // Bun 1.2.x installs bun.lock hoisted: the build passes, but exit.html keeps url(../node_modules/@fontsource…).
    expect(bunProblem("1.2.23")).toContain(`older than ${MIN_BUN}`);
    expect(bunProblem("1.3.1")).toBeDefined();
    expect(bunProblem("1.3.2")).toBeUndefined();
    expect(bunProblem("1.4.4")).toBeUndefined();
    expect(bunProblem()).toBeUndefined();
    expect(exitProblem(readFileSync(join(dist, "exit.html"), "utf8"))).toBeUndefined();
    expect(readFileSync(join(dist, "exit.html"), "utf8")).toContain("data:font/woff2");
    expect(exitProblem("<style>@font-face{src:url(../node_modules/@fontsource/ibm-plex-mono/files/x.woff2)}</style>")).toMatch(/does not carry/);
    expect(exitProblem("<style>@font-face{src:url('../fonts/x.woff2')}</style>")).toMatch(/does not carry/);
    expect(exitProblem("<script>import('/node_modules/x.js')</script>")).toMatch(/node_modules/);
  });

  test("build.json is a file, never the index, and is asked for fresh", () => {
    const rule = vercel.headers.find((h: { source: string }) => h.source === "/build.json");
    expect(rule.headers).toEqual([{ key: "Cache-Control", value: "no-cache" }]);
  });
});

describe("link previews: a Hand's address and its card reach face's Vercel Function", () => {
  const HANDS = ["/84532/12", "/84532/0x65ac707e2ae7392583de5d6192c619f1d8862309/12", "/84532/0x65AC707E2AE7392583DE5D6192C619F1D8862309/12", "/31337/1", "/1/99"];
  const CARDS = ["/og/generic.png", "/og/84532/12.png", "/og/84532/0x65ac707e2ae7392583de5d6192c619f1d8862309/12.png"];

  test("the function's files are exactly what the generator writes, and the configuration says previews", () => {
    for (const [path, text] of Object.entries(functionFiles())) expect(readFileSync(join(VERCEL_ROOT, path), "utf8")).toBe(text);
    expect(readFileSync(join(VERCEL_ROOT, FUNCTION_ENTRY), "utf8")).toContain(`export { default } from "../${FUNCTION_DIR}/handler.mjs";`);
    expect(JSON.parse(readFileSync(join(VERCEL_ROOT, "api/package.json"), "utf8"))).toEqual({ private: true, type: "module", engines: { node: "24.x" } });
    expect(config.previews).toBe(true);
    expect(vercel.functions).toEqual({ [FUNCTION_ENTRY]: { includeFiles: `${FUNCTION_DIR}/**`, maxDuration: 10 } });
  });

  test("Vercel's route compiler sends Hands' addresses and cards to the function, with the app's headers; everything else stays as before", () => {
    const app = appOf();
    for (const path of [...HANDS, ...CARDS]) {
      const answer = serve(path);
      expect({ path, status: answer.status, fn: answer.fn }).toEqual({ path, status: 200, fn: true });
      expect(answer.headers).toEqual(app);
    }
    // Not a Hand's address: the app as built, or a 404 for a file that is not there.
    for (const path of ["/84532/12/proof", "/84532/12/", "/84532/0x65ac/12", "/84532/-1", "/og", "/og/84532/12"]) {
      expect({ path, ...serve(path) }).toMatchObject({ path, status: 200, file: join(dist, "index.html") });
    }
    for (const path of ["/og/84532/12.jpg", "/og/whatever.png", "/og/84532/12/proof.png", "/og/generic.png.map"]) expect({ path, status: serve(path).status }).toEqual({ path, status: 404 });
    // A file of the build is never the function's, whatever its name.
    expect(serve("/index.html").file).toBe(join(dist, "index.html"));
  });

  test("a static-only host (previews false) has no function and no rewrite to it", () => {
    const exit = readFileSync(join(dist, "exit.html"), "utf8");
    const off = vercelJson({ ...config, previews: false }, exit);
    expect(off.rewrites).toEqual([{ source: APP_PATHS, destination: "/index.html" }]);
    expect("functions" in off).toBe(false);
    const on = vercelJson({ ...config, previews: undefined }, exit);
    expect(on.rewrites.map((rule) => rule.destination)).toEqual([FUNCTION_URL, FUNCTION_URL, "/index.html"]);
  });
});

describe("face's Vercel Function, called with Requests as Vercel's Node.js runtime calls it", () => {
  const SITE = "https://exp-e2e.ahand.in";
  const raiser = ANVIL_KEYS[1]!;
  let chain: Chain;
  let handle: (request: Request) => Promise<Response>;
  let index: string;
  const raise = (opts: RaiseOptions) => raiseHand(chain, SITE, raiser, opts);
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await handle(new Request(`${SITE}${path}`, init));
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { response, status: response.status, bytes, text: new TextDecoder().decode(bytes), header: (name: string) => response.headers.get(name) };
  };
  /** The page with face's tags taken out and the built title put back: must be index.html byte for byte. */
  const untagged = (page: string) =>
    page.replace(/ {4}<meta (?:property|name)="[^"]*" content="[^"]*" \/>(?:\n {4}<meta (?:property|name)="[^"]*" content="[^"]*" \/>)*\n {2}(?=<\/head>)/, "").replace(/<title>[\s\S]*?<\/title>/, "<title>aHand</title>");
  const GENERIC_TITLE = "Someone raised a hand.";

  beforeAll(async () => {
    chain = await startChain(process.env.VERCEL_TEST_PORT ? { port: Number(process.env.VERCEL_TEST_PORT) } : {});
    index = readFileSync(join(dist, "index.html"), "utf8");
    // Face reads the test chain through its client; everything else is the public configuration's,
    // so the CSP it writes is the one vercel.json sends for the same path.
    const fn: FunctionConfig = { rpc: config.chain.rpcUrls[0], chainId: chain.chainId, trusted: [chain.core], canonical: chain.core, relays: config.relays, privy: true };
    handle = faceFunction(fn, index, { client: chain.client, previewTtlMs: 0 });
  }, 60_000);

  afterAll(async () => {
    await chain?.stop();
  });

  test("an unlisted Hand's address: index.html as built with the Hand's tags, the static site's headers, no-cache", async () => {
    const title = "Looking for a sublet in Yerevan for June";
    const { before } = await raise({ mode: "unlisted", title, content: "Two rooms, near the metro. Hidden from robots.", reward: 40n * USD });
    expect(before).toMatch(/^\/31337\/\d+\?d=[A-Za-z0-9_-]+$/);
    const page = await call(before);
    expect(page.status).toBe(200);
    expect(unescape(metaOf(page.text, "og:title"))).toBe(isolate(title));
    expect(metaOf(page.text, "og:description")).toMatch(/^\$40 reward on chain · open until \d{1,2} [A-Z][a-z]{2}\.$/);
    expect(page.text).not.toContain("Hidden from robots");
    expect(unescape(metaOf(page.text, "og:image"))).toBe(`${SITE}/og${before.replace("?", ".png?")}`);
    expect(unescape(metaOf(page.text, "og:url"))).toBe(`${SITE}${before}`);
    expect(page.text).toContain(`<title>${isolate(title)} · aHand</title>`);
    expect(untagged(page.text)).toBe(index);
    expect(page.header("content-type")).toBe("text/html; charset=utf-8");
    expect(page.header("cache-control")).toBe("no-cache");
    expect(page.header("vary")).toBe("Accept-Language");
    expect(page.header("content-length")).toBe(String(page.bytes.byteLength));
    expect(page.header("strict-transport-security")).toBeNull();
    for (const [name, value] of Object.entries(serve(before.split("?")[0]!).headers)) expect({ name, value: page.header(name) }).toEqual({ name, value });

    const ru = await call(before, { headers: { "Accept-Language": "ru-RU,ru;q=0.9" } });
    expect(metaOf(ru.text, "og:description")).toStartWith("Награда $40 в сети · открыта до ");
    expect(unescape(metaOf(ru.text, "og:image"))).toBe(`${SITE}/og${before.replace("?", ".png?")}&l=ru`);

    const head = await call(before, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.bytes.byteLength).toBe(0);
    expect((await call(before, { method: "POST" })).status).toBe(405);
  });

  test("its card: a 1200×630 PNG kept five minutes, another in dark; the generic card for a wrong d", async () => {
    const { before } = await raise({ mode: "unlisted", title: "A PNG for this hand", reward: 12n * USD });
    const path = `/og${before.replace("?", ".png?")}`;
    const card = await call(path);
    expect(card.status).toBe(200);
    expect(card.header("content-type")).toBe("image/png");
    expect(card.header("cache-control")).toBe("public, max-age=300");
    expect(card.header("vary")).toBe("Accept-Language");
    expect(pngSize(card.bytes)).toEqual({ magic: "89504e470d0a1a0a", width: 1200, height: 630 });
    const dark = await call(`${path}&th=d`);
    expect(pngSize(dark.bytes)).toMatchObject({ width: 1200, height: 630 });
    expect(Buffer.from(dark.bytes).equals(Buffer.from(card.bytes))).toBe(false);
    const generic = await call("/og/generic.png");
    expect(pngSize(generic.bytes)).toMatchObject({ width: 1200, height: 630 });
    const wrong = await call(`/og/31337/999999.png?d=AAAA`);
    expect(Buffer.from(wrong.bytes).equals(Buffer.from(generic.bytes))).toBe(true);
  });

  test("a numbered address shows the terms under the generic title; a public Hand its details", async () => {
    const { before } = await raise({ mode: "unlisted", title: "Not for robots without d", reward: 25n * USD });
    const numbered = await call(before.split("?")[0]!);
    expect(unescape(metaOf(numbered.text, "og:title"))).toBe(GENERIC_TITLE);
    expect(metaOf(numbered.text, "og:description")).toStartWith("$25 reward on chain · open until ");
    expect(numbered.text).not.toContain("Not for robots");
    expect(numbered.text).toContain("<title>aHand</title>");

    const open = await raise({ mode: "public", title: "Who can fix a 1978 Vespa?", content: "It stalls at idle.", reward: 0n });
    const page = await call(open.before);
    expect(unescape(metaOf(page.text, "og:title"))).toBe(isolate("Who can fix a 1978 Vespa?"));
    expect(metaOf(page.text, "og:description")).toEndWith(`. The asker wrote: “${isolate("It stalls at idle.")}”`);
  });

  test("an unknown Hand, a mismatching d, a dark Hand, another chain and an untrusted Core: the generic card, 200", async () => {
    const dark = await raise({ mode: "dark", title: "Dark words", reward: 5n * USD });
    expect(dark.before).toBe("/"); // a dark Hand's address carries nothing before `#`: Vercel serves the static index
    const unlisted = await raise({ mode: "unlisted", title: "Tamper with me", reward: 2n * USD });
    const [path, d] = unlisted.before.split("?d=") as [string, string];
    const bytes = fromBase64Url(d);
    bytes[bytes.length - 1] ^= 0x01;
    const darkNumbered = `/31337/${dark.handId}`;
    for (const target of ["/31337/999999", `${path}?d=${toText(bytes)}`, `${darkNumbered}?d=AAAA`, `${path}?d=a&d=b`, "/84532/1", "/1/1", `/31337/0x1111111111111111111111111111111111111111/1`, `/31337/${unlisted.handId}?d=${"A".repeat(20_000)}`]) {
      const page = await call(target);
      expect({ target: target.slice(0, 80), status: page.status }).toEqual({ target: target.slice(0, 80), status: 200 });
      expect(unescape(metaOf(page.text, "og:title"))).toBe(GENERIC_TITLE);
      expect(metaOf(page.text, "og:description")).toBe("Open to see.");
      expect(unescape(metaOf(page.text, "og:image"))).toBe(`${SITE}/og/generic.png`);
      expect(page.text).not.toContain("Tamper with me");
      expect(page.text).not.toContain("Dark words");
      expect(untagged(page.text)).toBe(index);
    }
    // The dark Hand's own number gives its terms only, never its words.
    const terms = await call(darkNumbered);
    expect(metaOf(terms.text, "og:description")).toStartWith("$5 reward on chain · open until ");
    expect(terms.text).not.toContain("Dark words");
    // A card for a huge d is the generic card too.
    const huge = await call(`/og/31337/${unlisted.handId}.png?d=${"A".repeat(20_000)}`);
    expect(Buffer.from(huge.bytes).equals(Buffer.from((await call("/og/generic.png")).bytes))).toBe(true);
  });

  test("hostile words are escaped and isolated: no tag, script or direction control gets out", async () => {
    const title = `</title><script>alert(1)</script>"' & <meta property="og:title" content="pwned"> ‮evil`;
    const { before } = await raise({ mode: "public", title, content: `<img src=x onerror=alert(2)> ‮`, reward: USD });
    const page = await call(before);
    expect(page.status).toBe(200);
    expect(page.text).not.toContain("<script>alert");
    expect(page.text).not.toContain("<img src=x");
    expect(page.text).not.toContain('content="pwned"');
    expect(page.text.match(/<script\b/g)?.length ?? 0).toBe(index.match(/<script\b/g)?.length ?? 0);
    expect(page.text.match(/<title>/g)).toHaveLength(1);
    expect(unescape(metaOf(page.text, "og:title"))).toStartWith("⁨</title><script>");
    expect(unescape(metaOf(page.text, "og:title"))).toEndWith("⁩");
    expect(page.header("content-security-policy")).toBe(serve(before.split("?")[0]!).headers["Content-Security-Policy"]!);
    expect(untagged(page.text)).toBe(index);
    const card = await call(`/og${before.replace("?", ".png?")}`);
    expect(pngSize(card.bytes)).toMatchObject({ width: 1200, height: 630 });
  });

  test("a closed Hand follows the chain: the reward went back", async () => {
    const { handId, before } = await raise({ mode: "unlisted", title: "Short one", reward: 3n * USD, seconds: 3_600 });
    expect(metaOf((await call(before)).text, "og:description")).toStartWith("$3 reward on chain · open until ");
    await (chain.client.request as (a: { method: string; params: unknown[] }) => Promise<unknown>)({ method: "evm_increaseTime", params: [7_200] });
    await (chain.client.request as (a: { method: string; params: unknown[] }) => Promise<unknown>)({ method: "evm_mine", params: [] });
    await send(chain, ANVIL_KEYS[4]!, refundCall(chain.core, handId));
    expect(metaOf((await call(before)).text, "og:description")).toStartWith("The $3 reward went back on ");
  });

  test("the page names the host the visitor asked for (X-Forwarded-Host, as Vercel's proxy sets it), https, and nothing that is not a host", async () => {
    const { before } = await raise({ mode: "unlisted", title: "Which host", reward: USD });
    const viaProxy = await handle(new Request(`http://127.0.0.1:3${before}`, { headers: { "X-Forwarded-Host": "preview-branch.ahand.in" } }));
    expect(unescape(metaOf(await viaProxy.text(), "og:url"))).toBe(`https://preview-branch.ahand.in${before}`);
    const local = await handle(new Request(`http://127.0.0.1:3${before}`));
    expect(unescape(metaOf(await local.text(), "og:image"))).toStartWith("http://127.0.0.1:3/og/");
    const hostile = await handle(new Request(`${SITE}${before}`, { headers: { "X-Forwarded-Host": 'evil.example/"><script>' } }));
    const text = await hostile.text();
    expect(unescape(metaOf(text, "og:url"))).toBe(`${SITE}${before}`);
    expect(text).not.toContain("evil.example");
  });

  test("any other path the function is asked for is index.html as built, untouched", async () => {
    for (const path of ["/api/face", "/raise", "/"]) {
      const page = await call(path);
      expect(page.status).toBe(200);
      expect(page.text).toBe(index);
      expect(page.header("content-security-policy")).toBe(appOf()["Content-Security-Policy"]);
    }
  });
});

describe("the function as Vercel puts it together: the build's folder, traced, alone, under node", () => {
  test("@vercel/nft and includeFiles carry the bundle, index.html, face.json, the fonts and resvg's binary; node draws a card from them", async () => {
    // The Root Directory's layout under a repository of its own: apps/web/api/face.mjs and apps/web/face/.
    const repo = join(scratch, "repo");
    const web = join(repo, "apps/web");
    await stageFunction(configFile, dist, web);
    expect(readFileSync(join(web, FUNCTION_DIR, "index.html"))).toEqual(readFileSync(join(dist, "index.html")));
    expect(JSON.parse(readFileSync(join(web, FUNCTION_DIR, "face.json"), "utf8"))).toEqual({
      FACE_RPC: "https://sepolia.base.org",
      FACE_CHAIN: "84532",
      FACE_CORES: config.cores.canonical,
      FACE_CANONICAL: config.cores.canonical,
      FACE_RELAYS: config.relays.join(","),
      FACE_SITE: config.site,
      FACE_PRIVY: "1",
    });

    // What @vercel/node does: trace the entry from the repository's root (ts, mixed modules), then add includeFiles.
    const { traced, files: list } = await functionFileList(repo, web);
    const files = new Set(list);
    const binary = `apps/web/${FUNCTION_DIR}/node_modules/@resvg/resvg-js-${process.platform}-${process.arch}-gnu/resvgjs.${process.platform}-${process.arch}-gnu.node`;
    expect(traced).toContain(`apps/web/${FUNCTION_DIR}/handler.mjs`);
    expect(traced.some((file) => /^apps\/web\/face\/og-[a-z0-9]+\.mjs$/.test(file))).toBe(true);
    expect(traced).toContain(`apps/web/${FUNCTION_DIR}/node_modules/@resvg/resvg-js/js-binding.js`);
    for (const file of [binary, `apps/web/${FUNCTION_DIR}/index.html`, `apps/web/${FUNCTION_DIR}/face.json`, `apps/web/${FUNCTION_DIR}/fonts/NotoSans-400.ttf`, `apps/web/${FUNCTION_DIR}/og/ahand-mark-light.svg`]) expect(files.has(file)).toBe(true);

    // Those files alone, nothing else of this machine's: node loads the handler and answers.
    const lambda = copyFunction(repo, list, join(scratch, "lambda"));
    const script = join(scratch, "call.mjs");
    writeFileSync(script, `
      const { default: handler } = await import(process.argv[2]);
      const out = { node: process.version };
      const card = await handler.fetch(new Request("https://exp-e2e.ahand.in/og/generic.png"));
      const png = new Uint8Array(await card.arrayBuffer());
      out.card = { status: card.status, type: card.headers.get("content-type"), cache: card.headers.get("cache-control"), width: new DataView(png.buffer).getUint32(16), height: new DataView(png.buffer).getUint32(20), bytes: png.byteLength };
      const page = await handler.fetch(new Request("https://exp-e2e.ahand.in/raise"));
      out.page = { status: page.status, text: await page.text(), csp: page.headers.get("content-security-policy") };
      console.log(JSON.stringify(out));
    `);
    const node = process.env.NODE_BIN ?? "node";
    const run = spawnSync(node, [script, join(lambda, "apps/web", FUNCTION_ENTRY)], { encoding: "utf8", cwd: lambda, timeout: 60_000 });
    expect(run.stderr).toBe("");
    const out = JSON.parse(run.stdout);
    expect(out.card).toMatchObject({ status: 200, type: "image/png", cache: "public, max-age=300", width: 1200, height: 630 });
    expect(out.card.bytes).toBeGreaterThan(10_000);
    expect(out.page.status).toBe(200);
    expect(out.page.text).toBe(readFileSync(join(dist, "index.html"), "utf8"));
    expect(out.page.csp).toBe(appOf()["Content-Security-Policy"]);
  }, 120_000);
});
