/**
 * Foundry by path, and the lock around the compiler.
 *
 * A bare `forge` on this machine is another program, so every tool is called as
 * `$FOUNDRY_BIN/<tool>` (default ~/.foundry/bin). `forge build` and `forge script` write the
 * shared `contracts/out` and `contracts/cache`, so they run only while holding a lock folder,
 * `infra/stand/.run/forge.lock`, taken by `mkdir`. The holder refreshes the folder's time every
 * 30 seconds; a lock whose time is older than 120 seconds belongs to a holder that died and is
 * taken over.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { REPO_ROOT, RUN_ROOT } from "./ports.ts";

export type FoundryTool = "forge" | "cast" | "anvil" | "chisel";

export function foundryBin(env: Record<string, string | undefined> = process.env): string {
  return env.FOUNDRY_BIN || join(homedir(), ".foundry/bin");
}

/** The tool's path; throws if it is not there, rather than falling back to whatever PATH holds. */
export function foundryPath(tool: FoundryTool, env: Record<string, string | undefined> = process.env): string {
  const path = join(foundryBin(env), tool);
  if (!existsSync(path)) throw new Error(`${tool} not found at ${path}; set FOUNDRY_BIN to Foundry's bin folder`);
  return path;
}

export const CONTRACTS_DIR = join(REPO_ROOT, "contracts");
export const FORGE_LOCK = join(RUN_ROOT, "forge.lock");
export const LOCK_STALE_MS = 120_000;
const HEARTBEAT_MS = 30_000;
const POLL_MS = 250;

export interface LockOptions {
  /** Give up after this long; default 10 minutes. */
  waitMs?: number;
  /** The lock folder; default infra/stand/.run/forge.lock. */
  lock?: string;
  staleMs?: number;
}

function tryTake(lock: string, staleMs: number): boolean {
  try {
    mkdirSync(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let age: number;
    try {
      age = Date.now() - statSync(lock).mtimeMs;
    } catch {
      return false; // released between the two calls: try again on the next poll
    }
    if (age <= staleMs) return false;
    rmSync(lock, { recursive: true, force: true });
    try {
      mkdirSync(lock);
    } catch {
      return false; // someone else took it over first
    }
  }
  writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, since: new Date().toISOString() }));
  return true;
}

/** Runs `work` while holding the forge lock; waits for it, takes over a stale one, always releases. */
export async function withForgeLock<T>(work: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  const lock = options.lock ?? FORGE_LOCK;
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const deadline = Date.now() + (options.waitMs ?? 600_000);
  mkdirSync(join(lock, ".."), { recursive: true });
  while (!tryTake(lock, staleMs)) {
    if (Date.now() > deadline) throw new Error(`the forge lock ${lock} is still held; remove the folder if no forge is running`);
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
  const heartbeat = setInterval(() => {
    const now = new Date();
    try {
      utimesSync(lock, now, now);
    } catch {
      // the folder was taken over as stale: nothing to refresh
    }
  }, Math.min(HEARTBEAT_MS, staleMs / 4));
  try {
    return await work();
  } finally {
    clearInterval(heartbeat);
    rmSync(lock, { recursive: true, force: true });
  }
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a Foundry tool by path and collects its output. */
export function runFoundry(
  tool: FoundryTool,
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<RunResult> {
  const env = { ...process.env, ...options.env };
  return new Promise((done, fail) => {
    const child = spawn(foundryPath(tool, env), args, { cwd: options.cwd ?? CONTRACTS_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", fail);
    child.once("close", (code) => done({ code: code ?? 1, stdout, stderr }));
  });
}

/** `forge <args>` in contracts/, under the lock when it compiles or broadcasts (build, script). */
export function forge(args: string[], options: { cwd?: string; env?: Record<string, string | undefined> } = {}): Promise<RunResult> {
  const compiles = args[0] === "build" || args[0] === "script";
  return compiles ? withForgeLock(() => runFoundry("forge", args, options)) : runFoundry("forge", args, options);
}

export function cast(args: string[], options: { env?: Record<string, string | undefined> } = {}): Promise<RunResult> {
  return runFoundry("cast", args, { cwd: REPO_ROOT, ...options });
}
