/**
 * Fixtures for the CLI's tests: a helper chain (packages/sdk/tests/helpers/anvil.ts) on a port of
 * this package's range, Hands raised on it, links written by the SDK, and the CLI run as a child
 * process exactly as a person runs it from a clone.
 */
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

import { AHandCoreAbi, KeyAccountFactoryAbi, MockUSDAbi } from "@ahand/abi";
import { ANVIL_KEYS, startChain, type Chain } from "@ahand/sdk/testing";
import {
  createWalletClient,
  encodeFunctionData,
  http,
  serializeErc6492Signature,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { foundry } from "viem/chains";

import { toAddress, type AddressShape } from "../../packages/sdk/src/address.ts";
import { dataHashOf, textValue, type Statement } from "../../packages/sdk/src/data.ts";
import { encodeGive, encodeLive, keyOfSeed, newSeed, openLink, packAttachments, type Attachments, type OpenedLink } from "../../packages/sdk/src/link.ts";
import { signGiveWithKey } from "../../packages/sdk/src/sign.ts";
import { domain, type Give, type Hand } from "../../packages/sdk/src/types.ts";

export const REPO = resolve(import.meta.dir, "../..");
export const SITE = "http://127.0.0.1:15299";
export const FOUNDRY_BIN = process.env.FOUNDRY_BIN || join(process.env.HOME ?? "", ".foundry/bin");

/** This package's ports are 15250 to 15299; each test file takes its own. */
export function chainOn(port: number): Promise<Chain> {
  return startChain({ port });
}

export interface Raised {
  hand: Hand;
  seed: Hex;
  reward: bigint;
  raiserKey: Hex;
  /** The Hand's own words, outside the link (faced) or inside it (bare). */
  words: Attachments;
}

/** Raises a Hand in MockUSD from anvil account `raiser` with a fresh seed, its words hashed into dataHash. */
export async function raise(chain: Chain, options: { raiser?: number; reward?: bigint; minClaimBps?: number; days?: number; title?: string; content?: string } = {}): Promise<Raised> {
  const raiserKey = ANVIL_KEYS[options.raiser ?? 1]!;
  const account = privateKeyToAccount(raiserKey);
  const wallet = createWalletClient({ account, chain: foundry, transport: http(chain.rpc) });
  const token = chain.tokens.find((t) => t.kind === "usd")!.address;
  const reward = options.reward ?? 100_000_000n;
  const seed = newSeed();
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
  if (reward > 0n) await mined(await wallet.writeContract({ address: token, abi: MockUSDAbi, functionName: "approve", args: [chain.core, reward] }));
  const { result: handId, request } = await chain.client.simulateContract({
    account,
    address: chain.core,
    abi: AHandCoreAbi,
    functionName: "raise",
    args: [token, reward, expiry, rootKey, 250, minClaimBps, dataHash],
  });
  await mined(await wallet.writeContract(request));
  const hand: Hand = { handId, raiser: account.address, token, rootKey, payoutGasK: 250, minClaimBps, dataHash };
  return { hand, seed, reward, raiserKey, words: { statements: [list], texts } };
}

/** The first live address of a Hand: faced (its words in `d`) or bare (its words inside the link). */
export async function liveAddress(chain: Chain, raised: Raised, shape: AddressShape = "faced"): Promise<string> {
  const options = { canonicalCore: chain.core };
  const route = { domain: domain(chain.chainId, chain.core), hand: raised.hand, signedShakes: [], seed: raised.seed };
  if (shape === "faced") {
    const outside = packAttachments(raised.words);
    const link = await encodeLive(route, { ...options, outside });
    return toAddress({ site: SITE, link, shape, outside: raised.words }, options);
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
  const seen = (opened as OpenedLink & { seen: { shape: AddressShape; data?: Uint8Array } }).seen;
  const options = { canonicalCore: chain.core, outside: seen.data };
  const link = await encodeGive({ domain: opened.domain, hand, signedShakes: opened.signedShakes, signedGive: { give, keySig, giverSig }, attachments: opened.inside }, options);
  const outside = seen.shape === "faced" ? { statements: opened.outside.statements, texts: opened.outside.texts } : undefined;
  return toAddress({ site: SITE, link, shape: seen.shape, outside }, { canonicalCore: chain.core });
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

/** Runs `bun tools/ahand.ts …` from the repository root, as a person would, without RPC or CORE in the environment. */
export function cli(...args: string[]): Run {
  const env = { ...process.env };
  delete env.RPC;
  delete env.CORE;
  const run = spawnSync("bun", ["tools/ahand.ts", ...args], { cwd: REPO, env, encoding: "utf8", timeout: 60_000 });
  return { status: run.status ?? -1, stdout: run.stdout, stderr: run.stderr };
}

/** Runs a shell line (bash), with extra environment. */
export function sh(line: string, env: Record<string, string> = {}): Run {
  const run = spawnSync("bash", ["-c", line], { cwd: REPO, env: { ...process.env, ...env }, encoding: "utf8", timeout: 60_000 });
  return { status: run.status ?? -1, stdout: run.stdout, stderr: run.stderr };
}

export async function handOnChain(chain: Chain, handId: bigint) {
  const raw = (await chain.client.readContract({ address: chain.core, abi: AHandCoreAbi, functionName: "hands", args: [handId] })) as readonly unknown[];
  const thanks = (await chain.client.readContract({ address: chain.core, abi: AHandCoreAbi, functionName: "thanks", args: [handId] })) as readonly Hex[];
  return { closedAt: Number(raw[3]), reward: raw[7] as bigint, giveHash: thanks[0]! };
}

export async function balanceOf(chain: Chain, who: Address): Promise<bigint> {
  const token = chain.tokens.find((t) => t.kind === "usd")!.address;
  return (await chain.client.readContract({ address: token, abi: MockUSDAbi, functionName: "balanceOf", args: [who] })) as bigint;
}

export { ANVIL_KEYS, openLink, type Chain };
