import { nostrTransport, type Envelope, type GiveTransport, type HandRef } from "@ahand/deliver";
import { fromText, getHandFor, giveHash, openAddress, openLink, type Hand, type LinkHead, type OpenedLink } from "@ahand/sdk";
import { useSyncExternalStore } from "react";
import { keccak256, stringToBytes, type Hex } from "viem";

import { CLIENTS } from "../../chain";
import { config } from "../../config";
import { deviceClock, get, put, putIfAbsent, remove, type InboxRecord } from "../../store/db";
import { OPTIONS } from "./place";

/**
 * The raiser's side of delivery (ARCHITECTURE §8): this tab listens on each unlocked Hand's
 * inbox key through packages/deliver. A "give" envelope is written to the device's `inbox` store
 * (a give link holds no secret by format) and judged by Core only when shown. A "note" (a
 * helper's reply in the thread) and the raiser's own replies stay in this tab's memory.
 *
 * One record per Give (R-29, D-24, D-25; FINDINGS E-3, E-4): the give link is opened and the
 * record kept under `giveHash(hand, give)`, the id /thank looks it up by, and written only if
 * absent. A relay sends its stored wraps again to every new subscription, so the same Give comes
 * back in every session; its first-seen time stays the one of the first session. A link that
 * cannot be opened now (the network is away) is kept under its message id until it opens, and is
 * then moved to its giveHash with its first-seen time. When two records turn out to be one Give,
 * the earliest first-seen time stands; nothing ever writes a later one over it.
 *
 * One subscription per Hand for the life of the tab: the session that unlocked it.
 */

export interface ThreadLine {
  /** The other side's chat key (their replyTo), which keys the thread. */
  peer: Hex;
  text: string;
  mine: boolean;
  /** Seconds, the message's own time (the sender's machine clock, as Nostr has it). */
  at: number;
}

let transport: GiveTransport | undefined;
const listening = new Map<string, () => void>();
const threads = new Map<string, ThreadLine[]>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version++;
  for (const listener of listeners) listener();
}

/** Whether this build can hear answers at all: it names at least one relay. */
export const RELAYS = config.relays;

function carrier(): GiveTransport {
  transport ??= nostrTransport(RELAYS);
  return transport;
}

/** Re-renders the caller when an answer arrives or a thread line is added. */
export function useInboxVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => version,
  );
}

/* ───────────────────────────────────────────── one record per Give ── */

/** How a give link is opened here: the Hand's terms as Core keeps them, from `hands(id)`. */
export type GetHand = (head: LinkHead) => Promise<Hand>;

/** `getHandFor` over the build's trusted Cores, each Hand read once per tab (its terms never change). */
function cachedGetHand(): GetHand {
  const read = getHandFor(CLIENTS, config.cores.trusted);
  const cache = new Map<string, Promise<Hand>>();
  return (head) => {
    const key = `${head.chainId}:${head.core.toLowerCase()}:${head.handId}`;
    let hand = cache.get(key);
    if (!hand) {
      hand = read(head);
      cache.set(key, hand);
      hand.catch(() => cache.delete(key)); // a failed read (offline) is asked again next time
    }
    return hand;
  };
}

let handTerms: GetHand | undefined;
let intakes: Promise<unknown> = Promise.resolve();
function defaultGetHand(): GetHand {
  handTerms ??= cachedGetHand();
  return handTerms;
}

/** Opens a give link as it travels: a whole address (with `#`) or the bare link text. */
export function openGiveLink(text: string, getHand: GetHand): Promise<OpenedLink> {
  const trimmed = text.trim();
  return trimmed.includes("#") ? openAddress(trimmed, getHand, OPTIONS) : openLink(fromText(trimmed), getHand, OPTIONS);
}

/**
 * What makes one copy of a Give: its signatures (the Give's two and every Shake's). A giveHash
 * covers the Give's terms, not its signatures, so a link with a broken confirmation can carry the
 * same giveHash as the good one. Such a copy is kept apart, never in the good one's place.
 */
export function copyOf(opened: OpenedLink): string {
  const signed = opened.signedGive;
  return [signed?.keySig ?? "", signed?.giverSig ?? "", ...opened.signedShakes.map((s) => s.keySig)].join(":").toLowerCase();
}

/** The id a further copy of a Give is kept under, beside the giveHash the first copy holds. */
function copyId(hand: string, id: Hex, copy: string): string {
  return `${hand}:${id}:${keccak256(stringToBytes(copy)).slice(2, 18)}`;
}

/**
 * Writes `record` only if no record has its id; resolves with the record the store keeps.
 * A record already there keeps its first-seen time; only the helper's words and chat key, which
 * a pasted copy lacks, are filled in from a delivered one.
 */
export async function keepOnce(record: InboxRecord): Promise<InboxRecord> {
  if (await putIfAbsent("inbox", record)) return record;
  const before = await get("inbox", record.id);
  if (!before) return record; // removed meanwhile (moved to its giveHash by another tab): nothing to fill
  const fill: Partial<InboxRecord> = {};
  if (!before.words && record.words) fill.words = record.words;
  if (!before.replyTo && record.replyTo) fill.replyTo = record.replyTo;
  if (Object.keys(fill).length === 0) return before;
  const filled = { ...before, ...fill };
  await put("inbox", filled);
  return filled;
}

/**
 * Keeps one opened copy of a Give, written once: under its giveHash (the id /thank looks it up by)
 * when that id is free or already holds this same copy, else under the copy's own id. Resolves
 * with the record the store keeps for this copy; its first-seen time is never written over.
 */
export async function keepCopy(record: Omit<InboxRecord, "id">, opened: OpenedLink, getHand: GetHand): Promise<InboxRecord> {
  const id = giveHash(opened.hand, opened.signedGive!.give);
  if (await putIfAbsent("inbox", { ...record, id })) return { ...record, id };
  const there = await get("inbox", id);
  const copy = copyOf(opened);
  let same = false;
  if (there) {
    try {
      same = copyOf(await openGiveLink(there.giveLink, getHand)) === copy;
    } catch {
      same = false; // the kept link no longer opens: this copy is kept apart
    }
  }
  return keepOnce({ ...record, id: same || !there ? id : copyId(record.hand, id, copy) });
}

/** Whether a record is kept under a message id (`hand:messageId`): its link had not opened when it came. */
export function isProvisional(record: InboxRecord): boolean {
  const rest = record.id.startsWith(`${record.hand}:`) ? record.id.slice(record.hand.length + 1) : undefined;
  return rest !== undefined && rest !== "" && !rest.includes(":");
}

/**
 * Moves a record kept under a message id to its copy's own id, once the link opens. The earliest
 * first-seen time stands: the provisional record goes only when the record kept now carries a time
 * as early as its own; otherwise both stay and every reader takes the earlier one.
 */
export async function rekey(provisional: InboxRecord, opened: OpenedLink, getHand: GetHand = defaultGetHand()): Promise<InboxRecord> {
  if (!opened.signedGive) return provisional;
  const { id: _old, ...rest } = provisional;
  const kept = await keepCopy(rest, opened, getHand);
  if (kept.id !== provisional.id && kept.firstSeen <= provisional.firstSeen) await remove("inbox", provisional.id);
  return kept;
}

/** One delivered "give" envelope into the store: one record per copy of a Give, written once (E-3, E-4). */
export async function intake(hand: string, envelope: Envelope, messageId: string, getHand: GetHand = defaultGetHand()): Promise<InboxRecord | undefined> {
  if (envelope.kind !== "give" || !envelope.giveLink) return undefined;
  const record: InboxRecord = {
    id: `${hand}:${messageId}`,
    hand,
    giveLink: envelope.giveLink,
    firstSeen: deviceClock(),
    ...(envelope.text ? { words: envelope.text } : {}),
    replyTo: envelope.replyTo,
  };
  let opened: OpenedLink | undefined;
  try {
    opened = await openGiveLink(envelope.giveLink, getHand);
  } catch {
    opened = undefined; // offline, or a link that never opens: kept under its message id
  }
  const provisional = await get("inbox", record.id);
  if (!opened?.signedGive) return provisional ?? keepOnce(record);
  // An earlier session kept it under its message id: its first-seen time comes along.
  if (provisional) return rekey(provisional, opened, getHand);
  const { id: _message, ...rest } = record;
  return keepCopy(rest, opened, getHand);
}

/**
 * Starts listening on a Hand's inbox, once per tab. `hand` is the store's `handKey`. With no
 * `since`, the relays send every wrap they keep: an answer sent while this device was away still
 * arrives, and the store keeps one record per Give whatever comes again.
 */
export function listenOn(hand: string, secret: Hex, getHand?: GetHand): void {
  if (listening.has(hand) || RELAYS.length === 0) return;
  const stop = carrier().listen(secret, (envelope: Envelope, from: Hex, meta) => {
    if (envelope.kind === "give" && envelope.giveLink) {
      // One at a time in this tab, so two copies of one Give never race to be first.
      intakes = intakes
        .then(() => intake(hand, envelope, meta.id, getHand))
        .catch(() => undefined) // storage refused: the answer is lost on reload, like everything else in a private window
        .finally(emit);
    } else if (envelope.kind === "note" && envelope.text) {
      addLine(hand, { peer: from, text: envelope.text, mine: false, at: meta.at });
    }
  });
  listening.set(hand, stop);
  emit();
}

export function isListening(hand: string): boolean {
  return listening.has(hand);
}

function threadKey(hand: string, peer: Hex): string {
  return `${hand}|${peer.toLowerCase()}`;
}

function addLine(hand: string, line: ThreadLine): void {
  const key = threadKey(hand, line.peer);
  threads.set(key, [...(threads.get(key) ?? []), line].sort((a, b) => a.at - b.at));
  emit();
}

export function threadOf(hand: string, peer: Hex | undefined): ThreadLine[] {
  return peer ? (threads.get(threadKey(hand, peer)) ?? []) : [];
}

/**
 * Sends the raiser's reply as a "note" to the helper's chat key, from the Hand's inbox key, so
 * the helper can answer back into the same inbox. Says how many relays took it.
 */
export async function reply(hand: string, ref: HandRef, secret: Hex, to: Hex, text: string): Promise<{ acks: number; of: number }> {
  const sent = await carrier().send(to, { v: 1, kind: "note", hand: ref, text }, secret);
  if (sent.acks > 0) addLine(hand, { peer: to, text, mine: true, at: Math.floor(deviceClock() / 1000) });
  return { acks: sent.acks, of: sent.of };
}
