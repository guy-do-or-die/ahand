import { resolve } from "node:path";

import { getAddress, isAddress, type Address } from "viem";

/**
 * The view server's configuration, from the environment:
 *
 *   VIEW_PORT       the port to listen on, 1 to 65535 (default 8080)
 *   VIEW_DIST       the built app's folder (index.html, exit.html, build.json, assets/)
 *   VIEW_RPC        one JSON-RPC address of the chain the view server reads
 *   VIEW_CHAIN      that chain's id
 *   VIEW_CORES      the Cores the view server trusts on that chain, comma-separated
 *   VIEW_CANONICAL  the Core an address names by leaving its address out (may be empty)
 *   VIEW_SITE       the site's own origin, for absolute og:url and og:image
 *
 * One more, optional: VIEW_RELAYS, the relay URLs the app talks to, comma-separated. They go
 * into the CSP's connect-src beside VIEW_RPC; without them the app's delivery would be blocked
 * by the view server's own header.
 *
 * And VIEW_PRIVY, "1" when the app's configuration logs in through Privy: the CSP then
 * names Privy's and WalletConnect's sources (headers.ts PRIVY_SOURCES), as the app's own meta tag does.
 *
 * And VIEW_TOKENS, the tokens the app's configuration lists, comma-separated, each
 * `<address>:<decimals>:<symbol>`, with `:$` after a dollar token (`viewTokensOf` writes it from the
 * app's token list). A reward is written as an amount only in a listed token, and in dollars only
 * in a listed dollar token. The view server never reads `symbol()` or `decimals()` from a token: a
 * token anyone can deploy names itself whatever it likes ("USDC") and could revert to send the
 * server to a URL of its choosing (CCIP-Read).
 *
 * Nothing here is a secret: the view server holds no key.
 */
/** A token the app's configuration lists: what the view server may say about an amount in it. */
export interface ListedToken {
  address: Address;
  decimals: number;
  /** As the configuration writes it: 1 to 12 of A-Z a-z 0-9 . - */
  symbol: string;
  /** A dollar token: its amounts are written "$40". */
  dollar: boolean;
}

/** The token kinds of the app's configuration that are dollars. */
export const DOLLAR_KINDS: readonly string[] = ["usd", "usdc", "blacklist"];

const SYMBOL = /^[A-Za-z0-9.-]{1,12}$/;

/** VIEW_TOKENS for the app's token list. */
export function viewTokensOf(tokens: readonly { address: string; decimals: number; symbol: string; kind: string }[]): string {
  return tokens.map((t) => `${t.address}:${t.decimals}:${t.symbol}${DOLLAR_KINDS.includes(t.kind) ? ":$" : ""}`).join(",");
}

/** Reads VIEW_TOKENS; throws a plain sentence for the first entry that is wrong. */
export function tokensOf(value: string | undefined): ListedToken[] {
  return list(value).map((entry) => {
    const [at, decimalsText, symbol, mark, ...rest] = entry.split(":");
    const decimals = Number(decimalsText);
    if (rest.length > 0 || (mark !== undefined && mark !== "$")) throw new Error(`VIEW_TOKENS: ${entry} is not <address>:<decimals>:<symbol>[:$]`);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error(`VIEW_TOKENS: ${entry} has no decimals from 0 to 36`);
    if (!symbol || !SYMBOL.test(symbol)) throw new Error(`VIEW_TOKENS: ${entry} has no symbol of 1 to 12 letters, digits, dots or hyphens`);
    return { address: address(at ?? "", "VIEW_TOKENS"), decimals, symbol, dollar: mark === "$" };
  });
}

export interface ViewConfig {
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
  /** The tokens the app lists (VIEW_TOKENS); an amount in any other token is not written. */
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
export function configFromEnv(env: Record<string, string | undefined> = process.env): ViewConfig {
  const need = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  const portText = env.VIEW_PORT?.trim() || "8080";
  const port = Number(portText);
  if (!/^[0-9]+$/.test(portText) || port < 1 || port > 65_535) throw new Error(`VIEW_PORT: ${portText} is not a port from 1 to 65535`);
  const chainId = Number(need("VIEW_CHAIN"));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error(`VIEW_CHAIN: ${env.VIEW_CHAIN} is not a chain id`);
  const rpc = need("VIEW_RPC");
  origin(rpc, "VIEW_RPC");
  const trusted = list(env.VIEW_CORES).map((core) => address(core, "VIEW_CORES"));
  if (trusted.length === 0) throw new Error("VIEW_CORES names no Core");
  const canonicalText = env.VIEW_CANONICAL?.trim();
  const canonical = canonicalText ? address(canonicalText, "VIEW_CANONICAL") : undefined;
  if (canonical && !trusted.includes(canonical)) throw new Error("VIEW_CANONICAL is not among VIEW_CORES");
  const privy = env.VIEW_PRIVY?.trim() ?? "";
  if (privy !== "" && privy !== "0" && privy !== "1") throw new Error(`VIEW_PRIVY: ${env.VIEW_PRIVY} is not 0 or 1`);
  const relays = list(env.VIEW_RELAYS);
  for (const relay of relays) {
    let url: URL;
    try {
      url = new URL(relay);
    } catch {
      throw new Error(`VIEW_RELAYS: ${relay} is not a WebSocket address`);
    }
    if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error(`VIEW_RELAYS: ${relay} is not a WebSocket address`);
  }
  return {
    port,
    dist: resolve(need("VIEW_DIST")),
    rpc,
    chainId,
    trusted,
    canonical,
    site: origin(need("VIEW_SITE"), "VIEW_SITE"),
    relays,
    tokens: tokensOf(env.VIEW_TOKENS),
    ...(privy === "1" ? { privy: true } : {}),
  };
}
