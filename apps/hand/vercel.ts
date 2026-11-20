/**
 * The public test deployment (docs/public-test-deployment.md): the built app as a static site on
 * Vercel, against Base Sepolia. The repository's Vercel project has its Root Directory at apps/web,
 * so its settings live in apps/web/vercel.json, which this file writes and checks:
 *
 *   bun apps/hand/vercel.ts build   what Vercel's buildCommand runs: builds the app with the
 *                                   public configuration into apps/web/dist, writes build.json
 *                                   beside it, and fails if apps/web/vercel.json is not exactly
 *                                   what this build needs (a stale exit.html hash would block its script)
 *   bun apps/hand/vercel.ts write   builds into a scratch folder and writes apps/web/vercel.json
 *
 * The configuration is apps/hand/src/config/base-sepolia.json; once contracts/deployments/84532.json
 * (Core's real deployment) exists, its block, commit and dirty flag are taken in (`publicConfig`),
 * so after deploying Core run `write` again: exit.html carries the configuration, and its hash moves.
 *
 * Vercel reads vercel.json before it builds, so its headers are literal. They are the headers
 * infra/stand/static.ts and face send for the same configuration (csp.ts `appHeaders`, and for
 * exit.html the CSP with its inline script's hash, any https RPC and data: fonts); `tests/vercel.test.ts`
 * holds the file to them and plays its routes through Vercel's own route compiler.
 *
 * Paths: every app path (no file extension in its last part) serves index.html; a file that exists
 * is served as it is (filesystem first, as Vercel always does); a missing path with an extension
 * is a 404, never the index, as static.ts does.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseDeployment } from "@ahand/abi";

import { buildRecord } from "../../tools/manifest.ts";
import { appCsp, appHeaders, type CspSources } from "./csp.ts";

export const HAND_DIR = import.meta.dirname;
export const REPO_ROOT = resolve(HAND_DIR, "../..");
/** The configuration the public build is made with. */
export const PUBLIC_CONFIG = join(HAND_DIR, "src/config/base-sepolia.json");
/** The real deployment of Core on Base Sepolia, once the owner has made it (contracts/script/deploy.sh). */
export const PUBLIC_DEPLOYMENT = join(REPO_ROOT, "contracts/deployments/84532.json");
/** Vercel's Root Directory for this project, and the file and folder inside it. */
export const VERCEL_ROOT = join(REPO_ROOT, "apps/web");
export const VERCEL_JSON = join(VERCEL_ROOT, "vercel.json");
export const VERCEL_OUT = "dist";

/** Every path whose last part has no dot: the app's own addresses. Unnamed, so Vercel adds no query. */
export const APP_PATHS = "/((?:[^/]*/)*[^/.]*)";

interface PublicConfig {
  chain: { id: number; local?: boolean; rpcUrls: string[] };
  relays: string[];
}

function sourcesOf(config: PublicConfig): CspSources {
  return { rpcUrls: config.chain.rpcUrls, relays: config.relays };
}

/** The sha256 sources of the inline scripts of an HTML file, as CSP writes them (face and static.ts compute the same). */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(match[1]!)) continue;
    const body = match[2]!;
    if (body === "") continue;
    hashes.push(`'sha256-${new Bun.CryptoHasher("sha256").update(body).digest("base64")}'`);
  }
  return hashes;
}

/**
 * exit.html's CSP, as face's `cspFor(…, { inline, anyRpc: true })` writes it: the app's policy with
 * its inline script named by hash, any https RPC or this machine, and the fonts it carries as data:.
 */
export function exitCsp(sources: CspSources, exitHtml: string): string {
  const inline = inlineScriptHashes(exitHtml);
  return appCsp(sources, "header")
    .replace("script-src 'self'", ["script-src 'self'", ...inline].join(" "))
    .replace("font-src 'self'", "font-src 'self' data:")
    .replace(/connect-src ([^;]*)/, (_all, list: string) => `connect-src ${[...new Set([...list.split(" "), "https:", "http://127.0.0.1:*", "http://localhost:*"])].join(" ")}`);
}

type Header = { key: string; value: string };

const asList = (headers: Record<string, string>): Header[] => Object.entries(headers).map(([key, value]) => ({ key, value }));

/** apps/web/vercel.json for a configuration and the exit.html its build made. */
export function vercelJson(config: PublicConfig, exitHtml: string) {
  if (config.chain.local) throw new Error("the public build's configuration names a local chain");
  const headers = appHeaders(sourcesOf(config));
  const { "Content-Security-Policy": csp, ...rest } = headers;
  return {
    $schema: "https://openapi.vercel.sh/vercel.json",
    framework: null,
    installCommand: "cd ../.. && bun install --frozen-lockfile",
    buildCommand: "cd ../.. && bun apps/hand/vercel.ts build",
    outputDirectory: VERCEL_OUT,
    rewrites: [{ source: APP_PATHS, destination: "/index.html" }],
    headers: [
      { source: "/(.*)", headers: asList(rest) },
      { source: "/((?!exit\\.html$).*)", headers: asList({ "Content-Security-Policy": csp! }) },
      { source: "/exit.html", headers: asList({ "Content-Security-Policy": exitCsp(sourcesOf(config), exitHtml) }) },
      { source: "/assets/(.*)", headers: asList({ "Cache-Control": "public, max-age=31536000, immutable" }) },
      { source: "/build.json", headers: asList({ "Cache-Control": "no-cache" }) },
    ],
  };
}

/**
 * The configuration the public build is made with: base-sepolia.json, and once Core's real
 * deployment file exists, its block, commit and dirty flag in `deployment` (so /core names the
 * commit Core was built from). The file must describe the very Core the configuration names, or
 * the build stops.
 */
export function publicConfig(configFile = PUBLIC_CONFIG, deploymentFile = PUBLIC_DEPLOYMENT): Record<string, unknown> {
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  if (!existsSync(deploymentFile)) return config;
  const deployment = parseDeployment(JSON.parse(readFileSync(deploymentFile, "utf8")));
  const facts = config.deployment;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (deployment.chainId !== config.chain.id) throw new Error(`${deploymentFile} is for chain ${deployment.chainId}, the configuration for ${config.chain.id}`);
  if (!same(deployment.core, config.cores.canonical)) throw new Error(`${deploymentFile} names Core ${deployment.core}, the configuration ${config.cores.canonical}`);
  for (const key of ["factory", "salt", "initcodeHash"] as const) {
    if (!same(deployment[key], facts[key])) throw new Error(`${deploymentFile} has another ${key} than the configuration: ${deployment[key]}`);
  }
  return {
    ...config,
    deployment: { ...facts, deployBlock: deployment.deployBlock, commit: deployment.commit ?? "", dirty: deployment.dirty ?? false },
  };
}

/** Writes `publicConfig()` into `dir` and returns the file's path. */
export function writePublicConfig(dir: string, configFile = PUBLIC_CONFIG, deploymentFile = PUBLIC_DEPLOYMENT): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "config.json");
  writeFileSync(file, formatJson(publicConfig(configFile, deploymentFile)));
  return file;
}

/** Builds the app with `configFile` into `outDir` (index and exit; no gallery: a public build has none). */
export function buildApp(configFile: string, outDir: string, cacheDir?: string): void {
  const run = spawnSync(process.execPath, ["run", "build"], {
    cwd: HAND_DIR,
    env: { ...process.env, AHAND_CONFIG: configFile, AHAND_OUT_DIR: outDir, ...(cacheDir ? { AHAND_VITE_CACHE: cacheDir } : {}) },
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (run.status !== 0) throw new Error(`the app's build failed (exit ${run.status})`);
  for (const page of ["index.html", "exit.html"]) {
    if (!existsSync(join(outDir, page))) throw new Error(`the build made no ${page} in ${outDir}`);
  }
  if (existsSync(join(outDir, "gallery.html"))) throw new Error("a public build must not carry the gallery");
}

/** What `vercel.json` should be for a fresh public build in `outDir`. */
export function expectedVercelJson(outDir: string, configFile = PUBLIC_CONFIG) {
  const config = JSON.parse(readFileSync(configFile, "utf8")) as PublicConfig;
  return vercelJson(config, readFileSync(join(outDir, "exit.html"), "utf8"));
}

export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function main(argv: string[]): number {
  const [command] = argv;
  if (command === "build") {
    const out = join(VERCEL_ROOT, VERCEL_OUT);
    rmSync(out, { recursive: true, force: true });
    const scratch = mkdtempSync(join(tmpdir(), "ahand-vercel-"));
    const configFile = writePublicConfig(scratch);
    buildApp(configFile, out);
    const record = buildRecord(out);
    writeFileSync(join(out, "build.json"), formatJson(record));
    console.log(`vercel: built ${record.files.length} files into ${out}, hash ${record.hash}, commit ${record.commit ?? "unknown"}${record.dirty ? " (dirty)" : ""}`);
    const want = formatJson(expectedVercelJson(out, configFile));
    rmSync(scratch, { recursive: true, force: true });
    const have = existsSync(VERCEL_JSON) ? readFileSync(VERCEL_JSON, "utf8") : "";
    if (have !== want) {
      console.error("vercel: apps/web/vercel.json is not what this build needs (its headers would not match the pages). Run: bun apps/hand/vercel.ts write");
      return 1;
    }
    return 0;
  }
  if (command === "write") {
    const scratch = mkdtempSync(join(tmpdir(), "ahand-vercel-"));
    try {
      const configFile = writePublicConfig(scratch);
      buildApp(configFile, join(scratch, "dist"), join(scratch, "vite"));
      writeFileSync(VERCEL_JSON, formatJson(expectedVercelJson(join(scratch, "dist"), configFile)));
      console.log(`vercel: wrote ${VERCEL_JSON}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    return 0;
  }
  console.error("usage: bun apps/hand/vercel.ts build | write");
  return 2;
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`vercel: ${(error as Error).message}`);
    process.exit(1);
  }
}
