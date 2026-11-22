/**
 * The thank smoke's own fixtures, on top of the seed's (tests/e2e/smoke/thank.spec.ts). Everything
 * runs through the craft tool in a child process, except blocking a payee in
 * the BlacklistToken, which is one plain transaction from anvil's public account 0 (the token
 * lets anyone block; the seed does the same).
 */
import { resolve } from "node:path";

import { createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { account } from "../accounts";
import type { Rpc } from "../rpc";
import { runProgram, standSlot } from "../stand";

/**
 * Runs `bun tests/e2e/lib/craft.ts <args>` on this run's chain and returns its JSON: the stand
 * file in STAND_FILE when one is named (as `readStand` and `seed` take it), else the slot's.
 */
export function craft<T = Record<string, unknown>>(...args: string[]): T {
  const chain = process.env.STAND_FILE ? ["--stand", resolve(process.env.STAND_FILE)] : ["--slot", String(standSlot())];
  const { stdout } = runProgram("tests/e2e/lib/craft.ts", [...args, ...chain]);
  return JSON.parse(stdout) as T;
}

interface Made {
  handId: string;
  address: string;
}
interface Passed {
  address: string;
  payee: Address | null;
  keptBps: number;
}
interface Given {
  address: string;
  signer: Address;
  payee: Address;
  giveHash: Hex;
}

/** A Hand in the given token, passed once by a holder who keeps `keepBps` for `payeeAccount`, then answered by account 4. */
export function passedAndGiven(options: { token?: "usd" | "blacklist"; reward?: string; keepBps?: number; payeeAccount?: number; title?: string }) {
  const made = craft<Made>("make", "--token", options.token ?? "usd", "--reward", options.reward ?? "20", ...(options.title ? ["--title", options.title] : []));
  const passed = craft<Passed>("pass", made.address, "--keep", String(options.keepBps ?? 1_000), "--payee-account", String(options.payeeAccount ?? 2));
  const given = craft<Given>("give", passed.address, "--giver", "4");
  return { handId: BigInt(made.handId), passed, given };
}

const BLACKLIST = parseAbi(["function setBlocked(address account, bool isBlocked)"]);

/** Blocks or unblocks an address in the BlacklistToken, waiting for the block. */
export async function setBlocked(chain: Rpc, token: Address, who: Address, blocked: boolean): Promise<void> {
  const wallet = createWalletClient({ chain: foundry, transport: http(chain.url), account: privateKeyToAccount(account(0).privateKey) });
  const hash = await wallet.writeContract({ address: token, abi: BLACKLIST, functionName: "setBlocked", args: [who, blocked] });
  const receipt = await chain.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("setBlocked reverted");
}
