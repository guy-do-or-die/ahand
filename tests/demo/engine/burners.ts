/**
 * The engine's burner keys for Base Sepolia (DEMO_TARGET=site, and the fork, where they are funded
 * by anvil): made here, kept outside the repository in ~/.config/ahand-demo/burners.json (mode
 * 0600; DEMO_BURNERS_FILE moves it), never printed. They exist for test money on chain 84532 and
 * nothing else: the burner wallet refuses any other chain. Never the owner's keys.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const BURNER_CHAIN_ID = 84532;

export function burnersFile(): string {
  return process.env.DEMO_BURNERS_FILE ?? join(homedir(), ".config/ahand-demo/burners.json");
}

interface File {
  chainId: number;
  /** Burner n is keys[n - 1]: scenarios name test accounts 1 to 5, and burner n stands in for account n. */
  keys: Hex[];
}

function read(): File | undefined {
  const file = burnersFile();
  if (!existsSync(file)) return undefined;
  const parsed = JSON.parse(readFileSync(file, "utf8")) as File;
  if (parsed.chainId !== BURNER_CHAIN_ID) throw new Error(`${file} is for chain ${parsed.chainId}, not ${BURNER_CHAIN_ID}`);
  return parsed;
}

/** Makes burners until there are `count`; never replaces one that exists. */
export function ensureBurners(count: number): Address[] {
  const file = burnersFile();
  const now = read() ?? { chainId: BURNER_CHAIN_ID, keys: [] };
  while (now.keys.length < count) now.keys.push(generatePrivateKey());
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return now.keys.map((key) => privateKeyToAccount(key).address);
}

export function burnerAddresses(): Address[] {
  return (read()?.keys ?? []).map((key) => privateKeyToAccount(key).address);
}

/** The key of burner `n` (1-based). Only the burner wallet calls this, and only for chain 84532. */
export function burnerKey(n: number): Hex {
  const key = read()?.keys[n - 1];
  if (!key) throw new Error(`no burner ${n}: bun tests/demo/burners.ts new ${n}`);
  return key;
}
