import { bytesToHex, concatBytes, getAddress, hashTypedData, hexToBytes, recoverTypedDataAddress, stringToBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { describe, expect, it } from "vitest";

import {
  KEYS_PURPOSE,
  inboxSecretOf,
  keysTypedData,
  masterOf,
  matchRoot,
  newBook,
  rootKeyOf,
  rootSeedOf,
} from "../src/keys.js";
import { keyOfSeed } from "../src/link.js";

// anvil's first two public test keys: never a real key.
const raiser = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const other = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f37c4bb5a3ff9d");
const core: Address = getAddress("0x65ac707e2ae7392583de5d6192c619f1d8862309");
const book: Hex = "0x0123456789abcdef";

async function signatureOf(account = raiser, chainId = 8453): Promise<Hex> {
  return account.signTypedData(keysTypedData(chainId, core, account.address));
}

/** What `signatureOf` signed, for `masterOf`. */
const message = (account = raiser, chainId = 8453) => ({ chainId, core, raiser: account.address });

/** RFC 5869 HKDF-SHA256 in one call, by WebCrypto's own HKDF: the reference the two-step code must equal. */
async function webCryptoHkdf(ikm: Uint8Array, salt: string, info: Uint8Array, length: number): Promise<Hex> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: stringToBytes(salt), info: info as BufferSource }, key, length * 8);
  return bytesToHex(new Uint8Array(bits));
}

const infoOf = (label: string, n: number) => concatBytes([stringToBytes(label), hexToBytes(book), new Uint8Array([0, 0, n >> 8, n & 0xff])]);

describe("the keys message", () => {
  it("is EIP-712 under its own domain, with the warning as its words", async () => {
    const typed = keysTypedData(8453, core, raiser.address);
    expect(typed.domain).toEqual({ name: "aHand keys", version: "1", chainId: 8453, verifyingContract: core });
    expect(typed.primaryType).toBe("Keys");
    expect(typed.message).toEqual({ purpose: KEYS_PURPOSE, raiser: raiser.address });
    expect(KEYS_PURPOSE).toBe("Rebuilds my aHand links and opens replies to me. I sign this only on a site I trust.");
    const signature = await signatureOf();
    expect(await recoverTypedDataAddress({ ...typed, signature })).toBe(raiser.address);
  });

  it("differs by chain, Core and raiser", () => {
    const base = hashTypedData(keysTypedData(8453, core, raiser.address));
    expect(hashTypedData(keysTypedData(1, core, raiser.address))).not.toBe(base);
    expect(hashTypedData(keysTypedData(8453, raiser.address, raiser.address))).not.toBe(base);
    expect(hashTypedData(keysTypedData(8453, core, other.address))).not.toBe(base);
  });
});

describe("master, root seed and inbox secret", () => {
  it("are HKDF-SHA256 exactly: the same bytes as WebCrypto's HKDF in one call", async () => {
    const signature = await signatureOf();
    const master = await masterOf(signature, message());
    for (const n of [0, 1, 300]) {
      expect(await rootSeedOf(master, book, n)).toBe(await webCryptoHkdf(hexToBytes(signature), "aHand.keys/1", infoOf("aHand.root/1", n), 16));
      expect(await inboxSecretOf(master, book, n)).toBe(await webCryptoHkdf(hexToBytes(signature), "aHand.keys/1", infoOf("aHand.inbox/1", n), 32));
    }
  });

  it("the same signature, book and n give the same seed; another book or n another", async () => {
    const master = await masterOf(await signatureOf(), message());
    const again = await masterOf(await signatureOf(), message());
    expect(again).toBe(master);
    const seed = await rootSeedOf(master, book, 7);
    expect(seed).toMatch(/^0x[0-9a-f]{32}$/);
    expect(await rootSeedOf(again, book, 7)).toBe(seed);
    expect(await rootSeedOf(master, book, 8)).not.toBe(seed);
    expect(await rootSeedOf(master, "0x0123456789abcdee", 7)).not.toBe(seed);
    expect(await rootSeedOf(await masterOf(await signatureOf(other), message(other)), book, 7)).not.toBe(seed);
    expect(await rootSeedOf(await masterOf(await signatureOf(raiser, 1), message(raiser, 1)), book, 7)).not.toBe(seed);
  });

  it("rootSeedOf and inboxSecretOf differ, and the inbox secret is 32 bytes", async () => {
    const master = await masterOf(await signatureOf(), message());
    const seed = await rootSeedOf(master, book, 0);
    const secret = await inboxSecretOf(master, book, 0);
    expect(secret).toMatch(/^0x[0-9a-f]{64}$/);
    expect(secret.startsWith(seed)).toBe(false);
    expect(secret).not.toBe(await inboxSecretOf(master, book, 1));
  });

  it("is the same whichever way a wallet writes a key's signature (v as 0/1, ERC-2098, high s)", async () => {
    const signature = await signatureOf();
    const master = await masterOf(signature, message());
    const v = parseInt(signature.slice(-2), 16);
    const zeroOne = (signature.slice(0, -2) + (v - 27).toString(16).padStart(2, "0")) as Hex;
    expect(await masterOf(zeroOne, message())).toBe(master);
    // ERC-2098: the top bit of s carries v.
    const s = BigInt(`0x${signature.slice(66, 130)}`) | (BigInt(v - 27) << 255n);
    const compact = `${signature.slice(0, 66)}${s.toString(16).padStart(64, "0")}` as Hex;
    expect(await masterOf(compact, message())).toBe(master);
  });

  it("takes only the raiser's own key's signature: never a smart account's, another key's or another message's", async () => {
    const signature = await signatureOf();
    // Not a key's signature: a Safe's pre-approved form, a fixed answer, a long ERC-1271 one.
    const preApproved = `0x${raiser.address.slice(2).toLowerCase().padStart(64, "0")}${"00".repeat(32)}01` as Hex;
    for (const answer of [preApproved, "0x01" as Hex, `0x${"ab".repeat(100)}` as Hex]) {
      await expect(masterOf(answer, message())).rejects.toThrow(/own key's signature/);
    }
    // A key's signature, but of another raiser, chain or Core.
    await expect(masterOf(await signatureOf(other), message())).rejects.toThrow(/own key's signature/);
    await expect(masterOf(signature, message(raiser, 1))).rejects.toThrow(/own key's signature/);
    await expect(masterOf(signature, { ...message(), core: other.address })).rejects.toThrow(/own key's signature/);
    await expect(masterOf("0x", message())).rejects.toThrow(/hex bytes/);
  });

  it("refuses a book that is not 8 bytes and a Hand number out of range", async () => {
    const master = await masterOf(await signatureOf(), message());
    await expect(rootSeedOf(master, "0x0123", 0)).rejects.toThrow(/8 bytes/);
    await expect(rootSeedOf(master, book, -1)).rejects.toThrow(/whole number/);
    await expect(inboxSecretOf(master, book, 1.5)).rejects.toThrow(/whole number/);
    await expect(rootSeedOf("0x1234", book, 0)).rejects.toThrow(/32 bytes/);
  });
});

describe("newBook and matchRoot", () => {
  it("newBook is 8 random bytes", () => {
    const a = newBook();
    expect(a).toMatch(/^0x[0-9a-f]{16}$/);
    expect(newBook()).not.toBe(a);
  });

  it("matchRoot finds n from the root key Core keeps, and nothing for another book", async () => {
    const master = await masterOf(await signatureOf(), message());
    const rootKey = privateKeyToAddress(keyOfSeed(await rootSeedOf(master, book, 42)));
    expect(await rootKeyOf(master, book, 42)).toBe(rootKey);
    expect(await matchRoot(master, book, rootKey)).toBe(42);
    expect(await matchRoot(master, book, rootKey, 41)).toBeUndefined();
    expect(await matchRoot(master, newBook(), rootKey, 100)).toBeUndefined();
  });
});
