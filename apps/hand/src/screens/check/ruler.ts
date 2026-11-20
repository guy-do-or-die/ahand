/**
 * The ruler of a link's bytes (UX-SPEC §10.2): where the head, each pass, the end of the route,
 * the Give and the attachments lie, measured with no network and no key. It returns offsets and
 * lengths only, never a byte's value, so the screen cannot print the secret part even by mistake.
 *
 * The layout is the link format's, version 1, as `packages/sdk/src/link.ts` documents it at its
 * top. The SDK does not export its reader, so this walk follows that comment; `ruler.test.ts`
 * measures links the SDK itself wrote, of every kind, and requires the segments to cover each
 * byte exactly once. Proving anything is left to the SDK (`openAddress`, `runSteps`): a link this
 * walk can measure may still be refused there.
 */

export type SegmentKind = "head" | "shake" | "secret" | "last-key" | "pin" | "give" | "attachments";

export interface Segment {
  kind: SegmentKind;
  /** Offset of the first byte, from 0. */
  start: number;
  length: number;
  /** For a pass: its position on the route, from 0. */
  position?: number;
}

export interface Ruler {
  total: number;
  kind: "live" | "addressed" | "give";
  segments: Segment[];
}

const FLAG_ADDRESSED = 0x01;
const FLAG_GIVE = 0x02;
const FLAG_CORE = 0x04;
const FLAG_DATA = 0x08;
const SHAKE_PAYEE = 0x80;
const SHAKE_DATA = 0x40;
const GIVE_PAYEE = 0x80;
const GIVE_DATA = 0x40;
const GIVE_KEY = 0x20;

/** Thrown when the bytes do not follow the layout; the screen then shows no ruler and the SDK's sentence. */
export class Unmeasurable extends Error {}

class Walk {
  at = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get left(): number {
    return this.bytes.length - this.at;
  }
  skip(length: number): void {
    if (length < 0 || length > this.left) throw new Unmeasurable("the link ends in the middle of a field");
    this.at += length;
  }
  byte(): number {
    if (this.left < 1) throw new Unmeasurable("the link ends in the middle of a field");
    return this.bytes[this.at++]!;
  }
  varint(): number {
    let value = 0;
    for (let shift = 0; shift < 53; shift += 7) {
      const group = this.byte();
      value += (group & 0x7f) * 2 ** shift;
      if ((group & 0x80) === 0) return value;
    }
    throw new Unmeasurable("a number too long to measure");
  }
}

/** Measures a link's bytes. Throws `Unmeasurable` for bytes that do not follow the layout. */
export function rulerOf(bytes: Uint8Array): Ruler {
  const walk = new Walk(bytes);
  const segments: Segment[] = [];
  const mark = (kind: SegmentKind, start: number, position?: number) =>
    segments.push({ kind, start, length: walk.at - start, ...(position === undefined ? {} : { position }) });

  const first = walk.byte();
  if (first >> 4 !== 1) throw new Unmeasurable(`link version ${first >> 4}`);
  const flags = first & 0x0f;
  walk.varint(); // chain
  if (flags & FLAG_CORE) walk.skip(20);
  walk.varint(); // Hand number
  const count = walk.varint();
  if (count * 65 > walk.left) throw new Unmeasurable("more passes named than the link holds");
  mark("head", 0);

  for (let position = 0; position < count; ++position) {
    const start = walk.at;
    const shake = walk.byte();
    if (shake & SHAKE_PAYEE) walk.skip(1 + 20);
    if (shake & SHAKE_DATA) walk.skip(32);
    walk.skip(64);
    mark("shake", start, position);
  }

  const addressed = (flags & FLAG_ADDRESSED) !== 0;
  const hasGive = (flags & FLAG_GIVE) !== 0;
  let start = walk.at;
  if (!addressed) {
    walk.skip(16);
    mark("secret", start);
  } else if (count > 0) {
    walk.skip(20);
    mark("last-key", start);
  }
  if (count === 0 && !hasGive) {
    start = walk.at;
    walk.skip(16);
    mark("pin", start);
  }

  if (hasGive) {
    start = walk.at;
    const give = walk.byte();
    walk.skip(20);
    if (give & GIVE_PAYEE) walk.skip(20);
    if (give & GIVE_DATA) walk.skip(32);
    walk.skip(64);
    if (give & GIVE_KEY) walk.skip(64);
    else walk.skip(walk.varint());
    mark("give", start);
  }

  if (flags & FLAG_DATA) {
    start = walk.at;
    walk.skip(walk.left);
    mark("attachments", start);
  }
  if (walk.left !== 0) throw new Unmeasurable("bytes after the end of the link");

  return { total: bytes.length, kind: hasGive ? "give" : addressed ? "addressed" : "live", segments };
}

/** Splits pasted text into what stood before `#` and the link after it; text with no `#` is the link. */
export function splitPasted(text: string): { before: string; fragment: string } {
  const trimmed = text.trim();
  const mark = trimmed.indexOf("#");
  return mark < 0 ? { before: "", fragment: trimmed } : { before: trimmed.slice(0, mark), fragment: trimmed.slice(mark + 1) };
}

/** The bytes of the public part `?d=` before `#`, if any (base64url length only; checked by the SDK). */
export function outsideLength(before: string): number {
  const found = /[?&]d=([A-Za-z0-9_-]+)/.exec(before);
  if (!found) return 0;
  return Math.floor((found[1]!.length * 6) / 8);
}
