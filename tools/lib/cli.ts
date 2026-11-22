/**
 * What every command of tools/ahand.ts shares: the failure a person can act on, the arguments,
 * text made safe for a terminal, the chain connection and the Core this run trusts.
 */
import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { createPublicClient, formatUnits, getAddress, http, isAddress, parseAbi, type Address, type PublicClient } from "viem";

import { CONTRACTS, REPO_ROOT, coreAddressOf, coreBuild, readDeployment, type CoreBuild } from "../manifest.ts";

const DEPLOYMENTS = join(CONTRACTS, "deployments");
const LOCAL_CHAIN = 31337;

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
 * draw as a line break.
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

/** Where this run looks for Core's build and the deployment files; tests point it at doctored copies. */
export interface Sources {
  /** AHandCore's artifact in contracts/out. */
  artifact?: string;
  /** contracts/src/AHandCore.sol, the source that artifact must have been compiled from. */
  source?: string;
  /** contracts/deployments. */
  deployments?: string;
  env?: Record<string, string | undefined>;
}

/** core-check's sentence for a build that does not come from AHandCore.sol as it is now. */
export const STALE_BUILD =
  'contracts/out was not built from contracts/src/AHandCore.sol as it is now: rebuild it (cd contracts && "${FOUNDRY_BIN:-$HOME/.foundry/bin}/forge" build)';

/** The Core this clone builds, at create2(factory, salt, initcode of contracts/out), or why there is none. */
export function cloneCore(sources: Sources = {}): { core: Address; build: CoreBuild } | { why: string } {
  let build: CoreBuild;
  try {
    build = coreBuild(sources.artifact, sources.source);
  } catch (error) {
    return { why: (error as Error).message };
  }
  // A build of another source would make a stale or foreign contracts/out the trust anchor.
  if (!build.sourceMatches) return { why: STALE_BUILD };
  return { core: coreAddressOf(build.initcodeHash), build };
}

export interface DeploymentFile {
  file: string;
  /** Why this file was taken, for the person to read. */
  why: string;
}

/** A path as the person sees it: from the repository when it is inside it. */
export function shown(file: string): string {
  const path = relative(REPO_ROOT, file);
  return path && !path.startsWith("..") && !isAbsolute(path) ? path : file;
}

/**
 * The deployment file of a chain: --deployment when given; on the local chain 31337 with STAND_SLOT
 * set, that stand slot's file (the stand writes 31337-slot<N>.json); else <chainId>.json; else the
 * one slot file of the chain when there is exactly one. Undefined when there is none; a failure
 * when several slot files could be meant.
 */
export function deploymentFileOf(args: Args | undefined, chainId: number, sources: Sources = {}): DeploymentFile | undefined {
  const named = args?.flags.get("--deployment");
  if (named !== undefined) return { file: resolve(named), why: "given with --deployment" };
  const dir = sources.deployments ?? DEPLOYMENTS;
  const env = sources.env ?? process.env;
  const slotText = env.STAND_SLOT;
  if (chainId === LOCAL_CHAIN && slotText !== undefined && slotText !== "") {
    if (!/^[0-9]$/.test(slotText)) throw new Fail(`STAND_SLOT is a stand slot from 0 to 9, not ${clean(slotText)}`, 2);
    const file = join(dir, `${chainId}-slot${slotText}.json`);
    if (!existsSync(file)) throw new Fail(`STAND_SLOT=${slotText} names ${shown(file)}, and there is no such file: is stand slot ${slotText} up? (or give --deployment FILE)`);
    return { file, why: `stand slot ${slotText}, from STAND_SLOT` };
  }
  const plain = join(dir, `${chainId}.json`);
  if (existsSync(plain)) return { file: plain, why: `the deployment file of chain ${chainId}` };
  const pattern = new RegExp(`^${chainId}-slot([0-9]+)\\.json$`);
  const slots = existsSync(dir) ? readdirSync(dir).filter((name) => pattern.test(name)).sort() : [];
  if (slots.length === 1) return { file: join(dir, slots[0]!), why: `the only stand slot file of chain ${chainId}; STAND_SLOT or --deployment choose another` };
  if (slots.length > 1) {
    throw new Fail(`there is no ${shown(plain)}, and several stand slots have one (${slots.join(", ")}): set STAND_SLOT=N or give --deployment FILE`, 2);
  }
  return undefined;
}

/**
 * The Core this run reads and trusts: the one given, else the one this clone builds (its CREATE2
 * address from contracts/out) when that build comes from AHandCore.sol as
 * it is now, else the chain's deployment file.
 */
export function trustedCore(args: Args, chainId: number, sources: Sources = {}): TrustedCore {
  const given = addressFlag(args, "--core", "CORE");
  if (given) return { core: given, source: "given with --core" };
  const clone = cloneCore(sources);
  if ("core" in clone) return { core: clone.core, source: "create2(factory, salt, initcode built in contracts/out)" };
  const found = deploymentFileOf(args, chainId, sources);
  if (found) {
    let core: Address;
    try {
      core = getAddress(readDeployment(found.file).core);
    } catch (error) {
      throw new Fail((error as Error).message);
    }
    const note = clone.why === STALE_BUILD ? "; contracts/out is stale, so it was not used" : "";
    return { core, source: `${shown(found.file)}: ${found.why}${note}` };
  }
  if (clone.why === STALE_BUILD) throw new Fail(`no Core to trust: ${STALE_BUILD}, give --core 0x..., or add a deployment file`);
  throw new Fail('no Core to trust: give --core 0x..., build the contracts (cd contracts && "${FOUNDRY_BIN:-$HOME/.foundry/bin}/forge" build), or add a deployment file');
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
