import { passesLeft } from "@ahand/sdk";
import { getContractAddress, isAddressEqual, zeroAddress, zeroHash, type Address, type Hex } from "viem";

/**
 * The facts `/core` shows, as pure functions.
 * The address is derived, never looked up: create2(factory, salt, initcodeHash). Code found at
 * that address can only have come from that initcode, and the initcode hash is reproducible
 * from the commit with one command.
 */

export interface Derivation {
  derived: Address;
  matches: boolean;
}

export function derive(facts: { factory: Address; salt: Hex; initcodeHash: Hex }, inUse: Address): Derivation {
  const derived = getContractAddress({ opcode: "CREATE2", from: facts.factory, salt: facts.salt, bytecodeHash: facts.initcodeHash });
  return { derived, matches: isAddressEqual(derived, inUse) };
}

/**
 * The one command that rebuilds Core in a clone and prints its initcode hash. Kept word for word
 * equal to `reproduceCommand` in tools/manifest.ts (facts.test.ts compares them), so the site and
 * the CLI print the same line.
 */
export function reproduceLine(commit?: string): string {
  const tool = (name: "forge" | "cast") => `"\${FOUNDRY_BIN:-$HOME/.foundry/bin}/${name}"`;
  const checkout = commit ? `git checkout ${commit} && ` : "";
  return `${checkout}cd contracts && ${tool("forge")} build && ${tool("cast")} keccak "$(jq -r .bytecode.object out/AHandCore.sol/AHandCore.json)"`;
}

/** What `/build.json` held when it was fetched: the stand writes it beside a built site. */
export type ServedBuild = { kind: "served"; hash: string; command?: string; commit?: string | null; dirty?: boolean; files?: number } | { kind: "none" };

/**
 * Reads a `/build.json` answer. A dev server answers every path with its page, so anything that is
 * not JSON with a 64-hex `hash` means there is no build to hash.
 */
export function readServedBuild(contentType: string | null, body: string): ServedBuild {
  if (!contentType || !/json/i.test(contentType)) return { kind: "none" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: "none" };
  }
  if (typeof parsed !== "object" || parsed === null) return { kind: "none" };
  const record = parsed as Record<string, unknown>;
  if (typeof record.hash !== "string" || !/^[0-9a-f]{64}$/.test(record.hash)) return { kind: "none" };
  return {
    kind: "served",
    hash: record.hash,
    ...(typeof record.command === "string" ? { command: record.command } : {}),
    ...(typeof record.commit === "string" || record.commit === null ? { commit: record.commit as string | null } : {}),
    ...(typeof record.dirty === "boolean" ? { dirty: record.dirty } : {}),
    ...(Array.isArray(record.files) ? { files: record.files.length } : {}),
  };
}

/** Core's cap in whole days and the seconds it is made of. */
export function capDays(seconds: number): number {
  return seconds / 86_400;
}

/**
 * How many paid passes a route can take at worst and still be thanked in one transaction, when
 * each payout may use `payoutGasK` thousand gas: the SDK's `passesLeft` from an empty route (every
 * pass keeps a share and its payee burns the whole limit; the helper's own payout is counted too).
 * The record's limit says "about 70"; that was for a smaller limit per payout. This is the figure
 * for the setting this build raises Hands with.
 */
export function paidPassesAtWorst(payoutGasK: number): number {
  return passesLeft({ handId: 0n, raiser: zeroAddress, token: zeroAddress, rootKey: zeroAddress, payoutGasK, minClaimBps: 0, dataHash: zeroHash }, []);
}
