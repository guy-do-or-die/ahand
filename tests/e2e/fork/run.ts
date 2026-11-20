/**
 * The public test build proved on a local fork of Base Sepolia (docs/public-test-deployment.md):
 *
 *   bun tests/e2e/fork/run.ts            # FORK_URL, FORK_PORT, FORK_SITE_PORT to move it;
 *                                        # FORK_KEEP=1 keeps the fork and the site up afterwards
 *
 *  1. anvil forks Base Sepolia at a block near its head, as chain 84532, on 127.0.0.1:FORK_PORT
 *     (default 32200), a block a second;
 *  2. the app is built with apps/hand/src/config/base-sepolia.json whose RPC is the fork and whose
 *     site is 127.0.0.1:FORK_SITE_PORT (default 32202), chain.local false as on Vercel; build.json
 *     is written beside it as the Vercel build writes it; infra/stand/static.ts serves it;
 *  3. the browser checks the honest "not on Base Sepolia yet" sentence (FORK_PHASE=absent);
 *  4. Core is deployed on the fork with contracts/script/deploy.sh from anvil's public test
 *     account 0 (unlocked on anvil, so no key on any command line); the address must be the
 *     canonical one and check-deployment.sh must pass; the deployment's gas is measured;
 *  5. anvil's test accounts 1 to 5 get 1 000 test USDC each (anvil_setStorageAt on Circle's
 *     balance slot, read back with balanceOf);
 *  6. the browser life runs (FORK_PHASE=life), then the SDK's own loop (infra/stand/loop.ts --only usd);
 *  7. everything is stopped and the fork's deployment file is moved out of contracts/deployments.
 *
 * It never sends anything to the forked network itself: every transaction goes to the local anvil.
 * Results: tests/e2e/test-results/fork/ (summary.json, logs, the fork's deployment JSON).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { encodeAbiParameters, keccak256, numberToHex, pad, type Address, type Hex } from "viem";

import { buildApp, PUBLIC_CONFIG } from "../../../apps/hand/vercel.ts";
import { buildRecord } from "../../../tools/manifest.ts";

const REPO = resolve(import.meta.dirname, "../../..");
const FOUNDRY = process.env.FOUNDRY_BIN ?? join(homedir(), ".foundry/bin");
const FORK_URL = process.env.FORK_URL ?? "https://sepolia.base.org";
const FORK_PORT = Number(process.env.FORK_PORT ?? 32200);
const SITE_PORT = Number(process.env.FORK_SITE_PORT ?? 32202);
const HOST = "127.0.0.1";
const RPC = `http://${HOST}:${FORK_PORT}`;
const SITE = `http://${HOST}:${SITE_PORT}`;
const WORK = join(REPO, "tests/e2e/test-results/fork");
const CHAIN_ID = 84532;
const DEPLOYER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // anvil's public test account 0
const FUNDED: Address[] = [
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
];
const DEPLOY_OUT = "deployments/84532-fork.json";

const config = JSON.parse(readFileSync(PUBLIC_CONFIG, "utf8"));
const CORE: Address = config.cores.canonical;
const USDC: Address = config.tokens[0].address;

const children: ChildProcess[] = [];
const summary: Record<string, unknown> = { fork: { url: FORK_URL, port: FORK_PORT }, site: SITE, core: CORE };
const say = (line: string) => console.log(`fork: ${line}`);

let id = 0;
async function call<T>(method: string, params: unknown[] = [], url = RPC): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

function portBusy(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ port, host: HOST });
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
  });
}

async function waitFor(what: string, ms: number, ok: () => Promise<boolean>): Promise<void> {
  for (let waited = 0; waited < ms; waited += 250) {
    if (await ok().catch(() => false)) return;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`${what} did not come up within ${ms} ms`);
}

function start(name: string, command: string, args: string[], env: Record<string, string> = {}): ChildProcess {
  const fd = openSync(join(WORK, `${name}.log`), "w");
  const child = spawn(command, args, { cwd: REPO, env: { ...process.env, ...env }, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  children.push(child);
  return child;
}

function run(name: string, command: string, args: string[], env: Record<string, string> = {}, cwd = REPO): string {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(join(WORK, `${name}.log`), out);
  if (result.status !== 0) throw new Error(`${name} failed (exit ${result.status}); see ${join(WORK, `${name}.log`)}:\n${out.split("\n").slice(-25).join("\n")}`);
  return out;
}

function playwright(phase: string): void {
  say(`browser: FORK_PHASE=${phase}`);
  const out = run(`playwright-${phase}`, process.execPath, ["x", "playwright", "test", "tests/e2e/fork/base-sepolia.spec.ts"], {
    STAND_BASE_URL: SITE,
    FORK_RPC: RPC,
    FORK_CORE: CORE,
    FORK_USDC: USDC,
    FORK_PHASE: phase,
  });
  const line = out.split("\n").filter((l) => /passed|failed|skipped/.test(l)).pop() ?? "";
  summary[`browser-${phase}`] = line.trim();
  say(`browser ${phase}: ${line.trim()}`);
}

/** Circle's FiatToken v2.2 keeps balances in the mapping at slot 9 (the top bit is the blocklist flag). */
function balanceSlot(holder: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, 9n]));
}

async function balanceOf(holder: Address): Promise<bigint> {
  const data = `0x70a08231${pad(holder).slice(2)}` as Hex;
  return BigInt(await call<Hex>("eth_call", [{ to: USDC, data }, "latest"]));
}

async function main(): Promise<void> {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  for (const port of [FORK_PORT, SITE_PORT]) if (await portBusy(port)) throw new Error(`port ${port} is taken`);

  // 1. The fork, pinned a few blocks behind the head the public RPC reports now.
  const head = BigInt(await call<Hex>("eth_blockNumber", [], FORK_URL));
  const forkBlock = head - 5n;
  summary.fork = { ...(summary.fork as object), block: Number(forkBlock) };
  say(`anvil forks ${FORK_URL} at block ${forkBlock} as chain ${CHAIN_ID} on ${RPC}`);
  start("anvil", join(FOUNDRY, "anvil"), [
    "--fork-url", FORK_URL, "--fork-block-number", String(forkBlock), "--chain-id", String(CHAIN_ID),
    "--port", String(FORK_PORT), "--host", HOST, "--block-time", "1", "--slots-in-an-epoch", "1",
  ]);
  await waitFor("anvil", 60_000, async () => Number(await call<Hex>("eth_chainId")) === CHAIN_ID);

  // 2. The public build with the fork as its RPC.
  const forkConfig = { ...config, chain: { ...config.chain, rpcUrls: [RPC] }, site: SITE };
  if (forkConfig.chain.local !== false) throw new Error("the public configuration must say chain.local false");
  const configFile = join(WORK, "config.json");
  writeFileSync(configFile, `${JSON.stringify(forkConfig, null, 2)}\n`);
  const dist = join(WORK, "dist");
  buildApp(configFile, dist, join(WORK, "vite"));
  writeFileSync(join(dist, "build.json"), `${JSON.stringify(buildRecord(dist), null, 2)}\n`);
  start("static", process.execPath, ["infra/stand/static.ts", "--dir", dist, "--port", String(SITE_PORT), "--config", configFile, "--host", HOST]);
  await waitFor("static.ts", 15_000, async () => (await fetch(`${SITE}/build.json`)).ok);
  say(`the build is served on ${SITE}`);

  // 3. Before Core: the honest sentence.
  const empty = await call<Hex>("eth_getCode", [CORE, "latest"]);
  if (empty !== "0x") throw new Error(`Core already has code at ${CORE} on this fork`);
  playwright("absent");

  // 4. Core, from anvil's account 0 (unlocked), through the repository's own script.
  const balanceBefore = BigInt(await call<Hex>("eth_getBalance", [DEPLOYER, "latest"]));
  rmSync(join(REPO, "contracts", DEPLOY_OUT), { force: true });
  run("deploy", "bash", ["script/deploy.sh", RPC, "--unlocked", "--sender", DEPLOYER], { DEPLOY_OUT, FOUNDRY_BIN: FOUNDRY }, join(REPO, "contracts"));
  const deployment = JSON.parse(readFileSync(join(REPO, "contracts", DEPLOY_OUT), "utf8"));
  copyFileSync(join(REPO, "contracts", DEPLOY_OUT), join(WORK, "deployment.json"));
  if (deployment.core.toLowerCase() !== CORE.toLowerCase()) throw new Error(`Core landed at ${deployment.core}, not ${CORE}`);
  const check = run("check-deployment", "bash", ["script/check-deployment.sh", DEPLOY_OUT, RPC], { FOUNDRY_BIN: FOUNDRY }, join(REPO, "contracts"));
  const broadcast = JSON.parse(readFileSync(join(REPO, "contracts/broadcast/Deploy.s.sol", String(CHAIN_ID), "run-latest.json"), "utf8"));
  const receipt = broadcast.receipts[0] as { gasUsed: Hex; effectiveGasPrice: Hex; transactionHash: Hex };
  const tx = broadcast.transactions[0] as { transaction: { input?: Hex; data?: Hex } };
  const balanceAfter = BigInt(await call<Hex>("eth_getBalance", [DEPLOYER, "latest"]));
  summary.deploy = {
    address: deployment.core,
    deployBlock: deployment.deployBlock,
    initcodeHash: deployment.initcodeHash,
    txHash: receipt.transactionHash,
    gasUsed: Number(BigInt(receipt.gasUsed)),
    effectiveGasPriceWei: BigInt(receipt.effectiveGasPrice).toString(),
    calldataBytes: ((tx.transaction.input ?? tx.transaction.data ?? "0x").length - 2) / 2,
    ethSpentOnFork: (Number(balanceBefore - balanceAfter) / 1e18).toFixed(9),
    checkDeployment: check.trim().split("\n").pop(),
  };
  say(`Core at ${deployment.core}, gas ${BigInt(receipt.gasUsed)}; ${check.trim().split("\n").pop()}`);

  // 5. Test USDC for anvil's accounts 1 to 5.
  const amount = 1_000n * 1_000_000n;
  for (const holder of FUNDED) {
    await call("anvil_setStorageAt", [USDC, balanceSlot(holder), pad(numberToHex(amount))]);
    const balance = await balanceOf(holder);
    if (balance !== amount) throw new Error(`${holder} holds ${balance} USDC units after the write, not ${amount}`);
  }
  summary.funded = { usdcEach: "1000", accounts: FUNDED.length };
  say("accounts 1 to 5 hold 1 000 test USDC each");

  // 6. The browser life, then the SDK's own loop over a stand file that names this fork.
  playwright("life");
  const standFile = join(WORK, "stand.json");
  writeFileSync(standFile, `${JSON.stringify({ slot: null, mode: "built", fork: true, site: SITE, rpc: RPC, relay: null, chainId: CHAIN_ID, core: CORE, tokens: [{ address: USDC, symbol: "USDC", decimals: 6, kind: "usd" }], forwarder: config.forwarder, accountFactory: null, aheadSeconds: 0 }, null, 2)}\n`);
  const loop = run("sdk-loop", process.execPath, ["infra/stand/loop.ts", "--stand", standFile, "--only", "usd"]);
  summary.sdkLoop = loop.trim().split("\n").filter((l) => l.trim()).slice(-3);
  say(`SDK loop: ${loop.trim().split("\n").pop()}`);
}

async function stop(): Promise<void> {
  for (const child of children.reverse()) child.kill("SIGTERM");
  await new Promise((done) => setTimeout(done, 500));
  for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
  const leftover = join(REPO, "contracts", DEPLOY_OUT);
  if (existsSync(leftover)) renameSync(leftover, join(WORK, "deployment-left.json"));
  rmSync(join(WORK, "deployment-left.json"), { force: true });
}

try {
  await main();
  summary.ok = true;
} catch (error) {
  summary.ok = false;
  summary.error = (error as Error).message;
  console.error(`fork: ${(error as Error).message}`);
} finally {
  if (process.env.FORK_KEEP === "1") {
    // For looking around by hand: the fork and the site stay up until this process is stopped.
    say(`FORK_KEEP=1: the fork stays on ${RPC} and the site on ${SITE}; stop this process to take them down`);
    await new Promise<void>((done) => {
      process.once("SIGINT", () => done());
      process.once("SIGTERM", () => done());
    });
  }
  await stop();
  writeFileSync(join(WORK, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  say(`summary in ${join(WORK, "summary.json")}`);
}
process.exit(summary.ok ? 0 : 1);
