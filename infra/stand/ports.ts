/**
 * Stand slots. Slot `s` (0–9) owns four ports and one folder; slot 0 is the
 * integrator's. Nothing else in the repository computes these numbers. STAND_PORT_BASE moves the
 * ports of every slot when the fixed ones are taken (see portsOf).
 */
import { join, resolve } from "node:path";

export const SLOT_COUNT = 10;

export interface SlotPorts {
  /** anvil's JSON-RPC. */
  chain: number;
  /** The stand's NIP-01 relay. */
  relay: number;
  /** The built site (the view server or static.ts). */
  site: number;
  /** The Vite dev server, in --dev mode. */
  dev: number;
}

export function checkSlot(slot: number): number {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) throw new Error(`a slot is a whole number from 0 to ${SLOT_COUNT - 1}, not ${slot}`);
  return slot;
}

/** The lowest and highest STAND_PORT_BASE: above the privileged ports, and slot 9's last port fits. */
export const PORT_BASE_MIN = 1024;
export const PORT_BASE_MAX = 65000;

/**
 * STAND_PORT_BASE, when set: a whole number from 1024 to 65000 written in plain digits.
 * Unset or empty means the fixed layout. Anything else is refused, never guessed at.
 */
export function portBaseFromEnv(env: Record<string, string | undefined> = process.env): number | undefined {
  const text = env.STAND_PORT_BASE;
  if (text === undefined || text === "") return undefined;
  const base = /^[1-9][0-9]*$/.test(text) ? Number(text) : Number.NaN;
  if (!(base >= PORT_BASE_MIN && base <= PORT_BASE_MAX)) {
    throw new Error(`STAND_PORT_BASE must be a whole number from ${PORT_BASE_MIN} to ${PORT_BASE_MAX}, not "${text}"`);
  }
  return base;
}

/**
 * The four ports of a slot. Without STAND_PORT_BASE: the fixed layout, chain 18545 + 10s,
 * relay 18547 + 10s, site 18300 + 10s, dev 18301 + 10s. With STAND_PORT_BASE = B: the compact
 * layout, slot s takes B + 10s (chain), +1 (relay), +2 (site), +3 (dev), so all ten slots fit
 * in B … B + 93. Every command that touches a slot must see the same STAND_PORT_BASE.
 */
export function portsOf(slot: number, env: Record<string, string | undefined> = process.env): SlotPorts {
  const step = 10 * checkSlot(slot);
  const base = portBaseFromEnv(env);
  if (base === undefined) return { chain: 18545 + step, relay: 18547 + step, site: 18300 + step, dev: 18301 + step };
  const at = base + step;
  return { chain: at, relay: at + 1, site: at + 2, dev: at + 3 };
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
