/**
 * The demo engine's fork target (DEMO_TARGET=fork): Base Sepolia as it is now, copied into a
 * local anvil, with the public build of the app on top. Unlike tests/e2e/fork/run.ts (which proves
 * the deployment and stops), this one stays up for scenarios and shows:
 *
 *   - the real Core on Base Sepolia (the fork starts at the network's head, so Core is the one
 *     deployed there; if it is not there yet, Deploy.s.sol puts it at its canonical address);
 *   - Circle's real test USDC, with 1 000 written into anvil's test accounts 1 to 5 and into the
 *     engine's burner wallets (anvil_setStorageAt on the balance slot, ETH with anvil_setBalance);
 *   - the public build (chain.local false: no dev wallet, no gallery), as on Vercel, except that
 *     its RPC is the fork and its relay is a local one, so answers travel as on the real site but
 *     never reach the public relays.
 *
 * The public build logs in through Privy, and Privy answers only the origins its dashboard allows.
 * So by default the fork's build leaves Privy out (people come with a crypto wallet, through the
 * app's own sheet); with --privy-port the build keeps it and the site is served on
 * http://localhost:<that port>, an origin of `privy.origins` (3001, 3300, 3400 or 3411), for the
 * scenarios whose people sign in through Privy. Privy's test accounts' wallets get money too.
 *
 *   bun tests/demo/fork.ts up [--port-base 47100] [--privy-port 3411]   # rpc +0, relay +1, site +2
 *   bun tests/demo/fork.ts down
 *   bun tests/demo/fork.ts status
 *
 * Writes tests/demo/.run/fork/stand.json (the shape of a stand's), pids.json and logs. It sends
 * nothing to Base Sepolia: the public RPC is only read, by anvil, to copy state. Keys: anvil's
 * public test accounts and the engine's own burners, on this fork only.
 */
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { encodeAbiParameters, keccak256, numberToHex, pad, type Address, type Hex } from "viem";

import { buildApp, PUBLIC_CONFIG } from "../../apps/web/deploy.ts";
import { buildRecord } from "../../tools/manifest.ts";
import { burnerAddresses } from "./engine/burners.ts";
import { privyWallets } from "./engine/privy.ts";

const REPO = resolve(import.meta.dirname, "../..");
const RUN = join(REPO, "tests/demo/.run/fork");
const FOUNDRY = process.env.FOUNDRY_BIN ?? join(homedir(), ".foundry/bin");
const FORK_URL = process.env.FORK_URL ?? "https://sepolia.base.org";
const HOST = "127.0.0.1";
const CHAIN_ID = 84532;
const ANVIL_ACCOUNTS: Address[] = [
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
];
const USDC_EACH = 1_000n * 1_000_000n;
const ETH_EACH = 10n ** 19n;

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

let id = 0;
async function call<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: AbortSignal.timeout(20_000) });
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
  throw new Error(`${what} did not come up within ${ms} ms (logs in ${join(RUN, "logs")})`);
}

/** Starts a detached service with its own log; its process group id goes to pids.json. */
function start(name: string, command: string, args: string[], env: Record<string, string> = {}): number {
  mkdirSync(join(RUN, "logs"), { recursive: true });
  const fd = openSync(join(RUN, "logs", `${name}.log`), "w");
  const child = spawn(command, args, { cwd: REPO, env: { ...process.env, ...env }, stdio: ["ignore", fd, fd], detached: true });
  closeSync(fd);
  child.unref();
  return child.pid!;
}

/** Circle's FiatToken v2.2 keeps balances in the mapping at slot 9 (the top bit is the blocklist flag). */
function balanceSlot(holder: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, 9n]));
}

async function up(): Promise<void> {
  if (existsSync(join(RUN, "pids.json"))) throw new Error("a fork is up already: bun tests/demo/fork.ts down");
  const base = Number(arg("--port-base") ?? process.env.DEMO_FORK_PORT_BASE ?? 47100);
  const privyPort = arg("--privy-port") === undefined ? undefined : Number(arg("--privy-port"));
  const ports = { rpc: base, relay: base + 1, site: privyPort ?? base + 2 };
  for (const port of Object.values(ports)) if (await portBusy(port)) throw new Error(`port ${port} is taken`);
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(RUN, { recursive: true });
  const rpc = `http://${HOST}:${ports.rpc}`;
  const relay = `ws://${HOST}:${ports.relay}`;
  // Privy checks the page's origin against its dashboard's list, which names localhost.
  const site = privyPort === undefined ? `http://${HOST}:${ports.site}` : `http://localhost:${ports.site}`;
  const pids: Record<string, number> = {};
  const save = () => writeFileSync(join(RUN, "pids.json"), `${JSON.stringify(pids, null, 2)}\n`);

  try {
    const config = JSON.parse(readFileSync(PUBLIC_CONFIG, "utf8"));
    if (privyPort !== undefined && !(config.privy?.origins ?? []).includes(site)) throw new Error(`${site} is not one of privy.origins in ${PUBLIC_CONFIG}`);
    const core = config.cores.canonical as Address;
    const usdc = config.tokens[0].address as Address;
    const head = BigInt(await call<Hex>(FORK_URL, "eth_blockNumber"));
    const forkBlock = head - 5n;
    console.log(`fork: anvil copies ${FORK_URL} at block ${forkBlock} as chain ${CHAIN_ID} on ${rpc}`);
    pids.anvil = start("anvil", join(FOUNDRY, "anvil"), [
      "--fork-url", FORK_URL, "--fork-block-number", String(forkBlock), "--chain-id", String(CHAIN_ID),
      "--port", String(ports.rpc), "--host", HOST, "--block-time", "1", "--slots-in-an-epoch", "1",
    ]);
    save();
    await waitFor("anvil", 60_000, async () => Number(await call<Hex>(rpc, "eth_chainId")) === CHAIN_ID);

    // Core: the one on Base Sepolia, or deployed here at its canonical address.
    if ((await call<Hex>(rpc, "eth_getCode", [core, "latest"])) === "0x") {
      console.log("fork: Core is not on Base Sepolia at this block; deploying it with Deploy.s.sol");
      const out = "deployments/84532-demo-fork.json";
      const run = spawnSync("bash", ["script/deploy.sh", rpc, "--unlocked", "--sender", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"], { cwd: join(REPO, "contracts"), env: { ...process.env, DEPLOY_OUT: out, FOUNDRY_BIN: FOUNDRY }, encoding: "utf8" });
      rmSync(join(REPO, "contracts", out), { force: true });
      if (run.status !== 0) throw new Error(`deploy failed:\n${(run.stdout ?? "") + (run.stderr ?? "")}`.slice(0, 3000));
    } else console.log(`fork: Core ${core} is the one on Base Sepolia`);

    // Money: anvil's accounts 1–5 and the engine's burners.
    const holders = [...ANVIL_ACCOUNTS, ...burnerAddresses(), ...privyWallets()];
    for (const holder of holders) {
      await call(rpc, "anvil_setStorageAt", [usdc, balanceSlot(holder), pad(numberToHex(USDC_EACH))]);
      await call(rpc, "anvil_setBalance", [holder, numberToHex(ETH_EACH)]);
    }
    console.log(`fork: ${holders.length} accounts hold 1 000 test USDC and 10 ETH (${burnerAddresses().length} burners, ${privyWallets().length} Privy test wallets)`);

    // The relay, then the public build with the fork and the relay in its configuration.
    pids.relay = start("relay", process.execPath, ["infra/relay/relay.ts"], { PORT: String(ports.relay), HOST });
    save();
    await waitFor("relay", 10_000, () => portBusy(ports.relay));
    const { privy, ...withoutPrivy } = config;
    const forkConfig = { ...(privyPort === undefined ? withoutPrivy : { ...config, privy }), chain: { ...config.chain, rpcUrls: [rpc] }, site, relays: [relay], previews: false };
    const configFile = join(RUN, "config.json");
    writeFileSync(configFile, `${JSON.stringify(forkConfig, null, 2)}\n`);
    const dist = join(RUN, "dist");
    buildApp(configFile, dist, join(RUN, "vite"));
    writeFileSync(join(dist, "build.json"), `${JSON.stringify(buildRecord(dist), null, 2)}\n`);
    pids.site = start("site", process.execPath, ["infra/stand/static.ts", "--dir", dist, "--port", String(ports.site), "--config", configFile, "--host", HOST]);
    save();
    await waitFor("the site", 15_000, async () => (await fetch(`${site}/build.json`)).ok);

    const stand = { slot: null, mode: "built", fork: true, forkedFrom: { url: FORK_URL, block: Number(forkBlock) }, site, rpc, relay, chainId: CHAIN_ID, core, tokens: [{ address: usdc, symbol: "USDC", decimals: 6, kind: "usd" }], forwarder: config.forwarder, accountFactory: null, aheadSeconds: 0, privy: privyPort !== undefined };
    writeFileSync(join(RUN, "stand.json"), `${JSON.stringify(stand, null, 2)}\n`);
    console.log(`fork: up — site ${site}, rpc ${rpc}, relay ${relay}\n  DEMO_TARGET=fork bunx playwright test -c playwright.demo.config.ts`);
  } catch (error) {
    down();
    throw error;
  }
}

function down(): void {
  const file = join(RUN, "pids.json");
  if (!existsSync(file)) return void console.log("fork: nothing is up");
  const pids = JSON.parse(readFileSync(file, "utf8")) as Record<string, number>;
  for (const [name, pid] of Object.entries(pids)) {
    try {
      process.kill(-pid, "SIGTERM");
      console.log(`fork: ${name} stopped`);
    } catch {
      /* gone already */
    }
  }
  rmSync(file, { force: true });
  rmSync(join(RUN, "stand.json"), { force: true });
}

const command = process.argv[2];
if (command === "up") await up();
else if (command === "down") down();
else if (command === "status") console.log(existsSync(join(RUN, "stand.json")) ? readFileSync(join(RUN, "stand.json"), "utf8") : "fork: down");
else {
  console.error("usage: bun tests/demo/fork.ts up [--port-base N] [--privy-port 3411] | down | status");
  process.exit(2);
}
