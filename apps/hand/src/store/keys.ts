import { keysTypedData, masterOf } from "@ahand/sdk";
import { useSyncExternalStore } from "react";
import type { Address, Hex } from "viem";

import type { TypedOutcome } from "../wallet/useTypedSigner";
import { bookOf, setRepeats } from "./db";

/**
 * The keys confirmation (ARCHITECTURE §5, D-18): the one module /raise and /my ask it through.
 *
 * The master it gives can rebuild every link the account raised on this device and open the
 * replies sent to them, so it lives in this tab's memory only, never in storage, the console or a
 * request; a reload asks again. One confirmation serves the whole tab: a raise that asked it
 * leaves /my unlocked for the same account, chain and Core, and the other way round.
 *
 * First time on this device for an account, the confirmation is asked twice and the answers
 * compared; the verdict ("repeats" or not) is kept in the device's `books`. An account whose
 * answers differ (a passkey, an MPC or smart account) gives no master: nothing is derived from it.
 *
 * Storage is optional here, the same way for both screens: a device that cannot read `books`
 * (a private window) asks twice, as for a new account; one that cannot write the verdict keeps it
 * for this tab only.
 */

export interface Unlocked {
  /** Present only for an account whose confirmations repeat. */
  master?: Hex;
  repeats: boolean;
}

export type KeysTyped = ReturnType<typeof keysTypedData>;
export type UnlockOutcome = { ok: true; unlocked: Unlocked } | { ok: false; reason: "rejected" | "no-wallet" | "failed"; message?: string };

const unlocked = new Map<string, Unlocked>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version++;
  for (const listener of listeners) listener();
}

/** The session key of an account on a chain and Core: the keys message is bound to all three. */
export function sessionKey(chainId: number, core: string, raiser: string): string {
  return `${chainId}:${core.toLowerCase()}:${raiser.toLowerCase()}`;
}

export function unlockedFor(chainId: number, core: string, raiser: string | undefined): Unlocked | undefined {
  return raiser ? unlocked.get(sessionKey(chainId, core, raiser)) : undefined;
}

/** Re-renders the caller when an account is unlocked; returns a number that changes then. */
export function useSessionVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => version,
  );
}

/** What this device learned about the account's answers: undefined when it has not (or cannot read it). */
export async function repeatsOnDevice(raiser: Address): Promise<boolean | undefined> {
  return (await bookOf(raiser).catch(() => undefined))?.repeats;
}

/**
 * Asks the account for the keys confirmation, twice when this device does not yet know whether
 * its answers repeat, and keeps the result for this tab.
 */
export async function unlock(chainId: number, core: Address, raiser: Address, sign: (typed: KeysTyped) => Promise<TypedOutcome>): Promise<UnlockOutcome> {
  const typed = keysTypedData(chainId, core, raiser);
  const first = await sign(typed);
  if (!first.ok) return { ok: false, reason: first.reason, ...(first.message ? { message: first.message } : {}) };
  let repeats = await repeatsOnDevice(raiser);
  if (repeats === undefined) {
    const second = await sign(typed);
    if (!second.ok) return { ok: false, reason: second.reason, ...(second.message ? { message: second.message } : {}) };
    repeats = first.signature.toLowerCase() === second.signature.toLowerCase();
    await setRepeats(raiser, repeats).catch(() => undefined); // storage refused: the verdict holds for this tab
  }
  const result: Unlocked = repeats ? { master: await masterOf(first.signature), repeats } : { repeats };
  unlocked.set(sessionKey(chainId, core, raiser), result);
  emit();
  return { ok: true, unlocked: result };
}
