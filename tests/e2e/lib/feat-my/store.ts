/**
 * Writes records into the app's device store (IndexedDB "ahand", the schema of
 * apps/web/src/store/db.ts) from a spec, the same way against the dev server and the built app.
 *
 * The built app has no `/src/store/db.ts` to import, so this goes through the browser's own
 * IndexedDB API. It never creates the database: it waits until the page's app has opened it and
 * made its stores (an open that would create it is aborted and tried again).
 */
import type { Page } from "@playwright/test";

export type DeviceStore = "books" | "hands" | "inbox" | "passed";

/** `chainId:core:handId`, the store's one spelling of a Hand (db.ts handKey). */
export function handKey(chainId: number, core: string, handId: string | bigint | number): string {
  return `${chainId}:${core.toLowerCase()}:${handId.toString()}`;
}

/** Puts each record into its store, in one transaction per store. */
export async function devicePut(page: Page, writes: { store: DeviceStore; value: Record<string, unknown> }[]): Promise<void> {
  await page.evaluate(async (list) => {
    const openExisting = () =>
      new Promise<IDBDatabase | undefined>((resolve, reject) => {
        const request = indexedDB.open("ahand");
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => (request.error?.name === "AbortError" ? resolve(undefined) : reject(request.error));
      });
    let db: IDBDatabase | undefined;
    for (let tries = 0; tries < 100; tries++) {
      db = await openExisting();
      if (db && list.every((w) => db!.objectStoreNames.contains(w.store))) break;
      db?.close();
      db = undefined;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!db) throw new Error("the app has not made its device store yet");
    for (const { store, value } of list) {
      await new Promise<void>((resolve, reject) => {
        const tx = db!.transaction(store, "readwrite");
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    db.close();
  }, writes);
}

/** Every record of one store, read through the browser's own IndexedDB API (never creates the database). */
export async function deviceAll<T = Record<string, unknown>>(page: Page, store: DeviceStore): Promise<T[]> {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase | undefined>((resolve, reject) => {
      const request = indexedDB.open("ahand");
      request.onupgradeneeded = () => request.transaction?.abort();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => (request.error?.name === "AbortError" ? resolve(undefined) : reject(request.error));
    });
    if (!db || !db.objectStoreNames.contains(name)) return [];
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const request = db.transaction(name, "readonly").objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows;
  }, store) as Promise<T[]>;
}

/** Deletes one record of one store by its key. */
export async function deviceDelete(page: Page, store: DeviceStore, key: string): Promise<void> {
  await page.evaluate(
    async ([name, id]) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("ahand");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(name, "readwrite");
        tx.objectStore(name).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    [store, key] as const,
  );
}
