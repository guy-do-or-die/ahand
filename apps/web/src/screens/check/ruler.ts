/**
 * The ruler of a link's bytes: where the head, each pass, the end of the route,
 * the Give and the attachments lie, measured with no network and no key. It returns offsets and
 * lengths only, never a byte's value, so the screen cannot print the secret part even by mistake.
 *
 * The walk is the SDK's own (`linkLayout` in `packages/sdk/src/link.ts`, beside the reader and
 * with its flags), so the format is declared once. `ruler.test.ts` still measures links the SDK
 * wrote, of every kind, and requires the segments to cover each byte exactly once. Proving
 * anything is left to the SDK (`openAddress`, `runSteps`): a link this walk can measure may still
 * be refused there.
 */
import { LinkError, linkLayout, type LinkLayout, type LinkSegment } from "@ahand/sdk";

export type SegmentKind = LinkSegment["kind"];
export type Segment = LinkSegment;
export type Ruler = LinkLayout;

/** Thrown when the bytes do not follow the layout; the screen then shows no ruler and the SDK's sentence. */
export class Unmeasurable extends Error {}

/** Measures a link's bytes. Throws `Unmeasurable` for bytes that do not follow the layout. */
export function rulerOf(bytes: Uint8Array): Ruler {
  try {
    return linkLayout(bytes);
  } catch (error) {
    if (error instanceof LinkError) throw new Unmeasurable(error.message);
    throw error;
  }
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
