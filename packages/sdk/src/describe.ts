import { bytesToHex, keccak256, size, stringToBytes, zeroHash, type Hex } from "viem";

import type { AddressShape, OpenedAddress } from "./address.js";
import { dataHashOf, isDataOf, type Statement } from "./data.js";
import type { Attachments, MatchedData, OpenedLink } from "./link.js";
import type { Hand } from "./types.js";

/**
 * A Hand's description as this build writes it: lists of statements (`data.ts`) whose names are
 * this application's, not Core's and not the link format's.
 *
 *   title      the hash of the title's text
 *   content    the hash of the details' text
 *   salt       32 random bytes: the dataHash on the chain then confirms no guess of the words
 *   private    the dataHash of a second, hidden list (unlisted Hands)
 *   inbox.n1   the Hand's inbox: a 32-byte x-only public key replies are wrapped to (NIP-17)
 *
 * Three ways to arrange them, by what stands before `#` (ARCHITECTURE §9):
 *
 *   public    {title, content, inbox.n1}; the list and both texts in `d`        faced address
 *   unlisted  {title, private} and the title in `d`;
 *             private = dataHash {content, salt, inbox.n1}, carried with the details inside the link
 *   dark      {title, content, salt, inbox.n1} and both texts inside the link   bare address
 *
 * A writer of an unlisted (or public) link passes the public part to the encoder as
 * `options.outside`, because a link proves its attachments against the Hand together with them:
 *
 *   const d = describeHand({ mode: "unlisted", title, content, inbox });
 *   const outside = d.outside && packAttachments(d.outside);
 *   const link = await encodeLive({ domain, hand, signedShakes: [], seed, attachments: d.inside }, { ...options, outside });
 *   const address = toAddress({ site, link, shape: d.shape, outside: d.outside }, options);
 */

export const STATEMENT = {
  title: "title",
  content: "content",
  salt: "salt",
  private: "private",
  inbox: "inbox.n1",
} as const;

/** How much of a description stands before `#`: all of it, the title, or nothing. */
export type DescribeMode = "public" | "unlisted" | "dark";

export interface Description {
  mode: DescribeMode;
  title: string;
  content?: string;
  /** The Hand's inbox: a 32-byte x-only public key (`inbox.n1`). */
  inbox?: Hex;
  /** Unlisted and dark only; a fresh random one when left out. A public Hand takes none. */
  salt?: Hex;
}

export interface Described {
  /** What the raiser gives Core at `raise`. */
  dataHash: Hex;
  /** The address shape the raiser's links take. */
  shape: AddressShape;
  /** What rides after `#`, inside the link. */
  inside?: Attachments;
  /** What rides before `#`, in `d`, where a site and preview robots see it. */
  outside?: Attachments;
  /** The salt used (unlisted and dark), for the raiser's own list on this device. */
  salt?: Hex;
}

/**
 * A text the way it is hashed and attached: Unicode form NFC, line ends LF. Applied to what a
 * person typed before anything is hashed, attached or stored, so the words on every screen are
 * the bytes the dataHash stands for (D-43).
 */
export function normalizeText(input: string): string {
  return input.normalize("NFC").replace(/\r\n?/g, "\n");
}

/** The value of a statement about a text that is already normalised: the hash of its bytes. */
function textHash(text: string): Hex {
  return keccak256(stringToBytes(text));
}

function freshSalt(): Hex {
  return bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

function word32(value: Hex, what: string): Hex {
  if (!/^0x[0-9a-fA-F]*$/.test(value) || size(value) !== 32) throw new Error(`${what} is 32 bytes`);
  return value.toLowerCase() as Hex;
}

/**
 * The statements, texts and dataHash of a new Hand's description, arranged for its mode. Texts
 * are normalised here; an empty details text counts as none.
 */
export function describeHand(d: Description): Described {
  const title = normalizeText(d.title);
  if (title.trim() === "") throw new Error("a Hand's title is not empty");
  const content = d.content === undefined ? undefined : normalizeText(d.content);
  const told = content === undefined || content === "" ? undefined : content;
  const inbox = d.inbox === undefined ? undefined : word32(d.inbox, "an inbox key");

  const titled: Statement = { name: STATEMENT.title, value: textHash(title) };
  const detailed: Statement[] = told === undefined ? [] : [{ name: STATEMENT.content, value: textHash(told) }];
  const inboxed: Statement[] = inbox === undefined ? [] : [{ name: STATEMENT.inbox, value: inbox }];
  const texts = (...list: (string | undefined)[]) => list.filter((text): text is string => text !== undefined);

  if (d.mode === "public") {
    // Everything is public, so there is nothing for a salt to hide.
    if (d.salt !== undefined) throw new Error("a public Hand takes no salt");
    const list = [titled, ...detailed, ...inboxed];
    return { dataHash: dataHashOf(list), shape: "faced", outside: { statements: [list], texts: texts(title, told) } };
  }

  const salt = word32(d.salt ?? freshSalt(), "a salt");
  const salted: Statement = { name: STATEMENT.salt, value: salt };
  if (d.mode === "unlisted") {
    const hidden = [...detailed, salted, ...inboxed];
    const shown: Statement[] = [titled, { name: STATEMENT.private, value: dataHashOf(hidden) }];
    return {
      dataHash: dataHashOf(shown),
      shape: "faced",
      outside: { statements: [shown], texts: [title] },
      inside: { statements: [hidden], texts: texts(told) },
      salt,
    };
  }
  if (d.mode === "dark") {
    const list = [titled, ...detailed, salted, ...inboxed];
    return { dataHash: dataHashOf(list), shape: "bare", inside: { statements: [list], texts: texts(title, told) }, salt };
  }
  throw new Error(`no such mode: ${String((d as { mode: unknown }).mode)}`);
}

export interface ReadDescription {
  /**
   * `none`: the Hand has no description (dataHash 0). `attached`: every word its lists name
   * arrived and matched the dataHash Core keeps. `lost`: the Hand has one and it did not all
   * arrive; whatever did is still returned. A lost description is never shown as an empty Hand.
   */
  status: "none" | "attached" | "lost";
  title?: string;
  content?: string;
  inbox?: Hex;
}

function valueIn(lists: readonly Statement[][], name: string): Hex | undefined {
  for (const list of lists) {
    const found = list.find((statement) => statement.name === name);
    if (found) return found.value;
  }
  return undefined;
}

/**
 * The Hand's description, from `opened.ofHand` only: what hangs on the dataHash Core keeps for
 * the Hand. Lists a holder hung on its own Shake are never read here (they are not the raiser's
 * words). Reads the root list and, if it names one, the hidden list behind `private`.
 */
export function readDescription(opened: OpenedLink): ReadDescription {
  return readDescriptionOf(opened.hand, opened.ofHand);
}

/**
 * The same reader for a Hand and the data matched against its dataHash, where there is no opened
 * link: a faced address's `d` (`faceOf`), on the Hand view and in face's previews.
 */
export function readDescriptionOf(hand: Pick<Hand, "dataHash">, matched: MatchedData): ReadDescription {
  if (hand.dataHash.toLowerCase() === zeroHash) return { status: "none" };
  return readOfHand(hand.dataHash, matched);
}

function readOfHand(dataHash: Hex, ofHand: MatchedData): ReadDescription {
  const root = ofHand.statements.find((list) => isDataOf(dataHash, list));
  if (!root) return { status: "lost" };
  const hiddenHash = valueIn([root], STATEMENT.private);
  const hidden = hiddenHash === undefined ? undefined : ofHand.statements.find((list) => isDataOf(hiddenHash, list));
  const lists = hidden ? [root, hidden] : [root];

  const textOf = (value: Hex | undefined) =>
    value === undefined ? undefined : ofHand.texts.find((text) => textHash(text) === value.toLowerCase());
  const titleValue = valueIn(lists, STATEMENT.title);
  const contentValue = valueIn(lists, STATEMENT.content);
  const title = textOf(titleValue);
  const content = textOf(contentValue);
  const inbox = valueIn(lists, STATEMENT.inbox);

  const whole =
    (hiddenHash === undefined || hidden !== undefined) &&
    (titleValue === undefined || title !== undefined) &&
    (contentValue === undefined || content !== undefined);
  const result: ReadDescription = { status: whole ? "attached" : "lost" };
  if (title !== undefined) result.title = title;
  if (content !== undefined) result.content = content;
  if (inbox !== undefined) result.inbox = inbox;
  return result;
}

/**
 * Whether a holder may write a link received in one shape in another: the same shape, or bare.
 * Never lighter, which would publish what the raiser hid; bare is the one darker shape, and the
 * one a QR code always takes.
 */
export function canReshape(from: AddressShape, to: AddressShape): boolean {
  return from === to || to === "bare";
}

/**
 * What a holder passes on with the next link, in `shape`: the same attachments in the same places,
 * or for a bare address everything inside. Use it as
 *
 *   const carry = carryFor(opened, shape);
 *   const outside = carry.outside && packAttachments(carry.outside);
 *   const { link } = await passOn(opened, terms, { ...options, outside }, carry.attachments);
 *   const address = toAddress({ site, link, shape, outside: carry.outside }, options);
 */
export function carryFor(opened: OpenedAddress, shape: AddressShape): { attachments: Attachments; outside?: Attachments } {
  const from = opened.seen.shape;
  if (!canReshape(from, shape)) throw new Error(`a link received ${from} cannot be passed on ${shape}: that would show what was hidden`);
  const inside: Attachments = { statements: [...opened.inside.statements], texts: [...opened.inside.texts] };
  if (shape === from) {
    return shape === "faced" ? { attachments: inside, outside: { statements: [...opened.outside.statements], texts: [...opened.outside.texts] } } : { attachments: inside };
  }
  return {
    attachments: {
      statements: [...inside.statements!, ...opened.outside.statements],
      texts: [...inside.texts!, ...opened.outside.texts],
    },
  };
}

