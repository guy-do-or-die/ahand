/**
 * The local stand: one command brings up a whole aHand on this machine,
 * and ten can run side by side, one per slot.
 *
 *   bun infra/stand/stand.ts up [--slot N] [--dev] [--no-view] [--ahead SECONDS]
 *   bun infra/stand/stand.ts down [--slot N | --all]
 *   bun infra/stand/stand.ts status [--slot N] [--json]
 *   bun infra/stand/stand.ts build --slot N
 *   bun infra/stand/stand.ts stop --slot N <chain|relay|site|dev>
 *   bun infra/stand/stand.ts start --slot N <relay|view|static|dev>
 *
 * `up` starts anvil on the slot's port with its clock 40 days ahead of this machine's
 * (`--timestamp`), one block a second and one slot per epoch (so `safe` and `finalized` trail
 * `latest` by one and two blocks); deploys Core and the test contracts with
 * contracts/script/Deploy.s.sol under the forge lock, into the slot's own deployment file; reads
 * that file (never console text); writes the app's configuration and stand.json; starts the relay;
 * then builds the app and serves it (through the view server when it is there and healthy, else through
 * static.ts), or with --dev runs the Vite dev server instead.
 *
 * Every service runs detached in its own process group, with one process id in pids.json and one
 * log in logs/; stopping a service kills its group and waits until its port is free. The slot
 * defaults to STAND_SLOT, else 0.
 *
 * Keys: only anvil's public test account 0, and only inside Deploy.s.sol, which derives it from
 * anvil's public mnemonic on chain 31337; no key is ever on a command line or in a file here. The
 * stand refuses to deploy anywhere but chain 31337.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";

import { parseDeployment } from "@ahand/abi";
import { PRICES } from "@ahand/sdk/app";
import { getContractAddress } from "viem";

import { viewTokensOf } from "../../apps/view/src/config.ts";
import type { AppConfig } from "../../apps/web/src/config/schema.ts";
import { buildRecord } from "../../tools/manifest.ts";
import { forge, foundryPath } from "./foundry.ts";
import { checkSlot, pathsOf, portsOf, REPO_ROOT, slotFromEnv, SLOT_COUNT, type SlotPorts } from "./ports.ts";

/* ---------------------------------------------------------------- constants */

export const LOCAL_CHAIN_ID = 31337;
/** The stand's chain runs this far ahead of the machine's clock. */
export const AHEAD_SECONDS = 40 * 86_400;
const HOST = "127.0.0.1";
const APP_DIR = join(REPO_ROOT, "apps/web");
const VIEW_SERVER = join(REPO_ROOT, "apps/view/src/server.ts");
const RELAY = join(REPO_ROOT, "infra/relay/relay.ts");
const STATIC = join(REPO_ROOT, "infra/stand/static.ts");
const VITE = join(APP_DIR, "node_modules/.bin/vite");
const VIEW_HEALTH_MS = 5_000;

const TOKEN_LABELS: Record<string, string> = { usd: "Test dollars", blacklist: "Test dollars that can block" };

/* ---------------------------------------------------------------- arguments */

export type Command = "up" | "down" | "status" | "build" | "stop" | "start";
export type Service = "chain" | "relay" | "site" | "dev";
export type StartTarget = "relay" | "view" | "static" | "dev";
const COMMANDS: Command[] = ["up", "down", "status", "build", "stop", "start"];
const STOPPABLE: Service[] = ["chain", "relay", "site", "dev"];
const STARTABLE: StartTarget[] = ["relay", "view", "static", "dev"];

export interface Args {
  command: Command;
  slot: number;
  dev: boolean;
  noView: boolean;
  ahead: number;
  all: boolean;
  json: boolean;
  service: Service | StartTarget | undefined;
  /** Whether --slot was given (status and down without it act on every slot only with --all). */
  slotGiven?: boolean;
}

export const USAGE = `usage:
  bun infra/stand/stand.ts up [--slot N] [--dev] [--no-view] [--ahead SECONDS]
  bun infra/stand/stand.ts down [--slot N | --all]
  bun infra/stand/stand.ts status [--slot N] [--json]
  bun infra/stand/stand.ts build --slot N
  bun infra/stand/stand.ts stop --slot N <chain|relay|site|dev>
  bun infra/stand/stand.ts start --slot N <relay|view|static|dev>`;

export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env): Args {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command as Command)) throw new Error(`unknown command ${command ?? "(none)"}\n${USAGE}`);
  const args: Args = { command: command as Command, slot: 0, dev: false, noView: false, ahead: AHEAD_SECONDS, all: false, json: false, service: undefined };
  let slot: number | undefined;
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i]!;
    const value = () => {
      const next = rest[++i];
      if (next === undefined || next.startsWith("--")) throw new Error(`${word} needs a value`);
      return next;
    };
    if (word === "--slot") slot = checkSlot(Number(value()));
    else if (word === "--dev") args.dev = true;
    else if (word === "--no-view") args.noView = true;
    else if (word === "--all") args.all = true;
    else if (word === "--json") args.json = true;
    else if (word === "--ahead") {
      const text = value();
      const seconds = Number(text);
      if (!/^\d+$/.test(text) || !Number.isSafeInteger(seconds)) throw new Error(`--ahead takes whole seconds, 0 or more, not ${text}`);
      args.ahead = seconds;
    } else if (word.startsWith("--")) throw new Error(`unknown option ${word}\n${USAGE}`);
    else positional.push(word);
  }
  args.slot = slot ?? slotFromEnv(env);
  if (slot !== undefined) args.slotGiven = true;
  else delete args.slotGiven;

  if (args.command === "stop" || args.command === "start") {
    const allowed: string[] = args.command === "stop" ? STOPPABLE : STARTABLE;
    const names = args.command === "stop" ? "chain, relay, site or dev" : "relay, view, static or dev";
    if (positional.length !== 1 || !allowed.includes(positional[0]!)) throw new Error(`${args.command} takes one service: ${names}`);
    args.service = positional[0] as Service | StartTarget;
  } else if (positional.length > 0) throw new Error(`unexpected ${positional.join(" ")}\n${USAGE}`);
  return args;
}

/* ---------------------------------------------------------------- pure parts */

/** anvil's flags for a slot's chain: its clock at `timestamp`, a block a second, one slot per epoch. */
export function anvilArgs(port: number, timestamp: number): string[] {
  return [
    "--port", String(port),
    "--host", HOST,
    "--chain-id", String(LOCAL_CHAIN_ID),
    "--timestamp", String(timestamp),
    "--block-time", "1",
    "--slots-in-an-epoch", "1",
  ];
}

export function assertLocalChain(chainId: number): void {
  if (chainId !== LOCAL_CHAIN_ID) throw new Error(`the stand deploys and mints only on chain ${LOCAL_CHAIN_ID}; this RPC is chain ${chainId}`);
}

type Hex = `0x${string}`;

/** The deployment JSON's fields the stand uses (packages/abi `Deployment` fits it). */
export interface DeploymentIn {
  chainId: number;
  core: Hex;
  factory: Hex;
  salt: Hex;
  initcodeHash: Hex;
  runtimeHash: Hex;
  deployBlock: number;
  tokens: readonly { address: Hex; symbol: string; decimals: number; kind: string }[];
  forwarder: Hex | null;
  accountFactory: Hex | null;
  commit: string | null;
  dirty: boolean | null;
}

export const rpcUrl = (ports: SlotPorts) => `http://${HOST}:${ports.chain}`;
export const relayUrl = (ports: SlotPorts) => `ws://${HOST}:${ports.relay}`;
export const siteUrl = (ports: SlotPorts) => `http://${HOST}:${ports.site}`;
export const devUrl = (ports: SlotPorts) => `http://${HOST}:${ports.dev}`;

/** The app's configuration for a slot, from its deployment file. */
export function configOf(deployment: DeploymentIn, ports: SlotPorts, site: string): AppConfig {
  const prices: AppConfig["prices"] = { ...PRICES };
  return {
    chain: { id: deployment.chainId, name: "Local test network", rpcUrls: [rpcUrl(ports)], blockTimeMs: 1000, local: true, hasL1: false },
    cores: { trusted: [{ chainId: deployment.chainId, core: deployment.core }], canonical: deployment.core },
    deployment: {
      factory: deployment.factory,
      salt: deployment.salt,
      initcodeHash: deployment.initcodeHash,
      deployBlock: deployment.deployBlock,
      commit: deployment.commit ?? "",
      dirty: deployment.dirty ?? false,
    },
    tokens: deployment.tokens.map((t) => ({ address: t.address, symbol: t.symbol, decimals: t.decimals, kind: t.kind, label: TOKEN_LABELS[t.kind] ?? t.symbol })),
    forwarder: deployment.forwarder,
    accountFactory: deployment.accountFactory,
    relays: [relayUrl(ports)],
    site,
    prices,
    // the helper gets at least 70%, room for each payout 250 thousand gas, 30 days.
    defaults: { minClaimBps: 7000, payoutGasK: 250, expiryDays: 30 },
  };
}

export type SiteServer = "view" | "static";

/** infra/stand/.run/<s>/stand.json: the stand's own fields first, then what status and tests also use. */
export interface StandRecord {
  slot: number;
  mode: "built" | "dev";
  site: string;
  rpc: string;
  relay: string;
  chainId: number;
  core: Hex;
  tokens: { address: Hex; symbol: string; decimals: number; kind: string }[];
  forwarder: Hex | null;
  accountFactory: Hex | null;
  aheadSeconds: number;
  ports: SlotPorts;
  /** What serves the site port in built mode; null in dev mode. */
  server: SiteServer | null;
  /** Why it is that server (e.g. "the view server is off: --no-view"). */
  serverNote: string;
  /** The deployment file this stand read, and its sha256 at that moment. */
  deploymentFile: string;
  deploymentSha256: string;
  deployment: { factory: Hex; salt: Hex; initcodeHash: Hex; runtimeHash: Hex; deployBlock: number; commit: string | null; dirty: boolean | null };
}

export function standOf(input: {
  slot: number;
  mode: "built" | "dev";
  site: string;
  ports: SlotPorts;
  deployment: DeploymentIn;
  aheadSeconds: number;
  server: SiteServer | null;
  serverNote: string;
  deploymentFile: string;
  deploymentSha256: string;
}): StandRecord {
  const d = input.deployment;
  return {
    slot: input.slot,
    mode: input.mode,
    site: input.site,
    rpc: rpcUrl(input.ports),
    relay: relayUrl(input.ports),
    chainId: d.chainId,
    core: d.core,
    tokens: d.tokens.map((t) => ({ address: t.address, symbol: t.symbol, decimals: t.decimals, kind: t.kind })),
    forwarder: d.forwarder,
    accountFactory: d.accountFactory,
    aheadSeconds: input.aheadSeconds,
    ports: input.ports,
    server: input.server,
    serverNote: input.serverNote,
    deploymentFile: input.deploymentFile,
    deploymentSha256: input.deploymentSha256,
    deployment: {
      factory: d.factory,
      salt: d.salt,
      initcodeHash: d.initcodeHash,
      runtimeHash: d.runtimeHash,
      deployBlock: d.deployBlock,
      commit: d.commit,
      dirty: d.dirty,
    },
  };
}

/* ---------------------------------------------------------------- files */

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Written beside and renamed over, so a reader never sees half a file. */
function writeJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

interface ServiceEntry {
  pid: number;
  /**
   * What tells this process from a later one that got the same pid: its start time as the kernel
   * keeps it (`processIdentity`). Nothing is signalled unless it still matches.
   */
  identity?: string;
  port: number;
  /** anvil, relay, the view server, static or vite. */
  program: string;
  log: string;
  startedAt: string;
}
type Pids = Partial<Record<Service, ServiceEntry>>;

const readPids = (slot: number): Pids => readJson<Pids>(pathsOf(slot).pids) ?? {};
const readStand = (slot: number) => readJson<StandRecord>(pathsOf(slot).stand);
function needStand(slot: number): StandRecord {
  const stand = readStand(slot);
  if (!stand) throw new Error(`slot ${slot} has no stand: bun infra/stand/stand.ts up --slot ${slot}`);
  return stand;
}

function setPid(slot: number, service: Service, entry: ServiceEntry | undefined): void {
  const pids = readPids(slot);
  if (entry) pids[service] = entry;
  else delete pids[service];
  mkdirSync(pathsOf(slot).dir, { recursive: true });
  writeJson(pathsOf(slot).pids, pids);
}

/* ---------------------------------------------------------------- processes and ports */

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The start time of a live process, as the kernel keeps it: on Linux field 22 of /proc/<pid>/stat
 * (clock ticks since boot), elsewhere `ps -o lstart=`. With the pid it names one process for good:
 * a pid the system hands out again belongs to a process that started later. Undefined when the
 * process is gone or cannot be read.
 */
export function processIdentity(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // The command name (field 2) is in parentheses and may hold spaces: count from after it.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const start = fields[19];
    if (start && /^\d+$/.test(start)) return `stat:${start}`;
  } catch {
    // not Linux, or the process is gone
  }
  const run = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" });
  const started = run.status === 0 ? run.stdout.trim() : "";
  return started ? `ps:${started}` : undefined;
}

/**
 * Whether the recorded process is still the one this stand started: alive, and with the start time
 * recorded when it was spawned. An entry without one (written by an older stand) is never taken
 * for ours: its pid may since belong to anything (`stopService` keeps such an entry and names it).
 */
function ours(entry: ServiceEntry): boolean {
  return alive(entry.pid) && entry.identity !== undefined && processIdentity(entry.pid) === entry.identity;
}

/**
 * The ports of a slot as its stand.json recorded them when it came up, so a command run later with
 * another STAND_PORT_BASE still finds the stand's own ports; the computed ones when there is no stand.
 */
export function slotPorts(slot: number): SlotPorts {
  return readStand(slot)?.ports ?? portsOf(slot);
}

export function portBusy(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ port, host: HOST });
    socket.once("connect", () => (socket.destroy(), done(true)));
    socket.once("error", () => done(false));
    socket.setTimeout(500, () => (socket.destroy(), done(false)));
  });
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function waitUntil(what: string, timeoutMs: number, check: () => Promise<boolean> | boolean, giveUp?: () => string | undefined): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    const reason = giveUp?.();
    if (reason) throw new Error(`${what}: ${reason}`);
    await sleep(150);
  }
  throw new Error(`${what}: not within ${Math.round(timeoutMs / 1000)} s`);
}

function tail(path: string, lines = 25): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
}

/** Starts a service detached, in its own process group, its output appended to logs/<service>.log. */
async function spawnService(
  slot: number,
  service: Service,
  program: string,
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<ServiceEntry> {
  const { logs } = pathsOf(slot);
  mkdirSync(logs, { recursive: true });
  const log = join(logs, `${service}.log`);
  const fd = openSync(log, "a");
  writeSync(fd, `\n--- ${new Date().toISOString()} ${program}: ${[command, ...args].join(" ")}\n`);
  const child = spawn(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: { ...process.env, ...options.env },
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  await new Promise<void>((done, fail) => {
    child.once("spawn", () => done());
    child.once("error", fail);
  });
  child.unref();
  const port = slotPorts(slot)[service];
  const identity = processIdentity(child.pid!);
  const entry: ServiceEntry = { pid: child.pid!, ...(identity ? { identity } : {}), port, program, log, startedAt: new Date().toISOString() };
  setPid(slot, service, entry);
  return entry;
}

const exitedReason = (entry: ServiceEntry) => () => (alive(entry.pid) ? undefined : `${entry.program} exited; its log:\n${tail(entry.log)}`);

/** Stops one service of a slot by its recorded process group and waits until its port is free. */
async function stopService(slot: number, service: Service): Promise<string> {
  const entry = readPids(slot)[service];
  const port = entry?.port ?? slotPorts(slot)[service];
  if (!entry) {
    if (await portBusy(port)) return `${service}: not started by this stand, yet port ${port} is in use by something else; left alone`;
    return `${service}: not running`;
  }
  if (alive(entry.pid) && entry.identity === undefined) {
    // Recorded by an older stand, without a start time: it may still be that stand's process, or
    // the pid may since name anything. Never signal it, and keep the entry so its pid is not lost.
    return `${service}: pid ${entry.pid} (${entry.program}) was recorded without its start time, so this stand cannot vouch for it; left alone and kept in pids.json: if it is this stand's ${entry.program}, stop it by hand, then run stop again`;
  }
  if (alive(entry.pid) && !ours(entry)) {
    // The pid now names another process: never signal it.
    setPid(slot, service, undefined);
    const held = (await portBusy(port)) ? `; port ${port} is in use by something else` : "";
    return `${service}: pid ${entry.pid} is no longer the process this stand started; left alone${held}`;
  }
  if (alive(entry.pid)) {
    const signal = (name: NodeJS.Signals) => {
      try {
        process.kill(-entry.pid, name);
      } catch {
        try {
          process.kill(entry.pid, name);
        } catch {
          // already gone
        }
      }
    };
    signal("SIGTERM");
    try {
      await waitUntil(`${service} stops`, 5_000, () => !alive(entry.pid));
    } catch {
      signal("SIGKILL");
      await waitUntil(`${service} stops after SIGKILL`, 3_000, () => !alive(entry.pid));
    }
  }
  setPid(slot, service, undefined);
  await waitUntil(`port ${port} frees`, 5_000, async () => !(await portBusy(port)));
  return `${service}: stopped (pid ${entry.pid}), port ${port} free`;
}

/* ---------------------------------------------------------------- the chain */

async function rpcCall<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(5_000),
  });
  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

async function startChain(slot: number, aheadSeconds: number): Promise<void> {
  const ports = slotPorts(slot);
  // The one place the machine's clock is read: to set the chain's clock ahead of it.
  const timestamp = Math.floor(Date.now() / 1000) + aheadSeconds;
  const entry = await spawnService(slot, "chain", "anvil", foundryPath("anvil"), anvilArgs(ports.chain, timestamp));
  await waitUntil(`anvil on ${ports.chain}`, 30_000, async () => {
    try {
      await rpcCall(rpcUrl(ports), "eth_chainId");
      return true;
    } catch {
      return false;
    }
  }, exitedReason(entry));
  assertLocalChain(Number(await rpcCall<string>(rpcUrl(ports), "eth_chainId")));
}

function git(args: string[]): string | undefined {
  const run = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return run.status === 0 ? run.stdout.trim() : undefined;
}

/** Deploy.s.sol into the slot's own file, under the forge lock; returns what that file says. */
async function deploy(slot: number): Promise<{ deployment: DeploymentIn; sha256: string }> {
  const ports = slotPorts(slot);
  const paths = pathsOf(slot);
  assertLocalChain(Number(await rpcCall<string>(rpcUrl(ports), "eth_chainId")));
  // A file left by an earlier chain must never be read as this one's.
  rmSync(paths.deployment, { force: true });

  const env: Record<string, string> = { DEPLOY_OUT: paths.deployOut };
  const commit = git(["rev-parse", "HEAD"]);
  if (commit) {
    env.DEPLOY_COMMIT = commit;
    // As script/deploy.sh: dirty when Core's build inputs differ from the commit.
    env.DEPLOY_DIRTY = git(["status", "--porcelain", "--", "contracts/src", "contracts/foundry.toml"]) ? "true" : "false";
  }
  const result = await forge(["script", "script/Deploy.s.sol", "--rpc-url", rpcUrl(ports), "--broadcast"], { env });
  const log = join(paths.logs, "deploy.log");
  writeFileSync(log, `${result.stdout}\n${result.stderr}`);
  if (result.code !== 0) throw new Error(`Deploy.s.sol failed (exit ${result.code}); its output is in ${log}:\n${tail(log)}`);
  if (!existsSync(paths.deployment)) throw new Error(`Deploy.s.sol wrote no ${paths.deployment}`);

  const bytes = readFileSync(paths.deployment);
  const deployment = parseDeployment(JSON.parse(bytes.toString("utf8"))) as DeploymentIn;
  assertLocalChain(deployment.chainId);
  await checkOnChain(rpcUrl(ports), deployment);
  return { deployment, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** The file's Core is at its CREATE2 address, and every contract it names has code on this chain. */
async function checkOnChain(rpc: string, d: DeploymentIn): Promise<void> {
  const derived = getContractAddress({ opcode: "CREATE2", from: d.factory, salt: d.salt, bytecodeHash: d.initcodeHash });
  if (derived.toLowerCase() !== d.core.toLowerCase()) throw new Error(`the deployment names Core ${d.core}, but create2(factory, salt, initcodeHash) is ${derived}`);
  const named = [d.core, ...d.tokens.map((t) => t.address), d.forwarder, d.accountFactory].filter((a): a is Hex => a !== null);
  for (const address of named) {
    const code = await rpcCall<string>(rpc, "eth_getCode", [address, "latest"]);
    if (!code || code === "0x") throw new Error(`no code at ${address} on ${rpc}, though the deployment names it`);
  }
  if (d.tokens.length === 0 || !d.forwarder || !d.accountFactory) throw new Error("the deployment has no test tokens, forwarder or account factory");
}

/* ---------------------------------------------------------------- relay, build, site, dev */

async function startRelay(slot: number): Promise<void> {
  const port = slotPorts(slot).relay;
  const entry = await spawnService(slot, "relay", "relay", process.execPath, [RELAY], { env: { PORT: String(port), HOST } });
  await waitUntil(`relay on ${port}`, 10_000, () => portBusy(port), exitedReason(entry));
}

async function httpOk(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}

function setConfigSite(slot: number, site: string): void {
  const paths = pathsOf(slot);
  const config = readJson<AppConfig>(paths.config);
  if (!config) throw new Error(`slot ${slot} has no ${paths.config}: bun infra/stand/stand.ts up --slot ${slot}`);
  writeJson(paths.config, { ...config, site });
}

/** Builds index, gallery and exit into the slot's dist with its configuration, then writes build.json. */
async function build(slot: number): Promise<string> {
  const paths = pathsOf(slot);
  // A build is for the site port. On a dev stand the configuration keeps the dev server's address,
  // because Vite watches the file and would reload with the wrong one.
  if (readStand(slot)?.mode !== "dev") setConfigSite(slot, siteUrl(slotPorts(slot)));
  mkdirSync(paths.logs, { recursive: true });
  const log = join(paths.logs, "build.log");
  const fd = openSync(log, "w");
  const child = spawn(process.execPath, ["run", "build"], {
    cwd: APP_DIR,
    env: { ...process.env, AHAND_CONFIG: paths.config, AHAND_OUT_DIR: paths.dist, AHAND_VITE_CACHE: paths.viteCache },
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  const code = await new Promise<number>((done, fail) => {
    child.once("error", fail);
    child.once("close", (exit) => done(exit ?? 1));
  });
  if (code !== 0) throw new Error(`the app's build failed (exit ${code}); its log is ${log}:\n${tail(log)}`);
  for (const page of ["index.html", "gallery.html", "exit.html"]) {
    if (!existsSync(join(paths.dist, page))) throw new Error(`the build made no ${page} in ${paths.dist}`);
  }

  // The app's inputs may differ from the commit (tracked changes or new files in apps/web or packages): `dirty`.
  const record = buildRecord(paths.dist);
  writeJson(join(paths.dist, "build.json"), record);
  return record.hash;
}

async function startStatic(slot: number): Promise<void> {
  const paths = pathsOf(slot);
  const port = slotPorts(slot).site;
  if (!existsSync(join(paths.dist, "index.html"))) throw new Error(`no build in ${paths.dist}: bun infra/stand/stand.ts build --slot ${slot}`);
  const entry = await spawnService(slot, "site", "static", process.execPath, [STATIC, "--dir", paths.dist, "--port", String(port), "--config", paths.config, "--host", HOST]);
  await waitUntil(`static.ts on ${port}`, 10_000, () => httpOk(`http://${HOST}:${port}/build.json`), exitedReason(entry));
}

/** The view server on the site port, if it answers /healthz within five seconds; otherwise it is stopped again. */
async function startView(slot: number): Promise<{ ok: true } | { ok: false; why: string }> {
  const paths = pathsOf(slot);
  const ports = slotPorts(slot);
  if (!existsSync(VIEW_SERVER)) return { ok: false, why: "apps/view/src/server.ts does not exist" };
  if (!existsSync(join(paths.dist, "index.html"))) throw new Error(`no build in ${paths.dist}: bun infra/stand/stand.ts build --slot ${slot}`);
  const stand = needStand(slot);
  const config = readJson<AppConfig>(paths.config);
  const trusted = config?.cores.trusted.map((t) => t.core) ?? [stand.core];
  const entry = await spawnService(slot, "site", "view", process.execPath, [VIEW_SERVER], {
    env: {
      VIEW_PORT: String(ports.site),
      VIEW_DIST: paths.dist,
      VIEW_RPC: rpcUrl(ports),
      VIEW_CHAIN: String(stand.chainId),
      VIEW_CORES: trusted.join(","),
      VIEW_CANONICAL: stand.core,
      VIEW_SITE: siteUrl(ports),
      // Not a stand field, but the view server reads it: the relays go into its CSP's connect-src.
      VIEW_RELAYS: (config?.relays ?? [stand.relay]).join(","),
      // The tokens the app lists: the view server writes an amount only in one of them.
      VIEW_TOKENS: viewTokensOf(config?.tokens ?? stand.tokens),
    },
  });
  try {
    await waitUntil("the view server /healthz", VIEW_HEALTH_MS, () => httpOk(`http://${HOST}:${ports.site}/healthz`), exitedReason(entry));
    return { ok: true };
  } catch (error) {
    await stopService(slot, "site");
    return { ok: false, why: `the view server did not answer /healthz within 5 s (${(error as Error).message.split("\n")[0]}); its log is ${entry.log}` };
  }
}

/** The view server when it can, else static.ts; returns which, and why. */
async function serveBuilt(slot: number, noView: boolean): Promise<{ server: SiteServer; note: string }> {
  if (noView) {
    await startStatic(slot);
    return { server: "static", note: "the view server is off: --no-view" };
  }
  const view = await startView(slot);
  if (view.ok) return { server: "view", note: "the view server answered /healthz" };
  await startStatic(slot);
  return { server: "static", note: view.why };
}

async function startDev(slot: number): Promise<void> {
  const paths = pathsOf(slot);
  const ports = slotPorts(slot);
  if (!existsSync(VITE)) throw new Error(`Vite is not installed at ${VITE}`);
  setConfigSite(slot, devUrl(ports));
  const entry = await spawnService(slot, "dev", "vite", VITE, ["--port", String(ports.dev), "--strictPort", "--host", HOST], {
    cwd: APP_DIR,
    env: { AHAND_CONFIG: paths.config, AHAND_VITE_CACHE: paths.viteCache },
  });
  await waitUntil(`Vite on ${ports.dev}`, 60_000, () => httpOk(`${devUrl(ports)}/`), exitedReason(entry));
}

function updateStand(slot: number, change: Partial<StandRecord>): void {
  writeJson(pathsOf(slot).stand, { ...needStand(slot), ...change });
}

/* ---------------------------------------------------------------- commands */

/** What holds a slot: a live process its pids.json names, or one of its ports. Empty when it is free. */
export async function slotInUse(slot: number): Promise<string[]> {
  const busy: string[] = [];
  for (const [service, entry] of Object.entries(readPids(slot))) if (entry && ours(entry)) busy.push(`${service} (pid ${entry.pid})`);
  const ports = new Set([...Object.entries(slotPorts(slot)), ...Object.entries(portsOf(slot))].map(([service, port]) => `${service}:${port}`));
  for (const pair of ports) {
    const [service, port] = pair.split(":") as [string, string];
    if (await portBusy(Number(port))) busy.push(`port ${port} (${service})`);
  }
  return busy;
}

export async function up(args: Args, say: (line: string) => void = console.log): Promise<StandRecord> {
  const { slot } = args;
  const ports = portsOf(slot);
  const paths = pathsOf(slot);
  const busy = await slotInUse(slot);
  if (busy.length) throw new Error(`slot ${slot} is in use: ${busy.join(", ")}. bun infra/stand/stand.ts down --slot ${slot}`);

  mkdirSync(paths.logs, { recursive: true });
  for (const stale of [paths.pids, paths.stand, paths.deployment]) rmSync(stale, { force: true });
  const started = Date.now();
  const step = (line: string) => say(`[slot ${slot} ${((Date.now() - started) / 1000).toFixed(1)}s] ${line}`);

  try {
    await startChain(slot, args.ahead);
    step(`chain: anvil on ${rpcUrl(ports)}, clock ${args.ahead} s ahead, a block a second`);
    const { deployment, sha256 } = await deploy(slot);
    step(`deploy: Core ${deployment.core}, ${deployment.tokens.length} tokens, forwarder, account factory (read from ${paths.deployOut})`);

    const mode = args.dev ? "dev" : "built";
    const site = args.dev ? devUrl(ports) : siteUrl(ports);
    writeJson(paths.config, configOf(deployment, ports, site));
    const record = standOf({ slot, mode, site, ports, deployment, aheadSeconds: args.ahead, server: null, serverNote: "", deploymentFile: paths.deployment, deploymentSha256: sha256 });
    writeJson(paths.stand, record);

    await startRelay(slot);
    step(`relay: ${relayUrl(ports)}`);

    if (args.dev) {
      await startDev(slot);
      step(`dev: Vite on ${devUrl(ports)} (cache ${paths.viteCache})`);
    } else {
      const hash = await build(slot);
      step(`build: ${paths.dist}, build.json hash ${hash}`);
      const served = await serveBuilt(slot, args.noView);
      updateStand(slot, { server: served.server, serverNote: served.note });
      step(`site: ${served.server === "view" ? "view" : "static.ts"} on ${siteUrl(ports)} (${served.note})`);
    }
    return needStand(slot);
  } catch (error) {
    say(`[slot ${slot}] failed; stopping what was started`);
    await down(slot, () => {});
    throw error;
  }
}

export async function down(slot: number, say: (line: string) => void = console.log): Promise<void> {
  const paths = pathsOf(slot);
  for (const service of ["dev", "site", "relay", "chain"] as Service[]) say(`slot ${slot} ${await stopService(slot, service)}`);
  // An entry this stand left alone and kept stays recorded, with the ports it was given.
  const kept = Object.keys(readPids(slot)).length > 0;
  for (const file of kept ? [paths.deployment] : [paths.pids, paths.stand, paths.deployment]) rmSync(file, { force: true });
}

function usedSlots(): number[] {
  return Array.from({ length: SLOT_COUNT }, (_, s) => s).filter((s) => existsSync(pathsOf(s).pids) || existsSync(pathsOf(s).stand));
}

export interface ServiceState {
  service: Service;
  program: string | null;
  pid: number | null;
  port: number;
  running: boolean;
  listening: boolean;
}

export async function statusOf(slot: number) {
  const stand = readStand(slot);
  const pids = readPids(slot);
  const services: ServiceState[] = [];
  for (const service of STOPPABLE) {
    const entry = pids[service];
    const port = entry?.port ?? slotPorts(slot)[service];
    services.push({ service, program: entry?.program ?? null, pid: entry?.pid ?? null, port, running: entry ? ours(entry) : false, listening: await portBusy(port) });
  }
  let chain: { block: number; timestamp: number; aheadOfMachine: number } | null = null;
  if (stand && services[0]!.listening) {
    try {
      const latest = await rpcCall<{ number: string; timestamp: string }>(stand.rpc, "eth_getBlockByNumber", ["latest", false]);
      const timestamp = Number(latest.timestamp);
      chain = { block: Number(latest.number), timestamp, aheadOfMachine: timestamp - Math.floor(Date.now() / 1000) };
    } catch {
      chain = null;
    }
  }
  return { slot, stand: stand ?? null, services, chain };
}

function printStatus(s: Awaited<ReturnType<typeof statusOf>>, say: (line: string) => void): void {
  if (!s.stand) {
    say(`slot ${s.slot}: no stand.json`);
  } else {
    const how = s.stand.mode === "dev" ? "dev (Vite)" : `built, served by ${s.stand.server === "view" ? "view" : "static.ts"} (${s.stand.serverNote})`;
    say(`slot ${s.slot}: ${how}`);
    say(`  site   ${s.stand.site}`);
    say(`  rpc    ${s.stand.rpc}`);
    say(`  relay  ${s.stand.relay}`);
    say(`  core   ${s.stand.core}`);
    for (const t of s.stand.tokens) say(`  token  ${t.address}  ${t.symbol} (${t.kind})`);
    say(`  forwarder ${s.stand.forwarder}  account factory ${s.stand.accountFactory}`);
  }
  for (const v of s.services) {
    const state = v.running ? (v.listening ? "up" : "starting or not listening") : v.listening ? "port in use by another process" : "down";
    say(`  ${v.service.padEnd(6)} ${String(v.port).padEnd(6)} ${state}${v.pid ? `  pid ${v.pid} (${v.program})` : ""}`);
  }
  if (s.chain) say(`  chain time ${s.chain.timestamp} at block ${s.chain.block}: ${(s.chain.aheadOfMachine / 86_400).toFixed(2)} days ahead of this machine`);
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const { slot } = args;
  switch (args.command) {
    case "up": {
      await up(args);
      printStatus(await statusOf(slot), console.log);
      return;
    }
    case "down": {
      const slots = args.all ? usedSlots() : [slot];
      for (const s of slots) await down(s);
      return;
    }
    case "status": {
      const slots = args.slotGiven ? [slot] : usedSlots();
      const states = await Promise.all(slots.map(statusOf));
      if (args.json) console.log(JSON.stringify(args.slotGiven ? states[0] : states, null, 2));
      else if (states.length === 0) console.log("no stand on any slot");
      else states.forEach((s) => printStatus(s, console.log));
      return;
    }
    case "build": {
      needStand(slot);
      console.log(`build: ${pathsOf(slot).dist}, build.json hash ${await build(slot)}`);
      return;
    }
    case "stop": {
      console.log(`slot ${slot} ${await stopService(slot, args.service as Service)}`);
      return;
    }
    case "start": {
      const target = args.service as StartTarget;
      const service: Service = target === "view" || target === "static" ? "site" : target;
      needStand(slot);
      const running = readPids(slot)[service];
      if (running && ours(running)) throw new Error(`${service} of slot ${slot} already runs (pid ${running.pid}, ${running.program}); stop it first`);
      const ports = slotPorts(slot);
      if (await portBusy(ports[service])) throw new Error(`port ${ports[service]} is in use by another process`);
      if (target === "relay") await startRelay(slot);
      else if (target === "static") {
        await startStatic(slot);
        updateStand(slot, { mode: "built", site: siteUrl(ports), server: "static", serverNote: "started by hand: start static" });
      } else if (target === "view") {
        const view = await startView(slot);
        if (!view.ok) throw new Error(view.why);
        updateStand(slot, { mode: "built", site: siteUrl(ports), server: "view", serverNote: "started by hand: start view" });
      } else {
        await startDev(slot);
        updateStand(slot, { mode: "dev", site: devUrl(ports), server: null, serverNote: "" });
      }
      console.log(`slot ${slot} ${target}: started on port ${ports[service]}`);
      return;
    }
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: Error) => {
    console.error(`stand: ${error.message}`);
    process.exit(1);
  });
}
