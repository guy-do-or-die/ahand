import { inboxSecret, keysTypedData, masterOf, rootSeed } from "@ahand/sdk";
import { publicKeyOf } from "@ahand/deliver";
import { useSyncExternalStore } from "react";
import type { Address, Hex, TypedDataDefinition } from "viem";

import { bookOf, openSeed, setRepeats, type HandRecord } from "../../store/db";
import type { TypedOutcome } from "../../wallet";

/**
 * "Unlock links and replies" (UX-SPEC §7.3, ARCHITECTURE §5): one keys confirmation per session.
 * The master it gives can rebuild every link this account raised on this device and open the
 * replies sent to them, so it lives in this tab's memory only, never in storage, the console or
 * a request; a reload asks again.
 *
 * An account whose confirmations differ (a passkey, an MPC or smart account) gives a different
 * master each time: then nothing is derived. Its Hands' inbox secrets were stored on the device
 * when they were raised (§11), and a link can be shown again only from the locked copy (D-63)
 * while it still exists.
 */

export interface Unlocked {
  /** Present only for an account whose confirmations repeat. */
  master?: Hex;
  repeats: boolean;
}

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

export type UnlockOutcome = { ok: true; unlocked: Unlocked } | { ok: false; reason: "rejected" | "no-wallet" | "failed"; message?: string };

/**
 * Asks the connected account for the keys confirmation. If this device has not yet learned
 * whether the account repeats itself, it asks a second time and compares (D-18), and keeps the
 * verdict in `books`.
 */
export async function unlock(
  chainId: number,
  core: Address,
  raiser: Address,
  sign: (typed: TypedDataDefinition) => Promise<TypedOutcome>,
): Promise<UnlockOutcome> {
  const typed = keysTypedData(chainId, core, raiser) as unknown as TypedDataDefinition;
  const first = await sign(typed);
  if (!first.ok) return { ok: false, reason: first.reason, ...(first.message ? { message: first.message } : {}) };
  let repeats = (await bookOf(raiser).catch(() => undefined))?.repeats;
  if (repeats === undefined) {
    const second = await sign(typed);
    if (!second.ok) return { ok: false, reason: second.reason, ...(second.message ? { message: second.message } : {}) };
    repeats = first.signature.toLowerCase() === second.signature.toLowerCase();
    await setRepeats(raiser, repeats).catch(() => undefined); // a private window may refuse storage; the verdict holds for this tab
  }
  const result: Unlocked = repeats ? { master: await masterOf(first.signature), repeats } : { repeats };
  unlocked.set(sessionKey(chainId, core, raiser), result);
  emit();
  return { ok: true, unlocked: result };
}

/** What this device can do for one of its Hands once the account is unlocked. */
export interface HandSecrets {
  /** The link's 16-byte seed: derived, or opened from the locked copy. */
  seed?: Hex;
  /** The Hand's inbox secret (a chat key) and its public key. */
  inbox?: { secret: Hex; pub: Hex };
  /** Why there is no seed, when there is none. */
  noSeed?: "no-book" | "copy-dropped";
}

/** A Hand that was added by its number and whose place in a book is unknown. */
export function hasBook(record: HandRecord): boolean {
  return record.n >= 0 && /^0x[0-9a-fA-F]{16}$/.test(record.book);
}

export async function secretsOf(record: HandRecord, session: Unlocked): Promise<HandSecrets> {
  if (session.master) {
    if (!hasBook(record)) return { noSeed: "no-book" };
    const secret = await inboxSecret(session.master, record.book, record.n);
    return { seed: await rootSeed(session.master, record.book, record.n), inbox: { secret, pub: publicKeyOf(secret) } };
  }
  const out: HandSecrets = {};
  if (record.inboxSecret) out.inbox = { secret: record.inboxSecret, pub: publicKeyOf(record.inboxSecret) };
  const copy = await openSeed(record.intent).catch(() => undefined);
  if (copy) out.seed = copy;
  else out.noSeed = "copy-dropped";
  return out;
}
