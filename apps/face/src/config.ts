import { resolve } from "node:path";

import { getAddress, isAddress, type Address } from "viem";

/**
 * Face's configuration, from the environment, with the names of ARCHITECTURE §14:
 *
 *   FACE_PORT       the port to listen on (default 8080)
 *   FACE_DIST       the built app's folder (index.html, exit.html, build.json, assets/)
 *   FACE_RPC        one JSON-RPC address of the chain face reads
 *   FACE_CHAIN      that chain's id
 *   FACE_CORES      the Cores face trusts on that chain, comma-separated
 *   FACE_CANONICAL  the Core an address names by leaving its address out (may be empty)
 *   FACE_SITE       the site's own origin, for absolute og:url and og:image
 *
 * One more, optional: FACE_RELAYS, the relay URLs the app talks to, comma-separated. They go
 * into the CSP's connect-src beside FACE_RPC; without them the app's delivery would be blocked
 * by face's own header (ARCHITECTURE §11 lists "<relay urls>" there).
 *
 * Nothing here is a secret: face holds no key.
 */
export interface FaceConfig {
  port: number;
  dist: string;
  rpc: string;
  chainId: number;
  trusted: Address[];
  canonical?: Address;
  site: string;
  relays: string[];
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function address(value: string, name: string): Address {
  if (!isAddress(value, { strict: false })) throw new Error(`${name}: ${value} is not an address`);
  return getAddress(value);
}

function origin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name}: ${value} is not a web address`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${name}: only http and https`);
  return url.origin;
}

/** Reads and checks the environment; throws a plain sentence for the first thing wrong. */
export function configFromEnv(env: Record<string, string | undefined> = process.env): FaceConfig {
  const need = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  const port = Number(env.FACE_PORT ?? "8080");
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`FACE_PORT: ${env.FACE_PORT} is not a port`);
  const chainId = Number(need("FACE_CHAIN"));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error(`FACE_CHAIN: ${env.FACE_CHAIN} is not a chain id`);
  const rpc = need("FACE_RPC");
  origin(rpc, "FACE_RPC");
  const trusted = list(env.FACE_CORES).map((core) => address(core, "FACE_CORES"));
  if (trusted.length === 0) throw new Error("FACE_CORES names no Core");
  const canonicalText = env.FACE_CANONICAL?.trim();
  const canonical = canonicalText ? address(canonicalText, "FACE_CANONICAL") : undefined;
  if (canonical && !trusted.includes(canonical)) throw new Error("FACE_CANONICAL is not among FACE_CORES");
  const relays = list(env.FACE_RELAYS);
  for (const relay of relays) {
    const url = new URL(relay);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error(`FACE_RELAYS: ${relay} is not a WebSocket address`);
  }
  return {
    port,
    dist: resolve(need("FACE_DIST")),
    rpc,
    chainId,
    trusted,
    canonical,
    site: origin(need("FACE_SITE"), "FACE_SITE"),
    relays,
  };
}
