/**
 * The bundle audit (harden-app): reads a built app folder and fails on
 *  - any http(s)/ws(s) address that is not the configured RPC, relay or site, a markup namespace,
 *    or one of the library texts listed below (strings that are never fetched);
 *  - a source map, or a `sourceMappingURL` comment, that would ship;
 *  - anvil's public test mnemonic or any of its ten keys, when the configuration is not local;
 *  - the gallery (gallery.html, assets/gallery-*) or the dev wallet's chunk (assets/dev-*), when
 *    the configuration is not local;
 *  - an HTML page of the main build without the CSP `<meta>` tag.
 *
 * Privy's SDK (email, wallet/privy-host.tsx) is the one third-party library whose text names many
 * other services (wallet apps, WalletConnect, explorers). When the configuration has `privy`, the
 * chunks only privy-host-*.js reaches, and that no page loads before email is picked
 * (`privySdkFiles`), are listed as Privy's and their addresses are not findings: at run time the
 * CSP lets that code reach Privy's sign-in frame and API only. Every chunk a page loads without
 * email is audited as before, and a build without `privy` may carry no Privy chunk at all.
 *
 *   bun apps/web/tests/bundle/audit.ts <dist folder> <config.json>
 *
 * Exit 0 when clean; otherwise it prints each finding and exits 1. Only addresses are printed.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { bytesToHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

import { KNOWN_CHAINS } from "../../src/config/chains.ts";
import { PRIVY_CSP } from "../../csp.ts";

/** anvil's public test mnemonic (the dev wallet's, local builds only). */
export const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

/** anvil's ten public test keys, derived here rather than copied, without the 0x. */
export function anvilKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < 10; index++) {
    const key = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index }).getHdKey().privateKey;
    if (!key) throw new Error("no key derived");
    keys.push(bytesToHex(key).slice(2));
  }
  return keys;
}

/**
 * Origins that appear in the bundle only as text of the libraries the app ships, with where each
 * comes from. None is ever requested by the app, and the CSP's connect-src would refuse it if it were.
 */
export const LIBRARY_TEXT: Readonly<Record<string, string>> = {
  "http://www.w3.org": "XML and SVG namespace names (React, the QR and logo SVGs)",
  "https://viem.sh": "viem's error messages: documentation links",
  "https://oxlib.sh": "ox's error messages (under viem): documentation links",
  "https://abitype.dev": "abitype's error messages (under viem): documentation links",
  "https://wagmi.sh": "wagmi's error messages: documentation links",
  "https://react.dev": "React's production error message: a documentation link",
  "https://tailwindcss.com": "Tailwind's licence comment in the CSS",
  "https://docs.soliditylang.org": "viem's error messages: a documentation link",
  "https://4byte.sourcify.dev": "viem's error message for an unknown revert: a look-up hint, never fetched",
  "https://ipfs.io": "viem's ENS avatar parser default gateway: the app never reads an avatar",
  "https://arweave.net": "viem's ENS avatar parser default gateway: the app never reads an avatar",
};

/**
 * Origins in viem/chains' descriptions of the networks aHand knows (src/config/chains.ts): their
 * public RPCs, explorers and explorer APIs. The bundle carries all of them so the configuration can
 * name any of those chains by id. None is ever requested: chainOf puts the configured RPC in place
 * of viem's, an explorer is only a link, and the CSP's connect-src names the configured RPC alone.
 * Read from the same objects the app ships, so a viem upgrade that changes one moves this list too.
 */
export const CHAIN_TEXT: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    KNOWN_CHAINS.flatMap((chain) => {
      const urls = [...Object.values(chain.rpcUrls).flatMap((r) => [...r.http, ...(r.webSocket ?? [])]), ...Object.values(chain.blockExplorers ?? {}).flatMap((e) => [e.url, ...(e.apiUrl ? [e.apiUrl] : [])])];
      return urls.map((url) => [new URL(url).origin, `viem/chains' description of ${chain.name} (${chain.id}), never requested`] as const);
    }),
  ),
);

/** exit.html's own text: the one-line local web server command it prints for a page opened from disk. */
const EXIT_LOCAL_HINT = "http://127.0.0.1:";

export interface AuditConfig {
  chain: { rpcUrls: string[]; local: boolean };
  relays: string[];
  site: string;
  /**
   * Logging in through Privy: Privy's own chunks are listed, not audited for addresses, and the
   * site addresses Privy's dashboard allows (`origins`, which the app only compares with its own
   * address) are the configuration's own.
   */
  privy?: { appId?: string; origins?: string[] } | null;
}

/** What the built JavaScript imports: `from"./x.js"`, `import"./x.js"`, `import("./x.js")`, `` import(`./x.js`) ``. */
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'`]\.\/([A-Za-z0-9_.-]+\.js)["'`]/g;
/** The scripts an HTML page loads or preloads. */
const PAGE_SCRIPT = /(?:src|href)="\/?assets\/([A-Za-z0-9_.-]+\.js)"/g;
const PRIVY_HOST = /^privy-host-[A-Za-z0-9_-]+\.js$/;

/**
 * The chunks of Privy's SDK in a built folder: everything privy-host-*.js imports, at any depth,
 * that the pages do not reach without it. Preload lists (`__vite__mapDeps`, written as
 * "assets/…") are not imports and are not followed, so naming a chunk there does not make it the app's.
 */
export function privySdkFiles(folder: string): Set<string> {
  const assets = join(folder, "assets");
  if (!existsSync(assets)) return new Set();
  const names = readdirSync(assets).filter((name) => name.endsWith(".js"));
  const imports = new Map(names.map((name) => [name, [...readFileSync(join(assets, name), "utf8").matchAll(IMPORT)].map((m) => m[1]!)]));
  const reach = (roots: string[], skip: (name: string) => boolean) => {
    const seen = new Set<string>();
    const queue = roots.filter((name) => imports.has(name) && !skip(name));
    while (queue.length > 0) {
      const name = queue.pop()!;
      if (seen.has(name)) continue;
      seen.add(name);
      for (const next of imports.get(name) ?? []) if (imports.has(next) && !skip(next) && !seen.has(next)) queue.push(next);
    }
    return seen;
  };
  const pages = readdirSync(folder).filter((name) => name.endsWith(".html"));
  const roots = pages.flatMap((page) => [...readFileSync(join(folder, page), "utf8").matchAll(PAGE_SCRIPT)].map((m) => m[1]!));
  const app = reach(roots, (name) => PRIVY_HOST.test(name));
  const privy = reach(names.filter((name) => PRIVY_HOST.test(name)), () => false);
  return new Set([...privy].filter((name) => !app.has(name)).map((name) => `assets/${name}`));
}

export interface Finding {
  file: string;
  what: string;
}

function filesOf(folder: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) out.push(...filesOf(path));
    else out.push(path);
  }
  return out;
}

/** The local builds' own files: the kit's page and chunk, and the dev wallet's chunk. */
const LOCAL_ONLY = /^(gallery\.html|assets\/(gallery|dev)-[^/]*)$/;
const TEXT = /\.(html|js|mjs|css|json|svg|txt|webmanifest)$/;
const ADDRESS = /\b(?:https?|wss?):\/\/[A-Za-z0-9.-]+(?::\d+)?/g;

export function audit(folder: string, config: AuditConfig): { findings: Finding[]; seen: Map<string, Set<string>> } {
  // With Privy, its sources are the app's too: the CSP (and so the meta tag) names them.
  const privyOrigins = config.privy ? [...PRIVY_CSP.frame, ...PRIVY_CSP.connect, ...PRIVY_CSP.img, ...(config.privy.origins ?? [])].filter((source) => !source.includes("*")) : [];
  const allowed = new Set([...config.chain.rpcUrls, ...config.relays, config.site, ...privyOrigins].map((url) => new URL(url).origin));
  const keys = config.chain.local ? [] : anvilKeys();
  const findings: Finding[] = [];
  const seen = new Map<string, Set<string>>();
  const privySdk = privySdkFiles(folder);
  if (!config.privy) for (const file of privySdk) findings.push({ file, what: "Privy's SDK in a build without privy" });
  for (const path of filesOf(folder)) {
    const file = relative(folder, path);
    if (!config.chain.local && LOCAL_ONLY.test(file)) findings.push({ file, what: "a local-only file in a build that is not local" });
    if (file.endsWith(".map")) {
      findings.push({ file, what: "a source map would ship" });
      continue;
    }
    if (!TEXT.test(file)) continue;
    const text = readFileSync(path, "utf8");
    if (/[#@]\s*sourceMappingURL=/.test(text)) findings.push({ file, what: "a sourceMappingURL comment" });
    for (const match of text.matchAll(ADDRESS)) {
      const origin = match[0].replace(/\/+$/, "");
      if (!seen.has(origin)) seen.set(origin, new Set());
      seen.get(origin)!.add(file);
      if (allowed.has(origin) || origin in LIBRARY_TEXT || origin in CHAIN_TEXT) continue;
      if (config.privy && privySdk.has(file)) continue;
      if (file === "exit.html" && `${origin}:`.startsWith(EXIT_LOCAL_HINT)) continue;
      findings.push({ file, what: `an address that is not the configured RPC, relay or site: ${origin}` });
    }
    if (!config.chain.local) {
      if (text.includes(ANVIL_MNEMONIC)) findings.push({ file, what: "anvil's test mnemonic in a build that is not local" });
      const lower = text.toLowerCase();
      keys.forEach((key, index) => {
        if (lower.includes(key)) findings.push({ file, what: `anvil's test key ${index} in a build that is not local` });
      });
    }
    if ((file === "index.html" || file === "gallery.html") && !text.includes('http-equiv="Content-Security-Policy"')) {
      findings.push({ file, what: "no CSP meta tag" });
    }
  }
  return { findings, seen };
}

if (import.meta.main) {
  const [folder, configPath] = process.argv.slice(2);
  if (!folder || !configPath) {
    console.error("usage: bun apps/web/tests/bundle/audit.ts <dist folder> <config.json>");
    process.exit(2);
  }
  const config = JSON.parse(readFileSync(configPath, "utf8")) as AuditConfig;
  const { findings, seen } = audit(folder, config);
  const privySdk = privySdkFiles(folder);
  console.log(`addresses in ${folder} (local build: ${config.chain.local}${config.privy ? `, Privy's SDK in ${privySdk.size} chunks` : ""}):`);
  for (const [origin, files] of [...seen].sort()) {
    const onlyPrivy = [...files].every((file) => privySdk.has(file));
    const why = LIBRARY_TEXT[origin] ?? CHAIN_TEXT[origin] ?? (onlyPrivy ? "Privy's SDK text (the CSP lets it reach auth.privy.io only)" : origin.startsWith("http://127.0.0.1") && !config.chain.rpcUrls.some((url) => url.startsWith(origin)) ? "exit.html's local server hint" : "configured");
    console.log(`  ${origin.padEnd(36)} ${why} · ${[...files].join(", ")}`);
  }
  for (const finding of findings) console.log(`FINDING ${finding.file}: ${finding.what}`);
  console.log(findings.length === 0 ? "clean" : `${findings.length} finding(s)`);
  process.exit(findings.length === 0 ? 0 : 1);
}
