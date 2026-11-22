import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";

import { clientOf, useChainStatus } from "../../chain";
import { config } from "../../config";
import { all, forHand, type HandRecord, type InboxRecord, type PassedRecord } from "../../store/db";
import { judgeGive, onePerGive, type HandPlace, type Judged } from "./answers";
import { RELAYS, isProvisional, listenOn, readOf, rekey, useInboxVersion, useStoredVersion } from "./inbox";
import { inboxSight, type InboxSight } from "./logic";
import { GET_HAND, OPTIONS } from "./place";
import { secretsOf, unlockedFor, useSessionVersion, type HandSecrets } from "./session";

/**
 * The screen's reads of the device's store and of what an unlocked session gives. The list's one
 * source is the store: nothing here reads logs to find a raiser's Hands.
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
  }, [version, ...deps]); // `read` is a new closure every render; the caller's `deps` say when it reads something else
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

/** What /my reads of a thank's intent (A's `Intent`): only its kind, hash and chain. */
export interface ThankOnWay {
  kind?: string;
  hash?: string;
  chainId?: number;
}

/**
 * Every inbox record that keeps a thank's intent: a thank this device sent and
 * has not seen through. Read again when an answer arrives.
 */
export function useThanksOnWay(): Loaded<(InboxRecord & { thank: ThankOnWay })[]> {
  const inbox = useInboxVersion();
  return useStore(async () => {
    const records = (await all("inbox")) as (InboxRecord & { thank?: ThankOnWay })[];
    return records.filter((record): record is InboxRecord & { thank: ThankOnWay } => Boolean(record.thank && typeof record.thank === "object"));
  }, [inbox]);
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
  }, [record?.intent, record?.book, record?.n, unlocked, session]); // the record by its identity: a new object each read names the same Hand
  return secrets;
}

export interface AnswerRead {
  record: InboxRecord;
  /** Undefined while Core is being asked. */
  judged?: Judged;
}

export interface Answers {
  reads: AnswerRead[];
  /** Everything the store holds for this Hand now has been read back and judged by Core. */
  settled: boolean;
}

/**
 * The give links this device holds for a Hand, each judged by Core's `checkGive` on the chain's
 * current state. Judged again when a new one arrives and when the Hand's state changes (an answer
 * stops being one once the Hand is closed).
 */
export function useAnswers(key: string | undefined, place: HandPlace | undefined, state: string | undefined): Answers {
  // Changes when an answer was written to the store, not on every relay's word or thread line.
  const inbox = useStoredVersion();
  // Answers the network could not check are checked again each time the chain answers again.
  const { offline } = useChainStatus(place?.chainId);
  const wasOffline = useRef(offline);
  const [backOnline, setBackOnline] = useState(0);
  useEffect(() => {
    if (wasOffline.current && !offline) setBackOnline((n) => n + 1);
    wasOffline.current = offline;
  }, [offline]);
  const [reads, setReads] = useState<AnswerRead[]>([]);
  // What the last finished pass was asked: it is the current one only if nothing changed since.
  const asked = key && place ? `${key}|${state}|${inbox}|${backOnline}` : "";
  const [done, setDone] = useState("");
  useEffect(() => {
    if (!key || !place) {
      setReads([]);
      setDone("");
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
      if (!live) return;
      setReads(records.map((record, index) => ({ record, judged: judged[index] })));
      setDone(asked);
      // A record kept under a message id (the link did not open when it came, or an older build
      // kept it so) moves to its giveHash now that it opens, with its first-seen time.
      for (const [index, record] of records.entries()) {
        const read = judged[index];
        if (read?.verdict === "answer" && isProvisional(record)) void rekey(record, read.opened).catch(() => undefined);
      }
    })();
    return () => {
      live = false;
    };
  }, [key, place?.chainId, place?.core, place?.handId, state, inbox, backOnline]); // `place` by its parts: a new object each render names the same Hand
  // One card per Give: the same answer delivered twice, or also pasted, is shown once, at its earliest time.
  return { reads: onePerGive(reads), settled: done === asked && reads.every((read) => read.judged && read.judged.verdict !== "offline") };
}

/**
 * What the screen may say about a Hand's answers (logic.ts `inboxSight`): locked until the
 * connected account, the one that raised it, has confirmed its keys this visit; then by what the
 * relays answered. `settled` is `useAnswers`'s.
 */
export function useInboxSight(record: HandRecord | undefined, connected: Address | undefined, secrets: HandSecrets | undefined, settled: boolean): InboxSight {
  useSessionVersion();
  useInboxVersion();
  const mine = record && connected && record.raiser.toLowerCase() === connected.toLowerCase();
  const read = record?.hand ? readOf(record.hand) : undefined;
  return inboxSight({
    relays: RELAYS.length,
    unlocked: Boolean(mine && unlockedFor(record.chainId, record.core, record.raiser)),
    key: secrets && Boolean(secrets.inbox),
    read: read?.read ?? 0,
    failed: read?.failed ?? 0,
    busy: !settled || Boolean(read?.storing),
  });
}
