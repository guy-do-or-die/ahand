import { useId, useSyncExternalStore } from "react";

import { t } from "../i18n";
import { TID } from "../testids";
import { QuietButton } from "../ui";
import type { PasskeyOutcome } from "../wallet";
import { PASSKEYS_MOST } from "../wallet/passkeys";
import { asideWhile, personShown } from "./person";

/**
 * "Add a passkey" in the viewer's sheet, for an account whose wallet Privy keeps (email, a social
 * account or a passkey). Privy's login window only logs in with a passkey the account already
 * has ("I have a passkey"), so without this nobody could make one. The press opens Privy's own
 * passkey window (wallet/state.ts `addPasskey`); the sheet steps aside while it is open
 * (person.ts `asideWhile`) and comes back with the account's new count, or with one line saying
 * why nothing was added.
 *
 * With a passkey on the account the action stays, as "Add another passkey": Privy keeps up to 5
 * per account (its window lists them and removes them too), and a passkey is shared only within
 * one maker's keychain (Apple's, Google's, Microsoft's), so a phone and a computer of different
 * makers each need their own. At 5 the action gives way to one line saying that is the most.
 *
 * This file holds no wallet code: the sheet passes the way to add one in (`add`), so the frame and
 * the tests load it alone.
 */

/** The one line said after Privy's window closed with no passkey added; nothing after one was added or removed (the count says it). */
export type PasskeyNote = "none" | "full" | "unsupported" | "failed";

export function noteOf(outcome: PasskeyOutcome): PasskeyNote | undefined {
  return outcome === "added" || outcome === "removed" ? undefined : outcome;
}

/** Each line's key, written whole so the used-keys guard finds it. */
const NOTE_KEY: Record<PasskeyNote, string> = {
  none: "common.person.passkey.none",
  full: "common.person.passkey.full",
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

/**
 * How long the sheet is on screen again before its line is said: the sheet comes back as a new
 * dialog, and a screen reader reads out a live region's change, not the text it was drawn with.
 */
const SAY_AFTER_MS = 100;

/**
 * The press: the sheet steps aside for Privy's window, comes back, and then says the outcome's
 * line (unless the sheet was closed meanwhile). `add` never throws, and a throw is "failed" all
 * the same.
 */
export async function addPasskeyAside(add: () => Promise<PasskeyOutcome>): Promise<PasskeyOutcome> {
  setNote(undefined);
  const outcome = await asideWhile(() => add().catch((): PasskeyOutcome => "failed"));
  await new Promise((resolve) => setTimeout(resolve, SAY_AFTER_MS));
  if (personShown()?.who === "me") setNote(noteOf(outcome));
  return outcome;
}

/**
 * The action and its one line: "Add a passkey" with what it is for under it, or how many the
 * account has over "Add another passkey". After a press that added nothing, the line under the
 * action says why. At the most Privy keeps, the line says so in place of the action. The line under
 * the action is always there, empty when it has nothing to say, so a screen reader reads it out
 * when it changes, and it describes the action.
 */
export function PasskeyRow({ passkeys, note: said, onAdd }: { passkeys: number; note?: PasskeyNote | undefined; onAdd: () => void }) {
  const lineId = useId();
  const has = passkeys > 0;
  const full = passkeys >= PASSKEYS_MOST;
  const line = said ? t(NOTE_KEY[said]) : full ? t("common.person.passkey.full") : has ? "" : t("common.person.passkey.hint");
  return (
    <div className="flex flex-col items-start" data-testid={TID.shell.personPasskey} data-value={passkeys}>
      {has ? <p className="ah-label m-0 mb-1">{t("common.person.passkey.has", { n: passkeys })}</p> : null}
      {full ? null : (
        <QuietButton variant="text" data-testid={TID.shell.personPasskeyAdd} aria-describedby={lineId} onClick={onAdd}>
          {t(has ? "common.person.passkey.another" : "common.person.passkey.add")}
        </QuietButton>
      )}
      <p id={lineId} className={line && !full ? "ah-label m-0 mt-1" : "ah-label m-0"} role="status">
        {line}
      </p>
    </div>
  );
}
