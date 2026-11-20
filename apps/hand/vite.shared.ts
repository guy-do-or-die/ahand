import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { defaultClientConditions, type Plugin } from "vite";

import { appHeaders, cspMetaTag, type CspSources } from "./csp.ts";
import { localChainProblem } from "./src/config/local.ts";

/**
 * What both Vite builds share (ARCHITECTURE §14):
 * - AHAND_CONFIG: the app's configuration file, exposed as `virtual:ahand-config`
 *   (default: src/config/config.example.json);
 * - AHAND_OUT_DIR: both builds' output folder (default: dist);
 * - AHAND_VITE_CACHE: Vite's dependency cache (default: node_modules/.vite);
 * - the workspace packages (@ahand/sdk, abi, deliver) read from their TypeScript sources by alias.
 *   Not by the `source` export condition: that condition applies to every package, and
 *   nostr-tools 2.26.1 declares `source` entries (./utils.ts, ./nip44.ts, …) its published
 *   package does not ship, so @ahand/deliver could not load in dev or in the build.
 */

const here = import.meta.dirname;

function fromRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(here, path);
}

export const configFile = fromRoot(process.env.AHAND_CONFIG || "src/config/config.example.json");
export const outDir = fromRoot(process.env.AHAND_OUT_DIR || "dist");
export const cacheDir = fromRoot(process.env.AHAND_VITE_CACHE || "node_modules/.vite");
export const conditions = [...defaultClientConditions];
export const workspaceAlias = [
  { find: /^@ahand\/(sdk|abi|deliver)$/, replacement: resolve(here, "../../packages/$1/src/index.ts") },
];

/**
 * Whether the configuration names a local chain, read once when Vite loads its config. The main
 * build turns it into the `__AHAND_LOCAL__` define, so a public build drops the local-only
 * screens (dev wallet, gallery redirect) from its output, not only from its routes.
 */
export function isLocalChain(file: string = configFile): boolean {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { chain?: { id?: unknown; local?: unknown } };
  // A local build ships anvil's public mnemonic: refuse it for any chain but anvil's own.
  const problem = localChainProblem(parsed.chain);
  if (problem) throw new Error(`${file}: ${problem}`);
  return parsed.chain?.local === true;
}

const VIRTUAL = "virtual:ahand-config";
const RESOLVED = `\0${VIRTUAL}`;

export function ahandConfig(): Plugin {
  return {
    name: "ahand-config",
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return undefined;
      this.addWatchFile(configFile);
      // Parsed and re-serialised, so the module is plain data whatever the file's formatting.
      const parsed: unknown = JSON.parse(readFileSync(configFile, "utf8"));
      return `export default ${JSON.stringify(parsed)};`;
    },
  };
}

/** The RPC and relay addresses of the configuration: the only places the built app may connect to. */
export function cspSources(): CspSources {
  const parsed = JSON.parse(readFileSync(configFile, "utf8")) as { chain?: { rpcUrls?: unknown }; relays?: unknown };
  const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  return { rpcUrls: list(parsed.chain?.rpcUrls), relays: list(parsed.relays) };
}

/** The headers `vite preview` sends: the same CSP, Referrer-Policy and nosniff as face. */
export function previewHeaders(): Record<string, string> {
  return appHeaders(cspSources());
}

/**
 * Writes the CSP of ARCHITECTURE §11 into every built HTML page of the main build as a `<meta>`
 * tag, right after the referrer tag, for hosts that send no headers. Build only: the dev server
 * needs inline scripts for React's refresh. exit.html (the second build) has none: it is meant to
 * run from any host or from disk against an RPC its reader types, and face and static.ts send it
 * a header that names its inline script's hash.
 */
export function cspMeta(): Plugin {
  return {
    name: "ahand-csp-meta",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const tag = cspMetaTag(cspSources());
        const anchor = /<meta name="referrer"[^>]*>/;
        if (!anchor.test(html)) throw new Error("ahand-csp-meta: the page has no referrer meta tag to place the CSP after");
        return html.replace(anchor, (found) => `${found}\n    ${tag}`);
      },
    },
  };
}
