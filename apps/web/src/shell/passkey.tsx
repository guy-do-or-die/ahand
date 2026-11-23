import { useSyncExternalStore } from "react";

import { t } from "../i18n";
import { TID } from "../testids";
import { QuietButton } from "../ui";
import type { PasskeyOutcome } from "../wallet";
import { asideWhile } from "./person";

/**
 * "Add a passkey" in the viewer's sheet, for an account whose wallet Privy keeps (email, a social
 * account or a passkey). Privy's login window only logs in with a passkey the account already
 * has ("I have a passkey"), so without this nobody could make one. The press opens Privy's own
 * passkey window (wallet/state.ts `addPasskey`); the sheet steps aside while it is open
 * (person.ts `asideWhile`) and comes back with the account's new count, or with one line saying
 * why nothing was added.
 *
 * With a passkey on the account the action stays, as "Add another passkey": Privy keeps several
 * per account (its window lists them and removes them too), and a passkey is shared only within
 * one maker's keychain (Apple's, Google's, Microsoft's), so a phone and a computer of different
 * makers each need their own.
 *
 * This file holds no wallet code: the sheet passes the way to add one in (`add`), so the frame and
 * the tests load it alone.
 */

/** The one line said after Privy's window closed with no passkey added; nothing after one was added or removed (the count says it). */
export type PasskeyNote = "none" | "unsupported" | "failed";

export function noteOf(outcome: PasskeyOutcome): PasskeyNote | undefined {
  return outcome === "added" || outcome === "removed" ? undefined : outcome;
}

/** Each line's key, written whole so the used-keys guard finds it. */
const NOTE_KEY: Record<PasskeyNote, string> = {
  none: "common.person.passkey.none",
  unsupported: "common.person.passkey.unsupported",
  failed: "common.person.passkey.failed",
};

let note: PasskeyNote | undefined;
const listeners = new Set<() => void>();

function setNote(next: PasskeyNote | undefined): void {
  if (note === next) return;
  note = next;
  for (const listener of [...listeners]) listener();
}

/** Forgets the last line: the sheet calls it when it closes, so the line belongs to one visit. */
export function clearPasskeyNote(): void {
  setNote(undefined);
}

export function passkeyNote(): PasskeyNote | undefined {
  return note;
}

export function usePasskeyNote(): PasskeyNote | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => note,
    () => undefined,
  );
}

/** The press: the sheet steps aside for Privy's window, and comes back with the outcome's line. `add` never throws, and a throw is "failed" all the same. */
export async function addPasskeyAside(add: () => Promise<PasskeyOutcome>): Promise<PasskeyOutcome> {
  setNote(undefined);
  return asideWhile(async () => {
    const outcome = await add().catch((): PasskeyOutcome => "failed");
    setNote(noteOf(outcome));
    return outcome;
  });
}

/**
 * The action and its one line: "Add a passkey" with what it is for under it, or "Passkey added."
 * over "Add another passkey". After a press that added nothing, the line under the action says why,
 * in place of either.
 */
export function PasskeyRow({ passkeys, note: said, onAdd }: { passkeys: number; note?: PasskeyNote | undefined; onAdd: () => void }) {
  const has = passkeys > 0;
  return (
    <div className="flex flex-col items-start gap-1" data-testid={TID.shell.personPasskey} data-value={passkeys}>
      {has && !said ? <p className="ah-label m-0">{t("common.person.passkey.added")}</p> : null}
      <QuietButton variant="text" data-testid={TID.shell.personPasskeyAdd} onClick={onAdd}>
        {t(has ? "common.person.passkey.another" : "common.person.passkey.add")}
      </QuietButton>
      {said ? (
        <p className="ah-label m-0" role="status">
          {t(NOTE_KEY[said])}
        </p>
      ) : has ? null : (
        <p className="ah-label m-0">{t("common.person.passkey.hint")}</p>
      )}
    </div>
  );
}
