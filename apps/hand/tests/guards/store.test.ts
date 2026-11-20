import "fake-indexeddb/auto";

import { afterEach, describe, expect, test } from "bun:test";
import { bytesToHex, hexToBytes, type Hex } from "viem";

import {
  bookOf,
  closeDb,
  configureDb,
  dropSeed,
  forHand,
  handKey,
  loadPrefs,
  lockSeed,
  lockedIntents,
  openSeed,
  outboxStore,
  put,
  reserveNumber,
  setPref,
  setRepeats,
  STORES,
  vaultKey,
} from "../../src/store/db";

/**
 * The device store (ARCHITECTURE §5, §11) on fake-indexeddb under Bun. CryptoKey survives
 * fake-indexeddb's structured clone here (checked below by using the key read back), so the
 * locked copy is tested on the stored, non-extractable key itself, not on a key held in memory.
 */

let run = 0;
afterEach(() => closeDb());
function fresh(): string {
  const name = `ahand-test-${process.pid}-${++run}`;
  configureDb({ name });
  return name;
}

/** Every value in every store of the database, as raw structured-clone output. */
async function dump(name: string): Promise<unknown[]> {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const values: unknown[] = [];
  for (const store of db.objectStoreNames) {
    const tx = db.transaction(store, "readonly");
    const request = tx.objectStore(store).getAll();
    values.push(...(await new Promise<unknown[]>((resolve) => (request.onsuccess = () => resolve(request.result)))));
  }
  db.close();
  return values;
}

/** The seed in each form a careless write could take: hex, base64url, decimal digits, raw bytes. */
function forms(seed: Hex): { text: string[]; bytes: Uint8Array } {
  const bytes = hexToBytes(seed);
  const b64url = Buffer.from(bytes).toString("base64url");
  return { text: [seed.slice(2).toLowerCase(), seed.slice(2).toUpperCase(), b64url, BigInt(seed).toString(10)], bytes };
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** Whether a stored value holds the seed in any form, walking typed arrays, buffers and objects. */
function holdsSeed(value: unknown, seed: Hex, seen = new Set<unknown>()): boolean {
  const { text, bytes } = forms(seed);
  if (typeof value === "string") return text.some((form) => value.toLowerCase().includes(form.toLowerCase()));
  if (typeof value === "bigint" || typeof value === "number") return text.includes(value.toString());
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (value instanceof ArrayBuffer) return containsBytes(new Uint8Array(value), bytes);
  if (ArrayBuffer.isView(value)) return containsBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), bytes);
  if (value instanceof CryptoKey) return false;
  return Object.values(value).some((inner) => holdsSeed(inner, seed, seen));
}

describe("store: the stores of ARCHITECTURE §11", () => {
  test("the database has exactly the eight stores", async () => {
    const name = fresh();
    await loadPrefs();
    const db: IDBDatabase = await new Promise((resolve) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
    });
    expect([...db.objectStoreNames].sort()).toEqual([...STORES].sort());
    db.close();
  });

  test("prefs keep language, lens and theme", async () => {
    fresh();
    expect(await loadPrefs()).toEqual({});
    await setPref("lang", "ru");
    await setPref("lens", true);
    await setPref("theme", "dark");
    expect(await loadPrefs()).toEqual({ lang: "ru", lens: true, theme: "dark" });
    await setPref("theme", undefined);
    expect(await loadPrefs()).toEqual({ lang: "ru", lens: true });
  });

  test("records are found by their Hand", async () => {
    fresh();
    const hand = handKey(31337, "0x65ac707E2AE7392583de5d6192C619F1D8862309", 7n);
    expect(hand).toBe("31337:0x65ac707e2ae7392583de5d6192c619f1d8862309:7");
    await put("passed", { id: "a", hand, chainId: 31337, core: "0x65ac707e2ae7392583de5d6192c619f1d8862309", handId: "7", position: 1 });
    await put("passed", { id: "b", hand: handKey(31337, "0x01", 8), chainId: 31337, core: "0x01", handId: "8", position: 0 });
    expect((await forHand("passed", hand)).map((r) => r.id)).toEqual(["a"]);
  });

  test("the outbox view has the shape packages/deliver takes", async () => {
    fresh();
    const box = outboxStore<{ tries: number }>();
    await box.set("e1", { tries: 1 });
    await box.set("e2", { tries: 2 });
    expect(await box.get("e1")).toEqual({ tries: 1 });
    expect((await box.keys()).sort()).toEqual(["e1", "e2"]);
    await box.delete("e1");
    expect(await box.keys()).toEqual(["e2"]);
  });
});

describe("store: reserveNumber takes the next n in one transaction", () => {
  test("two concurrent calls return different numbers in one book", async () => {
    fresh();
    const raiser = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const [a, b] = await Promise.all([reserveNumber(raiser), reserveNumber(raiser)]);
    expect(a.book).toBe(b.book);
    expect(a.book).toMatch(/^0x[0-9a-f]{16}$/);
    expect(new Set([a.n, b.n])).toEqual(new Set([0, 1]));
  });

  test("twenty concurrent calls return twenty different numbers, and the next is 20", async () => {
    fresh();
    const raiser = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    const taken = await Promise.all(Array.from({ length: 20 }, () => reserveNumber(raiser)));
    expect(new Set(taken.map((t) => t.n)).size).toBe(20);
    expect((await reserveNumber(raiser.toLowerCase())).n).toBe(20);
  });

  test("each raiser has its own book; the repeat verdict is kept beside it", async () => {
    fresh();
    const one = await reserveNumber("0x0000000000000000000000000000000000000001");
    const two = await reserveNumber("0x0000000000000000000000000000000000000002");
    expect(one.book).not.toBe(two.book);
    expect(one.n).toBe(0);
    expect(two.n).toBe(0);
    await setRepeats("0x0000000000000000000000000000000000000001", false);
    const book = await bookOf("0x0000000000000000000000000000000000000001");
    expect(book).toEqual({ raiser: "0x0000000000000000000000000000000000000001", book: one.book, next: 1, repeats: false });
  });
});

describe("store: the locked copy (D-63)", () => {
  const seed = bytesToHex(new Uint8Array([0x5e, 0xed, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0xff]));

  test("lockSeed then openSeed returns the seed; storage holds no form of it; dropSeed empties the store", async () => {
    const name = fresh();
    await lockSeed("intent-1", seed);
    expect(await lockedIntents()).toEqual(["intent-1"]);
    expect(await openSeed("intent-1")).toBe(seed);

    const stored = await dump(name);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.some((value) => holdsSeed(value, seed))).toBe(false);
    // The checker itself finds the seed when it is there.
    expect(holdsSeed({ x: [new Uint8Array([9, ...hexToBytes(seed), 9])] }, seed)).toBe(true);
    expect(holdsSeed(`prefix${seed.slice(2).toUpperCase()}`, seed)).toBe(true);
    expect(holdsSeed(BigInt(seed), seed)).toBe(true);

    await dropSeed("intent-1");
    expect(await lockedIntents()).toEqual([]);
    expect(await openSeed("intent-1")).toBeUndefined();
  });

  test("the vault key is a stored CryptoKey that cannot be exported", async () => {
    fresh();
    const key = await vaultKey();
    expect(key).toBeInstanceOf(CryptoKey);
    expect(key.extractable).toBe(false);
    expect(key.algorithm.name).toBe("AES-GCM");
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
    await expect(crypto.subtle.exportKey("jwk", key)).rejects.toThrow();
    // The same key comes back: the copy written before a reload opens after it.
    closeDb();
    const again = await vaultKey();
    const iv = new Uint8Array(12);
    const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, again, sealed))).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("a copy opens only under its own intent and fails closed when altered", async () => {
    const name = fresh();
    await lockSeed("intent-a", seed);
    expect(await openSeed("intent-b")).toBeUndefined();
    // Move intent-a's record under intent-b: the bound intent no longer matches, so it does not open.
    const [record] = (await dump(name)).filter((v) => (v as { intent?: string }).intent === "intent-a") as { iv: Uint8Array; ciphertext: Uint8Array }[];
    closeDb();
    const db: IDBDatabase = await new Promise((resolve) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction("escrow", "readwrite");
    tx.objectStore("escrow").put({ intent: "intent-b", iv: record!.iv, ciphertext: record!.ciphertext });
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();
    expect(await openSeed("intent-b")).toBeUndefined();
    expect(await openSeed("intent-a")).toBe(seed);
  });

  test("two copies of one seed never share their stored bytes (a fresh IV each time)", async () => {
    const name = fresh();
    await lockSeed("x", seed);
    await lockSeed("y", seed);
    const records = (await dump(name)).filter((v) => typeof (v as { intent?: unknown }).intent === "string") as { ciphertext: Uint8Array }[];
    expect(records).toHaveLength(2);
    expect(Buffer.from(records[0]!.ciphertext).equals(Buffer.from(records[1]!.ciphertext))).toBe(false);
  });

  test("lockSeed refuses something that is not hex bytes", async () => {
    fresh();
    await expect(lockSeed("z", "not hex" as Hex)).rejects.toThrow(TypeError);
  });
});
