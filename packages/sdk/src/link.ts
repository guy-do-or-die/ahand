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

import { dataHashOf, nameOf, textValue, type Statement } from "./data.js";
import { LONGEST_ROUTE } from "./gas.js";
import { digest, domainSeparator, giveHash, handHash, shakeHash } from "./hash.js";
import { CURVE_ORDER, signShake } from "./sign.js";
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
import { checkRoute, isKeySignature, signedBy, type RouteEnd } from "./verify.js";

/**
 * The aHand link, version 1: a route of signed Shakes and what ends it, as one string of bytes.
 * Core never sees a link; what a link gives back is exactly what `thank` takes.
 *
 *   HEAD    0x10 | flags      version 1 in the high half; flags in the low half:
 *                               0x01 ADDRESSED  the route's end is named by an address: no secret
 *                               0x02 GIVE       a Give follows (only with ADDRESSED)
 *                               0x04 CORE       Core's address follows (not the canonical Core)
 *                               0x08 reserved, must be 0
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
 *   DATA    zero or more attachments to the end of the link, in ascending order:
 *           kind 1            1 a list of statements (see data.ts), 2 a text
 *           length            varint
 *           bytes
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
 */

export const LINK_VERSION = 1;
export const SEED_BYTES = 16;
export const PIN_BYTES = 16;
/** The tag under which a seed becomes a link key; another way of making keys is another tag. */
export const KEY_TAG = "aHand.key/1";

const FLAG_ADDRESSED = 0x01;
const FLAG_GIVE = 0x02;
const FLAG_CORE = 0x04;
const FLAG_RESERVED = 0x08;

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

export type LinkErrorCode =
  | "malformed" // not a link at all: cut short, a wrong alphabet, bytes left over
  | "unsupported" // another version, a reserved bit, an unknown attachment, no canonical Core known
  | "non-canonical" // readable, but written in a way the format does not allow
  | "too-long" // more Shakes than this application takes
  | "another-hand" // the Hand given is not the one the link names
  | "not-this-hand" // the route does not start at this Hand's root key, or the pin differs
  | "invalid" // Core would refuse it
  | "unmatched-data"; // an attachment that no hash in the link stands for

export class LinkError extends Error {
  constructor(
    readonly code: LinkErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "LinkError";
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
  const marked = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const text = marked ? `\uFEFF${textOf(bytes.subarray(3), what)}` : bytesToString(bytes);
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
  /** Whole lists of statements, each standing behind a dataHash of the Hand, of a Shake or of the Give. */
  statements?: Statement[][];
  /** Texts, each standing behind a value of one of the attached lists. */
  texts?: string[];
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
    const name = textOf(reader.take(length), "a statement's name");
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
  return text.normalize("NFC").replace(/\r\n?/g, "\n") === text;
}

function packAttachments(attachments: Attachments | undefined): Uint8Array {
  const items: Attached[] = [];
  for (const list of attachments?.statements ?? []) items.push({ kind: ATTACHED_STATEMENTS, bytes: packStatements(list) });
  for (const text of attachments?.texts ?? []) {
    if (!isHashedForm(text)) throw new LinkError("non-canonical", "a text travels in the form it is hashed in");
    items.push({ kind: ATTACHED_TEXT, bytes: stringToBytes(text) });
  }
  items.sort(compareAttached);
  const writer = new Writer();
  for (const { kind, bytes } of items) writer.byte(kind).varint(BigInt(bytes.length)).bytes(bytes);
  return writer.done();
}

/** Reads the attachments to the end of the link. */
function unpackAttachments(reader: Reader): Required<Attachments> {
  const statements: Statement[][] = [];
  const texts: string[] = [];
  let previous: Attached | undefined;
  while (reader.left > 0) {
    const kind = reader.byte();
    if (kind !== ATTACHED_STATEMENTS && kind !== ATTACHED_TEXT) throw new LinkError("unsupported", `attachment kind ${kind}`);
    const item: Attached = { kind, bytes: reader.take(reader.length()) };
    if (previous && compareAttached(previous, item) >= 0) {
      throw new LinkError("non-canonical", "attachments out of order or repeated");
    }
    previous = item;
    if (kind === ATTACHED_STATEMENTS) {
      statements.push(unpackStatements(item.bytes));
    } else {
      const text = textOf(item.bytes, "an attached text");
      if (!isHashedForm(text)) throw new LinkError("non-canonical", "a text not in the form it is hashed in");
      texts.push(text);
    }
  }
  return { statements, texts };
}

/* ------------------------------------------------------------------- wire */

export interface LinkOptions {
  /** The Core that links name by leaving its address out. None is deployed yet. */
  canonicalCore?: Address;
  /**
   * The most Shakes a link may carry: a rule of the application, not of the format. Left out, it
   * is the longest route one transaction can carry (`LONGEST_ROUTE`): a longer one could never
   * be thanked, and reading it would only cost time.
   */
  maxShakes?: number;
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

  return writer.bytes(packAttachments(link.attachments)).done();
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
  const first = reader.byte();
  const version = first >> 4;
  const flags = first & 0x0f;
  if (version !== LINK_VERSION) throw new LinkError("unsupported", `link version ${version}`);
  if (flags & FLAG_RESERVED) throw new LinkError("unsupported", "a reserved bit is set");
  if (flags & FLAG_GIVE && !(flags & FLAG_ADDRESSED)) {
    throw new LinkError("non-canonical", "a Give never travels with a secret");
  }

  const chainId = reader.varint();
  if (chainId > BigInt(Number.MAX_SAFE_INTEGER)) throw new LinkError("malformed", "a chain number out of range");

  let core: Address;
  if (flags & FLAG_CORE) {
    core = reader.address();
    if (options.canonicalCore && isAddressEqual(core, options.canonicalCore)) {
      throw new LinkError("non-canonical", "the canonical Core is named by leaving its address out");
    }
  } else {
    if (!options.canonicalCore) throw new LinkError("unsupported", "the link names the canonical Core and none is known");
    core = options.canonicalCore;
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

/** Reads what a link names, without the network and without checking the rest of it. */
export function peekLink(bytes: Uint8Array, options: LinkOptions = {}): LinkHead {
  return readHead(new Reader(bytes), options).head;
}

/** Reads a link into its parts and refuses every way of writing them but `pack`'s. Proves nothing yet. */
function unpack(bytes: Uint8Array, options: LinkOptions): { head: LinkHead; wire: WireLink } {
  const reader = new Reader(bytes);
  const { head, flags } = readHead(reader, options);
  const addressed = (flags & FLAG_ADDRESSED) !== 0;
  const hasGive = (flags & FLAG_GIVE) !== 0;

  // Claims run forwards, so each Shake's claim is known here, before any key is.
  const shakes: WireShake[] = [];
  let claim = BPS;
  for (let position = 0; position < head.shakes; ++position) {
    const first = reader.byte();
    let payee: Address = zeroAddress;
    if (first & SHAKE_PAYEE) {
      const nextClaimBps = ((first & SHAKE_CLAIM) << 8) | reader.byte();
      if (nextClaimBps > claim) throw new LinkError("invalid", `the Shake at ${position} passes on more than reached it`);
      claim = nextClaimBps;
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

  const wire: WireLink = { chainId: BigInt(head.chainId), handId: head.handId, shakes, seed, lastKey, pin, give };
  wire.attachments = unpackAttachments(reader);
  return { head, wire };
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
  /** The attached lists of statements and texts, each already checked against its hash. */
  statements: Statement[][];
  texts: string[];
}

/**
 * Where the route ends by Core's rules. A route Core would refuse is no link, and neither is one
 * that leaves the giver less than the Hand's minimum: Core would refuse every Give that ends it.
 */
async function routeEnd(chain: Eip712Domain, hand: Hand, signedShakes: readonly SignedShake[]): Promise<RouteEnd> {
  let end: RouteEnd;
  try {
    end = await checkRoute(chain, hand, signedShakes);
  } catch (error) {
    throw new LinkError("invalid", `Core would refuse the route: ${(error as Error).message}`);
  }
  if (end.claimBps < hand.minClaimBps) {
    throw new LinkError("invalid", "the route leaves the giver less than the Hand's minimum");
  }
  return end;
}

/**
 * Reads a link against the Hand it names. `getHand` answers with the Hand's terms as Core keeps
 * them (`hands(handId)` on the chain and the Core the link names); the link then proves them: its
 * first signature, or its pin, fits no other terms. What only the chain knows stays the
 * application's to ask: whether the Hand is open, its expiry and its reward.
 */
export async function openLink(
  bytes: Uint8Array,
  getHand: (head: LinkHead) => Promise<Hand>,
  options: LinkOptions = {},
): Promise<OpenedLink> {
  const { head, wire } = unpack(bytes, options);
  const hand = await getHand(head);
  if (hand.handId !== head.handId) throw new LinkError("another-hand", "the Hand given is not the one the link names");
  const chain = domain(head.chainId, head.core);
  const separator = domainSeparator(chain);

  // The route's last key: the seed's, the one named, or without Shakes the Hand's root key.
  const linkKey = wire.seed === undefined ? undefined : keyOfSeed(wire.seed);
  const lastKey = linkKey ? privateKeyToAddress(linkKey) : (wire.lastKey ?? hand.rootKey);
  if (isAddressEqual(lastKey, zeroAddress)) throw new LinkError("invalid", "a route that ends at the zero key");

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
      throw new LinkError("invalid", `the signature at ${position} cannot be read`);
    }
  }
  if (!isAddressEqual(key, hand.rootKey)) {
    throw new LinkError("not-this-hand", "the route does not start at this Hand's root key");
  }
  if (wire.pin !== undefined && wire.pin !== pinOf(chain, hand)) {
    throw new LinkError("not-this-hand", "the link is for a Hand with other terms");
  }

  // Forwards, as Core walks it.
  const end = await routeEnd(chain, hand, signedShakes);

  let signedGive: SignedGive | undefined;
  if (wire.give) {
    const { signer, payee, dataHash, keySig, giverSig } = wire.give;
    const give: Give = { signer, payee, claimBps: end.claimBps, routeHash: end.routeHash, dataHash };
    // What Core refuses in a Give whoever signed it.
    if (isAddressEqual(signer, hand.raiser)) throw new LinkError("invalid", "the Give is the raiser's own");
    if (isAddressEqual(payee, zeroAddress)) throw new LinkError("invalid", "the Give names no payee");
    // The last key's signature is what ties the Give to this route and, without Shakes, to this Hand.
    if (!(await signedBy(end.lastKey, digest(separator, giveHash(hand, give)), keySig))) {
      throw new LinkError("not-this-hand", "the Give is not signed by the route's last key");
    }
    signedGive = { give, keySig, giverSig };
  }

  // Each attached list stands behind a dataHash of the Hand, of a Shake or of the Give; each
  // attached text behind a value of an attached list.
  const { statements = [], texts = [] } = wire.attachments ?? {};
  const hashes = new Set([hand.dataHash, ...wire.shakes.map(({ dataHash }) => dataHash)].map((hash) => hash.toLowerCase()));
  if (signedGive) hashes.add(signedGive.give.dataHash.toLowerCase());
  hashes.delete(zeroHash);
  const values = new Set<string>();
  for (const list of statements) {
    if (!hashes.has(dataHashOf(list))) throw new LinkError("unmatched-data", "a list of statements behind no dataHash of the link");
    for (const { value } of list) values.add(value);
  }
  for (const text of texts) {
    if (!values.has(textValue(text))) throw new LinkError("unmatched-data", "a text behind no attached statement");
  }

  return { head, domain: chain, hand, signedShakes, end, seed: wire.seed, linkKey, signedGive, statements, texts };
}

/* ----------------------------------------------------------------- encode */

/** A route to write as a link: only one Core would take is written. */
export interface LinkRoute {
  domain: Eip712Domain;
  hand: Hand;
  signedShakes: readonly SignedShake[];
  attachments?: Attachments;
}

async function wireOf(route: LinkRoute, options: LinkOptions): Promise<{ wire: WireLink; end: RouteEnd }> {
  const end = await routeEnd(route.domain, route.hand, route.signedShakes);
  const core = route.domain.verifyingContract;
  const wire: WireLink = {
    chainId: BigInt(route.domain.chainId),
    core: options.canonicalCore && isAddressEqual(options.canonicalCore, core) ? undefined : core,
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
  const { wire, end } = await wireOf(route, options);
  const { give, keySig, giverSig } = route.signedGive;
  if (give.claimBps !== end.claimBps) throw new LinkError("invalid", "the Give's claim is not the one the route left");
  if (give.routeHash.toLowerCase() !== end.routeHash.toLowerCase()) throw new LinkError("invalid", "the Give names another route");
  if (route.signedShakes.length > 0) wire.lastKey = end.lastKey;
  wire.give = { signer: give.signer, payee: give.payee, dataHash: give.dataHash, keySig, giverSig };
  return written(wire, route, options);
}

/**
 * Passes a live link on: a fresh seed, a Shake signed by the link's key to the new seed's key, and
 * the new link, which carries the new seed and not the old one. What was attached to the link
 * travels on with it, unless other `attachments` are given.
 */
export async function passOn(
  opened: OpenedLink,
  terms: { payee: Address; nextClaimBps: number; dataHash?: Hex },
  options: LinkOptions = {},
  attachments: Attachments = { statements: opened.statements, texts: opened.texts },
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

/**
 * Reads either form: a string of digits is the decimal form, anything else base64url. Each link
 * has one string in each form: loose bits at the end of base64url and leading zeros are refused.
 */
export function fromText(text: string): Uint8Array {
  let bytes: Uint8Array;
  if (/^[0-9]+$/.test(text)) {
    let hex = BigInt(text).toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    bytes = hexToBytes(`0x${hex}`);
    if (toDigits(bytes) !== text) throw new LinkError("non-canonical", "a decimal link with leading zeros");
  } else {
    if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) throw new LinkError("malformed", "not a link");
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
    bytes = Uint8Array.from(out);
    if (toText(bytes) !== text) throw new LinkError("non-canonical", "base64url with loose bits at its end");
  }
  // The first byte carries the version, which is never zero: a number cannot hide leading bytes.
  if (bytes.length === 0 || bytes[0] >> 4 === 0) throw new LinkError("malformed", "not a link");
  return bytes;
}
