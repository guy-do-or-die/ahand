/**
 * Writes records into the app's device store (IndexedDB "ahand", the schema of
 * apps/hand/src/store/db.ts) from a spec, the same way against the dev server and the built app.
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
