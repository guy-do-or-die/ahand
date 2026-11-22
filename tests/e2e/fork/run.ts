/**
 * The public test build proved on a local fork of Base Sepolia (docs/public-test-deployment.md):
 *
 *   bun tests/e2e/fork/run.ts            # FORK_URL, FORK_PORT, FORK_SITE_PORT to move it;
 *                                        # FORK_KEEP=1 keeps the fork and the site up afterwards
 *
 *  1. anvil forks Base Sepolia at a block near its head (once Core is on Base Sepolia, the last block
 *     before it; FORK_BLOCK pins one), as chain 84532, on 127.0.0.1:FORK_PORT (default 32200), a
 *     block a second;
 *  2. the app is built with apps/web/src/config/base-sepolia.json whose RPC is the fork and whose
 *     site is 127.0.0.1:FORK_SITE_PORT (default 32202), chain.local false as on Vercel; build.json
 *     is written beside it as the Vercel build writes it; infra/stand/static.ts serves it;
 *  3. the browser checks the honest "not on Base Sepolia yet" sentence (FORK_PHASE=absent);
 *  4. Core is deployed on the fork with contracts/script/deploy.sh from anvil's public test
 *     account 0 (unlocked on anvil, so no key on any command line); the address must be the
 *     canonical one and check-deployment.sh must pass; the deployment's gas is measured;
 *  5. anvil's test accounts 1 to 5 get 1 000 test USDC each (anvil_setStorageAt on Circle's
 *     balance slot, read back with balanceOf);
 *  6. the browser life runs (FORK_PHASE=life), then the SDK's own loop (infra/stand/loop.ts --only usd);
 *  7. link previews: the view server's Vercel Function is built as `bun apps/web/deploy.ts build` builds it,
 *     but reading the fork; its files are gathered as Vercel gathers them (@vercel/nft and
 *     includeFiles), copied out alone, and run by Node (FORK_NODE, Node 24 as on Vercel) with a
 *     Request for each shape of a Hand's address raised here through the SDK (unlisted with d,
 *     numbered, public, dark, unknown, a d changed, another chain) and for their cards;
 *  8. everything is stopped and the fork's deployment file is moved out of contracts/deployments.
 *
 * It never sends anything to the forked network itself: every transaction goes to the local anvil.
 * Results: tests/e2e/test-results/fork/ (summary.json, logs, the fork's deployment JSON).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { createPublicClient, encodeAbiParameters, http, keccak256, numberToHex, pad, type Address, type Hex, type PublicClient } from "viem";

import { fromBase64Url, toText } from "@ahand/sdk";
import { ANVIL_KEYS, type ChainToken } from "@ahand/sdk/testing";

import { isolate } from "../../../apps/view/src/bidi.ts";
import { metaOf, raiseHand, unescape, USD, type RaiseChain } from "../../../apps/view/tests/hands.ts";
import { buildApp, copyFunction, FUNCTION_ENTRY, functionFileList, PUBLIC_CONFIG, stageFunction } from "../../../apps/web/deploy.ts";
import { buildRecord } from "../../../tools/manifest.ts";

const REPO = resolve(import.meta.dirname, "../../..");
const FOUNDRY = process.env.FOUNDRY_BIN ?? join(homedir(), ".foundry/bin");
const FORK_URL = process.env.FORK_URL ?? "https://sepolia.base.org";
const FORK_PORT = Number(process.env.FORK_PORT ?? 32200);
const SITE_PORT = Number(process.env.FORK_SITE_PORT ?? 32202);
const HOST = "127.0.0.1";
const RPC = `http://${HOST}:${FORK_PORT}`;
const SITE = `http://${HOST}:${SITE_PORT}`;
/** The Node that runs the function (Vercel runs it on Node.js 24, apps/web/api/package.json). */
const NODE = process.env.FORK_NODE ?? "node";
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

/**
 * The last block at or before `upTo` where Core has no code on the forked network: `upTo` itself
 * while Core is not there, else found by bisection over at most `back` blocks (eth_getCode reads
 * only; the public RPC keeps that much state).
 */
async function lastBlockWithoutCore(upTo: bigint, back = 200_000n): Promise<bigint> {
  const empty = async (block: bigint) => (await call<Hex>("eth_getCode", [CORE, numberToHex(block)], FORK_URL)) === "0x";
  if (await empty(upTo)) return upTo;
  let lo = upTo - back;
  let hi = upTo;
  if (!(await empty(lo))) throw new Error(`Core has code on ${FORK_URL} already at block ${lo}; set FORK_BLOCK to a block before it came`);
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (await empty(mid)) lo = mid;
    else hi = mid;
  }
  summary.coreOnForkedNetwork = { firstBlockWithCode: Number(hi) };
  say(`Core is on ${FORK_URL} since block ${hi}; the fork starts at block ${lo}, before it`);
  return lo;
}

async function main(): Promise<void> {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  for (const port of [FORK_PORT, SITE_PORT]) if (await portBusy(port)) throw new Error(`port ${port} is taken`);

  // 1. The fork, pinned a few blocks behind the head the public RPC reports now, or, once Core is
  //    on Base Sepolia itself, at the last block before it came (FORK_BLOCK pins one by hand).
  const head = BigInt(await call<Hex>("eth_blockNumber", [], FORK_URL));
  const forkBlock = process.env.FORK_BLOCK ? BigInt(process.env.FORK_BLOCK) : await lastBlockWithoutCore(head - 5n);
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

  // 7. Link previews through the view server's Vercel Function, under Node, reading the fork.
  await previews(configFile, dist);
}

/** One expectation of the function's answers; a failure names the path and what was seen. */
function expectThat(ok: boolean, what: string, seen: unknown): void {
  if (!ok) throw new Error(`function: ${what}; saw ${JSON.stringify(seen).slice(0, 400)}`);
}

async function previews(configFile: string, dist: string): Promise<void> {
  const repo = join(WORK, "function");
  const web = join(repo, "apps/web");
  await stageFunction(configFile, dist, web);
  const { traced, files } = await functionFileList(repo, web);
  const lambda = copyFunction(repo, files, join(WORK, "lambda"));
  const binary = files.find((file) => file.endsWith(".node")) ?? "none";
  say(`function: ${files.length} files (${traced.length} traced), resvg ${binary.split("/").pop()}`);

  // Hands raised here through the SDK from anvil's account 5 (1 000 test USDC), as the app raises them.
  const ORIGIN = "https://next.ahand.in";
  const usd: ChainToken = { address: USDC, symbol: "USDC", decimals: 6, kind: "usd" } as ChainToken;
  const chain: RaiseChain = { rpc: RPC, client: createPublicClient({ transport: http(RPC) }) as PublicClient, core: CORE, chainId: CHAIN_ID, tokens: [usd] };
  const key = ANVIL_KEYS[5]!;
  const title = "Fork check: a sublet in Yerevan for June";
  const unlisted = await raiseHand(chain, ORIGIN, key, { mode: "unlisted", title, content: "Two rooms. Hidden from robots.", reward: 5n * USD });
  const open = await raiseHand(chain, ORIGIN, key, { mode: "public", title: "Fork check: who can fix a 1978 Vespa?", content: "It stalls at idle.", reward: 0n });
  const dark = await raiseHand(chain, ORIGIN, key, { mode: "dark", title: "Fork check: dark words", reward: USD });
  const [path, d] = unlisted.before.split("?d=") as [string, string];
  const changed = fromBase64Url(d);
  changed[changed.length - 1] ^= 0x01;
  const card = `/og${unlisted.before.replace("?", ".png?")}`;
  const shapes = {
    described: unlisted.before,
    numbered: path,
    public: open.before,
    dark: `/${CHAIN_ID}/${dark.handId}`,
    unknown: `/${CHAIN_ID}/999999999`,
    changed: `${path}?d=${toText(changed)}`,
    otherChain: `/8453/${unlisted.handId}`,
    huge: `${path}?d=${"A".repeat(16_000)}`,
    card,
    cardDark: `${card}&th=d`,
    generic: "/og/generic.png",
  };
  const out = run("function-node", NODE, [join(REPO, "tests/e2e/fork/call-function.mjs"), join(lambda, "apps/web", FUNCTION_ENTRY), ORIGIN, ...Object.values(shapes)]);
  const { node, answers } = JSON.parse(out.trim().split("\n").pop()!) as { node: string; answers: { path: string; status: number; headers: Record<string, string>; text?: string; png?: { signature: string; width: number; height: number; bytes: number }; ms: number }[] };
  const by = Object.fromEntries(Object.keys(shapes).map((name, i) => [name, answers[i]!]));
  const index = readFileSync(join(dist, "index.html"), "utf8");
  const titleOf = (name: string) => unescape(metaOf(by[name]!.text ?? "", "og:title"));
  const descriptionOf = (name: string) => unescape(metaOf(by[name]!.text ?? "", "og:description")) ?? "";

  for (const [name, answer] of Object.entries(by)) expectThat(answer.status === 200, `${name} answers 200`, answer.status);
  expectThat(titleOf("described") === isolate(title), "the described address shows the title", titleOf("described"));
  expectThat(descriptionOf("described").startsWith("$5 reward on chain · open until "), "the described address shows the terms", descriptionOf("described"));
  expectThat(!by.described!.text!.includes("Hidden from robots"), "an unlisted Hand's details stay hidden", "");
  expectThat(unescape(metaOf(by.described!.text!, "og:image")) === `${ORIGIN}${card}`, "og:image names the card", metaOf(by.described!.text!, "og:image"));
  expectThat(by.described!.headers["cache-control"] === "no-cache" && by.described!.headers["content-type"] === "text/html; charset=utf-8", "a page is no-cache HTML", by.described!.headers);
  expectThat(titleOf("numbered") === "Someone raised a hand." && descriptionOf("numbered").startsWith("$5 reward on chain"), "a numbered address shows the terms only", [titleOf("numbered"), descriptionOf("numbered")]);
  expectThat(titleOf("public") === isolate("Fork check: who can fix a 1978 Vespa?") && descriptionOf("public").includes(isolate("It stalls at idle.")), "a public Hand shows its details", descriptionOf("public"));
  expectThat(descriptionOf("dark").startsWith("$1 reward on chain") && !by.dark!.text!.includes("dark words"), "a dark Hand's number shows terms, never words", descriptionOf("dark"));
  for (const name of ["unknown", "changed", "otherChain", "huge"]) {
    expectThat(titleOf(name) === "Someone raised a hand." && descriptionOf(name) === "Open to see.", `${name} gives the generic card`, [titleOf(name), descriptionOf(name)]);
  }
  for (const name of ["described", "numbered", "public", "dark", "unknown", "changed"]) {
    const untagged = by[name]!.text!.replace(/ {4}<meta (?:property|name)="[^"]*" content="[^"]*" \/>(?:\n {4}<meta (?:property|name)="[^"]*" content="[^"]*" \/>)*\n {2}(?=<\/head>)/, "").replace(/<title>[\s\S]*?<\/title>/, "<title>aHand</title>");
    expectThat(untagged === index, `${name} is index.html as built apart from the tags`, untagged.slice(0, 200));
  }
  for (const name of ["card", "cardDark", "generic"]) {
    const png = by[name]!.png;
    expectThat(png?.signature === "89504e470d0a1a0a" && png.width === 1200 && png.height === 630 && png.bytes > 10_000, `${name} is a 1200×630 PNG`, png);
    expectThat(by[name]!.headers["cache-control"] === "public, max-age=300", `${name} is kept five minutes`, by[name]!.headers);
  }
  summary.previews = {
    node,
    files: files.length,
    traced: traced.length,
    resvg: binary,
    hands: { unlisted: Number(unlisted.handId), public: Number(open.handId), dark: Number(dark.handId) },
    answers: answers.map((answer) => ({ path: answer.path.slice(0, 90), status: answer.status, ms: answer.ms, ...(answer.png ? { png: answer.png } : { title: unescape(metaOf(answer.text ?? "", "og:title")) }) })),
  };
  say(`function under Node ${node}: ${answers.length} answers as expected (pages with tags, 1200×630 cards)`);
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
