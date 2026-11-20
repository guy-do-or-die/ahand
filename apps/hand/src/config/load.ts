import { localChainProblem } from "./local";
import type { Address, AppConfig, Hex } from "./schema";

/** A configuration that does not match the schema. The message names the first wrong field. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

type Json = Record<string, unknown>;

function object(value: unknown, at: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ConfigError(`${at} must be an object`);
  return value as Json;
}
function string(value: unknown, at: string): string {
  if (typeof value !== "string") throw new ConfigError(`${at} must be a string`);
  return value;
}
function number(value: unknown, at: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ConfigError(`${at} must be a number`);
  return value;
}
function integer(value: unknown, at: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = number(value, at);
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${at} must be a whole number from ${min} to ${max}`);
  return n;
}
function boolean(value: unknown, at: string): boolean {
  if (typeof value !== "boolean") throw new ConfigError(`${at} must be true or false`);
  return value;
}
function address(value: unknown, at: string): Address {
  const text = string(value, at);
  if (!ADDRESS.test(text)) throw new ConfigError(`${at} must be a 20-byte hex address`);
  return text as Address;
}
function maybeAddress(value: unknown, at: string): Address | null {
  return value === null || value === undefined ? null : address(value, at);
}
function hash(value: unknown, at: string): Hex {
  const text = string(value, at);
  if (!HASH.test(text)) throw new ConfigError(`${at} must be a 32-byte hex value`);
  return text as Hex;
}
function list<T>(value: unknown, at: string, each: (item: unknown, at: string) => T): T[] {
  if (!Array.isArray(value)) throw new ConfigError(`${at} must be a list`);
  return value.map((item, i) => each(item, `${at}[${i}]`));
}
function url(value: unknown, at: string, schemes: string[]): string {
  const text = string(value, at);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new ConfigError(`${at} must be a URL`);
  }
  if (!schemes.includes(parsed.protocol)) throw new ConfigError(`${at} must start with ${schemes.join(" or ")}`);
  return text;
}

/** Checks a parsed configuration field by field and returns it typed. Throws `ConfigError`. */
export function parseConfig(input: unknown): AppConfig {
  const root = object(input, "config");
  const chain = object(root.chain, "chain");
  const cores = object(root.cores, "cores");
  const prices = object(root.prices, "prices");
  const defaults = object(root.defaults, "defaults");
  const chainId = integer(chain.id, "chain.id", 1);

  const config: AppConfig = {
    chain: {
      id: chainId,
      name: string(chain.name, "chain.name"),
      rpcUrls: list(chain.rpcUrls, "chain.rpcUrls", (v, at) => url(v, at, ["http:", "https:"])),
      blockTimeMs: integer(chain.blockTimeMs, "chain.blockTimeMs", 1),
      local: boolean(chain.local, "chain.local"),
      hasL1: boolean(chain.hasL1, "chain.hasL1"),
      ...(chain.testnet === undefined ? {} : { testnet: boolean(chain.testnet, "chain.testnet") }),
      ...(chain.explorer === undefined || chain.explorer === null ? {} : { explorer: url(chain.explorer, "chain.explorer", ["https:"]).replace(/\/+$/, "") }),
    },
    cores: {
      trusted: list(cores.trusted, "cores.trusted", (v, at) => {
        const entry = object(v, at);
        return { chainId: integer(entry.chainId, `${at}.chainId`, 1), core: address(entry.core, `${at}.core`) };
      }),
      canonical: maybeAddress(cores.canonical, "cores.canonical"),
    },
    deployment:
      root.deployment === null || root.deployment === undefined
        ? null
        : (() => {
            const d = object(root.deployment, "deployment");
            return {
              factory: address(d.factory, "deployment.factory"),
              salt: hash(d.salt, "deployment.salt"),
              initcodeHash: hash(d.initcodeHash, "deployment.initcodeHash"),
              deployBlock: integer(d.deployBlock, "deployment.deployBlock"),
              commit: string(d.commit, "deployment.commit"),
              dirty: boolean(d.dirty, "deployment.dirty"),
            };
          })(),
    tokens: list(root.tokens, "tokens", (v, at) => {
      const t = object(v, at);
      return {
        address: address(t.address, `${at}.address`),
        symbol: string(t.symbol, `${at}.symbol`),
        decimals: integer(t.decimals, `${at}.decimals`, 0, 36),
        kind: string(t.kind, `${at}.kind`),
        label: string(t.label, `${at}.label`),
      };
    }),
    forwarder: maybeAddress(root.forwarder, "forwarder"),
    accountFactory: maybeAddress(root.accountFactory, "accountFactory"),
    relays: list(root.relays, "relays", (v, at) => url(v, at, ["ws:", "wss:"])),
    site: url(root.site, "site", ["http:", "https:"]),
    prices: {
      date: string(prices.date, "prices.date"),
      ethUsd: number(prices.ethUsd, "prices.ethUsd"),
      base: { gwei: number(object(prices.base, "prices.base").gwei, "prices.base.gwei") },
      ethereum: { gwei: number(object(prices.ethereum, "prices.ethereum").gwei, "prices.ethereum.gwei") },
      source: string(prices.source, "prices.source"),
    },
    defaults: {
      minClaimBps: integer(defaults.minClaimBps, "defaults.minClaimBps", 0, 10_000),
      payoutGasK: integer(defaults.payoutGasK, "defaults.payoutGasK", 0, 65_535),
      expiryDays: integer(defaults.expiryDays, "defaults.expiryDays", 1, 180),
    },
    ...(root.faucets === undefined || root.faucets === null
      ? {}
      : {
          faucets: list(root.faucets, "faucets", (v, at) => {
            const f = object(v, at);
            return { asset: string(f.asset, `${at}.asset`), url: url(f.url, `${at}.url`, ["https:"]) };
          }),
        }),
    ...(root.previews === undefined ? {} : { previews: boolean(root.previews, "previews") }),
  };

  const localProblem = localChainProblem(config.chain);
  if (localProblem) throw new ConfigError(localProblem);
  if (config.faucets?.length && !(config.chain.testnet ?? config.chain.local)) throw new ConfigError("faucets belong to a test network: set chain.testnet");
  if (config.chain.rpcUrls.length === 0) throw new ConfigError("chain.rpcUrls must name at least one RPC");
  if (!config.cores.trusted.some((t) => t.chainId === chainId)) throw new ConfigError("cores.trusted must name a Core on chain.id");
  if (config.cores.canonical && !config.cores.trusted.some((t) => t.core.toLowerCase() === config.cores.canonical!.toLowerCase())) {
    throw new ConfigError("cores.canonical must be one of cores.trusted");
  }
  return config;
}
