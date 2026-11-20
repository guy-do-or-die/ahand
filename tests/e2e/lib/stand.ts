/**
 * A stand from a spec file's side (ARCHITECTURE §14): read a slot's stand.json, and drive the
 * stand's own programs (infra/stand/stand.ts, and the seed of wave 3) in child processes.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { Address } from "viem";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");

export interface StandToken {
  address: Address;
  symbol: string;
  decimals: number;
  kind: string;
}

/** infra/stand/.run/<slot>/stand.json */
export interface StandInfo {
  slot: number | null;
  mode: "built" | "dev" | "helper";
  /** The address a browser should open; null for a helper chain with no site. */
  site: string | null;
  rpc: string;
  relay: string | null;
  chainId: number;
  core: Address;
  tokens: StandToken[];
  forwarder: Address | null;
  accountFactory: Address | null;
  aheadSeconds: number;
}

export function standSlot(): number {
  const text = process.env.STAND_SLOT;
  return text === undefined || text === "" ? 0 : Number(text);
}

export function standFile(slot = standSlot()): string {
  return join(REPO_ROOT, "infra/stand/.run", String(slot), "stand.json");
}

/** The stand of a slot, or of the file in STAND_FILE (a helper chain's --write-stand). */
export function readStand(slot = standSlot()): StandInfo {
  const file = process.env.STAND_FILE ? resolve(process.env.STAND_FILE) : standFile(slot);
  if (!existsSync(file)) throw new Error(`no stand at ${file}: bun infra/stand/stand.ts up --slot ${slot}`);
  return JSON.parse(readFileSync(file, "utf8")) as StandInfo;
}

/** The token of a kind ("usd", "blacklist") on this stand. */
export function tokenOf(stand: StandInfo, kind: string): StandToken {
  const token = stand.tokens.find((t) => t.kind === kind);
  if (!token) throw new Error(`the stand has no ${kind} token`);
  return token;
}

function bun(): string {
  if (process.env.BUN_BIN) return process.env.BUN_BIN;
  const home = join(homedir(), ".bun/bin/bun");
  return existsSync(home) ? home : "bun";
}

export interface ProgramResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `bun <script> <args>` from the root; throws with its output when it fails. */
export function runProgram(script: string, args: string[], options: { allowFailure?: boolean; timeoutMs?: number } = {}): ProgramResult {
  const run = spawnSync(bun(), [script, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 300_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const result = { code: run.status ?? 1, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
  if (result.code !== 0 && !options.allowFailure) {
    throw new Error(`bun ${script} ${args.join(" ")} exited ${result.code}\n${result.stderr || result.stdout}`);
  }
  return result;
}

const STAND = "infra/stand/stand.ts";

export function standUp(slot: number, options: { dev?: boolean; noFace?: boolean; aheadSeconds?: number } = {}): StandInfo {
  const args = ["up", "--slot", String(slot)];
  if (options.dev) args.push("--dev");
  if (options.noFace) args.push("--no-face");
  if (options.aheadSeconds !== undefined) args.push("--ahead", String(options.aheadSeconds));
  runProgram(STAND, args);
  return readStand(slot);
}

export function standDown(slot: number): void {
  runProgram(STAND, ["down", "--slot", String(slot)]);
}

export type StandService = "chain" | "relay" | "site" | "dev";

export function stopService(slot: number, service: StandService): void {
  runProgram(STAND, ["stop", "--slot", String(slot), service]);
}

export function startService(slot: number, service: "relay" | "face" | "static" | "dev"): void {
  runProgram(STAND, ["start", "--slot", String(slot), service]);
}

/**
 * Seeds a fresh set of fixture Hands on the slot's chain and returns the seed's JSON (wave 3's
 * infra/stand/seed.ts). Each spec file calls it in beforeAll and uses only its own set.
 */
export function seed<T = Record<string, unknown>>(slot = standSlot(), only?: string[]): T {
  const args = ["--json"];
  if (process.env.STAND_FILE) args.push("--stand", resolve(process.env.STAND_FILE));
  else args.push("--slot", String(slot));
  if (only?.length) args.push("--only", only.join(","));
  const { stdout } = runProgram("infra/stand/seed.ts", args);
  return JSON.parse(stdout) as T;
}
