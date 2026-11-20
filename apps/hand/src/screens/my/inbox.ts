import { nostrTransport, publicKeyOf, type Envelope, type GiveTransport, type HandRef } from "@ahand/deliver";
import { useSyncExternalStore } from "react";
import type { Hex } from "viem";

import { config } from "../../config";
import { deviceClock, put } from "../../store/db";
import { readBook, type ReadBook } from "./reads";

/**
 * The raiser's side of delivery (ARCHITECTURE §8): this tab listens on each unlocked Hand's
 * inbox key through packages/deliver. A "give" envelope is written to the device's `inbox` store
 * as it came (a give link holds no secret by format) and judged by Core only when shown. A "note"
 * (a helper's reply in the thread) and the raiser's own replies stay in this tab's memory.
 *
 * One subscription per Hand for the life of the tab: the session that unlocked it. Whether each
 * relay has answered that subscription in full is kept too (reads.ts), because only then may the
 * screen say that nothing has arrived.
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
let reads: ReadBook | undefined;
/** `handKey` → the inbox key listened on, and how to stop. */
const listening = new Map<string, { inbox: Hex; stop: () => void }>();
/** `handKey` → answers that arrived and are not in the store yet. */
const storing = new Map<string, number>();
const threads = new Map<string, ThreadLine[]>();
const listeners = new Set<() => void>();
let version = 0;
let stored = 0;

function emit(): void {
  version++;
  for (const listener of listeners) listener();
}

/** The relays this build names, each once; with none, no answer can arrive here by itself. */
export const RELAYS = [...new Set(config.relays)];

function carrier(): GiveTransport {
  reads ??= readBook(globalThis.WebSocket, emit);
  transport ??= nostrTransport(RELAYS, { WebSocket: reads.Socket });
  return transport;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Re-renders the caller when anything here changes: an answer, a thread line, a relay's read. */
export function useInboxVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

/** A number that changes only when an answer was written to the store: the cue to read it again. */
export function useStoredVersion(): number {
  return useSyncExternalStore(subscribe, () => stored, () => stored);
}

/** Starts listening on a Hand's inbox, once per tab. `hand` is the store's `handKey`. */
export function listenOn(hand: string, secret: Hex): void {
  if (listening.has(hand) || RELAYS.length === 0) return;
  const inbox = publicKeyOf(secret);
  const wire = carrier();
  reads!.expect(inbox); // before the first socket opens, so its answer is counted
  const stop = wire.listen(secret, (envelope: Envelope, from: Hex, meta) => {
    if (envelope.kind === "give" && envelope.giveLink) {
      storing.set(hand, (storing.get(hand) ?? 0) + 1);
      void put("inbox", {
        id: `${hand}:${meta.id}`,
        hand,
        giveLink: envelope.giveLink,
        firstSeen: deviceClock(),
        ...(envelope.text ? { words: envelope.text } : {}),
        replyTo: envelope.replyTo,
      })
        .catch(() => undefined) // storage refused: the answer is lost on reload, like everything else in a private window
        .finally(() => {
          storing.set(hand, storing.get(hand)! - 1);
          stored++;
          emit();
        });
    } else if (envelope.kind === "note" && envelope.text) {
      addLine(hand, { peer: from, text: envelope.text, mine: false, at: meta.at });
    }
  });
  listening.set(hand, { inbox, stop });
  emit();
}

/**
 * How the read of a Hand's inbox stands: relays that answered it in full, relays that could not
 * be read, and whether an answer that arrived is still on its way into the store. Undefined
 * until this tab listens on it.
 */
export function readOf(hand: string): { read: number; failed: number; storing: boolean } | undefined {
  const marks = reads?.marksOf(listening.get(hand)?.inbox ?? "");
  return marks && { ...marks, storing: (storing.get(hand) ?? 0) > 0 };
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
