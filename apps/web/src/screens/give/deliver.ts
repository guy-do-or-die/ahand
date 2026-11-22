import { nostrTransport, openOutbox, type Envelope, type GiveTransport, type Hex, type Outbox, type OutboxEntry, type OutboxStore } from "@ahand/deliver";
import { useEffect, useState, useSyncExternalStore } from "react";

import { config } from "../../config";
import { openDb, outboxStore } from "../../store/db";
import { fromInbox } from "./flow";

/**
 * The giver's side of delivery. One outbox per tab over the device's
 * IndexedDB (`outbox` store): every envelope is written down before it is sent, keeps its chat key
 * so the thread survives a reload, and is retried while the outbox is open. Where storage is
 * refused (some private windows) the outbox lives in this tab's memory: delivery still works, the
 * retry stops when the tab closes. The relays are the configuration's; none is built in.
 *
 * What is stored: the give link (no secret by format), the giver's words and replies, the status
 * and the per-Give chat key (a chat key only: it can sign no Shake and no Give).
 */

/**
 * The first pause before an undelivered envelope is tried again while this page is open; the
 * outbox doubles it after each try, up to ten minutes. An envelope counts as delivered once two
 * relays (or every relay, when fewer are configured) acknowledge it (@ahand/deliver).
 */
export const RETRY_MS = 10_000;

let transport: GiveTransport | undefined;
let outbox: Promise<Outbox> | undefined;
const entries = new Map<string, OutboxEntry>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version++;
  for (const listener of [...listeners]) listener();
}

function changed(entry: OutboxEntry): void {
  entries.set(entry.key, entry);
  notify();
}

function memoryStore(): OutboxStore {
  const map = new Map<string, OutboxEntry>();
  return { get: (key) => map.get(key), set: (key, value) => map.set(key, value), delete: (key) => map.delete(key), keys: () => [...map.keys()] };
}

export function relayCount(): number {
  return config.relays.length;
}

function transportOf(): GiveTransport {
  transport ??= nostrTransport(config.relays);
  return transport;
}

/** The tab's outbox, opened once. */
export function giverOutbox(): Promise<Outbox> {
  outbox ??= (async () => {
    let store: OutboxStore;
    try {
      await openDb();
      store = outboxStore<OutboxEntry>();
    } catch {
      store = memoryStore();
    }
    const opened = openOutbox(transportOf(), store, { retryMs: RETRY_MS, onChange: changed });
    for (const entry of await opened.list()) entries.set(entry.key, entry);
    notify(); // a screen that read the entries before they were loaded draws them now
    return opened;
  })();
  return outbox;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** One outbox entry, re-rendering the caller on every change (an acknowledgement, a retry). */
export function useEntry(key: string | undefined): OutboxEntry | undefined {
  useSyncExternalStore(subscribe, () => version);
  return key ? entries.get(key) : undefined;
}

/**
 * This device's own answers: every "give" envelope the outbox wrote down, newest first,
 * with its chat key, so its thread can be read again after a reload or in a new tab.
 * Opening the outbox also starts its retries while the page is open.
 */
export function useMyAnswers(): { loaded: boolean; entries: OutboxEntry[] } {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    giverOutbox().then(
      () => live && setLoaded(true),
      () => live && setLoaded(true),
    );
    return () => {
      live = false;
    };
  }, []);
  useSyncExternalStore(subscribe, () => version);
  const gives = [...entries.values()].filter((entry) => entry.envelope.kind === "give" && entry.envelope.giveLink);
  return { loaded, entries: gives.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key)) };
}

/** Every entry written with this chat key: the giver's own side of the thread, in order. */
export function useThreadSent(chatKey: Hex | undefined): OutboxEntry[] {
  useSyncExternalStore(subscribe, () => version);
  if (!chatKey) return [];
  return [...entries.values()].filter((entry) => entry.chatKey.toLowerCase() === chatKey.toLowerCase()).sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

/** Sends one envelope to the Hand's inbox through the outbox; resolves after its first try. */
export async function sendToInbox(inbox: Hex, envelope: Omit<Envelope, "replyTo">, chatKey?: Hex): Promise<OutboxEntry> {
  const box = await giverOutbox();
  const entry = await box.send(inbox, envelope, chatKey);
  changed(entry);
  return entry;
}

/** Tries every undelivered envelope now. */
export async function retryNow(): Promise<void> {
  const box = await giverOutbox();
  for (const entry of await box.flush()) changed(entry);
}

export interface Reply {
  id: string;
  /** Seconds, the machine's clock of whoever wrote it (Nostr's), shown only as an order. */
  at: number;
  text: string;
  replyTo: Hex;
}

/**
 * The asker's replies to this give: gift wraps to the giver's chat key whose sender is the Hand's
 * own inbox key and whose envelope names this Hand. Anything else addressed to the key is a
 * stranger's and is not shown. Kept in memory; after a reload they are read again from the relays.
 */
export function useReplies(chatKey: Hex | undefined, inbox: Hex | undefined, hand: { chainId: number; core: string; handId: string } | undefined, since: number | undefined): Reply[] {
  const [replies, setReplies] = useState<Reply[]>([]);
  const handKey = hand ? `${hand.chainId}:${hand.core.toLowerCase()}:${hand.handId}` : undefined;
  useEffect(() => {
    if (!chatKey || !inbox || !handKey || config.relays.length === 0) return;
    setReplies([]);
    const stop = transportOf().listen(
      chatKey,
      (envelope, from, meta) => {
        if (!fromInbox(from, inbox) || envelope.kind !== "note" || !envelope.text) return;
        if (`${envelope.hand.chainId}:${envelope.hand.core.toLowerCase()}:${envelope.hand.handId}` !== handKey) return;
        setReplies((before) => (before.some((r) => r.id === meta.id) ? before : [...before, { id: meta.id, at: meta.at, text: envelope.text!, replyTo: envelope.replyTo }].sort((a, b) => a.at - b.at)));
      },
      since,
    );
    return stop;
  }, [chatKey, inbox, handKey, since]);
  return replies;
}
