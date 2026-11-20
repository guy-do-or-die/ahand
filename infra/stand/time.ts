/**
 * Moves a stand's chain clock forward and mines one block (ARCHITECTURE §14, D-61).
 *
 *   bun infra/stand/time.ts --slot N <seconds> [--json]
 *   bun infra/stand/time.ts --stand <stand.json> <seconds> [--json]
 *
 * It uses anvil's `evm_increaseTime` (every later block keeps the offset) and `evm_mine`, and
 * prints the latest block before and after. It refuses any chain but 31337.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { pathsOf, checkSlot, slotFromEnv } from "./ports.ts";

const LOCAL_CHAIN_ID = 31337;

async function rpc<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
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

interface Latest {
  block: number;
  timestamp: number;
}

async function latest(url: string): Promise<Latest> {
  const block = await rpc<{ number: string; timestamp: string }>(url, "eth_getBlockByNumber", ["latest", false]);
  return { block: Number(block.number), timestamp: Number(block.timestamp) };
}

/** Moves the chain at `url` forward by `seconds` and mines a block; returns the latest block before and after. */
export async function jump(url: string, seconds: number): Promise<{ before: Latest; after: Latest }> {
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error(`seconds must be a whole number above 0, not ${seconds}`);
  const chainId = Number(await rpc<string>(url, "eth_chainId"));
  if (chainId !== LOCAL_CHAIN_ID) throw new Error(`time.ts moves only chain ${LOCAL_CHAIN_ID}'s clock; ${url} is chain ${chainId}`);
  const before = await latest(url);
  await rpc(url, "evm_increaseTime", [seconds]);
  await rpc(url, "evm_mine");
  return { before, after: await latest(url) };
}

function usage(): never {
  throw new Error("usage: bun infra/stand/time.ts --slot N <seconds> | --stand <stand.json> <seconds> [--json]");
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    let standFile: string | undefined;
    let json = false;
    const positional: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      const word = argv[i]!;
      if (word === "--slot") standFile = pathsOf(checkSlot(Number(argv[++i]))).stand;
      else if (word === "--stand") standFile = resolve(argv[++i] ?? usage());
      else if (word === "--json") json = true;
      else if (word.startsWith("--")) usage();
      else positional.push(word);
    }
    if (positional.length !== 1 || !/^\d+$/.test(positional[0]!)) usage();
    standFile ??= pathsOf(slotFromEnv()).stand;
    if (!existsSync(standFile)) throw new Error(`no stand at ${standFile}`);
    const { rpc: url } = JSON.parse(readFileSync(standFile, "utf8")) as { rpc: string };
    const { before, after } = await jump(url, Number(positional[0]));
    if (json) console.log(JSON.stringify({ rpc: url, seconds: Number(positional[0]), before, after }));
    else {
      console.log(`chain ${url}: block ${before.block} at ${before.timestamp} -> block ${after.block} at ${after.timestamp} (+${after.timestamp - before.timestamp} s)`);
    }
  } catch (error) {
    console.error(`time: ${(error as Error).message}`);
    process.exit(1);
  }
}
