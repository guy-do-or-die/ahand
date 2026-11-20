/**
 * What every command of tools/ahand.ts shares: the failure a person can act on, the arguments,
 * text made safe for a terminal, the chain connection and the Core this run trusts.
 */
import { existsSync } from "node:fs";

import { createPublicClient, formatUnits, getAddress, http, isAddress, parseAbi, type Address, type PublicClient } from "viem";

import { coreAddressOf, coreBuild, deploymentPath, readDeployment } from "../manifest.ts";

/** A failure the person can act on: printed as one plain sentence, exit status 1 (2 for a usage mistake). */
export class Fail extends Error {
  constructor(
    message: string,
    readonly status = 1,
  ) {
    super(message);
    this.name = "Fail";
  }
}

export interface Args {
  positional: string[];
  flags: Map<string, string>;
}

/** Options that take a value. */
export const VALUE_FLAGS = [
  "--rpc",
  "--core",
  "--forwarder",
  "--share-bps",
  "--payee",
  "--deployment",
  "--app",
  "--out",
  "--bundle",
  "--give",
  "--save",
  "--raiser",
  "--days",
  "--chunk",
  "--book",
  "--max",
  "--site",
] as const;

/** Options that are switches: present or not. */
export const SWITCH_FLAGS = ["--details", "--between", "--print-link"] as const;

export function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "-h" || arg === "--help") {
      flags.set("--help", "");
    } else if (arg.startsWith("--")) {
      const [name, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
      if ((SWITCH_FLAGS as readonly string[]).includes(name)) {
        if (inline !== undefined) throw new Fail(`${name} takes no value`, 2);
        flags.set(name, "");
        continue;
      }
      if (!(VALUE_FLAGS as readonly string[]).includes(name)) throw new Fail(`unknown option ${clean(name)}; see bun tools/ahand.ts help`, 2);
      const value = inline ?? argv[++index];
      if (value === undefined || value === "") throw new Fail(`${name} needs a value`, 2);
      flags.set(name, value);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

export function addressFlag(args: Args, name: string, env?: string): Address | undefined {
  const value = args.flags.get(name) ?? (env ? process.env[env] || undefined : undefined);
  if (value === undefined) return undefined;
  if (!isAddress(value, { strict: false })) throw new Fail(`${name} is not an address: ${clean(value)}`, 2);
  return getAddress(value);
}

/** A whole number option within bounds. */
export function wholeFlag(args: Args, name: string, fallback: number, min: number, max: number): number {
  const text = args.flags.get(name);
  if (text === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(text) || Number(text) < min || Number(text) > max) {
    throw new Fail(`${name} is a whole number from ${min} to ${group(max)}, not ${clean(text)}`, 2);
  }
  return Number(text);
}

/** A Hand's number as given on the command line. */
export function handIdOf(text: string | undefined, usage: string): bigint {
  if (!text || !/^(0|[1-9][0-9]*)$/.test(text)) throw new Fail(`give the Hand's number: ${usage}`, 2);
  return BigInt(text);
}

/**
 * Text that came from a link or a chain, made safe for a terminal: no control, direction or
 * invisible characters. Each is written as its \uXXXX escape: C0 and C1 controls, every bidi
 * control (LRM, RLM, ALM, LRE…RLO, LRI…PDI), the zero-width characters (U+200B…U+200D, U+2060…
 * U+2064, U+FEFF) and the line and paragraph separators U+2028 and U+2029, which a terminal may
 * draw as a line break (early review H-2).
 */
export function clean(text: string, max = 120): string {
  const unsafe = new RegExp(
    "[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]",
    "g",
  );
  const safe = text.replace(unsafe, (char) =>
    char === "\n" ? "\\n" : char === "\t" ? "\\t" : `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return safe.length > max ? `${safe.slice(0, max)}…` : safe;
}

export function pct(bps: number | bigint): string {
  const value = Number(bps) / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0$/, "")}%`;
}

/** A block's timestamp as a date; this tool never reads the machine's clock for "now". */
export function utc(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "")} UTC`;
}

export function span(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d ? `${d}d ` : ""}${d || h ? `${h}h ` : ""}${m}m`;
}

export function group(n: number | bigint): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/* ------------------------------------------------------------------- chain */

export interface Chain {
  rpc: string;
  client: PublicClient;
  chainId: number;
}

export async function connect(args: Args, required: boolean): Promise<Chain | undefined> {
  const rpc = args.flags.get("--rpc") ?? (process.env.RPC || undefined);
  if (!rpc) {
    if (required) throw new Fail("this command needs the chain: give --rpc URL (or set RPC)", 2);
    return undefined;
  }
  if (!/^https?:\/\//.test(rpc)) throw new Fail(`--rpc is a web address (http:// or https://), not ${clean(rpc)}`, 2);
  const client = createPublicClient({ transport: http(rpc, { retryCount: 1, timeout: 15_000 }) }) as PublicClient;
  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch {
    throw new Fail(`the RPC at ${clean(rpc)} did not answer`);
  }
  return { rpc, client, chainId };
}

export interface TrustedCore {
  core: Address;
  /** How this tool came to trust it. */
  source: string;
}

/**
 * The Core this run reads and trusts: the one given, else the one this clone builds (its CREATE2
 * address from contracts/out: the derivation of D-10), else the deployment file of the chain.
 */
export function trustedCore(args: Args, chainId: number): TrustedCore {
  const given = addressFlag(args, "--core", "CORE");
  if (given) return { core: given, source: "given with --core" };
  try {
    return { core: coreAddressOf(coreBuild().initcodeHash), source: "create2(factory, salt, initcode built in contracts/out)" };
  } catch {
    // no build here: fall back to the deployment file
  }
  const file = deploymentPath(chainId);
  if (existsSync(file)) return { core: getAddress(readDeployment(file).core), source: `contracts/deployments/${chainId}.json` };
  throw new Fail("no Core to trust: give --core 0x..., build the contracts (cd contracts && \"${FOUNDRY_BIN:-$HOME/.foundry/bin}/forge\" build), or add a deployment file");
}

const ERC20 = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);

/** An amount in a token's own units, with its symbol and decimals when the token answers. */
export async function amountOf(chain: Chain, token: Address, units: bigint): Promise<string> {
  try {
    const [symbol, decimals] = await Promise.all([
      chain.client.readContract({ address: token, abi: ERC20, functionName: "symbol" }),
      chain.client.readContract({ address: token, abi: ERC20, functionName: "decimals" }),
    ]);
    return `${formatUnits(units, decimals)} ${clean(symbol, 16)} (${units} units)`;
  } catch {
    return `${units} units`;
  }
}
