import { nostrTransport, type Envelope, type GiveTransport, type HandRef } from "@ahand/deliver";
import { useSyncExternalStore } from "react";
import type { Hex } from "viem";

import { config } from "../../config";
import { deviceClock, put } from "../../store/db";

/**
 * The raiser's side of delivery (ARCHITECTURE §8): this tab listens on each unlocked Hand's
 * inbox key through packages/deliver. A "give" envelope is written to the device's `inbox` store
 * as it came (a give link holds no secret by format) and judged by Core only when shown. A "note"
 * (a helper's reply in the thread) and the raiser's own replies stay in this tab's memory.
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

/** Starts listening on a Hand's inbox, once per tab. `hand` is the store's `handKey`. */
export function listenOn(hand: string, secret: Hex): void {
  if (listening.has(hand) || RELAYS.length === 0) return;
  const stop = carrier().listen(secret, (envelope: Envelope, from: Hex, meta) => {
    if (envelope.kind === "give" && envelope.giveLink) {
      void put("inbox", {
        id: `${hand}:${meta.id}`,
        hand,
        giveLink: envelope.giveLink,
        firstSeen: deviceClock(),
        ...(envelope.text ? { words: envelope.text } : {}),
        replyTo: envelope.replyTo,
      })
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
