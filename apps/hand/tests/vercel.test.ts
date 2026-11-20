import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getTransformedRoutes } from "@vercel/routing-utils";

import { connectSourcesOf, contentSecurityPolicy, inlineScriptHashes as staticHashes } from "../../../infra/stand/static.ts";
import { appHeaders } from "../csp.ts";
import { buildApp, bunProblem, exitProblem, expectedVercelJson, formatJson, MIN_BUN, PUBLIC_CONFIG, publicConfig, VERCEL_JSON, writePublicConfig } from "../vercel.ts";

/**
 * apps/web/vercel.json, the public test deployment's settings (apps/hand/vercel.ts): Vercel reads
 * it before it builds, so its headers are literal. Here a fresh public build is made and the file
 * must be exactly what that build needs: the headers the stand's static server sends for the same
 * configuration, exit.html's own script hash, and routes that Vercel's own route compiler
 * (@vercel/routing-utils) turns into: app paths to index.html, files as they are, a missing file a 404.
 */

const scratch = mkdtempSync(join(tmpdir(), "ahand-vercel-test-"));
const dist = join(scratch, "dist");
const configFile = writePublicConfig(join(scratch, "config"));
const config = JSON.parse(readFileSync(configFile, "utf8"));
const vercel = JSON.parse(readFileSync(VERCEL_JSON, "utf8"));

beforeAll(() => {
  buildApp(configFile, dist, join(scratch, "vite"));
}, 120_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type Route = { src?: string; dest?: string; headers?: Record<string, string>; continue?: boolean; check?: boolean; status?: number; handle?: string };

/** One request through Vercel's routes as it applies them: header rules, then the filesystem, then rewrites. */
function serve(path: string): { status: number; file?: string; headers: Record<string, string> } {
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
      const file = isFile(route.dest.split("?")[0]!);
      if (file) return { status: 200, file, headers };
    }
  }
  return { status: 404, headers };
}

describe("apps/web/vercel.json (the public test deployment)", () => {
  test("is exactly what a fresh public build needs: bun apps/hand/vercel.ts write", () => {
    expect(readFileSync(VERCEL_JSON, "utf8")).toBe(formatJson(expectedVercelJson(dist, configFile)));
  });

  test("builds the right app where Vercel serves it, with no gallery and no dev wallet", () => {
    expect(vercel.framework).toBeNull();
    expect(vercel.outputDirectory).toBe("dist");
    expect(vercel.installCommand).toBe("cd ../.. && bun install --frozen-lockfile");
    expect(vercel.buildCommand).toBe("cd ../.. && bun apps/hand/vercel.ts build");
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
    const app = appHeaders({ rpcUrls: config.chain.rpcUrls, relays: config.relays });
    expect(app["Content-Security-Policy"]).toBe(contentSecurityPolicy(connect));
    for (const path of ["/", "/raise", "/84532/12", "/84532/0x65ac707E2AE7392583de5d6192C619F1D8862309/12", "/84532/12/proof", "/my", "/my/84532/3", "/pass", "/give", "/thank", "/waiting", "/check", "/core", "/care/84532/1", "/print", "/limits", "/defaults", "/without-us", "/nowhere/at/all"]) {
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
