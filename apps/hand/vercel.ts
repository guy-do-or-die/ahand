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
 *
 * Link previews (the configuration's `previews`, absent or true): a Hand's address
 * (`/<chain>/<hand>`, `/<chain>/<core>/<hand>`) and its card (`/og/….png`) are rewritten to one
 * Vercel Function, apps/web/api/face.mjs, before the rule that gives every other app path
 * index.html. That file only re-exports apps/web/face/handler.mjs, which the build bundles from
 * face (apps/face/src/function-entry.ts, `faceFunction`) with Bun, beside the built index.html,
 * face's settings (face.json), its fonts and lockup, and resvg's prebuilt binary; `functions`
 * names that folder in `includeFiles`. With `previews` false the site is static only: no rewrite
 * reaches the function. Vercel runs the build command before it traces a function (its frontend
 * builder runs first), so the folder is there when the function is put together.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

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

/**
 * A Hand's address as face reads it (apps/face/src/preview.ts HAND_PATH), and its card (server.ts
 * OG_PATH, generic.png too). Unnamed groups, so Vercel adds nothing to the query: `d` arrives as written.
 */
export const HAND_PATHS = "/([0-9]+/(?:0x[0-9a-fA-F]{40}/)?[0-9]+)";
export const CARD_PATHS = "/og/(generic|[0-9]+/(?:0x[0-9a-fA-F]{40}/)?[0-9]+)\\.png";

/** The Vercel Function (Root Directory relative), the URL it answers on, and the folder the build fills for it. */
export const FUNCTION_ENTRY = "api/face.mjs";
export const FUNCTION_URL = "/api/face";
export const FUNCTION_DIR = "face";
/** How long one answer may take: a cold card is under a second, a chain read gives up after 4 s (preview.ts). */
export const FUNCTION_MAX_SECONDS = 10;
export const FACE_DIR = join(REPO_ROOT, "apps/face");

interface PublicConfig {
  chain: { id: number; local?: boolean; rpcUrls: string[] };
  cores: { trusted: { chainId: number; core: string }[]; canonical?: string };
  relays: string[];
  site: string;
  previews?: boolean;
  /** Email sign-in through Privy: the app's pages name Privy's sources in their CSP, exit.html never. */
  privy?: { appId: string } | null;
}

/** Whether this build answers a Hand's address with face's tags and card (absent means yes). */
export function previewsOn(config: Pick<PublicConfig, "previews">): boolean {
  return config.previews !== false;
}

/** Whether this build logs in through Privy. */
export function privyOn(config: Pick<PublicConfig, "privy">): boolean {
  return typeof config.privy === "object" && config.privy !== null;
}

function sourcesOf(config: PublicConfig): CspSources {
  return { rpcUrls: config.chain.rpcUrls, relays: config.relays, ...(privyOn(config) ? { privy: true } : {}) };
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
 * Never Privy's sources: exit.html carries no sign-in, only the reader's own wallet.
 */
export function exitCsp(sources: CspSources, exitHtml: string): string {
  const inline = inlineScriptHashes(exitHtml);
  return appCsp({ rpcUrls: sources.rpcUrls, relays: sources.relays }, "header")
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
    installCommand: `cd ../.. && npx -y bun@${BUN} install --frozen-lockfile`,
    buildCommand: `cd ../.. && npx -y bun@${BUN} apps/hand/vercel.ts build`,
    outputDirectory: VERCEL_OUT,
    ...(previewsOn(config) ? { functions: { [FUNCTION_ENTRY]: { includeFiles: `${FUNCTION_DIR}/**`, maxDuration: FUNCTION_MAX_SECONDS } } } : {}),
    rewrites: [
      ...(previewsOn(config)
        ? [
            { source: HAND_PATHS, destination: FUNCTION_URL },
            { source: CARD_PATHS, destination: FUNCTION_URL },
          ]
        : []),
      { source: APP_PATHS, destination: "/index.html" },
    ],
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

/**
 * The oldest Bun that installs this repository as it is locked: bun.lock carries `configVersion`,
 * which Bun 1.3.2 and later read as the isolated linker. An older Bun ignores it and installs
 * hoisted; the build still passes, but exit.html's fonts no longer resolve and stay as relative
 * node_modules URLs that 404 on the site. Vercel names only "Bun 1" for its build image.
 */
export const MIN_BUN = "1.3.2";

/**
 * The Bun that installs and builds the public site: the one CI pins (.github/workflows/check.yml,
 * setup-bun) and the one bun.lock is written with. Vercel's build image carries its own Bun 1.x
 * (1.3.14 on 2026-11-21), which rewrites a lockfile made by 1.4 (it drops `libc` and adds
 * `hasInstallScript`) and so refuses `--frozen-lockfile`; npx fetches this exact one instead.
 */
export const BUN = "1.4.4";

/** Why this Bun cannot make the public build, or undefined when it can. */
export function bunProblem(version: string = Bun.version): string | undefined {
  if (Bun.semver.order(version, MIN_BUN) >= 0) return undefined;
  return `Bun ${version} is older than ${MIN_BUN}: it installs bun.lock hoisted and exit.html loses its fonts. Run the commands vercel.json names (npx -y bun@${BUN} …)`;
}

/**
 * What is wrong with a built exit.html, or undefined. It is one file that works saved to a disk:
 * every font and image is inlined, so a URL that climbs out of the page (`url(../…)`) or names
 * node_modules is a file the build did not resolve, and the saved page would draw without it.
 */
export function exitProblem(html: string): string | undefined {
  const climbing = html.match(/url\(\s*['"]?\.\.\/[^)]*\)/);
  if (climbing) return `exit.html refers to a file it does not carry: ${climbing[0].slice(0, 120)}`;
  const at = html.indexOf("node_modules");
  if (at >= 0) return `exit.html names node_modules: …${html.slice(Math.max(0, at - 60), at + 60)}…`;
  return undefined;
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
  const exit = exitProblem(readFileSync(join(outDir, "exit.html"), "utf8"));
  if (exit) throw new Error(exit);
}

/**
 * Face's settings for the function, as the FACE_* names of apps/face/src/config.ts: the
 * configuration's one RPC (face's CSP names only that one, so the page's header stays the static
 * one), the chain, the Cores it trusts on that chain, the canonical Core and the relays, and
 * FACE_PRIVY when the app signs in by email through Privy (face's CSP then names Privy, as the page's meta tag does).
 */
export function faceEnvOf(config: PublicConfig): Record<string, string> {
  if (config.chain.rpcUrls.length !== 1) throw new Error("face reads one RPC, and its CSP would name only that one: the public configuration must have exactly one");
  const cores = config.cores.trusted.filter((entry) => entry.chainId === config.chain.id).map((entry) => entry.core);
  if (cores.length === 0) throw new Error(`the public configuration trusts no Core on chain ${config.chain.id}`);
  return {
    FACE_RPC: config.chain.rpcUrls[0]!,
    FACE_CHAIN: String(config.chain.id),
    FACE_CORES: cores.join(","),
    FACE_CANONICAL: config.cores.canonical ?? "",
    FACE_RELAYS: config.relays.join(","),
    FACE_SITE: config.site,
    ...(privyOn(config) ? { FACE_PRIVY: "1" } : {}),
  };
}

/** apps/web/api/face.mjs: the function Vercel finds, a thin re-export of the bundle the build makes. */
export const FUNCTION_SOURCE = `// The Vercel Function of the public test deployment: face's link previews for a Hand's address
// and its card (docs/public-test-deployment.md). Written by \`bun apps/hand/vercel.ts write\`;
// ../face/ is made by the build command (apps/hand/vercel.ts buildFunction) before Vercel traces this file.
export { default } from "../${FUNCTION_DIR}/handler.mjs";
`;

/**
 * apps/web/api/package.json: the function's own package, so Vercel's Node.js builder, which installs
 * the nearest package.json, installs nothing (apps/web/package.json is the old app's) and runs it
 * on Node.js 24 as ES modules.
 */
export const FUNCTION_PACKAGE = formatJson({ private: true, type: "module", engines: { node: "24.x" } });

/** The files under the Root Directory that `write` makes besides vercel.json, and what they hold. */
export function functionFiles(): Record<string, string> {
  return { [FUNCTION_ENTRY]: FUNCTION_SOURCE, [join(dirname(FUNCTION_ENTRY), "package.json")]: FUNCTION_PACKAGE };
}

/**
 * resvg's JavaScript and every prebuilt binary installed beside it (bun.lock installs the ones for
 * this machine: on Vercel's build image linux-x64-gnu), copied as files, for the bundle to require.
 */
function copyResvg(outDir: string): string[] {
  const own = dirname(realpathSync(createRequire(join(FACE_DIR, "package.json")).resolve("@resvg/resvg-js/package.json")));
  const scope = dirname(own);
  const names = readdirSync(scope).filter((name) => name === basename(own) || name.startsWith(`${basename(own)}-`));
  for (const name of names) cpSync(join(scope, name), join(outDir, "node_modules/@resvg", name), { recursive: true, dereference: true });
  const binaries = names.filter((name) => name.startsWith(`resvg-js-${process.platform}-${process.arch}`));
  if (binaries.length === 0) throw new Error(`no prebuilt resvg for ${process.platform}-${process.arch} next to ${own}`);
  return binaries;
}

/**
 * The function's folder (apps/web/face on Vercel): face bundled for Node.js by Bun (one entry,
 * handler.mjs, and chunks; og.tsx and resvg load with the first card), the built index.html as
 * it is, face.json, face's fonts and lockup, and resvg. `distDir` is the build the site serves.
 */
export async function buildFunction(configFile: string, distDir: string, outDir: string): Promise<void> {
  const config = JSON.parse(readFileSync(configFile, "utf8")) as PublicConfig;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const built = await Bun.build({
    entrypoints: [join(FACE_DIR, "src/function-entry.ts")],
    target: "node",
    format: "esm",
    splitting: true,
    outdir: outDir,
    naming: { entry: "handler.mjs", chunk: "[name]-[hash].mjs" },
    // Workspace packages export their TypeScript under "source"; resvg is native and copied as files.
    conditions: ["source"],
    external: ["@resvg/resvg-js"],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!built.success) throw new Error(`face's function did not bundle: ${built.logs.map(String).join("\n")}`);
  cpSync(join(FACE_DIR, "src/fonts"), join(outDir, "fonts"), { recursive: true });
  cpSync(join(FACE_DIR, "src/og"), join(outDir, "og"), { recursive: true });
  cpSync(join(distDir, "index.html"), join(outDir, "index.html"));
  writeFileSync(join(outDir, "face.json"), formatJson(faceEnvOf(config)));
  copyResvg(outDir);
}

/**
 * The Root Directory's part of the function, put together in `webDir` (a stand-in for apps/web):
 * the generated api files and the build's folder for them. What a Vercel build has before it traces.
 */
export async function stageFunction(configFile: string, distDir: string, webDir: string): Promise<void> {
  await buildFunction(configFile, distDir, join(webDir, FUNCTION_DIR));
  for (const [path, text] of Object.entries(functionFiles())) {
    mkdirSync(dirname(join(webDir, path)), { recursive: true });
    writeFileSync(join(webDir, path), text);
  }
}

function filesUnder(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path, base));
    else out.push(path.slice(base.length + 1));
  }
  return out;
}

/**
 * The files Vercel's Node.js builder (@vercel/node) puts into the function, gathered the same way:
 * @vercel/nft traces the entry from the repository's root (`ts`, `mixedModules`, the Root
 * Directory as the process's folder), and `includeFiles` (the build's folder) is added whole.
 * Paths are relative to `repoDir`; `traced` is what the tracer found on its own.
 */
export async function functionFileList(repoDir: string, webDir: string): Promise<{ traced: string[]; files: string[] }> {
  const { nodeFileTrace } = await import("@vercel/nft");
  const { fileList } = await nodeFileTrace([join(webDir, FUNCTION_ENTRY)], { base: repoDir, processCwd: webDir, ts: true, mixedModules: true });
  const traced = [...fileList].sort();
  const files = [...new Set([...traced, ...filesUnder(join(webDir, FUNCTION_DIR), repoDir)])].sort();
  return { traced, files };
}

/** Copies `files` (relative to `repoDir`) into `outDir`, as the function's own file system: nothing else of this machine. */
export function copyFunction(repoDir: string, files: string[], outDir: string): string {
  rmSync(outDir, { recursive: true, force: true });
  for (const file of files) cpSync(join(repoDir, file), join(outDir, file), { dereference: true });
  return outDir;
}

/** What `vercel.json` should be for a fresh public build in `outDir`. */
export function expectedVercelJson(outDir: string, configFile = PUBLIC_CONFIG) {
  const config = JSON.parse(readFileSync(configFile, "utf8")) as PublicConfig;
  return vercelJson(config, readFileSync(join(outDir, "exit.html"), "utf8"));
}

export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main(argv: string[]): Promise<number> {
  const [command] = argv;
  if (command === "build") {
    console.log(`vercel: bun ${Bun.version}`);
    const old = bunProblem();
    if (old) {
      console.error(`vercel: ${old}`);
      return 1;
    }
    const out = join(VERCEL_ROOT, VERCEL_OUT);
    rmSync(out, { recursive: true, force: true });
    const scratch = mkdtempSync(join(tmpdir(), "ahand-vercel-"));
    const configFile = writePublicConfig(scratch);
    buildApp(configFile, out);
    const record = buildRecord(out);
    writeFileSync(join(out, "build.json"), formatJson(record));
    console.log(`vercel: built ${record.files.length} files into ${out}, hash ${record.hash}, commit ${record.commit ?? "unknown"}${record.dirty ? " (dirty)" : ""}`);
    const functionDir = join(VERCEL_ROOT, FUNCTION_DIR);
    await buildFunction(configFile, out, functionDir);
    console.log(`vercel: face's function bundled into ${functionDir} for ${FUNCTION_ENTRY}`);
    const want = formatJson(expectedVercelJson(out, configFile));
    rmSync(scratch, { recursive: true, force: true });
    const have = existsSync(VERCEL_JSON) ? readFileSync(VERCEL_JSON, "utf8") : "";
    const stale = Object.entries(functionFiles()).filter(([path, text]) => !existsSync(join(VERCEL_ROOT, path)) || readFileSync(join(VERCEL_ROOT, path), "utf8") !== text);
    if (have !== want || stale.length > 0) {
      console.error(`vercel: ${have !== want ? "apps/web/vercel.json" : stale.map(([path]) => `apps/web/${path}`).join(", ")} is not what this build needs (its headers or its function would not match the pages). Run: bun apps/hand/vercel.ts write`);
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
      for (const [path, text] of Object.entries(functionFiles())) {
        mkdirSync(dirname(join(VERCEL_ROOT, path)), { recursive: true });
        writeFileSync(join(VERCEL_ROOT, path), text);
        console.log(`vercel: wrote ${join(VERCEL_ROOT, path)}`);
      }
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
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    console.error(`vercel: ${(error as Error).message}`);
    process.exit(1);
  }
}
