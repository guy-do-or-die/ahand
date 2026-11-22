import { bytesToHex, hexToBytes, isHex, type Address, type Hex } from "viem";

import type { Intent } from "../wallet/send";

/**
 * What this device keeps, in one IndexedDB database. Nothing stored here can
 * sign a Shake or a Give in the clear. The one exception is `escrow`: a new Hand's seed, encrypted
 * under the device's non-extractable `vault` key, from before `raise` is sent until the raiser
 * ticks "I saved the link". That copy protects against a storage dump and a crash; it
 * does not protect against this site's own code, which reads links anyway.
 *
 * | store   | holds                                                                  | key            |
 * |---------|------------------------------------------------------------------------|----------------|
 * | books   | the 8-byte book per raiser, the next n, whether the account repeats    | raiser (lower) |
 * | hands   | my Hands: chain, Core, n, the raise intent and hash, mode, own words   | intent         |
 * | inbox   | Gives received or pasted, as give links, with first-seen times         | id             |
 * | outbox  | the giver's envelopes on their way (packages/deliver's OutboxStore)    | any string     |
 * | passed  | Hands this device passed on: chain, handId, position, payee            | id             |
 * | prefs   | language, lens, theme; a raise form across a social login (≤ 30 min)   | name           |
 * | vault   | one AES-GCM key per device, made non-extractable                      | "device"       |
 * | escrow  | the locked copy of a new Hand's seed (signers that do not repeat)      | intent         |
 * | sends   | a money action on its way from this device (care, /waiting, send-back) | action + place |
 *
 * Only this module touches `indexedDB`; the secrets guard checks that.
 */

export const DB_NAME = "ahand";
export const DB_VERSION = 2;
export const STORES = ["books", "hands", "inbox", "outbox", "passed", "prefs", "vault", "escrow", "sends"] as const;
export type StoreName = (typeof STORES)[number];

export type Mode = "public" | "unlisted" | "dark";

export interface BookRecord {
  /** The raiser's address, lower case. */
  raiser: string;
  /** 8 random bytes made once per device and raiser. Not a secret. */
  book: Hex;
  /** The next Hand number to hand out; never given back. */
  next: number;
  /** Whether the account's keys confirmations came out equal when asked twice. */
  repeats?: boolean;
}

export interface HandRecord {
  /** The raise intent: made before anything is signed, the record's key. */
  intent: string;
  raiser: string;
  chainId: number;
  core: string;
  book: Hex;
  n: number;
  mode: Mode;
  /** The raiser's own words, normalised. */
  title: string;
  content?: string;
  salt?: Hex;
  /** `handKey(chainId, core, handId)` once the receipt gave the Hand's number. */
  hand?: string;
  handId?: string;
  txHash?: Hex;
  /**
   * The wallet's id of the EIP-5792 batch that carries the raise, kept from the moment the wallet
   * hands it over until its hash is known, so a raise in the wallet's hands always has a record
   * (and, for an account whose confirmations differ, its locked seed) on the device. The store
   * has no schema beyond its key, so the field needs no migration.
   */
  batchId?: string;
  /** For a signer that does not repeat only: the Hand's inbox secret, a chat key. */
  inboxSecret?: Hex;
  /**
   * "asked" once the wallet is asked for the raise (its nonce kept, no hash yet); "sent" while the
   * raise waits for its receipt; "up" once it is in a block; "reverted"; "dropped" when nothing
   * from it left the account (its nonce went to another transaction, or stayed free for good, and
   * no `Raised` of it is on the chain).
   */
  status?: "intent" | "asked" | "sent" | "up" | "reverted" | "dropped";
  /** The account asked to send the raise, its `pending` nonce then, and the latest block then. */
  from?: Address;
  nonce?: number;
  fromBlock?: number;
  /** The raise's root key and description hash: public, kept to find its `Raised` if its hash never lands. */
  rootKey?: Address;
  dataHash?: Hex;
  /** A dropped raise /raise has told about, and the raiser has raised again since. */
  droppedSeen?: boolean;
}

/**
 * A money action on its way from this device, kept before the wallet is asked and until it
 * lands, reverts or is dropped, so a reload follows it instead of offering it again. `id` is the action and its place: `fund:<handKey>`, `extend:<handKey>`,
 * `refund:<handKey>`, `withdraw:<chainId>:<payee>:<token>`.
 */
export interface SendRecord {
  id: string;
  intent: Intent;
}

export interface InboxRecord {
  /** The Give's hash, or another id that stands for one Give. */
  id: string;
  hand: string;
  /** A give link holds no secret by its format. */
  giveLink: string;
  /** This device's clock (`deviceClock`), labelled so wherever it is shown. */
  firstSeen: number;
  /** The route's keys as seen, for judging re-signed Gives. */
  routeKeys?: string[];
  words?: string;
  replyTo?: string;
}

export interface PassedRecord {
  id: string;
  hand: string;
  chainId: number;
  core: string;
  handId: string;
  /** The holder's position on the route. */
  position: number;
  payee?: string;
}

export interface Prefs {
  lang?: "en" | "ru";
  lens?: boolean;
  theme?: "light" | "dark";
  /** The raise form while a social login through Privy leaves the page and comes back (screens/raise/kept.ts). */
  raiseForm?: KeptRaise;
}

/**
 * A raise form not yet sent, kept only for the trip a social login makes away from the page and
 * back (Google, Apple, X through Privy load the page afresh). The asker's own words, as `hands`
 * keeps them once raised; no seed, no key, no link. Taken out as /raise opens, used only within
 * half an hour of being written.
 */
export interface KeptRaise {
  poster: string;
  details: string;
  showDetails: boolean;
  rewardKey: string;
  /** A custom reward in the token's smallest units, as decimal digits. */
  custom?: string;
  days: number;
  mode: Mode;
  minClaimBps: number;
  payoutGasK: number;
  /** When it was written (the device's clock, ms). */
  at: number;
}

interface EscrowRecord {
  intent: string;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  /** The chain's time (seconds, the latest block) when the raise that made it read the chain. */
  lockedAt?: number;
  /** The chain's time when the "up" screen first showed the link. */
  shownAt?: number;
}

/** What the sweep needs of a locked copy: never its contents. */
export interface EscrowStamp {
  intent: string;
  lockedAt?: number;
  shownAt?: number;
}

/** `chainId:core:handId`, the one spelling of a Hand used as an index here. */
export function handKey(chainId: number, core: string, handId: bigint | string | number): string {
  return `${chainId}:${core.toLowerCase()}:${handId.toString()}`;
}

/**
 * The device's own clock, read here and nowhere in screens/, ui/ or chain/ (the clock guard):
 * it is used only for "first seen on this device" times, which are labelled as such. Every
 * "now" that a state, a countdown or an expiry depends on is the chain's.
 */
export function deviceClock(): number {
  return Date.now();
}

/* ─────────────────────────────────────────────────────────── opening ── */

let factory: IDBFactory | undefined;
let name = DB_NAME;
let opening: Promise<IDBDatabase> | undefined;

/** Tests point the store at their own factory or database name; the app never calls this. */
export function configureDb(options: { factory?: IDBFactory; name?: string }): void {
  closeDb();
  factory = options.factory;
  name = options.name ?? DB_NAME;
}

/** Closes the connection; the next call opens it again. */
export function closeDb(): void {
  const pending = opening;
  opening = undefined;
  void pending?.then((db) => db.close()).catch(() => undefined);
}

function upgrade(db: IDBDatabase): void {
  const has = (store: string) => db.objectStoreNames.contains(store);
  if (!has("books")) db.createObjectStore("books", { keyPath: "raiser" });
  if (!has("hands")) {
    const hands = db.createObjectStore("hands", { keyPath: "intent" });
    hands.createIndex("raiser", "raiser");
    hands.createIndex("hand", "hand");
  }
  if (!has("inbox")) db.createObjectStore("inbox", { keyPath: "id" }).createIndex("hand", "hand");
  if (!has("outbox")) db.createObjectStore("outbox");
  if (!has("passed")) db.createObjectStore("passed", { keyPath: "id" }).createIndex("hand", "hand");
  if (!has("prefs")) db.createObjectStore("prefs");
  if (!has("vault")) db.createObjectStore("vault");
  if (!has("escrow")) db.createObjectStore("escrow", { keyPath: "intent" });
  if (!has("sends")) db.createObjectStore("sends", { keyPath: "id" });
}

/** The open database. Rejects where storage is refused (some private windows): callers carry on without it. */
export function openDb(): Promise<IDBDatabase> {
  if (opening) return opening;
  const source = factory ?? globalThis.indexedDB;
  if (!source) return Promise.reject(new Error("IndexedDB is not available here"));
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = source.open(name, DB_VERSION);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"));
  });
  opening.catch(() => {
    opening = undefined;
  });
  return opening;
}

function settled(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error);
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// IDBRequest is invariant in its result; requests whose result is not read are passed as this.
type AnyRequest = IDBRequest<any>;

async function single<T>(store: StoreName, mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest<T> | AnyRequest): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(store, mode);
  const value = result(act(tx.objectStore(store)) as IDBRequest<T>);
  value.catch(() => undefined); // its error also aborts the transaction, which is what is thrown
  await settled(tx);
  return value;
}

/* ──────────────────────────────────────────────────────── plain access ── */

interface Records {
  books: BookRecord;
  hands: HandRecord;
  inbox: InboxRecord;
  passed: PassedRecord;
  sends: SendRecord;
}
type Keyed = keyof Records;

/** Writes one record of a keyed store (books, hands, inbox, passed, sends). */
export function put<S extends Keyed>(store: S, value: Records[S]): Promise<void> {
  return single(store, "readwrite", (s) => s.put(value)).then(() => undefined);
}

/**
 * Writes one record only if none has its key yet (IndexedDB `add`): true when written, false when
 * a record was already there, which is left as it was. One transaction, so two tabs cannot both
 * write first.
 */
export async function putIfAbsent<S extends Keyed>(store: S, value: Records[S]): Promise<boolean> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  const request = tx.objectStore(store).add(value);
  const written = new Promise<boolean>((resolve, reject) => {
    request.onsuccess = () => resolve(true);
    request.onerror = (event) => {
      if (request.error?.name === "ConstraintError") {
        // The record that is there stays; the transaction ends quietly instead of aborting.
        event.preventDefault();
        event.stopPropagation();
        resolve(false);
      } else reject(request.error);
    };
  });
  written.catch(() => undefined);
  await settled(tx);
  return written;
}

/** Reads one record of a keyed store by its key. */
export function get<S extends Keyed>(store: S, key: string): Promise<Records[S] | undefined> {
  return single(store, "readonly", (s) => s.get(key) as IDBRequest<Records[S] | undefined>);
}

/** Deletes one record of a keyed store. */
export function remove(store: Keyed, key: string): Promise<void> {
  return single(store, "readwrite", (s) => s.delete(key)).then(() => undefined);
}

/** Every record of a keyed store. */
export function all<S extends Keyed>(store: S): Promise<Records[S][]> {
  return single(store, "readonly", (s) => s.getAll() as IDBRequest<Records[S][]>);
}

/** The records of hands, inbox or passed that belong to one Hand (`handKey`). */
export function forHand<S extends "hands" | "inbox" | "passed">(store: S, hand: string): Promise<Records[S][]> {
  return single(store, "readonly", (s) => s.index("hand").getAll(hand) as IDBRequest<Records[S][]>);
}

/** My Hands raised by one account on this device. */
export function handsOf(raiser: string): Promise<HandRecord[]> {
  return single("hands", "readonly", (s) => s.index("raiser").getAll(raiser.toLowerCase()) as IDBRequest<HandRecord[]>);
}

/**
 * A key-value view of the `outbox` store with the shape packages/deliver's `OutboxStore` takes
 * (get, set, delete, keys). Values must be plain data.
 */
export function outboxStore<V>() {
  return {
    get: (key: string) => single("outbox", "readonly", (s) => s.get(key) as IDBRequest<V | undefined>),
    set: (key: string, value: V) => single("outbox", "readwrite", (s) => s.put(value, key)).then(() => undefined),
    delete: (key: string) => single("outbox", "readwrite", (s) => s.delete(key)).then(() => undefined),
    keys: () => single("outbox", "readonly", (s) => s.getAllKeys()).then((keys) => keys.map(String)),
  };
}

/* ─────────────────────────────────────────────────────────────── prefs ── */

/** Every preference this device chose. Empty where storage is refused. */
export async function loadPrefs(): Promise<Prefs> {
  const db = await openDb();
  const tx = db.transaction("prefs", "readonly");
  const store = tx.objectStore("prefs");
  const [keys, values] = await Promise.all([result(store.getAllKeys()), result(store.getAll())]);
  await settled(tx);
  return Object.fromEntries(keys.map((key, i) => [String(key), values[i]])) as Prefs;
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): Promise<void> {
  return single("prefs", "readwrite", (s): AnyRequest => (value === undefined ? s.delete(key) : s.put(value, key))).then(() => undefined);
}

/* ─────────────────────────────────────────────────────────────── books ── */

function newBook(): Hex {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
}

/**
 * Takes the raiser's next Hand number on this device, in one transaction, before anything is
 * signed. The book is made here the first time. A number is never given back, even if the
 * raise fails, so two tabs or two calls can never get the same (book, n).
 */
export async function reserveNumber(raiser: string): Promise<{ book: Hex; n: number }> {
  const key = raiser.toLowerCase();
  const db = await openDb();
  const tx = db.transaction("books", "readwrite");
  const store = tx.objectStore("books");
  const taken = new Promise<{ book: Hex; n: number }>((resolve, reject) => {
    const read = store.get(key);
    read.onerror = () => reject(read.error);
    read.onsuccess = () => {
      const record: BookRecord = (read.result as BookRecord | undefined) ?? { raiser: key, book: newBook(), next: 0 };
      const n = record.next;
      const write = store.put({ ...record, next: n + 1 });
      write.onerror = () => reject(write.error);
      write.onsuccess = () => resolve({ book: record.book, n });
    };
  });
  taken.catch(() => undefined); // its error also aborts the transaction, which is what is thrown
  await settled(tx);
  return taken;
}

/** The raiser's book on this device, if one was made. */
export function bookOf(raiser: string): Promise<BookRecord | undefined> {
  return get("books", raiser.toLowerCase());
}

/** Stores whether the account's keys confirmations repeat (asked twice once per account and device). */
export async function setRepeats(raiser: string, repeats: boolean): Promise<void> {
  const key = raiser.toLowerCase();
  const db = await openDb();
  const tx = db.transaction("books", "readwrite");
  const store = tx.objectStore("books");
  const read = store.get(key);
  read.onsuccess = () => {
    const record: BookRecord = (read.result as BookRecord | undefined) ?? { raiser: key, book: newBook(), next: 0 };
    store.put({ ...record, repeats });
  };
  await settled(tx);
}

/* ────────────────────────────────────────────── the locked copy ── */

const VAULT_KEY = "device";

/** The device's AES-GCM key, made non-extractable on first use and kept in `vault`. */
export async function vaultKey(): Promise<CryptoKey> {
  const existing = await single("vault", "readonly", (s) => s.get(VAULT_KEY) as IDBRequest<CryptoKey | undefined>);
  if (existing) return existing;
  const made = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  try {
    await single("vault", "readwrite", (s) => s.add(made, VAULT_KEY));
    return made;
  } catch {
    // Another tab made one first: use that one, so every copy opens with the same key.
    const theirs = await single("vault", "readonly", (s) => s.get(VAULT_KEY) as IDBRequest<CryptoKey | undefined>);
    if (!theirs) throw new Error("the device key could not be kept");
    return theirs;
  }
}

function boundTo(intent: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`aHand.escrow/1:${intent}`);
}

/**
 * Writes the locked copy of a new Hand's seed, before `raise` is sent. Only ciphertext reaches
 * storage: AES-GCM under the vault key, a fresh 12-byte IV, the intent bound as associated data.
 */
export async function lockSeed(intent: string, seed: Hex): Promise<void> {
  if (!isHex(seed) || seed.length < 4) throw new TypeError("lockSeed: the seed must be hex bytes");
  const key = await vaultKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: boundTo(intent) }, key, new Uint8Array(hexToBytes(seed))),
  );
  const record: EscrowRecord = { intent, iv, ciphertext };
  await single("escrow", "readwrite", (s) => s.put(record));
}

/**
 * Opens the locked copy of the seed for this raise intent: undefined when there is none, or when
 * it can no longer be opened (the vault key was cleared or the record was altered).
 */
export async function openSeed(intent: string): Promise<Hex | undefined> {
  const record = await single("escrow", "readonly", (s) => s.get(intent) as IDBRequest<EscrowRecord | undefined>);
  if (!record) return undefined;
  try {
    const key = await vaultKey();
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(record.iv), additionalData: boundTo(intent) },
      key,
      new Uint8Array(record.ciphertext),
    );
    return bytesToHex(new Uint8Array(plain));
  } catch {
    return undefined;
  }
}

/**
 * Writes a chain time on the locked copy, once: when the raise read the chain (`lockedAt`), and
 * when the link was first on screen (`shownAt`). A later stamp of the same kind changes nothing.
 */
export async function stampSeed(intent: string, field: "lockedAt" | "shownAt", at: number): Promise<void> {
  const tx = (await openDb()).transaction("escrow", "readwrite");
  const store = tx.objectStore("escrow");
  const read = store.get(intent) as IDBRequest<EscrowRecord | undefined>;
  read.onsuccess = () => {
    const record = read.result;
    if (record && record[field] === undefined) store.put({ ...record, [field]: at });
  };
  await settled(tx);
}

/** Every locked copy's intent and chain times, for the sweep. */
export async function escrowStamps(): Promise<EscrowStamp[]> {
  const records = await single("escrow", "readonly", (s) => s.getAll() as IDBRequest<EscrowRecord[]>);
  return records.map(({ intent, lockedAt, shownAt }) => ({ intent, ...(lockedAt !== undefined ? { lockedAt } : {}), ...(shownAt !== undefined ? { shownAt } : {}) }));
}

/** Deletes the locked copy: when the raiser ticks "I saved the link", or the raise is found reverted. */
export async function dropSeed(intent: string): Promise<void> {
  await single("escrow", "readwrite", (s) => s.delete(intent));
}

/** The intents that still have a locked copy, so a reloaded tab can find its pending raise. */
export function lockedIntents(): Promise<string[]> {
  return single("escrow", "readonly", (s) => s.getAllKeys()).then((keys) => keys.map(String));
}
