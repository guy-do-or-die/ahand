import { inboxSecret, rootSeed } from "@ahand/sdk";
import { publicKeyOf } from "@ahand/deliver";
import type { Hex } from "viem";

import { openSeed, type HandRecord } from "../../store/db";
import type { Unlocked } from "../../store/keys";

/**
 * "Unlock links and replies" (UX-SPEC §7.3, ARCHITECTURE §5): one keys confirmation per session,
 * asked through `store/keys.ts` (the same module /raise uses). The master lives in this tab's
 * memory only; a reload asks again.
 *
 * An account whose confirmations differ (a passkey, an MPC or smart account) gives a different
 * master each time: then nothing is derived. Its Hands' inbox secrets were stored on the device
 * when they were raised (§11), and a link can be shown again only from the locked copy (D-63)
 * while it still exists.
 */

export { sessionKey, unlock, unlockedFor, useSessionVersion, type Unlocked, type UnlockOutcome } from "../../store/keys";

/** What this device can do for one of its Hands once the account is unlocked. */
export interface HandSecrets {
  /** The link's 16-byte seed: derived, or opened from the locked copy. */
  seed?: Hex;
  /** The Hand's inbox secret (a chat key) and its public key. */
  inbox?: { secret: Hex; pub: Hex };
  /** Why there is no seed, when there is none. */
  noSeed?: "no-book" | "copy-dropped";
  /** The seed came from the raise's locked copy, which lives until "I saved the link" (or the sweep). */
  fromCopy?: boolean;
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
  if (copy) {
    out.seed = copy;
    out.fromCopy = true;
  } else out.noSeed = "copy-dropped";
  return out;
}
