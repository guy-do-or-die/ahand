import { dropSeed, escrowStamps, get, type HandRecord } from "../../store/db";

/**
 * The sweep of the raiser's locked copies (ARCHITECTURE §5, D-63: "it lasts minutes"). A locked
 * copy of a new Hand's seed exists for one reason: a tab that reloads between sending `raise` and
 * the raiser saving the link must still be able to show that link. Once that reason is gone, so is
 * the copy. Run when the app starts; every time is the chain's (`now` is the latest block's
 * timestamp), never the device's clock.
 *
 * A copy is deleted when:
 *   - no raise on this device names it any more (its record was forgotten or never written);
 *   - its raise was found reverted, or dropped (nothing from it left the account: a tab that
 *     closed between writing that and deleting the copy leaves it for this sweep);
 *   - its Hand is closed (`closedAt` set) or past its end by the chain's clock: the link can no
 *     longer be passed, helped or thanked;
 *   - its link was first shown on the "up" screen `SHOWN_BOUND` seconds ago or more.
 * It is kept while the raise is still on its way (no Hand number yet), and whenever the Hand
 * cannot be read now: a sweep never deletes on a network failure.
 */

/** How long a shown link's locked copy is kept: one day of the chain's time. */
export const SHOWN_BOUND = 24 * 60 * 60;

/** What the sweep needs to know about a Hand: Core's `hands(id).expiry` and `closedAt`. */
export interface HandTimes {
  expiry: number;
  closedAt: number;
}

export type SweepReason = "orphan" | "reverted" | "dropped" | "closed" | "expired" | "shown";

export interface Swept {
  intent: string;
  reason: SweepReason;
}

/**
 * Deletes the locked copies whose reason is gone and says which and why. `readHand` answers for a
 * raise record with a Hand number (undefined when it cannot be read now, or the Hand is on a chain
 * this build does not read).
 */
export async function sweepLockedCopies(now: number, readHand: (record: HandRecord) => Promise<HandTimes | undefined>): Promise<Swept[]> {
  const swept: Swept[] = [];
  for (const stamp of await escrowStamps()) {
    const record = await get("hands", stamp.intent);
    let reason: SweepReason | undefined;
    if (!record) reason = "orphan";
    else if (record.status === "reverted") reason = "reverted";
    else if (record.status === "dropped") reason = "dropped";
    else if (record.handId === undefined) reason = undefined; // the raise is still on its way
    else if (stamp.shownAt !== undefined && now - stamp.shownAt >= SHOWN_BOUND) reason = "shown";
    else {
      const times = await readHand(record).catch(() => undefined);
      if (times && times.closedAt !== 0) reason = "closed";
      else if (times && now >= times.expiry) reason = "expired";
    }
    if (reason) {
      await dropSeed(stamp.intent);
      swept.push({ intent: stamp.intent, reason });
    }
  }
  return swept;
}
