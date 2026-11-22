import {
  bytesToHex,
  bytesToString,
  concatHex,
  getAddress,
  hexToBigInt,
  hexToBytes,
  isAddressEqual,
  keccak256,
  numberToHex,
  recoverAddress,
  size,
  slice,
  stringToBytes,
  stringToHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";

import { CANONICAL_CORE } from "./canonical.js";
import { dataHashOf, nameOf, normalizeText, type Statement } from "./data.js";
import { LONGEST_ROUTE, TX_BYTES_LIMIT } from "./gas.js";
import { digest, domainSeparator, giveHash, handHash, shakeHash } from "./hash.js";
import { signShake } from "./sign.js";
import {
  BPS,
  domain,
  type Eip712Domain,
  type Give,
  type Hand,
  type Shake,
  type SignedGive,
  type SignedShake,
} from "./types.js";
import { CURVE_ORDER, Refusal, checkRoute, isKeySignature, signedBy, type RefusalName, type RouteEnd } from "./verify.js";

/**
 * The aHand link, version 1: a route of signed Shakes and what ends it, as one string of bytes.
 * Core never sees a link; what a link gives back is exactly what `thank` takes.
 *
 *   HEAD    0x10 | flags      version 1 in the high half; flags in the low half:
 *                               0x01 ADDRESSED  the route's end is named by an address: no secret
 *                               0x02 GIVE       a Give follows (only with ADDRESSED)
 *                               0x04 CORE       Core's address follows (not the canonical Core)
 *                               0x08 DATA       attachments follow the route (and the Give)
 *           chainId           varint
 *           [core 20]         if CORE
 *           handId            varint
 *           count             varint: how many Shakes
 *   SHAKES  count records, in route order:
 *           first byte        0x80 PAYEE, 0x40 DATA, low 6 bits: with PAYEE the high bits of
 *                             nextClaimBps, without it zero
 *           [second byte]     if PAYEE: the low 8 bits of nextClaimBps
 *           [payee 20]        if PAYEE, never zero
 *           [dataHash 32]     if DATA, never zero
 *           keySig 64         r, then s with v - 27 in its top bit (ERC-2098)
 *   END     seed 16           without ADDRESSED: the link key is keccak256("aHand.key/1" ‖ seed)
 *           lastKey 20        with ADDRESSED and at least one Shake: the last Shake's nextKey
 *           pin 16            without Shakes and without a Give: the first 16 bytes of the
 *                             EIP-712 hash of the Hand's terms under Core's domain
 *   GIVE    first byte        0x80 PAYEE (the payee is not the signer), 0x40 DATA, 0x20 KEY (the
 *                             giver's signature is a key's, 64 bytes); low 5 bits zero
 *           signer 20
 *           [payee 20]        if PAYEE
 *           [dataHash 32]     if DATA
 *           keySig 64
 *           giverSig          64 bytes if KEY, else varint length and the bytes as they are
 *   DATA    only with the DATA flag: their number (varint, at least 1), then that many
 *           attachments to the end of the link, in ascending order:
 *           kind 1            1 a list of statements (see data.ts), 2 a text
 *           length            varint
 *           bytes
 *           A list stands behind a dataHash of the Hand, of a Shake or of the Give, or behind a
 *           value of another attached list; a text behind a value of an attached list. The same
 *           DATA bytes may also travel outside the link, where a site can see them (address.ts):
 *           they are checked the same way, and nothing may stand in both places.
 *
 * Not carried, because the rest gives it: a Shake's nextKey (recovered from the next signature,
 * backwards from the end of the route to the Hand's root key), a Shake's claimBps (the claim
 * passed on before it, 10000 at the start), the Give's claimBps and routeHash, and the Hand's
 * terms (read from Core by handId and then proven by the first signature, or by the pin).
 *
 * Every byte is one of three things: signed, checked against a hash that is signed or kept by
 * Core, or the one secret. The one exception is the giver's signature, which travels as it is:
 * only `checkGive` and, for a contract giver, the chain can judge it. Anything that could be
 * written in two ways is refused in all but one, so one route is one link.
 *
 * Attachments can be taken off a link and it still opens: what is attached is checked, that
 * everything was attached is not. A link cut anywhere, the end of an attachment included, does
 * not open.
 */

export const LINK_VERSION = 1;
/**
 * The most bytes a reader takes by default, in a link and in the attachments that travel outside
 * it: 128 KiB, the largest transaction ordinary nodes accept. The format has no limit; a reader
 * needs one, or a link of any size would be read whole before it could be refused.
 */
export const MAX_LINK_BYTES = TX_BYTES_LIMIT;
export const SEED_BYTES = 16;
export const PIN_BYTES = 16;
/** The tag under which a seed becomes a link key; another way of making keys is another tag. */
export const KEY_TAG = "aHand.key/1";

const FLAG_ADDRESSED = 0x01;
const FLAG_GIVE = 0x02;
const FLAG_CORE = 0x04;
const FLAG_DATA = 0x08;

const SHAKE_PAYEE = 0x80;
const SHAKE_DATA = 0x40;
const SHAKE_CLAIM = 0x3f;

const GIVE_PAYEE = 0x80;
const GIVE_DATA = 0x40;
const GIVE_KEY = 0x20;
const GIVE_RESERVED = 0x1f;

const ATTACHED_STATEMENTS = 1;
const ATTACHED_TEXT = 2;

/** The least a Shake takes on the wire: its first byte and its signature. */
const SHAKE_MIN_BYTES = 65;
/** The least an attachment takes: its kind and its length. */
const ATTACHED_MIN_BYTES = 2;

export type LinkErrorCode =
  | "malformed" // not a link at all: cut short, a wrong alphabet, bytes left over
  | "unsupported" // another version, a reserved bit of the Give, an unknown attachment
  | "no-canonical-core" // the link names the canonical Core by leaving its address out, and this reader knows none
  | "non-canonical" // readable, but written in a way the format does not allow
  | "too-long" // more Shakes than this application takes
  | "another-hand" // the Hand given is not the one the link names
  | "not-this-hand" // the route does not start at this Hand's root key, or the pin differs
  | "invalid" // Core would refuse it
  | "unmatched-data"; // an attachment that no hash in the link stands for

export class LinkError extends Error {
  /**
   * Where Core itself would refuse what the link holds or what was given to write: Core's error,
   * the first in the order of Core's checks, and the position for the errors that name one. A
   * route Core would take but no Give could end (one that leaves the giver less than the Hand's
   * minimum, or one that ends at the zero key) names the error Core gives every such Give.
   *
   * Two refusals name no position. A signature no key can have made, after the first Shake, when
   * the first Shake's signature can be read: the Shakes before it cannot be rebuilt without the
   * key it hides, so the signature Core stops at depends on the keys sent with them. And a route
   * that does not start at this Hand's root key (`not-this-hand`): the link was signed under
   * other terms or by another key, and its Shakes as read under this Hand's are not the ones its
   * signers signed. A Give not signed by the route's last key names its own position, the
   * route's length. Absent for a fault of the link's own, such as a seed that gives no key.
   */
  readonly refusal?: { name: RefusalName; position?: number };

  constructor(
    readonly code: LinkErrorCode,
    message: string,
    refusal?: { name: RefusalName; position?: number },
  ) {
    super(`${code}: ${message}`);
    this.name = "LinkError";
    if (refusal) this.refusal = refusal.position === undefined ? { name: refusal.name } : { name: refusal.name, position: refusal.position };
  }
}

/* ------------------------------------------------------------------ bytes */

class Writer {
  private readonly chunks: Uint8Array[] = [];

  bytes(value: Uint8Array | Hex): this {
    this.chunks.push(typeof value === "string" ? hexToBytes(value) : value);
    return this;
  }

  byte(value: number): this {
    return this.bytes(Uint8Array.of(value));
  }

  /** A number in groups of 7 bits, lowest first, the top bit of a byte saying that more follow. */
  varint(value: bigint): this {
    if (value < 0n || value >= 1n << 256n) throw new LinkError("malformed", "a number out of range");
    const out: number[] = [];
    do {
      const group = Number(value & 0x7fn);
      value >>= 7n;
      out.push(value > 0n ? group | 0x80 : group);
    } while (value > 0n);
    return this.bytes(Uint8Array.from(out));
  }

  done(): Uint8Array {
    const out = new Uint8Array(this.chunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

class Reader {
  private offset = 0;

  constructor(private readonly source: Uint8Array) {}

  get left(): number {
    return this.source.length - this.offset;
  }

  take(length: number): Uint8Array {
    if (length > this.left) throw new LinkError("malformed", "the link ends in the middle of a field");
    const out = this.source.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  hex(length: number): Hex {
    return bytesToHex(this.take(length));
  }

  address(): Address {
    return getAddress(this.hex(20));
  }

  byte(): number {
    return this.take(1)[0];
  }

  varint(): bigint {
    let value = 0n;
    for (let shift = 0n; ; shift += 7n) {
      if (shift > 252n) throw new LinkError("malformed", "a number longer than 256 bits");
      const group = this.byte();
      value |= BigInt(group & 0x7f) << shift;
      if ((group & 0x80) === 0) {
        if (group === 0 && shift > 0n) throw new LinkError("non-canonical", "a number written longer than needed");
        if (value >= 1n << 256n) throw new LinkError("malformed", "a number longer than 256 bits");
        return value;
      }
    }
  }

  /** A length that the rest of the link can hold. */
  length(): number {
    const length = this.varint();
    if (length > BigInt(this.left)) throw new LinkError("malformed", "the link ends in the middle of a field");
    return Number(length);
  }
}

/** The text that `bytes` are, if they are text written in the one way UTF-8 allows. */
function textOf(bytes: Uint8Array, what: string): string {
  // A decoder drops a byte-order mark at the start; it is a character of the text like any other.
  // The marks are counted in a loop: a text of nothing else would otherwise nest a call for each.
  let marks = 0;
  while (bytes.length >= 3 * (marks + 1) && bytes[3 * marks] === 0xef && bytes[3 * marks + 1] === 0xbb && bytes[3 * marks + 2] === 0xbf) {
    ++marks;
  }
  const text = "\uFEFF".repeat(marks) + bytesToString(bytes.subarray(3 * marks));
  if (bytesToHex(stringToBytes(text)) !== bytesToHex(bytes)) throw new LinkError("malformed", `${what} is not text`);
  return text;
}

/** A statement's name as it is hashed; a name the list's rules refuse is no link. */
function paddedName(name: string): Hex {
  try {
    return nameOf(name);
  } catch (error) {
    throw new LinkError("malformed", (error as Error).message);
  }
}

/* ------------------------------------------------------------- signatures */

const TOP_BIT = 1n << 255n;

/** Core's 65 bytes as the 64 of the wire. Only the one form Core takes can be written. */
function toWireSig(signature: Hex): Hex {
  if (!isKeySignature(signature)) throw new LinkError("invalid", "not a key's signature in the form Core takes");
  const s = hexToBigInt(slice(signature, 32, 64));
  const v = Number(hexToBigInt(slice(signature, 64, 65)));
  return concatHex([slice(signature, 0, 32), numberToHex(v === 28 ? s | TOP_BIT : s, { size: 32 })]);
}

/** The 64 bytes of the wire as the 65 Core takes; an `s` Core would refuse cannot be read. */
function fromWireSig(wire: Hex): Hex {
  const vs = hexToBigInt(slice(wire, 32, 64));
  const signature = concatHex([
    slice(wire, 0, 32),
    numberToHex(vs & (TOP_BIT - 1n), { size: 32 }),
    vs >= TOP_BIT ? "0x1c" : "0x1b",
  ]);
  if (!isKeySignature(signature)) throw new LinkError("non-canonical", "a signature with s in the upper half");
  return signature;
}

/* ------------------------------------------------------------------- keys */

/** The link key a seed stands for. */
export function keyOfSeed(seed: Hex): Hex {
  if (size(seed) !== SEED_BYTES) throw new LinkError("malformed", `a seed is ${SEED_BYTES} bytes`);
  const key = keccak256(concatHex([stringToHex(KEY_TAG), seed]));
  // About one seed in 2^128 gives a number that is no key; such a seed is never handed out.
  const scalar = hexToBigInt(key);
  if (scalar === 0n || scalar >= CURVE_ORDER) throw new LinkError("invalid", "this seed gives no key");
  return key;
}

/** A fresh seed from the system's generator: the first bytes of a fresh random key. */
export function newSeed(): Hex {
  for (;;) {
    const seed = slice(generatePrivateKey(), 0, SEED_BYTES);
    try {
      keyOfSeed(seed);
      return seed;
    } catch {
      // try another
    }
  }
}

/**
 * What names a Hand's terms on a link that no signature covers yet: the start of the hash a
 * signature over the Hand alone would be made on.
 */
export function pinOf(chain: Eip712Domain, hand: Hand): Hex {
  return slice(digest(domainSeparator(chain), handHash(hand)), 0, PIN_BYTES);
}

/* ------------------------------------------------------------ attachments */

/** What may travel with a link without being part of the route; each is checked against a hash. */
export interface Attachments {
  /**
   * Whole lists of statements, each standing behind a dataHash of the Hand, of a Shake or of the
   * Give, or behind a value of another attached list.
   */
  statements?: Statement[][];
  /** Texts, each standing behind a value of one of the attached lists. */
  texts?: string[];
}

/** Attachments read and checked against the hashes they stand behind. */
export interface MatchedData {
  statements: Statement[][];
  texts: string[];
}

interface Attached {
  kind: number;
  bytes: Uint8Array;
}

/** The one order attachments stand in: by kind, then by their bytes. */
function compareAttached(a: Attached, b: Attached): number {
  if (a.kind !== b.kind) return a.kind - b.kind;
  const ah = bytesToHex(a.bytes);
  const bh = bytesToHex(b.bytes);
  return ah < bh ? -1 : ah > bh ? 1 : 0;
}

/** A list of statements: how many, then each name's length, the name and the 32-byte value, by name. */
function packStatements(list: readonly Statement[]): Uint8Array {
  const sorted = list
    .map(({ name, value }) => ({ name, padded: paddedName(name), value }))
    .sort((a, b) => (a.padded < b.padded ? -1 : a.padded > b.padded ? 1 : 0));
  const writer = new Writer().varint(BigInt(sorted.length));
  for (const { name, value } of sorted) {
    if (size(value) !== 32) throw new LinkError("malformed", "a statement's value is 32 bytes");
    const text = stringToBytes(name);
    writer.byte(text.length).bytes(text).bytes(value);
  }
  return writer.done();
}

function unpackStatements(bytes: Uint8Array): Statement[] {
  const reader = new Reader(bytes);
  const list: Statement[] = [];
  let previous: Hex | undefined;
  for (let left = reader.varint(); left > 0n; --left) {
    const length = reader.byte();
    if (length === 0 || length > 32) throw new LinkError("malformed", "a statement's name is 1 to 32 bytes");
    const raw = reader.take(length);
    // A name is hashed padded with zeros: a zero byte in it would be a byte no hash tells apart.
    if (raw.includes(0)) throw new LinkError("non-canonical", "a statement's name with a zero character");
    const name = textOf(raw, "a statement's name");
    const padded = paddedName(name);
    if (previous !== undefined && padded <= previous) throw new LinkError("non-canonical", "statements out of order");
    previous = padded;
    list.push({ name, value: reader.hex(32) });
  }
  if (reader.left !== 0) throw new LinkError("malformed", "bytes after a list of statements");
  return list;
}

/** A text as everyone sees it and as `textValue` hashes it: Unicode form NFC, line ends LF. */
function isHashedForm(text: string): boolean {
  return normalizeText(text) === text;
}

/**
 * Attachments as they travel, in a link or outside it: their number, then the kind, length and
 * bytes of each, in ascending order. None at all is no bytes at all.
 */
export function packAttachments(attachments: Attachments | undefined): Uint8Array {
  const items: Attached[] = [];
  for (const list of attachments?.statements ?? []) items.push({ kind: ATTACHED_STATEMENTS, bytes: packStatements(list) });
  for (const text of attachments?.texts ?? []) {
    // A reader hashes a text's bytes as they are; the writer is the one that keeps to the form.
    if (!isHashedForm(text)) throw new LinkError("non-canonical", "a text is written in the form it is hashed in");
    items.push({ kind: ATTACHED_TEXT, bytes: stringToBytes(text) });
  }
  if (items.length === 0) return new Uint8Array(0);
  items.sort(compareAttached);
  // Their number comes first: a link or an address cut at the end of an attachment does not read.
  const writer = new Writer().varint(BigInt(items.length));
  for (const { kind, bytes } of items) writer.byte(kind).varint(BigInt(bytes.length)).bytes(bytes);
  return writer.done();
}

/** Reads attachments to the end of `reader`: as many as announced, of known kinds, in ascending order, none twice. */
function readAttachments(reader: Reader): Attached[] {
  const count = reader.varint();
  if (count === 0n) throw new LinkError("non-canonical", "attachments announced and none written");
  // A number the bytes cannot hold is refused before any work is done for it.
  if (count * BigInt(ATTACHED_MIN_BYTES) > BigInt(reader.left)) {
    throw new LinkError("malformed", "more attachments named than the link holds");
  }
  const attached: Attached[] = [];
  for (let index = 0n; index < count; ++index) {
    const kind = reader.byte();
    if (kind !== ATTACHED_STATEMENTS && kind !== ATTACHED_TEXT) throw new LinkError("unsupported", `attachment kind ${kind}`);
    const item: Attached = { kind, bytes: reader.take(reader.length()) };
    if (attached.length > 0 && compareAttached(attached[attached.length - 1], item) >= 0) {
      throw new LinkError("non-canonical", "attachments out of order or repeated");
    }
    attached.push(item);
  }
  if (reader.left !== 0) throw new LinkError("malformed", "bytes after the last attachment");
  return attached;
}

/**
 * Checks attachments against hashes that are already proven: `roots`. A list is taken when its
 * dataHash is a root or a value of a list already taken; a text when the hash of its bytes, as
 * they are, is a value of a list taken. With `all`, anything left over is refused: no byte
 * travels that no hash stands for. Without it, what does not hang on the roots is left out: this
 * is how what describes the Hand is told from what a holder hung on its own Shake.
 */
function matchAttachments(attached: readonly Attached[], roots: readonly Hex[], all = true): MatchedData {
  // Each list is hashed once and found by its hash: the work grows with the bytes, not their square.
  const waiting = new Map<string, Statement[]>();
  for (const { kind, bytes } of attached) {
    if (kind !== ATTACHED_STATEMENTS) continue;
    const list = unpackStatements(bytes);
    waiting.set(dataHashOf(list).toLowerCase(), list);
  }
  const lists = waiting.size;
  const proven = roots.map((hash) => hash.toLowerCase()).filter((hash) => hash !== zeroHash);
  const values = new Set<string>();
  const statements: Statement[][] = [];
  while (proven.length > 0) {
    const hash = proven.pop()!;
    const list = waiting.get(hash);
    if (!list) continue;
    waiting.delete(hash);
    statements.push(list);
    for (const { value } of list) {
      const lower = value.toLowerCase();
      // A value of zero proves nothing.
      if (lower === zeroHash) continue;
      values.add(lower);
      proven.push(lower);
    }
  }
  if (all && statements.length !== lists) throw new LinkError("unmatched-data", "a list of statements that no hash stands for");

  const texts: string[] = [];
  for (const { kind, bytes } of attached) {
    if (kind !== ATTACHED_TEXT) continue;
    const text = textOf(bytes, "an attached text");
    // The bytes are hashed as they are, and nothing is brought to a form first: a reader that did
    // would depend on its own tables of Unicode, and the hash already allows only these bytes.
    if (!values.has(keccak256(bytes))) {
      if (all) throw new LinkError("unmatched-data", "a text behind no attached statement");
      continue;
    }
    texts.push(text);
  }
  return { statements, texts };
}

/**
 * What a site may show of a Hand from attachments that travel where it can see them, without the
 * link: they are checked against the `dataHash` Core keeps for the Hand and nothing else.
 */
export function openPublicPart(publicPart: Uint8Array, hand: Hand, options: Pick<LinkOptions, "maxBytes"> = {}): MatchedData {
  withinLimit(publicPart.length, options, "a public part");
  return matchAttachments(readAttachments(new Reader(publicPart)), [hand.dataHash]);
}

/* ------------------------------------------------------------------- wire */

export interface LinkOptions {
  /**
   * The Core that links name by leaving its address out. Left out, it is `CANONICAL_CORE`, the
   * one Core of link version 1. Tests and a reader of another Core may name another; `null` says
   * this reader knows none, and a link without Core's address is then "no-canonical-core". The key
   * given with the value `undefined` (an unset configuration value, say) is refused with a
   * TypeError: it is neither of the two meanings, and guessing one would misread links.
   */
  canonicalCore?: Address | null;
  /**
   * The most Shakes a link may carry: a rule of the application, not of the format. Left out, it
   * is the longest route one transaction can carry (`LONGEST_ROUTE`): a longer one could never
   * be thanked, and reading it would only cost time.
   */
  maxShakes?: number;
  /**
   * Attachments that travelled outside the link, where a site can see them (address.ts): they are
   * read together with the link's own, and must hang on the Hand's own dataHash: the public part
   * of a described address (`d`).
   */
  publicPart?: Uint8Array;
  /**
   * The most bytes a link may take, and so may the attachments outside it: a rule of the
   * application, not of the format. Left out, it is `MAX_LINK_BYTES`.
   */
  maxBytes?: number;
}

/** Refuses bytes past the application's limit before any of them is read. */
function withinLimit(length: number, options: Pick<LinkOptions, "maxBytes">, what: string): void {
  const max = options.maxBytes ?? MAX_LINK_BYTES;
  if (length > max) throw new LinkError("too-long", `${what} of ${length} bytes; at most ${max} are taken`);
}

/** The Core a link without Core's address names, under these options; undefined if none. */
export function canonicalOf(options: LinkOptions): Address | undefined {
  if (!("canonicalCore" in options)) return CANONICAL_CORE;
  if (options.canonicalCore === undefined) {
    throw new TypeError("LinkOptions.canonicalCore is undefined: leave the key out for the canonical Core, or give null for none");
  }
  return options.canonicalCore ?? undefined;
}

/** A Shake as it stands on the wire. Without a payee its `nextClaimBps` is not written: it is the claim that reached it. */
export interface WireShake {
  payee: Address;
  nextClaimBps: number;
  dataHash: Hex;
  keySig: Hex;
}

/** A Give as it stands on the wire. */
export interface WireGive {
  signer: Address;
  payee: Address;
  dataHash: Hex;
  keySig: Hex;
  giverSig: Hex;
}

/** A link as its parts stand on the wire. */
export interface WireLink {
  chainId: bigint;
  /** Only for a Core other than the canonical one. */
  core?: Address;
  handId: bigint;
  shakes: WireShake[];
  seed?: Hex;
  lastKey?: Address;
  pin?: Hex;
  give?: WireGive;
  attachments?: Attachments;
}

/**
 * Writes the parts as they are and checks nothing but the form of the signatures: for the
 * encoders below, and for tests that need a link no encoder would write.
 */
export function pack(link: WireLink): Uint8Array {
  let flags = 0;
  if (link.seed === undefined) flags |= FLAG_ADDRESSED;
  if (link.give) flags |= FLAG_GIVE;
  if (link.core) flags |= FLAG_CORE;
  const attached = packAttachments(link.attachments);
  if (attached.length > 0) flags |= FLAG_DATA;

  const writer = new Writer().byte((LINK_VERSION << 4) | flags).varint(link.chainId);
  if (link.core) writer.bytes(link.core);
  writer.varint(link.handId).varint(BigInt(link.shakes.length));

  for (const { payee, nextClaimBps, dataHash, keySig } of link.shakes) {
    const paid = !isAddressEqual(payee, zeroAddress);
    const data = dataHash !== zeroHash;
    const first = (paid ? SHAKE_PAYEE : 0) | (data ? SHAKE_DATA : 0);
    if (paid) {
      // Above the whole it would not fit the six bits left for it beside the flags.
      if (nextClaimBps > BPS) throw new LinkError("invalid", "a claim above the whole");
      writer.byte(first | (nextClaimBps >> 8)).byte(nextClaimBps & 0xff).bytes(payee);
    } else {
      writer.byte(first);
    }
    if (data) writer.bytes(dataHash);
    writer.bytes(toWireSig(keySig));
  }

  if (link.seed !== undefined) writer.bytes(link.seed);
  if (link.lastKey !== undefined) writer.bytes(link.lastKey);
  if (link.pin !== undefined) writer.bytes(link.pin);

  if (link.give) {
    const { signer, payee, dataHash, keySig, giverSig } = link.give;
    const other = !isAddressEqual(payee, signer);
    const data = dataHash !== zeroHash;
    const key = isKeySignature(giverSig);
    writer.byte((other ? GIVE_PAYEE : 0) | (data ? GIVE_DATA : 0) | (key ? GIVE_KEY : 0)).bytes(signer);
    if (other) writer.bytes(payee);
    if (data) writer.bytes(dataHash);
    writer.bytes(toWireSig(keySig));
    if (key) writer.bytes(toWireSig(giverSig));
    else writer.varint(BigInt(size(giverSig))).bytes(giverSig);
  }

  return writer.bytes(attached).done();
}

/** What a link names: enough to ask Core for the Hand's terms. */
export interface LinkHead {
  version: number;
  /** "live" carries the secret of its last key; "addressed" ends at an address; "give" ends with a Give. */
  kind: "live" | "addressed" | "give";
  chainId: number;
  core: Address;
  handId: bigint;
  /** How many Shakes the link carries. */
  shakes: number;
}

function readHead(reader: Reader, options: LinkOptions): { head: LinkHead; flags: number } {
  withinLimit(reader.left, options, "a link");
  const first = reader.byte();
  const version = first >> 4;
  const flags = first & 0x0f;
  if (version !== LINK_VERSION) throw new LinkError("unsupported", `link version ${version}`);
  if (flags & FLAG_GIVE && !(flags & FLAG_ADDRESSED)) {
    throw new LinkError("non-canonical", "a Give never travels with a secret");
  }

  const chainId = reader.varint();
  if (chainId > BigInt(Number.MAX_SAFE_INTEGER)) throw new LinkError("malformed", "a chain number out of range");

  const canonical = canonicalOf(options);
  let core: Address;
  if (flags & FLAG_CORE) {
    core = reader.address();
    if (canonical && isAddressEqual(core, canonical)) {
      throw new LinkError("non-canonical", "the canonical Core is named by leaving its address out");
    }
  } else {
    if (!canonical) throw new LinkError("no-canonical-core", "the link names the canonical Core and none is known");
    core = canonical;
  }

  const handId = reader.varint();
  const count = reader.varint();
  // A count the link cannot hold is refused before any work is done for it.
  if (count * BigInt(SHAKE_MIN_BYTES) > BigInt(reader.left)) {
    throw new LinkError("malformed", "more Shakes named than the link holds");
  }
  const maxShakes = options.maxShakes ?? LONGEST_ROUTE;
  if (count > BigInt(maxShakes)) throw new LinkError("too-long", `${count} Shakes; at most ${maxShakes} are taken`);

  const kind = flags & FLAG_GIVE ? "give" : flags & FLAG_ADDRESSED ? "addressed" : "live";
  return { head: { version, kind, chainId: Number(chainId), core, handId, shakes: Number(count) }, flags };
}

/**
 * Whether a link may carry a secret, the seed of its last key: anything but a version 1 link that
 * ends at an address or with a Give. Read from the first byte alone, so a link that does not open
 * is judged too.
 */
export function mayCarrySecret(bytes: Uint8Array): boolean {
  return bytes.length === 0 || bytes[0] >> 4 !== LINK_VERSION || (bytes[0] & FLAG_ADDRESSED) === 0;
}

/** Reads what a link names, without the network and without checking the rest of it. */
export function peekLink(bytes: Uint8Array, options: LinkOptions = {}): LinkHead {
  return readHead(new Reader(bytes), options).head;
}

/* ----------------------------------------------------------------- layout */

/** One part of a link's bytes: where it starts and how long it is, never its value. */
export interface LinkSegment {
  kind: "head" | "shake" | "secret" | "last-key" | "pin" | "give" | "attachments";
  /** Offset of the first byte, from 0. */
  start: number;
  length: number;
  /** For a Shake: its position on the route, from 0. */
  position?: number;
}

export interface LinkLayout {
  total: number;
  kind: LinkHead["kind"];
  segments: LinkSegment[];
}

/**
 * Where a link's parts lie (for `/check`'s ruler): the head, each Shake, the secret or the last
 * key, the pin, the Give and the attachments, as offsets and lengths that cover every byte once.
 * It walks the same layout `unpack` reads, with the same flags, and needs no options: it neither
 * proves nor refuses what it measures (a non-canonical or invalid link is measured; `openLink`
 * says what is wrong with it). Throws `LinkError` "unsupported" for another version and
 * "malformed" for bytes that do not follow the layout. No byte's value leaves it.
 */
export function linkLayout(bytes: Uint8Array): LinkLayout {
  let at = 0;
  const left = () => bytes.length - at;
  const skip = (length: number) => {
    if (length < 0 || length > left()) throw new LinkError("malformed", "the link ends in the middle of a field");
    at += length;
  };
  const byte = () => {
    if (left() < 1) throw new LinkError("malformed", "the link ends in the middle of a field");
    return bytes[at++]!;
  };
  const varint = () => {
    let value = 0;
    for (let shift = 0; shift < 53; shift += 7) {
      const group = byte();
      value += (group & 0x7f) * 2 ** shift;
      if ((group & 0x80) === 0) return value;
    }
    throw new LinkError("malformed", "a number too long to measure");
  };
  const segments: LinkSegment[] = [];
  const mark = (kind: LinkSegment["kind"], start: number, position?: number) =>
    segments.push({ kind, start, length: at - start, ...(position === undefined ? {} : { position }) });

  const first = byte();
  if (first >> 4 !== LINK_VERSION) throw new LinkError("unsupported", `link version ${first >> 4}`);
  const flags = first & 0x0f;
  varint(); // chain
  if (flags & FLAG_CORE) skip(20);
  varint(); // Hand number
  const count = varint();
  if (count * SHAKE_MIN_BYTES > left()) throw new LinkError("malformed", "more Shakes named than the link holds");
  mark("head", 0);

  for (let position = 0; position < count; ++position) {
    const start = at;
    const shake = byte();
    if (shake & SHAKE_PAYEE) skip(1 + 20);
    if (shake & SHAKE_DATA) skip(32);
    skip(64);
    mark("shake", start, position);
  }

  const addressed = (flags & FLAG_ADDRESSED) !== 0;
  const hasGive = (flags & FLAG_GIVE) !== 0;
  let start = at;
  if (!addressed) {
    skip(SEED_BYTES);
    mark("secret", start);
  } else if (count > 0) {
    skip(20);
    mark("last-key", start);
  }
  if (count === 0 && !hasGive) {
    start = at;
    skip(PIN_BYTES);
    mark("pin", start);
  }

  if (hasGive) {
    start = at;
    const give = byte();
    skip(20);
    if (give & GIVE_PAYEE) skip(20);
    if (give & GIVE_DATA) skip(32);
    skip(64);
    if (give & GIVE_KEY) skip(64);
    else skip(varint());
    mark("give", start);
  }

  if (flags & FLAG_DATA) {
    start = at;
    skip(left());
    mark("attachments", start);
  }
  if (left() !== 0) throw new LinkError("malformed", "bytes after the end of the link");
  return { total: bytes.length, kind: hasGive ? "give" : addressed ? "addressed" : "live", segments };
}

/**
 * Reads a link into its parts and refuses every way of writing them but `pack`'s. Proves nothing
 * yet: not even a claim Core would refuse, which `openLink` names in Core's order.
 */
function unpack(bytes: Uint8Array, options: LinkOptions): { head: LinkHead; wire: WireLink; inLink: Attached[] } {
  const reader = new Reader(bytes);
  const { head, flags } = readHead(reader, options);
  const addressed = (flags & FLAG_ADDRESSED) !== 0;
  const hasGive = (flags & FLAG_GIVE) !== 0;

  // Claims run forwards, so each Shake's claim is known here, before any key is. One that passes
  // on more than reached it is read as written: Core judges it in its own order, which `openLink`
  // keeps, after the Give's own fields and with each Shake's signature after its claim.
  const shakes: WireShake[] = [];
  let claim = BPS;
  for (let position = 0; position < head.shakes; ++position) {
    const first = reader.byte();
    let payee: Address = zeroAddress;
    if (first & SHAKE_PAYEE) {
      claim = ((first & SHAKE_CLAIM) << 8) | reader.byte();
      payee = reader.address();
      if (isAddressEqual(payee, zeroAddress)) throw new LinkError("non-canonical", "a payee written as zero");
    } else if (first & SHAKE_CLAIM) {
      throw new LinkError("non-canonical", "a claim written without a payee");
    }
    let dataHash: Hex = zeroHash;
    if (first & SHAKE_DATA) {
      dataHash = reader.hex(32);
      if (dataHash === zeroHash) throw new LinkError("non-canonical", "a dataHash written as zero");
    }
    shakes.push({ payee, nextClaimBps: claim, dataHash, keySig: fromWireSig(reader.hex(64)) });
  }

  const seed = addressed ? undefined : reader.hex(SEED_BYTES);
  const lastKey = addressed && head.shakes > 0 ? reader.address() : undefined;
  const pin = head.shakes === 0 && !hasGive ? reader.hex(PIN_BYTES) : undefined;

  let give: WireGive | undefined;
  if (hasGive) {
    const first = reader.byte();
    if (first & GIVE_RESERVED) throw new LinkError("unsupported", "a reserved bit is set in the Give");
    const signer = reader.address();
    let payee = signer;
    if (first & GIVE_PAYEE) {
      payee = reader.address();
      if (isAddressEqual(payee, signer)) throw new LinkError("non-canonical", "a payee written though it is the signer");
    }
    let dataHash: Hex = zeroHash;
    if (first & GIVE_DATA) {
      dataHash = reader.hex(32);
      if (dataHash === zeroHash) throw new LinkError("non-canonical", "a dataHash written as zero");
    }
    const keySig = fromWireSig(reader.hex(64));
    let giverSig: Hex;
    if (first & GIVE_KEY) {
      giverSig = fromWireSig(reader.hex(64));
    } else {
      giverSig = reader.hex(reader.length());
      if (isKeySignature(giverSig)) throw new LinkError("non-canonical", "a key's signature written at full length");
    }
    give = { signer, payee, dataHash, keySig, giverSig };
  }

  // Without the flag the link ends where its route, or its Give, ends.
  const inLink = flags & FLAG_DATA ? readAttachments(reader) : [];
  if (reader.left !== 0) throw new LinkError("malformed", "bytes after the end of the link");

  const wire: WireLink = { chainId: BigInt(head.chainId), handId: head.handId, shakes, seed, lastKey, pin, give };
  return { head, wire, inLink };
}

/* ------------------------------------------------------------------- open */

/** A link read and proven against the Hand it names. */
export interface OpenedLink {
  head: LinkHead;
  domain: Eip712Domain;
  hand: Hand;
  /** The route, as `thank`, `checkRoute` and `checkGive` take it. */
  signedShakes: SignedShake[];
  /** Where the route ends, as Core's `checkRoute` would answer. */
  end: RouteEnd;
  /** A live link only: the one secret, and the link key it stands for. */
  seed?: Hex;
  linkKey?: Hex;
  /** A Give link only. Its key signature is checked here; the giver's is for `checkGive`. */
  signedGive?: SignedGive;
  /**
   * Everything attached, in the link and outside it, each checked against a hash: the Hand's, a
   * Shake's or the Give's. A holder signs its own Shake and can hang any list on it, so this is
   * NOT what describes the Hand: that is `ofHand`.
   */
  statements: Statement[][];
  texts: string[];
  /** What hangs on the Hand's own dataHash, the one Core keeps: the raiser's words. */
  ofHand: MatchedData;
  /** The public part: what travelled outside the link, where a site and a preview could see it. */
  publicPart: MatchedData;
  /** The link part: what travelled in the link, what a holder carries on when passing the link. */
  linkPart: MatchedData;
}

/** Where the route ends by Core's `checkRoute`, which does not judge the claim left. */
async function routeChecked(chain: Eip712Domain, hand: Hand, signedShakes: readonly SignedShake[]): Promise<RouteEnd> {
  try {
    return await checkRoute(chain, hand, signedShakes);
  } catch (error) {
    const refusal = error instanceof Refusal ? { name: error.error, position: error.position } : undefined;
    throw new LinkError("invalid", `Core would refuse the route: ${(error as Error).message}`, refusal);
  }
}

/** A route that leaves the giver less than the Hand's minimum: Core would refuse every Give that ends it. */
function atLeastMinimum(hand: Hand, end: RouteEnd): void {
  if (end.claimBps < hand.minClaimBps) {
    throw new LinkError("invalid", "the route leaves the giver less than the Hand's minimum", { name: "BelowMinClaim" });
  }
}

/**
 * Where the route ends by Core's rules. A route Core would refuse is no link, and neither is one
 * that leaves the giver less than the Hand's minimum.
 */
async function routeEnd(chain: Eip712Domain, hand: Hand, signedShakes: readonly SignedShake[]): Promise<RouteEnd> {
  const end = await routeChecked(chain, hand, signedShakes);
  atLeastMinimum(hand, end);
  return end;
}

/** What Core refuses in a Give before it looks at the route, whoever signed it. */
function giveFields(hand: Hand, give: { signer: Address; payee: Address }): void {
  if (isAddressEqual(give.signer, hand.raiser)) throw new LinkError("invalid", "the Give is the raiser's own", { name: "GiverIsRaiser" });
  if (isAddressEqual(give.payee, zeroAddress)) throw new LinkError("invalid", "the Give names no payee", { name: "ZeroPayee" });
}

/**
 * Core's first check of the route, which needs no key: the Shake at 0 passes on no more than the
 * whole. The rest of Core's claim checks the wire cannot fail: each Shake starts from the claim
 * that reached it, and one without a payee carries no claim of its own. A later Shake's claim is
 * judged only once the signatures before it are known: by `checkRoute`.
 */
function firstClaim(shakes: readonly WireShake[]): void {
  if (shakes.length > 0 && shakes[0].nextClaimBps > BPS) {
    throw new LinkError("invalid", "the Shake at 0 passes on more than reached it", { name: "InvalidClaim", position: 0 });
  }
}

/**
 * Whether no key can have made `signature` over any hash. A signature fails over one hash only
 * where s·R = h·G, which holds for a single h; failing over two hashes, its R is no point of the
 * curve, so it fails over every hash, the one Core would build included.
 */
async function readableByNoHash(signature: Hex): Promise<boolean> {
  for (const hash of [keccak256(stringToHex("aHand.unreadable/1")), keccak256(stringToHex("aHand.unreadable/2"))]) {
    try {
      await recoverAddress({ hash, signature });
      return false;
    } catch {
      // Unreadable over this hash: try the other.
    }
  }
  return true;
}

/**
 * Reads a link against the Hand it names. `getHand` answers with the Hand's terms as Core keeps
 * them (`hands(handId)` on the chain and the Core the link names); the link then proves them: its
 * first signature, or its pin, fits no other terms. What only the chain knows stays the
 * application's to ask: whether the Hand is open, its expiry and its reward. Of several faults
 * Core would refuse, the error names the first in Core's order: the Give's own fields, then per
 * Shake its claim and its signature, then the Give against the route.
 */
export async function openLink(
  bytes: Uint8Array,
  getHand: (head: LinkHead) => Promise<Hand>,
  options: LinkOptions = {},
): Promise<OpenedLink> {
  const { head, wire, inLink } = unpack(bytes, options);
  if (options.publicPart !== undefined) withinLimit(options.publicPart.length, options, "a public part");
  const inPublic = options.publicPart === undefined ? [] : readAttachments(new Reader(options.publicPart));
  const attached = [...inLink, ...inPublic].sort(compareAttached);
  for (let index = 1; index < attached.length; ++index) {
    if (compareAttached(attached[index - 1], attached[index]) === 0) {
      throw new LinkError("non-canonical", "an attachment stands both in the link and outside it");
    }
  }

  // From here on the Hand's terms are needed.
  const hand = await getHand(head);
  if (hand.handId !== head.handId) throw new LinkError("another-hand", "the Hand given is not the one the link names");
  const chain = domain(head.chainId, head.core);
  const separator = domainSeparator(chain);

  // Core looks at the Give's own fields before the route.
  if (wire.give) giveFields(hand, wire.give);

  // The route's last key: the seed's, the one named, or without Shakes the Hand's root key. One
  // named as zero is judged after the route, as Core would meet it: at the Give's key signature.
  const linkKey = wire.seed === undefined ? undefined : keyOfSeed(wire.seed);
  const lastKey = linkKey ? privateKeyToAddress(linkKey) : (wire.lastKey ?? hand.rootKey);

  // Backwards: each Shake's nextKey is the key found so far, and its signature gives the key before.
  const signedShakes: SignedShake[] = new Array(wire.shakes.length);
  let key = lastKey;
  for (let position = wire.shakes.length - 1; position >= 0; --position) {
    const { payee, nextClaimBps, dataHash, keySig } = wire.shakes[position];
    const claimBps = position === 0 ? BPS : wire.shakes[position - 1].nextClaimBps;
    const shake: Shake = { nextKey: key, payee, claimBps, nextClaimBps, dataHash };
    signedShakes[position] = { shake, keySig };
    try {
      key = await recoverAddress({ hash: digest(separator, shakeHash(hand, shake)), signature: keySig });
    } catch {
      // Without this key the Shakes before it cannot be rebuilt. Core, walking forwards, checks
      // the first claim and then the first signature: one that no key can have made over any
      // hash stops it there, at 0, whatever keys are sent. Otherwise what Core meets first
      // depends on the keys sent with the earlier Shakes, which the link does not carry. Sent
      // with the keys that signed them, Core stops at the first over-claim up to here
      // (InvalidClaim) or at a signature up to here; sent with any key the link alone can give
      // the Shake at 0, at its signature. InvalidKeySig is named, as Core's answer to the route
      // as the link alone rebuilds it; the claim would need the keys this signature hides. No
      // position is named, as the signature Core stops at depends on those keys too.
      firstClaim(wire.shakes);
      const atFirst = position === 0 || (await readableByNoHash(wire.shakes[0].keySig));
      throw new LinkError("invalid", `the signature at ${atFirst ? 0 : position} cannot be read`, {
        name: "InvalidKeySig",
        position: atFirst ? 0 : undefined,
      });
    }
  }
  if (!isAddressEqual(key, hand.rootKey)) {
    // Core would check the first claim before the first signature. The link was signed under
    // other terms or by another key: no position is named in Shakes its signers did not sign.
    firstClaim(wire.shakes);
    throw new LinkError("not-this-hand", "the route does not start at this Hand's root key", { name: "InvalidKeySig" });
  }
  if (wire.pin !== undefined && wire.pin !== pinOf(chain, hand)) {
    throw new LinkError("not-this-hand", "the link is for a Hand with other terms");
  }

  // Forwards, as Core walks it.
  const end = await routeEnd(chain, hand, signedShakes);
  // A route Core takes, ending at the zero key: no key signs as it, so Core refuses every Give
  // that ends it, this link's own included, at the Give's key signature.
  if (isAddressEqual(end.lastKey, zeroAddress)) {
    throw new LinkError("invalid", "the route ends at the zero key, which signs no Give", {
      name: "InvalidKeySig",
      position: signedShakes.length,
    });
  }

  let signedGive: SignedGive | undefined;
  if (wire.give) {
    const { signer, payee, dataHash, keySig, giverSig } = wire.give;
    const give: Give = { signer, payee, claimBps: end.claimBps, routeHash: end.routeHash, dataHash };
    // The last key's signature is what ties the Give to this route and, without Shakes, to this Hand.
    if (!(await signedBy(end.lastKey, digest(separator, giveHash(hand, give)), keySig))) {
      throw new LinkError("not-this-hand", "the Give is not signed by the route's last key", {
        name: "InvalidKeySig",
        position: signedShakes.length,
      });
    }
    signedGive = { give, keySig, giverSig };
  }

  // Each attached list stands behind a dataHash of the Hand, of a Shake or of the Give, or behind
  // a value of another list; each text behind a value of a list. Anything else is refused. What
  // travelled outside the link must hang on the Hand's own dataHash: a site sees only that.
  const roots: Hex[] = [hand.dataHash, ...signedShakes.map(({ shake }) => shake.dataHash)];
  if (signedGive) roots.push(signedGive.give.dataHash);
  const { statements, texts } = matchAttachments(attached, roots);
  const seen = matchAttachments(inPublic, [hand.dataHash]);
  const ofHand = matchAttachments(attached, [hand.dataHash], false);
  const carried: MatchedData = {
    statements: inLink.filter(({ kind }) => kind === ATTACHED_STATEMENTS).map((item) => unpackStatements(item.bytes)),
    texts: inLink.filter(({ kind }) => kind === ATTACHED_TEXT).map((item) => textOf(item.bytes, "an attached text")),
  };

  return {
    head,
    domain: chain,
    hand,
    signedShakes,
    end,
    seed: wire.seed,
    linkKey,
    signedGive,
    statements,
    texts,
    ofHand,
    publicPart: seen,
    linkPart: carried,
  };
}

/* ----------------------------------------------------------------- encode */

/** A route to write as a link: only one Core would take is written. */
export interface LinkRoute {
  domain: Eip712Domain;
  hand: Hand;
  signedShakes: readonly SignedShake[];
  attachments?: Attachments;
}

/** `minimum: false` leaves the Hand's minimum to the caller, which checks a Give first, as Core does. */
async function wireOf(route: LinkRoute, options: LinkOptions, minimum = true): Promise<{ wire: WireLink; end: RouteEnd }> {
  const end = await routeChecked(route.domain, route.hand, route.signedShakes);
  if (minimum) atLeastMinimum(route.hand, end);
  const core = route.domain.verifyingContract;
  const canonical = canonicalOf(options);
  const wire: WireLink = {
    chainId: BigInt(route.domain.chainId),
    core: canonical && isAddressEqual(canonical, core) ? undefined : core,
    handId: route.hand.handId,
    shakes: route.signedShakes.map(({ shake: { payee, nextClaimBps, dataHash }, keySig }) => ({ payee, nextClaimBps, dataHash, keySig })),
    attachments: route.attachments,
  };
  return { wire, end };
}

/** What was written must open as a link of this Hand: a last guard against the encoder itself. */
async function written(wire: WireLink, route: LinkRoute, options: LinkOptions): Promise<Uint8Array> {
  const bytes = pack(wire);
  await openLink(bytes, async () => route.hand, options);
  return bytes;
}

/**
 * The link a holder passes on: the route so far and the one secret, the seed of its last key.
 * There is no way to give it a second secret.
 */
export async function encodeLive(route: LinkRoute & { seed: Hex }, options: LinkOptions = {}): Promise<Uint8Array> {
  const { wire, end } = await wireOf(route, options);
  if (!isAddressEqual(privateKeyToAddress(keyOfSeed(route.seed)), end.lastKey)) {
    throw new LinkError("invalid", "the seed is not the route's last key");
  }
  wire.seed = route.seed;
  if (route.signedShakes.length === 0) wire.pin = pinOf(route.domain, route.hand);
  return written(wire, route, options);
}

/**
 * A link without a secret: the route ends at an address whose holder signs for itself, or the
 * route is only shown. It takes no seed and no key.
 */
export async function encodeAddressed(route: LinkRoute, options: LinkOptions = {}): Promise<Uint8Array> {
  const { wire, end } = await wireOf(route, options);
  if (route.signedShakes.length === 0) wire.pin = pinOf(route.domain, route.hand);
  else wire.lastKey = end.lastKey;
  return written(wire, route, options);
}

/**
 * What the giver sends the raiser: the route and the Give that ends it, with both signatures and
 * no secret. The giver's signature travels as it is; `checkGive` judges it.
 */
export async function encodeGive(
  route: LinkRoute & { signedGive: SignedGive },
  options: LinkOptions = {},
): Promise<Uint8Array> {
  const { give, keySig, giverSig } = route.signedGive;
  // In Core's order: the Give's own fields, the route, the Give's claim and route, the minimum.
  giveFields(route.hand, give);
  const { wire, end } = await wireOf(route, options, false);
  if (give.claimBps !== end.claimBps) {
    throw new LinkError("invalid", "the Give's claim is not the one the route left", { name: "InvalidClaim", position: route.signedShakes.length });
  }
  if (give.routeHash.toLowerCase() !== end.routeHash.toLowerCase()) {
    throw new LinkError("invalid", "the Give names another route", { name: "InvalidRouteHash" });
  }
  atLeastMinimum(route.hand, end);
  if (route.signedShakes.length > 0) wire.lastKey = end.lastKey;
  wire.give = { signer: give.signer, payee: give.payee, dataHash: give.dataHash, keySig, giverSig };
  return written(wire, route, options);
}

/**
 * Passes a live link on: a fresh seed, a Shake signed by the link's key to the new seed's key, and
 * the new link, which carries the new seed and not the old one. What was attached inside the link
 * travels on with it, unless other `attachments` are given.
 */
export async function passOn(
  opened: OpenedLink,
  terms: { payee: Address; nextClaimBps: number; dataHash?: Hex },
  options: LinkOptions = {},
  attachments: Attachments = opened.linkPart,
): Promise<{ link: Uint8Array; seed: Hex }> {
  if (!opened.linkKey) throw new LinkError("invalid", "only a live link can be passed on with its key");
  const seed = newSeed();
  const shake: Shake = {
    nextKey: privateKeyToAddress(keyOfSeed(seed)),
    payee: terms.payee,
    claimBps: opened.end.claimBps,
    nextClaimBps: terms.nextClaimBps,
    dataHash: terms.dataHash ?? zeroHash,
  };
  const keySig = await signShake(opened.linkKey, opened.domain, opened.hand, shake);
  const signedShakes = [...opened.signedShakes, { shake, keySig }];
  const link = await encodeLive({ domain: opened.domain, hand: opened.hand, signedShakes, seed, attachments }, options);
  return { link, seed };
}

/* ------------------------------------------------------------------- text */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** For a link sent as text: base64url without padding. A version 1 link starts with E or F. */
export function toText(bytes: Uint8Array): string {
  if (bytes.length === 0) throw new LinkError("malformed", "not a link");
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    const chars = Math.min(4, bytes.length - index + 1);
    for (let char = 0; char < chars; ++char) out += ALPHABET[(chunk >> (18 - 6 * char)) & 0x3f];
  }
  return out;
}

/** For a QR code: the same bytes as one decimal number, which a QR code packs in its numeric mode. */
export function toDigits(bytes: Uint8Array): string {
  if (bytes.length === 0) throw new LinkError("malformed", "not a link");
  return hexToBigInt(bytesToHex(bytes)).toString(10);
}

/** Reads base64url without padding, in its one spelling: no loose bits at the end. */
export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) throw new LinkError("malformed", "not base64url");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    buffer = ((buffer << 6) | ALPHABET.indexOf(char)) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  const bytes = Uint8Array.from(out);
  if (toText(bytes) !== text) throw new LinkError("non-canonical", "base64url with loose bits at its end");
  return bytes;
}

/**
 * Reads either form: a string of digits is the decimal form, anything else base64url. Each link
 * has one string in each form: loose bits at the end of base64url and leading zeros are refused.
 * A text longer than a link of `options.maxBytes` (`MAX_LINK_BYTES`) can be is refused unread.
 */
export function fromText(text: string, options: Pick<LinkOptions, "maxBytes"> = {}): Uint8Array {
  const max = options.maxBytes ?? MAX_LINK_BYTES;
  // The longest text of a link of `max` bytes: digits are log10(256) per byte, base64url 4 per 3.
  const longest = /^[0-9]+$/.test(text) ? Math.ceil(max * Math.log10(256)) + 1 : Math.ceil((max * 4) / 3);
  if (text.length > longest) throw new LinkError("too-long", `a link of ${text.length} characters; at most ${longest} are taken`);
  let bytes: Uint8Array;
  if (/^[0-9]+$/.test(text)) {
    let hex = BigInt(text).toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    bytes = hexToBytes(`0x${hex}`);
    if (toDigits(bytes) !== text) throw new LinkError("non-canonical", "a decimal link with leading zeros");
  } else {
    bytes = fromBase64Url(text);
  }
  // The first byte carries the version, which is never zero: a number cannot hide leading bytes.
  if (bytes.length === 0 || bytes[0] >> 4 === 0) throw new LinkError("malformed", "not a link");
  withinLimit(bytes.length, options, "a link");
  return bytes;
}
