import { bytesToHex, concatBytes, hexToBytes, isAddressEqual, recoverTypedDataAddress, size, stringToBytes, type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import { keyOfSeed } from "./link.js";
import { toCoreSignature } from "./sign.js";

/**
 * The raiser's link and inbox keys, from one wallet signature: nothing to store, and the same keys
 * again on any device the raiser's wallet signs on.
 *
 *   master                         = HKDF-Extract(salt = "aHand.keys/1", signature)
 *   rootSeedOf(master, book, n)    = HKDF-Expand(master, "aHand.root/1"  ‖ book ‖ n, 16)
 *   inboxSecretOf(master, book, n) = HKDF-Expand(master, "aHand.inbox/1" ‖ book ‖ n, 32)
 *
 * HKDF-SHA256 as RFC 5869 defines it, computed with WebCrypto's HMAC-SHA256 so that the master can
 * be kept between the two steps (WebCrypto's own HKDF runs both at once; a test checks that the
 * results are the same). `book` is 8 random bytes made once per device and raiser and `n` the
 * raiser's own Hand number in that book, written as 4 bytes, big-endian. The two infos differ, so
 * neither key tells anything about the other, and the inbox key is never derived from a link seed,
 * which every holder has.
 *
 * A key's signature is brought to Core's 65-byte form before it is used, so the same key gives the
 * same master whichever way its wallet writes `v` or `s`. Only the raiser's own key's signature of
 * the keys message is taken: it must recover to the raiser. A signature that is not a key's (a smart
 * account's, a passkey's) is refused, because it is not always a secret: a multisig's service may
 * store its off-chain signatures where anyone can read them, some accounts answer with a fixed or
 * predictable value, and whoever had those bytes would rebuild every root key and inbox secret.
 * A raiser that is a contract account needs another way to keep its keys.
 */

export const KEYS_DOMAIN_NAME = "aHand keys";
export const KEYS_DOMAIN_VERSION = "1";
/** The message's own words are the warning the wallet shows. */
export const KEYS_PURPOSE = "Rebuilds my aHand links and opens replies to me. I sign this only on a site I trust.";
export const KEYS_TYPES = {
  Keys: [
    { name: "purpose", type: "string" },
    { name: "raiser", type: "address" },
  ],
} as const;

const EXTRACT_SALT = "aHand.keys/1";
const ROOT_INFO = "aHand.root/1";
const INBOX_INFO = "aHand.inbox/1";
export const BOOK_BYTES = 8;
/** How far `matchRoot` looks by default: Hand numbers 0 to 1 000 of one book. */
export const MATCH_ROOT_MAX_N = 1_000;

/** The EIP-712 keys message: domain {name: "aHand keys", version: "1", chainId, verifyingContract: core}. */
export function keysTypedData(chainId: number, core: Address, raiser: Address) {
  return {
    domain: { name: KEYS_DOMAIN_NAME, version: KEYS_DOMAIN_VERSION, chainId, verifyingContract: core },
    types: KEYS_TYPES,
    primaryType: "Keys" as const,
    message: { purpose: KEYS_PURPOSE, raiser },
  };
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const imported = await subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", imported, data as BufferSource));
}

/** What the keys message was signed for: the arguments of `keysTypedData`. */
export interface KeysMessage {
  chainId: number;
  core: Address;
  raiser: Address;
}

const NOT_A_SECRET =
  "keys are made only from the raiser's own key's signature of the keys message: another signature (a smart account's, a passkey's) may be stored or predictable, and would give the keys away";

/**
 * `masterOf`'s refusal of a signature that is not the raiser's own key's (a smart account's, a
 * wrapped or a passkey's): an app tells it apart from any other failure by this class.
 */
export class NotAKeySignatureError extends Error {
  constructor() {
    super(NOT_A_SECRET);
    this.name = "NotAKeySignatureError";
  }
}

/** The signature's bytes as the master is made from them: the raiser's key's, in Core's form. */
async function signatureBytes(signature: Hex, signed: KeysMessage): Promise<Uint8Array> {
  if (!/^0x[0-9a-fA-F]*$/.test(signature) || size(signature) === 0) throw new Error("a signature is hex bytes");
  let core: Hex;
  let by: Address;
  try {
    core = toCoreSignature(signature);
    by = await recoverTypedDataAddress({ ...keysTypedData(signed.chainId, signed.core, signed.raiser), signature: core });
  } catch {
    throw new NotAKeySignatureError();
  }
  if (!isAddressEqual(by, signed.raiser)) throw new NotAKeySignatureError();
  return hexToBytes(core);
}

/**
 * HKDF extract over the raiser's signature of the keys message: 32 bytes. Throws unless the
 * signature is a key's and recovers to `signed.raiser` over `keysTypedData(signed…)`.
 */
export async function masterOf(signature: Hex, signed: KeysMessage): Promise<Hex> {
  return bytesToHex(await hmac(stringToBytes(EXTRACT_SALT), await signatureBytes(signature, signed)));
}

function infoOf(label: string, book: Hex, n: number): Uint8Array {
  if (!/^0x[0-9a-fA-F]*$/.test(book) || size(book) !== BOOK_BYTES) throw new Error(`a book is ${BOOK_BYTES} bytes`);
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) throw new Error("a Hand number is a whole number from 0 to 4 294 967 295");
  const number = new Uint8Array(4);
  new DataView(number.buffer).setUint32(0, n);
  return concatBytes([stringToBytes(label), hexToBytes(book), number]);
}

/** HKDF expand for up to one block (32 bytes): T(1) = HMAC(master, info ‖ 0x01). */
async function expand(master: Hex, info: Uint8Array, length: number): Promise<Hex> {
  if (!/^0x[0-9a-fA-F]*$/.test(master) || size(master) !== 32) throw new Error("a master is 32 bytes");
  const block = await hmac(hexToBytes(master), concatBytes([info, new Uint8Array([1])]));
  return bytesToHex(block.slice(0, length));
}

/** The link seed of the raiser's Hand number `n` in `book`: 16 bytes. */
export async function rootSeedOf(master: Hex, book: Hex, n: number): Promise<Hex> {
  return expand(master, infoOf(ROOT_INFO, book, n), 16);
}

/** The inbox secret of the raiser's Hand number `n` in `book`: 32 bytes, another HKDF info. */
export async function inboxSecretOf(master: Hex, book: Hex, n: number): Promise<Hex> {
  return expand(master, infoOf(INBOX_INFO, book, n), 32);
}

/** 8 random bytes, one per device and raiser. */
export function newBook(): Hex {
  return bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(BOOK_BYTES)));
}

/** The root key address of Hand number `n` in `book`: the address Core keeps as `rootKey`. */
export async function rootKeyOf(master: Hex, book: Hex, n: number): Promise<Address> {
  return privateKeyToAddress(keyOfSeed(await rootSeedOf(master, book, n)));
}

/** The `n` whose root key is `rootKey`, searching 0 to `maxN`. */
export async function matchRoot(master: Hex, book: Hex, rootKey: Address, maxN: number = MATCH_ROOT_MAX_N): Promise<number | undefined> {
  for (let n = 0; n <= maxN; ++n) {
    if (isAddressEqual(await rootKeyOf(master, book, n), rootKey)) return n;
  }
  return undefined;
}
