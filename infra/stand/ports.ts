/**
 * Stand slots (ARCHITECTURE §14). Slot `s` (0–9) owns four ports and one folder; slot 0 is the
 * integrator's. Nothing else in the repository computes these numbers.
 */
import { join, resolve } from "node:path";

export const SLOT_COUNT = 10;

export interface SlotPorts {
  /** anvil's JSON-RPC. */
  chain: number;
  /** The stand's NIP-01 relay. */
  relay: number;
  /** The built site (face or static.ts). */
  site: number;
  /** The Vite dev server, in --dev mode. */
  dev: number;
}

export function checkSlot(slot: number): number {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) throw new Error(`a slot is a whole number from 0 to ${SLOT_COUNT - 1}, not ${slot}`);
  return slot;
}

export function portsOf(slot: number): SlotPorts {
  const step = 10 * checkSlot(slot);
  return { chain: 18545 + step, relay: 18547 + step, site: 18300 + step, dev: 18301 + step };
}

/** The slot named by STAND_SLOT (default 0). */
export function slotFromEnv(env: Record<string, string | undefined> = process.env): number {
  const text = env.STAND_SLOT;
  return text === undefined || text === "" ? 0 : checkSlot(Number(text));
}

/** The worktree's root. */
export const REPO_ROOT = resolve(import.meta.dirname, "../..");
/** Every slot's folder lives here; git ignores it. */
export const RUN_ROOT = join(REPO_ROOT, "infra/stand/.run");

export interface SlotPaths {
  /** infra/stand/.run/<s>/ */
  dir: string;
  stand: string;
  config: string;
  pids: string;
  logs: string;
  dist: string;
  viteCache: string;
  /** Absolute path of the slot's deployment JSON. */
  deployment: string;
  /** The same file as Deploy.s.sol's DEPLOY_OUT takes it: relative to contracts/, under ./deployments. */
  deployOut: string;
}

export function pathsOf(slot: number): SlotPaths {
  const dir = join(RUN_ROOT, String(checkSlot(slot)));
  const deployOut = `deployments/31337-slot${slot}.json`;
  return {
    dir,
    stand: join(dir, "stand.json"),
    config: join(dir, "config.json"),
    pids: join(dir, "pids.json"),
    logs: join(dir, "logs"),
    dist: join(dir, "dist"),
    viteCache: join(dir, "vite-cache"),
    deployment: join(REPO_ROOT, "contracts", deployOut),
    deployOut,
  };
}
