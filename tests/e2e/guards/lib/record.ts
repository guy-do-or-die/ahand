/**
 * The hygiene guard's recorder and search: every request a
 * browser context makes (address, headers, body), every WebSocket frame either way, every console
 * line and page error, and at the end everything the context put into localStorage,
 * sessionStorage and IndexedDB. The search then looks for given texts in all of it.
 */
import type { BrowserContext, Page } from "@playwright/test";

import { storageText } from "../../lib/feat-give/storage";

/** One place something was seen, and its whole text. */
export interface Hay {
  /** "request", "frame", "console" or "storage". */
  kind: "request" | "frame" | "console" | "storage";
  /** Who and where: the person, and the URL or the store. */
  where: string;
  text: string;
  /** A request is a JSON-RPC call to the chain: the one place a signature may travel. */
  rpc?: boolean;
}

/** A text the search looks for. Hex is compared without regard to case; everything else exactly. */
export interface Needle {
  label: string;
  text: string;
  caseless?: boolean;
}

export interface Hit {
  label: string;
  kind: Hay["kind"];
  where: string;
}

export class Recorder {
  readonly hays: Hay[] = [];

  constructor(private readonly rpcOrigin: string) {}

  /** Records everything `context` does from now on, under the name `who`. */
  watch(context: BrowserContext, who: string): void {
    context.on("request", (request) => {
      const body = request.postData() ?? "";
      const url = request.url();
      let rpc = false;
      try {
        rpc = new URL(url).origin === this.rpcOrigin && /"jsonrpc"\s*:\s*"2\.0"/.test(body);
      } catch {
        // a data: or blob: URL
      }
      this.hays.push({ kind: "request", where: `${who} ${request.method()} ${url}`, text: `${url}\n${JSON.stringify(request.headers())}\n${body}`, rpc });
    });
    const page = (p: Page) => {
      p.on("console", (message) => this.hays.push({ kind: "console", where: `${who} console.${message.type()}`, text: message.text() }));
      p.on("pageerror", (error) => this.hays.push({ kind: "console", where: `${who} pageerror`, text: `${error.message}\n${error.stack ?? ""}` }));
      p.on("websocket", (socket) => {
        const add = (dir: string) => (frame: { payload: string | Buffer }) =>
          this.hays.push({ kind: "frame", where: `${who} ws ${dir} ${socket.url()}`, text: typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8") });
        socket.on("framesent", add("sent"));
        socket.on("framereceived", add("received"));
      });
    };
    context.pages().forEach(page);
    context.on("page", page);
  }

  /** Adds everything `page`'s origin keeps in the browser's storage, as of now. */
  async storage(page: Page, who: string): Promise<void> {
    this.hays.push({ kind: "storage", where: `${who} storage of ${new URL(page.url()).origin}`, text: await storageText(page) });
  }
}

/** Every place where a needle stands. */
export function search(hays: readonly Hay[], needles: readonly Needle[]): Hit[] {
  const hits: Hit[] = [];
  for (const hay of hays) {
    const lower = hay.text.toLowerCase();
    for (const needle of needles) {
      if (!needle.text) continue;
      const found = needle.caseless ? lower.includes(needle.text.toLowerCase()) : hay.text.includes(needle.text);
      if (found) hits.push({ label: needle.label, kind: hay.kind, where: hay.where });
    }
  }
  return hits;
}

/** A live link's secret as needles: its seed in three forms, the whole address and its fragment. */
export function linkNeedles(name: string, address: string, forms: { hex: string; base64url: string; digits: string }): Needle[] {
  return [
    { label: `${name}: seed as hex`, text: forms.hex, caseless: true },
    { label: `${name}: seed as base64url`, text: forms.base64url },
    { label: `${name}: seed as decimal digits`, text: forms.digits },
    { label: `${name}: the whole address`, text: address },
    { label: `${name}: the link after #`, text: address.slice(address.indexOf("#") + 1) },
  ];
}

/** Twelve words as needles: the phrase, and every run of three (a run is rare in any other text). */
export function wordNeedles(words: readonly string[]): Needle[] {
  const out: Needle[] = [{ label: "the twelve words", text: words.join(" "), caseless: true }];
  for (let i = 0; i + 3 <= words.length; i++) out.push({ label: `words ${i + 1}–${i + 3}`, text: words.slice(i, i + 3).join(" "), caseless: true });
  // Joined without spaces, as a careless serialiser might write an array.
  out.push({ label: "the twelve words, quoted list", text: words.map((word) => `"${word}"`).join(","), caseless: true });
  return out;
}

export function describeHits(hits: readonly Hit[]): string[] {
  return hits.map((hit) => `${hit.label} — in ${hit.kind}: ${hit.where}`);
}
