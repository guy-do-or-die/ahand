/**
 * A local chain for tests: anvil on a free port, its clock 40 days ahead of this machine's, with
 * Core deployed through the CREATE2 deployer exactly as `contracts/script/Deploy.s.sol` deploys it,
 * the two test tokens minted to anvil accounts 1 to 5, and the test account factory and forwarder
 * when their artifacts are built.
 *
 * It deploys from the artifacts in `contracts/out` with viem and never starts a compiler. It runs
 * under Bun and under Node (vitest), so it uses no Bun-only API.
 *
 *   bun packages/sdk/tests/helpers/anvil.ts --selftest
 *   bun packages/sdk/tests/helpers/anvil.ts --serve [--write-stand FILE] [--write-config FILE]
 *
 * Options: --port N (or ANVIL_PORT), --ahead SECONDS (default 3 456 000, 40 days).
 * Binaries come from $FOUNDRY_BIN (default ~/.foundry/bin): a bare `anvil` may be another program.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  stringToBytes,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { PRICES } from "../../src/app.js";

/** The deterministic deployment proxy every anvil ships (and every real chain has). */
export const CREATE2_FACTORY: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
/** The same salt on every chain, so the same initcode lands at the same address. */
export const CORE_SALT: Hex = keccak256(stringToBytes("aHand.core/1"));
/** 40 days: the stand's clock runs this far ahead of the machine's, so a slip to `Date.now()` shows at once. */
export const AHEAD_SECONDS = 40 * 24 * 60 * 60;

/** anvil's well-known test keys (public, for local chains only). Index 0 deploys; 1 to 5 receive tokens. */
export const ANVIL_KEYS: readonly Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
];

/** How much of each test token accounts 1 to 5 receive: one million dollars of six decimals. */
export const MINT_AMOUNT = 1_000_000n * 10n ** 6n;

export type TokenKind = "usd" | "blacklist";

export interface ChainToken {
  address: Address;
  symbol: string;
  decimals: number;
  kind: TokenKind;
}

/** The facts a deployment leaves: the same fields as contracts/deployments/<chainId>.json. */
export interface HelperDeployment {
  chainId: number;
  core: Address;
  factory: Address;
  salt: Hex;
  initcodeHash: Hex;
  runtimeHash: Hex;
  deployBlock: number;
  tokens: ChainToken[];
  forwarder: Address | null;
  accountFactory: Address | null;
  commit: string;
  dirty: boolean;
  solc: string;
  optimizerRuns: number;
  evmVersion: string;
  oz: string;
}

export interface StartOptions {
  /** A port to listen on; left out, the system picks a free one. */
  port?: number;
  /** Seconds the chain's clock starts ahead of this machine's. */
  aheadSeconds?: number;
  /** Seconds between blocks; left out, a block is mined for each transaction. */
  blockTime?: number;
  /** One slot per epoch makes `safe` and `finalized` trail `latest` by 1 and 2 blocks. */
  slotsInAnEpoch?: number;
  /** The folder of `forge build` output; default `contracts/out` of this repository. */
  artifacts?: string;
}

export interface Chain extends HelperDeployment {
  rpc: string;
  port: number;
  aheadSeconds: number;
  /** anvil's process id, so a caller that must can stop exactly this chain. */
  pid: number;
  client: PublicClient;
  /** A wallet over anvil account 0, the deployer. */
  wallet: WalletClient;
  deployer: PrivateKeyAccount;
  stop(): Promise<void>;
}

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../../..");
const DEFAULT_ARTIFACTS = join(REPO_ROOT, "contracts/out");

export function foundryBin(tool: "anvil" | "cast" | "forge"): string {
  const dir = process.env.FOUNDRY_BIN || join(homedir(), ".foundry/bin");
  const path = join(dir, tool);
  if (!existsSync(path)) throw new Error(`${tool} not found at ${path}; set FOUNDRY_BIN to Foundry's bin folder`);
  return path;
}

export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });
}

interface Artifact {
  abi: Abi;
  bytecode: Hex;
}

/** Reads a forge artifact; retries briefly, because a `forge build` elsewhere may be rewriting it. */
function artifactAt(folder: string, file: string, name: string): Artifact | undefined {
  const path = join(folder, file, `${name}.json`);
  if (!existsSync(path)) return undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      const json = JSON.parse(readFileSync(path, "utf8"));
      const bytecode = json.bytecode?.object as Hex | undefined;
      if (!bytecode || bytecode === "0x") throw new Error(`${path} has no bytecode`);
      return { abi: json.abi as Abi, bytecode };
    } catch (error) {
      if (attempt >= 20) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

function needArtifact(folder: string, file: string, name: string): Artifact {
  const found = artifactAt(folder, file, name);
  if (!found) throw new Error(`${join(folder, file, name)}.json is missing: build the contracts first (forge build in contracts/)`);
  return found;
}

function buildFacts(folder: string): Pick<HelperDeployment, "commit" | "dirty" | "solc" | "optimizerRuns" | "evmVersion" | "oz"> {
  const git = (args: string[]) => {
    const run = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
    return run.status === 0 ? run.stdout.trim() : "";
  };
  const meta = JSON.parse(readFileSync(join(folder, "AHandCore.sol/AHandCore.json"), "utf8")).metadata ?? {};
  const settings = meta.settings ?? {};
  let oz = "";
  const ozPackage = join(REPO_ROOT, "contracts/lib/openzeppelin-contracts/package.json");
  if (existsSync(ozPackage)) oz = JSON.parse(readFileSync(ozPackage, "utf8")).version ?? "";
  return {
    commit: git(["rev-parse", "HEAD"]),
    dirty: git(["status", "--porcelain", "--", "contracts/src"]) !== "",
    solc: meta.compiler?.version ?? "",
    optimizerRuns: settings.optimizer?.runs ?? 0,
    evmVersion: settings.evmVersion ?? "",
    oz,
  };
}

async function waitForRpc(client: PublicClient, anvil: ChildProcess, log: () => string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (anvil.exitCode !== null) throw new Error(`anvil exited with ${anvil.exitCode}: ${log()}`);
    try {
      await client.getChainId();
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 50));
    }
  }
  throw new Error(`anvil did not answer: ${log()}`);
}

/** Starts anvil, deploys Core and the test contracts, and returns the chain with how to stop it. */
export async function startChain(options: StartOptions = {}): Promise<Chain> {
  const folder = options.artifacts ?? DEFAULT_ARTIFACTS;
  const coreArtifact = needArtifact(folder, "AHandCore.sol", "AHandCore");
  const usdArtifact = needArtifact(folder, "MockUSD.sol", "MockUSD");
  const blacklistArtifact = needArtifact(folder, "BlacklistToken.sol", "BlacklistToken");
  const accountFactoryArtifact = artifactAt(folder, "KeyAccount.sol", "KeyAccountFactory");
  const forwarderArtifact = artifactAt(folder, "Forwarder.sol", "Forwarder");

  const port = options.port ?? (await freePort());
  const aheadSeconds = options.aheadSeconds ?? AHEAD_SECONDS;
  // The one place the machine's clock is read: to set the chain's clock ahead of it.
  const startTime = Math.floor(Date.now() / 1000) + aheadSeconds;
  const args = ["--port", String(port), "--host", "127.0.0.1", "--chain-id", "31337", "--timestamp", String(startTime)];
  if (options.blockTime !== undefined) args.push("--block-time", String(options.blockTime));
  if (options.slotsInAnEpoch !== undefined) args.push("--slots-in-an-epoch", String(options.slotsInAnEpoch));

  const anvil = spawn(foundryBin("anvil"), args, { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  anvil.stdout?.on("data", (chunk) => (output = (output + chunk).slice(-4000)));
  anvil.stderr?.on("data", (chunk) => (output = (output + chunk).slice(-4000)));

  const stop = async () => {
    if (anvil.exitCode !== null || anvil.signalCode !== null) return;
    const exited = new Promise<void>((done) => anvil.once("exit", () => done()));
    anvil.kill("SIGTERM");
    const timer = setTimeout(() => anvil.kill("SIGKILL"), 3000);
    await exited;
    clearTimeout(timer);
  };

  try {
    const rpc = `http://127.0.0.1:${port}`;
    const client = createPublicClient({ chain: foundry, transport: http(rpc), pollingInterval: 100 }) as PublicClient;
    await waitForRpc(client, anvil, () => output);
    const deployer = privateKeyToAccount(ANVIL_KEYS[0]!);
    const wallet = createWalletClient({ account: deployer, chain: foundry, transport: http(rpc) });

    const mined = async (hash: Hex) => {
      const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 100 });
      if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
      return receipt;
    };

    const factoryCode = await client.getCode({ address: CREATE2_FACTORY });
    if (!factoryCode || factoryCode === "0x") throw new Error("this anvil has no CREATE2 deployer");

    // Every transaction is sent at once with its own nonce, then all are awaited: with one block
    // a second (--serve) the whole deployment takes a block or two instead of one per transaction.
    // Addresses are known before anything is mined, so the mints can follow their tokens' deploys.
    let nonce = await client.getTransactionCount({ address: deployer.address, blockTag: "pending" });
    const sent: Promise<Hex>[] = [];
    const send = (to: Address | null, data: Hex, gas?: bigint): { nonce: number } => {
      const own = nonce++;
      sent.push(
        (async () => {
          const limit = gas ?? ((await client.estimateGas({ account: deployer.address, ...(to ? { to } : {}), data })) * 12n) / 10n;
          return wallet.sendTransaction({ ...(to ? { to } : {}), data, gas: limit, nonce: own, chain: foundry } as Parameters<typeof wallet.sendTransaction>[0]);
        })(),
      );
      return { nonce: own };
    };
    const deploy = (artifact: Artifact, what: string): Address => {
      const constructor = artifact.abi.find((item) => item.type === "constructor");
      if (constructor && "inputs" in constructor && constructor.inputs.length > 0) {
        throw new Error(`${what} takes constructor arguments; the helper deploys only argument-free test contracts`);
      }
      const { nonce: own } = send(null, artifact.bytecode);
      return getContractAddress({ from: deployer.address, nonce: BigInt(own) });
    };

    // Core through the CREATE2 deployer: calldata is the salt followed by the initcode.
    const initcode = coreArtifact.bytecode;
    const core = getContractAddress({ opcode: "CREATE2", from: CREATE2_FACTORY, salt: CORE_SALT, bytecode: initcode });
    send(CREATE2_FACTORY, `${CORE_SALT}${initcode.slice(2)}` as Hex);
    const usd = deploy(usdArtifact, "MockUSD");
    const blacklist = deploy(blacklistArtifact, "BlacklistToken");
    const accountFactory = accountFactoryArtifact ? deploy(accountFactoryArtifact, "KeyAccountFactory") : null;
    const forwarder = forwarderArtifact ? deploy(forwarderArtifact, "Forwarder") : null;
    for (const [token, artifact] of [
      [usd, usdArtifact],
      [blacklist, blacklistArtifact],
    ] as const) {
      for (const key of ANVIL_KEYS.slice(1, 6)) {
        const to = privateKeyToAccount(key).address;
        send(token, encodeFunctionData({ abi: artifact.abi, functionName: "mint", args: [to, MINT_AMOUNT] }), 120_000n);
      }
    }
    const receipts = await Promise.all((await Promise.all(sent)).map(mined));
    const coreReceipt = receipts[0]!;

    const runtime = await client.getCode({ address: core });
    if (!runtime || runtime === "0x") throw new Error(`no code at the derived Core address ${core}`);
    const tokens: ChainToken[] = [];
    for (const [address, artifact, kind] of [
      [usd, usdArtifact, "usd"],
      [blacklist, blacklistArtifact, "blacklist"],
    ] as const) {
      const symbol = (await client.readContract({ address, abi: artifact.abi, functionName: "symbol" })) as string;
      const decimals = Number(await client.readContract({ address, abi: artifact.abi, functionName: "decimals" }));
      tokens.push({ address, symbol, decimals, kind });
    }

    return {
      chainId: 31337,
      core,
      factory: CREATE2_FACTORY,
      salt: CORE_SALT,
      initcodeHash: keccak256(initcode),
      runtimeHash: keccak256(runtime),
      deployBlock: Number(coreReceipt.blockNumber),
      tokens,
      forwarder,
      accountFactory,
      ...buildFacts(folder),
      rpc,
      port,
      aheadSeconds,
      pid: anvil.pid!,
      client,
      wallet,
      deployer,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** The shape of a local stand's `stand.json`, for a helper chain. */
export function standOf(chain: Chain) {
  return {
    slot: null,
    mode: "helper" as const,
    site: null,
    rpc: chain.rpc,
    relay: null,
    chainId: chain.chainId,
    core: chain.core,
    tokens: chain.tokens,
    forwarder: chain.forwarder,
    accountFactory: chain.accountFactory,
    aheadSeconds: chain.aheadSeconds,
    pid: chain.pid,
    deployment: deploymentOf(chain),
  };
}

export function deploymentOf(chain: Chain): HelperDeployment {
  const { chainId, core, factory, salt, initcodeHash, runtimeHash, deployBlock, tokens, forwarder, accountFactory } = chain;
  const { commit, dirty, solc, optimizerRuns, evmVersion, oz } = chain;
  return { chainId, core, factory, salt, initcodeHash, runtimeHash, deployBlock, tokens, forwarder, accountFactory, commit, dirty, solc, optimizerRuns, evmVersion, oz };
}

const TOKEN_LABELS: Record<TokenKind, string> = { usd: "Test dollars", blacklist: "Test dollars that can block" };

/**
 * An app configuration for this chain. The defaults of a new Hand: the helper gets at least 70 %,
 * room for each payout 250 thousand gas, 30 days.
 */
export function configOf(chain: Chain, site = "http://127.0.0.1", relays: string[] = []) {
  return {
    chain: { id: chain.chainId, name: "Local test network", rpcUrls: [chain.rpc], blockTimeMs: 1000, local: true, hasL1: false },
    cores: { trusted: [{ chainId: chain.chainId, core: chain.core }], canonical: chain.core },
    deployment: {
      factory: chain.factory,
      salt: chain.salt,
      initcodeHash: chain.initcodeHash,
      deployBlock: chain.deployBlock,
      commit: chain.commit,
      dirty: chain.dirty,
    },
    tokens: chain.tokens.map((token) => ({ ...token, label: TOKEN_LABELS[token.kind] })),
    forwarder: chain.forwarder,
    accountFactory: chain.accountFactory,
    relays,
    site,
    prices: PRICES,
    defaults: { minClaimBps: 7000, payoutGasK: 250, expiryDays: 30 },
  };
}

function writeJson(file: string, value: unknown): void {
  const path = resolve(file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
}

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at < 0) return undefined;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

async function main(argv: string[]): Promise<number> {
  const selftest = argv.includes("--selftest");
  const writeStand = flag(argv, "--write-stand");
  const writeConfig = flag(argv, "--write-config");
  // A written file names a chain that must stay up to be useful, so --write-* implies --serve.
  const serve = argv.includes("--serve") || (!selftest && (writeStand !== undefined || writeConfig !== undefined));
  if (!selftest && !serve) {
    console.error("usage: anvil.ts --selftest | --serve [--write-stand FILE] [--write-config FILE] [--port N] [--ahead SECONDS]");
    return 2;
  }
  const portText = flag(argv, "--port") ?? process.env.ANVIL_PORT;
  const aheadText = flag(argv, "--ahead");
  const chain = await startChain({
    port: portText ? Number(portText) : undefined,
    aheadSeconds: aheadText ? Number(aheadText) : undefined,
    ...(serve ? { blockTime: 1, slotsInAnEpoch: 1 } : {}),
  });

  if (writeStand) writeJson(writeStand, standOf(chain));
  if (writeConfig) writeJson(writeConfig, configOf(chain));

  if (selftest) {
    try {
      const code = await chain.client.getCode({ address: chain.core });
      const block = await chain.client.getBlock({ blockTag: "latest" });
      const machine = Math.floor(Date.now() / 1000);
      const ahead = Number(block.timestamp) - machine;
      const days = ahead / 86400;
      const codeBytes = code ? (code.length - 2) / 2 : 0;
      const derived = getContractAddress({ opcode: "CREATE2", from: chain.factory, salt: chain.salt, bytecodeHash: chain.initcodeHash });
      console.log(`rpc            ${chain.rpc}`);
      console.log(`core           ${chain.core} (${codeBytes} bytes of code; CREATE2 derivation ${derived === chain.core ? "matches" : "DIFFERS"})`);
      console.log(`salt           ${chain.salt} = keccak256("aHand.core/1")`);
      console.log(`initcodeHash   ${chain.initcodeHash}`);
      for (const token of chain.tokens) console.log(`token          ${token.address} ${token.symbol} ${token.decimals} decimals (${token.kind})`);
      console.log(`accountFactory ${chain.accountFactory ?? "null (no KeyAccount.sol artifact in contracts/out)"}`);
      console.log(`forwarder      ${chain.forwarder ?? "null (no Forwarder.sol artifact in contracts/out)"}`);
      console.log(`chain time     ${block.timestamp} at block ${block.number}; machine ${machine}; ahead ${ahead} s = ${days.toFixed(2)} days`);
      const ok = codeBytes > 0 && derived === chain.core && ahead >= 39 * 86400;
      console.log(ok ? "selftest ok" : "selftest FAILED");
      return ok ? 0 : 1;
    } finally {
      await chain.stop();
    }
  }

  console.log(JSON.stringify({ rpc: chain.rpc, pid: chain.pid, core: chain.core, tokens: chain.tokens, forwarder: chain.forwarder, accountFactory: chain.accountFactory }));
  const shutdown = async () => {
    await chain.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => {});
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
