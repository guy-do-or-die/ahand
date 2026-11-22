import { fromBase64Url } from "@ahand/sdk";
import { bytesToHex, getAddress, type Address } from "viem";

import type { Ruler } from "./ruler";

/**
 * What a link's bytes say by themselves, with no network (also with the RPC
 * off): each pass's share and payee, the answer's helper and payee, and the words that travel
 * with the link. Nothing here is proof. A pass's confirmation is made over the Hand's terms
 * (EIP-712: `shakeHash(hand, shake)`), and the link does not carry the terms: they are read from
 * Core. So without the network no confirmation can be checked, and the keys cannot be shown to
 * follow one another either, because a pass's next key is not written in the link: it is
 * recovered from the next confirmation. The screen says exactly that.
 *
 * It starts from the ruler's offsets and reads only the segments that hold no secret (`shake`,
 * `give`, `attachments`); the `secret` segment is never touched. The layout is the link format's,
 * version 1 (packages/sdk/src/link.ts, the comment at its top). Anything that does not read is
 * left out, never guessed: proving and refusing stay the SDK's job, with the network.
 */

const BPS = 10_000;
const SHAKE_PAYEE = 0x80;
const SHAKE_DATA = 0x40;
const SHAKE_CLAIM = 0x3f;
const GIVE_PAYEE = 0x80;
const GIVE_DATA = 0x40;
const GIVE_KEY = 0x20;
const ATTACHED_STATEMENTS = 1;
const ATTACHED_TEXT = 2;

export interface OfflinePass {
  /** Its place on the route, from 0. */
  position: number;
  /** The share that reached it, in basis points: the whole at the start, then what the pass before left. */
  claimBps: number;
  /** The share it passes on. The difference is what it keeps. */
  nextClaimBps: number;
  /** Where its own part would land; absent when it keeps nothing. */
  payee?: Address;
  /** Whether it hangs a list of its own on its pass (a `dataHash`). */
  ownWords: boolean;
}

export interface OfflineGive {
  /** The helper the answer names. */
  signer: Address;
  /** Where the helper's money would land: the helper's own address unless another is written. */
  payee: Address;
  /** Whether the helper's confirmation is a key's (64 bytes on the wire) or an account's own bytes. */
  byKey: boolean;
  /** The length of the helper's confirmation as it travels. */
  confirmationBytes: number;
  ownWords: boolean;
}

/** Attachments as they travel: the names of each list's statements, and each text. Unchecked. */
export interface OfflineWords {
  names: string[];
  texts: string[];
}

export interface OfflineReading {
  passes: OfflinePass[];
  /** What the route leaves for whoever answers it. */
  leftBps: number;
  give?: OfflineGive;
  /** The words inside the link, after `#`. */
  inside?: OfflineWords;
  /** The words in the open part before `#` (`?d=`), which a site can see. */
  outside?: OfflineWords;
}

class Cursor {
  at = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get left(): number {
    return this.bytes.length - this.at;
  }
  take(length: number): Uint8Array {
    if (length < 0 || length > this.left) throw new RangeError("the bytes end in the middle of a field");
    const out = this.bytes.subarray(this.at, this.at + length);
    this.at += length;
    return out;
  }
  byte(): number {
    return this.take(1)[0]!;
  }
  address(): Address {
    return getAddress(bytesToHex(this.take(20)));
  }
  varint(): number {
    let value = 0;
    for (let shift = 0; shift < 53; shift += 7) {
      const group = this.byte();
      value += (group & 0x7f) * 2 ** shift;
      if ((group & 0x80) === 0) return value;
    }
    throw new RangeError("a number too long to read");
  }
}

function textOf(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** Reads attachments as they travel (their number, then kind, length and bytes of each). Undefined when they do not read. */
export function wordsOf(bytes: Uint8Array): OfflineWords | undefined {
  try {
    const cursor = new Cursor(bytes);
    const words: OfflineWords = { names: [], texts: [] };
    for (let left = cursor.varint(); left > 0; --left) {
      const kind = cursor.byte();
      const body = cursor.take(cursor.varint());
      if (kind === ATTACHED_TEXT) {
        const text = textOf(body);
        if (text !== undefined) words.texts.push(text);
      } else if (kind === ATTACHED_STATEMENTS) {
        const list = new Cursor(body);
        for (let statements = list.varint(); statements > 0; --statements) {
          const name = textOf(list.take(list.byte()));
          list.take(32); // the statement's value: a hash, or a key; not words
          if (name !== undefined) words.names.push(name);
        }
      }
    }
    if (cursor.left !== 0) return undefined;
    return words.names.length + words.texts.length > 0 ? words : undefined;
  } catch {
    return undefined;
  }
}

/** The words of the open part `?d=` before `#`, if any. */
export function outsideWords(before: string): OfflineWords | undefined {
  const found = /[?&]d=([A-Za-z0-9_-]+)/.exec(before);
  if (!found) return undefined;
  try {
    return wordsOf(fromBase64Url(found[1]!));
  } catch {
    return undefined;
  }
}

/**
 * What the bytes say, from the ruler's offsets. `before` is what stood before `#` in the pasted
 * text. Throws only for bytes the ruler itself could not have measured.
 */
export function readOffline(bytes: Uint8Array, ruler: Ruler, before = ""): OfflineReading {
  const passes: OfflinePass[] = [];
  let claim = BPS;
  let give: OfflineGive | undefined;
  let inside: OfflineWords | undefined;

  for (const segment of ruler.segments) {
    // The secret, the last key and the pin are never read: nothing of them is shown.
    if (segment.kind !== "shake" && segment.kind !== "give" && segment.kind !== "attachments") continue;
    const part = bytes.subarray(segment.start, segment.start + segment.length);
    const cursor = new Cursor(part);
    if (segment.kind === "shake") {
      const first = cursor.byte();
      const pass: OfflinePass = { position: segment.position ?? passes.length, claimBps: claim, nextClaimBps: claim, ownWords: (first & SHAKE_DATA) !== 0 };
      if (first & SHAKE_PAYEE) {
        pass.nextClaimBps = ((first & SHAKE_CLAIM) << 8) | cursor.byte();
        pass.payee = cursor.address();
      }
      claim = pass.nextClaimBps;
      passes.push(pass);
    } else if (segment.kind === "give") {
      const first = cursor.byte();
      const signer = cursor.address();
      const payee = first & GIVE_PAYEE ? cursor.address() : signer;
      if (first & GIVE_DATA) cursor.take(32);
      cursor.take(64); // the link key's confirmation of the answer
      const byKey = (first & GIVE_KEY) !== 0;
      give = { signer, payee, byKey, confirmationBytes: byKey ? 64 : cursor.varint(), ownWords: (first & GIVE_DATA) !== 0 };
    } else {
      inside = wordsOf(part);
    }
  }

  const outside = outsideWords(before);
  return { passes, leftBps: claim, ...(give ? { give } : {}), ...(inside ? { inside } : {}), ...(outside ? { outside } : {}) };
}
