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
 * And FACE_PRIVY, "1" when the app's configuration logs in through Privy: the CSP then
 * names Privy's and WalletConnect's sources (headers.ts PRIVY_SOURCES), as the app's own meta tag does.
 *
 * And FACE_TOKENS, the tokens the app's configuration lists, comma-separated, each
 * `<address>:<decimals>:<symbol>`, with `:$` after a dollar token (`faceTokensOf` writes it from the
 * app's token list). A reward is written as an amount only in a listed token, and in dollars only
 * in a listed dollar token. Face never reads `symbol()` or `decimals()` from a token: a token
 * anyone can deploy names itself whatever it likes ("USDC") and could revert to send face to a
 * URL of its choosing (CCIP-Read).
 *
 * Nothing here is a secret: face holds no key.
 */
/** A token the app's configuration lists: what face may say about an amount in it. */
export interface ListedToken {
  address: Address;
  decimals: number;
  /** As the configuration writes it: 1 to 12 of A-Z a-z 0-9 . - */
  symbol: string;
  /** A dollar token: its amounts are written "$40". */
  dollar: boolean;
}

/** The token kinds of the app's configuration (apps/hand/src/config/schema.ts) that are dollars. */
export const DOLLAR_KINDS: readonly string[] = ["usd", "usdc", "blacklist"];

const SYMBOL = /^[A-Za-z0-9.-]{1,12}$/;

/** FACE_TOKENS for the app's token list. */
export function faceTokensOf(tokens: readonly { address: string; decimals: number; symbol: string; kind: string }[]): string {
  return tokens.map((t) => `${t.address}:${t.decimals}:${t.symbol}${DOLLAR_KINDS.includes(t.kind) ? ":$" : ""}`).join(",");
}

/** Reads FACE_TOKENS; throws a plain sentence for the first entry that is wrong. */
export function tokensOf(value: string | undefined): ListedToken[] {
  return list(value).map((entry) => {
    const [at, decimalsText, symbol, mark, ...rest] = entry.split(":");
    const decimals = Number(decimalsText);
    if (rest.length > 0 || (mark !== undefined && mark !== "$")) throw new Error(`FACE_TOKENS: ${entry} is not <address>:<decimals>:<symbol>[:$]`);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error(`FACE_TOKENS: ${entry} has no decimals from 0 to 36`);
    if (!symbol || !SYMBOL.test(symbol)) throw new Error(`FACE_TOKENS: ${entry} has no symbol of 1 to 12 letters, digits, dots or hyphens`);
    return { address: address(at ?? "", "FACE_TOKENS"), decimals, symbol, dollar: mark === "$" };
  });
}

export interface FaceConfig {
  port: number;
  dist: string;
  rpc: string;
  chainId: number;
  trusted: Address[];
  canonical?: Address;
  site: string;
  relays: string[];
  /** The app logs in through Privy: the CSP names Privy's sources. */
  privy?: boolean;
  /** The tokens the app lists (FACE_TOKENS); an amount in any other token is not written. */
  tokens: ListedToken[];
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
  const privy = env.FACE_PRIVY?.trim() ?? "";
  if (privy !== "" && privy !== "0" && privy !== "1") throw new Error(`FACE_PRIVY: ${env.FACE_PRIVY} is not 0 or 1`);
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
    tokens: tokensOf(env.FACE_TOKENS),
    ...(privy === "1" ? { privy: true } : {}),
  };
}
