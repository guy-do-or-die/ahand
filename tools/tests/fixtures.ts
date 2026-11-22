/**
 * Fixtures for the CLI's tests: a helper chain (packages/sdk/tests/helpers/anvil.ts) on a port of
 * this package's range, Hands raised on it, links written by the SDK, and the CLI run as a child
 * process exactly as a person runs it from a clone.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";

import { aHandCoreAbi, mockUsdAbi } from "@ahand/abi";
import { ANVIL_KEYS, startChain, type Chain } from "@ahand/sdk/testing";
import { createWalletClient, encodeFunctionData, hexToBigInt, hexToBytes, http, serializeErc6492Signature, zeroHash, type Address, type Hex, parseAbi } from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { foundry } from "viem/chains";

import { toAddress, type AddressShape } from "../../packages/sdk/src/address.ts";
import { dataHashOf, textValue, type Statement } from "../../packages/sdk/src/data.ts";
import { thankCalldata } from "../../packages/sdk/src/gas.ts";
import { encodeGive, encodeLive, keyOfSeed, newSeed, openLink, packAttachments, toText, type Attachments, type OpenedLink } from "../../packages/sdk/src/link.ts";
import { signGiveWithKey } from "../../packages/sdk/src/sign.ts";
import { domain, type Give, type Hand } from "../../packages/sdk/src/types.ts";

/** The test account factory of contracts/test/mocks/KeyAccount.sol, which the test chain deploys. */
export const KeyAccountFactoryAbi = parseAbi([
  "function createAccount(address owner, uint256 salt) returns (address)",
  "function getAddress(address owner, uint256 salt) view returns (address)",
]);

export const REPO = resolve(import.meta.dir, "../..");
export const SITE = "http://127.0.0.1:15299";
export const FOUNDRY_BIN = process.env.FOUNDRY_BIN || join(process.env.HOME ?? "", ".foundry/bin");

/** Each test file takes its own port of 18352 to 18358 (18350-18399, but stand slots 5 to 9 serve on 183N0 and 183N1). */
/**
 * The CLI tests' ports: 18350 + offset by default (offsets 2 to 8, one per test file);
 * TOOLS_TEST_PORT_BASE moves the whole block, for agents that share one machine.
 */
export const testPort = (offset: number): number => Number(process.env.TOOLS_TEST_PORT_BASE ?? 18350) + offset;

export function chainOn(port: number): Promise<Chain> {
  return startChain({ port });
}

export interface Raised {
  hand: Hand;
  seed: Hex;
  reward: bigint;
  raiserKey: Hex;
  /** The Hand's own words, outside the link (described) or inside it (bare). */
  words: Attachments;
}

/** Raises a Hand in MockUSD from anvil account `raiser` with a fresh seed, its words hashed into dataHash. */
export async function raise(chain: Chain, options: { raiser?: number; reward?: bigint; minClaimBps?: number; days?: number; title?: string; content?: string; seed?: Hex } = {}): Promise<Raised> {
  const raiserKey = ANVIL_KEYS[options.raiser ?? 1]!;
  const account = privateKeyToAccount(raiserKey);
  const wallet = createWalletClient({ account, chain: foundry, transport: http(chain.rpc) });
  const token = chain.tokens.find((t) => t.kind === "usd")!.address;
  const reward = options.reward ?? 100_000_000n;
  const seed = options.seed ?? newSeed();
  const rootKey = privateKeyToAddress(keyOfSeed(seed));
  const title = options.title ?? "Looking for a violin teacher in Tbilisi";
  const texts = options.content ? [title, options.content] : [title];
  const list: Statement[] = [{ name: "title", value: textValue(title) }];
  if (options.content) list.push({ name: "content", value: textValue(options.content) });
  const dataHash = dataHashOf(list);
  const block = await chain.client.getBlock({ blockTag: "latest" });
  const expiry = Number(block.timestamp) + (options.days ?? 30) * 86400;
  const minClaimBps = options.minClaimBps ?? 7000;

  const mined = async (hash: Hex) => {
    const receipt = await chain.client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
  };
  if (reward > 0n) await mined(await wallet.writeContract({ address: token, abi: mockUsdAbi, functionName: "approve", args: [chain.core, reward] }));
  const { result: handId, request } = await chain.client.simulateContract({
    account,
    address: chain.core,
    abi: aHandCoreAbi,
    functionName: "raise",
    args: [token, reward, expiry, rootKey, 250, minClaimBps, dataHash],
  });
  await mined(await wallet.writeContract(request));
  const hand: Hand = { handId, raiser: account.address, token, rootKey, payoutGasK: 250, minClaimBps, dataHash };
  return { hand, seed, reward, raiserKey, words: { statements: [list], texts } };
}

/** The first live address of a Hand: described (its words in `d`) or bare (its words inside the link). */
export async function liveAddress(chain: Chain, raised: Raised, shape: AddressShape = "described"): Promise<string> {
  const options = { canonicalCore: chain.core };
  const route = { domain: domain(chain.chainId, chain.core), hand: raised.hand, signedShakes: [], seed: raised.seed };
  if (shape === "described") {
    const publicPart = packAttachments(raised.words);
    const link = await encodeLive(route, { ...options, publicPart });
    return toAddress({ site: SITE, link, shape, publicPart: raised.words }, options);
  }
  const link = await encodeLive({ ...route, attachments: raised.words }, options);
  return toAddress({ site: SITE, link, shape }, options);
}

/** Opens an address with the Hand given directly (what a holder's browser does after reading Core). */
export async function openWith(chain: Chain, address: string, hand: Hand): Promise<OpenedLink> {
  const { openAddress } = await import("../../packages/sdk/src/address.ts");
  return openAddress(address, async () => hand, { canonicalCore: chain.core });
}

/** A give address that ends `opened`: signed by the link key and by `giverSig(digest)`. */
export async function giveAddress(
  chain: Chain,
  address: string,
  hand: Hand,
  giver: { signer: Address; payee: Address; sign: (give: Give) => Promise<Hex> },
): Promise<string> {
  const opened = await openWith(chain, address, hand);
  const give: Give = { signer: giver.signer, payee: giver.payee, claimBps: opened.end.claimBps, routeHash: opened.end.routeHash, dataHash: zeroHash };
  const keySig = await signGiveWithKey(opened.linkKey!, opened.domain, hand, give);
  const giverSig = await giver.sign(give);
  const seen = (opened as OpenedLink & { seen: { shape: AddressShape; publicPart?: Uint8Array } }).seen;
  const options = { canonicalCore: chain.core, publicPart: seen.publicPart };
  const link = await encodeGive({ domain: opened.domain, hand, signedShakes: opened.signedShakes, signedGive: { give, keySig, giverSig }, attachments: opened.linkPart }, options);
  const publicPart = seen.shape === "described" ? { statements: opened.publicPart.statements, texts: opened.publicPart.texts } : undefined;
  return toAddress({ site: SITE, link, shape: seen.shape, publicPart }, { canonicalCore: chain.core });
}

/** A giver that signs with a plain key. */
export function keyGiver(key: Hex) {
  const signer = privateKeyToAddress(key);
  return (chain: Chain, hand: Hand) => ({
    signer,
    payee: signer,
    sign: (give: Give) => signGiveWithKey(key, domain(chain.chainId, chain.core), hand, give),
  });
}

/** A giver whose KeyAccount is not deployed yet: its signature is wrapped per ERC-6492. */
export async function undeployedGiver(chain: Chain, ownerKey: Hex, salt: bigint, hand: Hand) {
  const owner = privateKeyToAddress(ownerKey);
  const factory = chain.accountFactory!;
  const account = (await chain.client.readContract({ address: factory, abi: KeyAccountFactoryAbi, functionName: "getAddress", args: [owner, salt] })) as Address;
  const data = encodeFunctionData({ abi: KeyAccountFactoryAbi, functionName: "createAccount", args: [owner, salt] });
  return {
    signer: account,
    payee: account,
    sign: async (give: Give) =>
      serializeErc6492Signature({ address: factory, data, signature: await signGiveWithKey(ownerKey, domain(chain.chainId, chain.core), hand, give) }),
  };
}

export interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/** The environment the CLI runs in: this one without RPC, CORE or STAND_SLOT, which would choose for it. */
function cliEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.RPC;
  delete env.CORE;
  delete env.STAND_SLOT;
  return { ...env, ...extra };
}

/** Runs `bun tools/ahand.ts …` from the repository root, as a person would, without RPC, CORE or STAND_SLOT in the environment. */
export function cli(...args: string[]): Run {
  const run = spawnSync("bun", ["tools/ahand.ts", ...args], { cwd: REPO, env: cliEnv(), encoding: "utf8", timeout: 60_000 });
  return { status: run.status ?? -1, stdout: run.stdout, stderr: run.stderr };
}

/**
 * A clone of its own for the CLI: this tool's code copied into `dir`, the packages and modules
 * linked, contracts/src/AHandCore.sol copied, and contracts/out and contracts/deployments as the
 * test writes them. It lets a test doctor the build or the deployment files without touching the
 * repository's own, which other runs use.
 */
export interface Clone {
  dir: string;
  artifact: string;
  deployments: string;
  run(args: string[], env?: Record<string, string>): Run;
}

export function cloneAt(dir: string): Clone {
  mkdirSync(join(dir, "contracts/src"), { recursive: true });
  mkdirSync(join(dir, "contracts/out/AHandCore.sol"), { recursive: true });
  mkdirSync(join(dir, "contracts/deployments"), { recursive: true });
  cpSync(join(REPO, "tools"), join(dir, "tools"), { recursive: true, filter: (path) => !path.includes("node_modules") });
  symlinkSync(join(REPO, "tools/node_modules"), join(dir, "tools/node_modules"));
  symlinkSync(join(REPO, "packages"), join(dir, "packages"));
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
  copyFileSync(join(REPO, "contracts/src/AHandCore.sol"), join(dir, "contracts/src/AHandCore.sol"));
  const artifact = join(dir, "contracts/out/AHandCore.sol/AHandCore.json");
  copyFileSync(join(REPO, "contracts/out/AHandCore.sol/AHandCore.json"), artifact);
  return {
    dir,
    artifact,
    deployments: join(dir, "contracts/deployments"),
    run: (args, env = {}) => {
      const run = spawnSync("bun", ["tools/ahand.ts", ...args], { cwd: dir, env: cliEnv(env), encoding: "utf8", timeout: 60_000 });
      return { status: run.status ?? -1, stdout: run.stdout, stderr: run.stderr };
    },
  };
}

/** Runs the CLI with `input` on its standard input (for `recover`, which reads the signature there). */
export function cliWithInput(input: string, ...args: string[]): Run {
  const run = spawnSync("bun", ["tools/ahand.ts", ...args], { cwd: REPO, env: cliEnv(), input, encoding: "utf8", timeout: 120_000 });
  return { status: run.status ?? -1, stdout: run.stdout, stderr: run.stderr };
}

/** Sends `thank` for a give address as the raiser, straight through viem (what the app's /thank does). */
export async function thank(chain: Chain, raised: Raised, give: string): Promise<Hex> {
  const opened = await openWith(chain, give, raised.hand);
  if (!opened.signedGive) throw new Error("not a give address");
  const account = privateKeyToAccount(raised.raiserKey);
  const wallet = createWalletClient({ account, chain: foundry, transport: http(chain.rpc) });
  const data = thankCalldata(raised.hand.handId, opened.signedShakes, opened.signedGive);
  const hash = await wallet.sendTransaction({ to: chain.core, data });
  const receipt = await chain.client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
  if (receipt.status !== "success") throw new Error(`thank ${hash} reverted`);
  return hash;
}

/** Moves the chain's clock forward and mines one block. */
export async function advance(chain: Chain, seconds: number): Promise<void> {
  await chain.client.request({ method: "evm_increaseTime" as never, params: [seconds] as never });
  await chain.client.request({ method: "evm_mine" as never, params: [] as never });
}

/** Every way a secret could leak into text: hex (any case, with or without 0x), base64url, decimal digits. */
export function leaks(output: string, secret: Hex): string[] {
  const found: string[] = [];
  if (output.toLowerCase().includes(secret.slice(2).toLowerCase())) found.push("hex");
  if (output.includes(toText(hexToBytes(secret)))) found.push("base64url");
  if (output.includes(hexToBigInt(secret).toString(10))) found.push("digits");
  return found;
}

/** Runs a shell line (bash), with extra environment. */
export function sh(line: string, env: Record<string, string> = {}): Run {
  const run = spawnSync("bash", ["-c", line], { cwd: REPO, env: { ...process.env, ...env }, encoding: "utf8", timeout: 60_000 });
  return { status: run.status ?? -1, stdout: run.stdout, stderr: run.stderr };
}

export async function handOnChain(chain: Chain, handId: bigint) {
  const raw = (await chain.client.readContract({ address: chain.core, abi: aHandCoreAbi, functionName: "hands", args: [handId] })) as readonly unknown[];
  const thanks = (await chain.client.readContract({ address: chain.core, abi: aHandCoreAbi, functionName: "thanks", args: [handId] })) as readonly Hex[];
  return { closedAt: Number(raw[3]), reward: raw[7] as bigint, giveHash: thanks[0]! };
}

export async function balanceOf(chain: Chain, who: Address): Promise<bigint> {
  const token = chain.tokens.find((t) => t.kind === "usd")!.address;
  return (await chain.client.readContract({ address: token, abi: mockUsdAbi, functionName: "balanceOf", args: [who] })) as bigint;
}

export { ANVIL_KEYS, openLink, type Chain };
