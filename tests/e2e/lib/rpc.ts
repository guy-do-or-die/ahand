/**
 * Chain reads and test controls for spec files: viem, and the ABIs read by path (spec files never
 * import a workspace package). Time is always the chain's: `chainNow`, never the machine's clock.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  createPublicClient,
  createTestClient,
  erc20Abi,
  http,
  type Abi,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  type TestClient,
} from "viem";
import { foundry } from "viem/chains";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/** An ABI by name: packages/abi/abis/<name>.json when the contracts kit wrote it, else forge's artifact. */
export function abiOf(name: string, solFile = `${name}.sol`): Abi {
  const generated = join(REPO_ROOT, "packages/abi/abis", `${name}.json`);
  if (existsSync(generated)) {
    const json = JSON.parse(readFileSync(generated, "utf8"));
    return (Array.isArray(json) ? json : json.abi) as Abi;
  }
  const artifact = join(REPO_ROOT, "contracts/out", solFile, `${name}.json`);
  if (!existsSync(artifact)) throw new Error(`no ABI for ${name}: neither ${generated} nor ${artifact} exists`);
  return JSON.parse(readFileSync(artifact, "utf8")).abi as Abi;
}

export const coreAbi = (): Abi => abiOf("AHandCore");

export interface Rpc {
  url: string;
  client: PublicClient;
  test: TestClient<"anvil">;
}

export function rpc(url: string): Rpc {
  const transport = http(url);
  return {
    url,
    client: createPublicClient({ chain: foundry, transport, pollingInterval: 250 }) as PublicClient,
    test: createTestClient({ chain: foundry, mode: "anvil", transport }),
  };
}

export interface HandRow {
  raiser: Address;
  expiry: number;
  openedAt: number;
  closedAt: number;
  token: Address;
  payoutGasK: number;
  minClaimBps: number;
  reward: bigint;
  rootKey: Address;
  dataHash: Hex;
}

export async function hands({ client }: Rpc, core: Address, handId: bigint): Promise<HandRow> {
  const r = (await client.readContract({ address: core, abi: coreAbi(), functionName: "hands", args: [handId] })) as readonly [
    Address, number, number, number, Address, number, number, bigint, Address, Hex,
  ];
  return { raiser: r[0], expiry: Number(r[1]), openedAt: Number(r[2]), closedAt: Number(r[3]), token: r[4], payoutGasK: Number(r[5]), minClaimBps: Number(r[6]), reward: r[7], rootKey: r[8], dataHash: r[9] };
}

export async function thanks({ client }: Rpc, core: Address, handId: bigint): Promise<{ giveHash: Hex; dataHash: Hex }> {
  const [giveHash, dataHash] = (await client.readContract({ address: core, abi: coreAbi(), functionName: "thanks", args: [handId] })) as readonly [Hex, Hex];
  return { giveHash, dataHash };
}

export async function pending({ client }: Rpc, core: Address, token: Address, payee: Address): Promise<bigint> {
  return (await client.readContract({ address: core, abi: coreAbi(), functionName: "pending", args: [token, payee] })) as bigint;
}

export async function handsCount({ client }: Rpc, core: Address): Promise<bigint> {
  return (await client.readContract({ address: core, abi: coreAbi(), functionName: "handsCount" })) as bigint;
}

export function balanceOf({ client }: Rpc, token: Address, owner: Address): Promise<bigint> {
  return client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

export async function code({ client }: Rpc, address: Address): Promise<Hex> {
  return (await client.getCode({ address })) ?? "0x";
}

/** Core's logs in a block range, decoded; filter by `eventName` and `args` in the spec. */
export async function logs({ client }: Rpc, core: Address, fromBlock: bigint, toBlock?: bigint): Promise<Log[]> {
  return client.getContractEvents({ address: core, abi: coreAbi(), fromBlock, toBlock: toBlock ?? "latest" }) as Promise<Log[]>;
}

/** The latest block: the one clock. */
export async function chainNow({ client }: Rpc): Promise<{ number: bigint; timestamp: number }> {
  const block = await client.getBlock({ blockTag: "latest" });
  return { number: block.number, timestamp: Number(block.timestamp) };
}

/** Moves the chain's clock forward and mines one block; returns the new latest block. */
export async function jump(r: Rpc, seconds: number): Promise<{ number: bigint; timestamp: number }> {
  await r.test.increaseTime({ seconds });
  await r.test.mine({ blocks: 1 });
  return chainNow(r);
}

/** Mines `blocks` blocks now, whatever the interval. */
export async function mine(r: Rpc, blocks = 1): Promise<void> {
  await r.test.mine({ blocks });
}

/** Stops block production: no interval blocks and no automine, so sent transactions wait. */
export async function pauseBlocks(r: Rpc): Promise<void> {
  await r.test.setIntervalMining({ interval: 0 });
  await r.test.setAutomine(false);
}

/** Restores the stand's one block per second. */
export async function resumeBlocks(r: Rpc, intervalSeconds = 1): Promise<void> {
  await r.test.setIntervalMining({ interval: intervalSeconds });
}
