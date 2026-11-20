import { useEffect, useState } from "react";
import type { Address } from "viem";

import { clientOf } from "../../chain";
import { config } from "../../config";
import { all, forHand, type HandRecord, type InboxRecord, type PassedRecord } from "../../store/db";
import { judgeGive, type HandPlace, type Judged } from "./answers";
import { listenOn, useInboxVersion } from "./inbox";
import { GET_HAND, OPTIONS } from "./place";
import { secretsOf, unlockedFor, useSessionVersion, type HandSecrets } from "./session";

/**
 * The screen's reads of the device's store and of what an unlocked session gives. The list's one
 * source is the store (D-5): nothing here reads logs to find a raiser's Hands.
 */

const listListeners = new Set<() => void>();
let listVersion = 0;

/** Tells every list on screen that the store's `hands` changed (an add, a rebuild). */
export function listChanged(): void {
  listVersion++;
  for (const listener of listListeners) listener();
}

export type Loaded<T> = { status: "loading" } | { status: "ok"; value: T } | { status: "refused" };

function useStore<T>(read: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [version, setVersion] = useState(listVersion);
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  useEffect(() => {
    const listener = () => setVersion(listVersion);
    listListeners.add(listener);
    return () => {
      listListeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    let live = true;
    read().then(
      (value) => live && setState({ status: "ok", value }),
      () => live && setState({ status: "refused" }), // storage refused (a private window): the screen says the list lives here only
    );
    return () => {
      live = false;
    };
  }, [version, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

/** Every Hand raised on (or added to) this device, newest Hand number first. */
export function useMyHands(): Loaded<HandRecord[]> {
  return useStore(async () => {
    const records = await all("hands");
    return records.sort((a, b) => {
      const x = a.handId ? BigInt(a.handId) : -1n;
      const y = b.handId ? BigInt(b.handId) : -1n;
      return x === y ? 0 : x > y ? -1 : 1;
    });
  }, []);
}

/** The device's record of one Hand (`handKey`), if it keeps one. */
export function useMyHand(key: string): Loaded<HandRecord | undefined> {
  return useStore(async () => (await forHand("hands", key))[0], [key]);
}

export function usePassed(): Loaded<PassedRecord[]> {
  return useStore(() => all("passed"), []);
}

/**
 * What an unlocked session gives for one Hand: its link seed and inbox key. Starts listening on
 * the inbox as soon as the key is known. Undefined while locked, or for another account's Hand.
 */
export function useSecrets(record: HandRecord | undefined, connected: Address | undefined): HandSecrets | undefined {
  const session = useSessionVersion();
  const [secrets, setSecrets] = useState<HandSecrets | undefined>(undefined);
  const mine = record && connected && record.raiser.toLowerCase() === connected.toLowerCase();
  const unlocked = mine ? unlockedFor(record.chainId, record.core, record.raiser) : undefined;
  useEffect(() => {
    if (!record || !unlocked) {
      setSecrets(undefined);
      return;
    }
    let live = true;
    secretsOf(record, unlocked).then(
      (found) => {
        if (!live) return;
        setSecrets(found);
        if (found.inbox && record.hand) listenOn(record.hand, found.inbox.secret);
      },
      () => live && setSecrets({}),
    );
    return () => {
      live = false;
    };
  }, [record?.intent, record?.book, record?.n, unlocked, session]); // eslint-disable-line react-hooks/exhaustive-deps
  return secrets;
}

export interface AnswerRead {
  record: InboxRecord;
  /** Undefined while Core is being asked. */
  judged?: Judged;
}

/**
 * The give links this device holds for a Hand, each judged by Core's `checkGive` on the chain's
 * current state. Judged again when a new one arrives and when the Hand's state changes (an answer
 * stops being one once the Hand is closed).
 */
export function useAnswers(key: string | undefined, place: HandPlace | undefined, state: string | undefined): AnswerRead[] {
  const inbox = useInboxVersion();
  const [reads, setReads] = useState<AnswerRead[]>([]);
  useEffect(() => {
    if (!key || !place) {
      setReads([]);
      return;
    }
    let live = true;
    (async () => {
      let records: InboxRecord[];
      try {
        records = await forHand("inbox", key);
      } catch {
        records = [];
      }
      records.sort((a, b) => a.firstSeen - b.firstSeen);
      if (!live) return;
      setReads((before) => records.map((record) => ({ record, ...(before.find((r) => r.record.id === record.id)?.judged ? { judged: before.find((r) => r.record.id === record.id)!.judged } : {}) })));
      const judged = await Promise.all(
        records.map((record) =>
          judgeGive({ giveLink: record.giveLink, place, client: clientOf(place.chainId), getHand: GET_HAND, options: OPTIONS, forwarder: config.forwarder }),
        ),
      );
      if (live) setReads(records.map((record, index) => ({ record, judged: judged[index] })));
    })();
    return () => {
      live = false;
    };
  }, [key, place?.chainId, place?.core, place?.handId, state, inbox]); // eslint-disable-line react-hooks/exhaustive-deps
  return dedupe(reads);
}

/** One card per Give: the same answer delivered twice, or also pasted, is shown once. */
function dedupe(reads: AnswerRead[]): AnswerRead[] {
  const seen = new Set<string>();
  // Answers first (in the order they arrived), then whatever is still being checked or was refused.
  const rank = (read: AnswerRead) => (read.judged?.verdict === "answer" ? 0 : read.judged ? 2 : 1);
  return [...reads].sort((a, b) => rank(a) - rank(b)).filter((read) => {
    if (read.judged?.verdict !== "answer") return true;
    if (seen.has(read.judged.giveHash)) return false;
    seen.add(read.judged.giveHash);
    return true;
  });
}
