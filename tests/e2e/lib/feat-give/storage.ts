/**
 * Everything a page has put into the browser's storage, as one text a spec can search: every
 * IndexedDB database and store (keys and values), localStorage and sessionStorage. Values are
 * serialised with bigints as decimals and binary as hex, so a key or a word cannot hide in a type.
 */
import type { Page } from "@playwright/test";

export async function storageText(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const plain = (value: unknown): unknown => {
      if (typeof value === "bigint") return value.toString();
      if (value instanceof Uint8Array) return hex(value);
      if (value instanceof ArrayBuffer) return hex(new Uint8Array(value));
      if (Array.isArray(value)) return value.map(plain);
      if (value && typeof value === "object") {
        if (typeof CryptoKey !== "undefined" && value instanceof CryptoKey) return `CryptoKey(${value.type}, extractable ${value.extractable})`;
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
      }
      return value;
    };
    const parts: string[] = [];
    const request = <T>(r: IDBRequest<T>) => new Promise<T>((done, fail) => ((r.onsuccess = () => done(r.result)), (r.onerror = () => fail(r.error))));
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase>((done, fail) => {
        const open = indexedDB.open(info.name!);
        open.onsuccess = () => done(open.result);
        open.onerror = () => fail(open.error);
      });
      for (const name of Array.from(db.objectStoreNames)) {
        const store = db.transaction(name, "readonly").objectStore(name);
        const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
        parts.push(`idb ${info.name}/${name}: ${JSON.stringify(plain({ keys, values }))}`);
      }
      db.close();
    }
    for (const [label, area] of [["local", localStorage], ["session", sessionStorage]] as const) {
      for (let i = 0; i < area.length; i++) {
        const key = area.key(i)!;
        parts.push(`${label} ${key}: ${area.getItem(key)}`);
      }
    }
    return parts.join("\n");
  });
}
