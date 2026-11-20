/**
 * feat-hand's own helpers for its smoke (PLAN rule 9: under tests/e2e/lib/<id>/ only): the
 * fixture shapes it reads from the seed's JSON, the craft tool as a child process, and a request
 * log that says where every request of a browser context went and which JSON-RPC methods it
 * carried.
 */
import type { BrowserContext, Page, Request } from "@playwright/test";
import type { Address } from "viem";

import { runProgram, standSlot } from "../stand";

/** One fixture as the seed prints it (infra/stand/seed.ts `handJson` and friends). */
export interface Fixture {
  handId: string;
  reward: string;
  expiry: number;
  title: string;
  content: string;
  address: string;
  state: string;
  endedBlock?: string;
}

export interface SeedRun {
  chainId: number;
  core: Address;
  rpc: string;
  site: string;
  raiser: { account: number; address: Address };
  fixtures: Record<string, Fixture>;
}

/** Runs `bun tests/e2e/lib/craft.ts <args> --slot N` and returns its JSON. */
export function craft<T = Record<string, unknown>>(args: string[]): T {
  const { stdout } = runProgram("tests/e2e/lib/craft.ts", [...args, "--slot", String(standSlot())]);
  return JSON.parse(stdout) as T;
}

/** One request a page made: where it went, and the JSON-RPC methods in its body, if any. */
export interface Seen {
  url: string;
  origin: string;
  methods: string[];
}

function methodsOf(request: Request): string[] {
  try {
    const body = request.postDataJSON() as unknown;
    const list = Array.isArray(body) ? body : [body];
    return list.map((item) => (item && typeof item === "object" && "method" in item ? String((item as { method: unknown }).method) : "")).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Logs every request the context (or page) makes from now on: HTTP requests and WebSocket
 * openings alike. `seen` grows as they happen.
 */
export function logRequests(target: BrowserContext | Page): Seen[] {
  const seen: Seen[] = [];
  target.on("request", (request) => {
    const url = request.url();
    let origin = url;
    try {
      origin = new URL(url).origin;
    } catch {
      // data: and blob: URLs have no origin worth checking; they leave nothing.
    }
    seen.push({ url, origin, methods: methodsOf(request) });
  });
  const pages = "pages" in target ? target.pages() : [target];
  const watch = (page: Page) =>
    page.on("websocket", (socket) => {
      const url = socket.url();
      seen.push({ url, origin: new URL(url.replace(/^ws/, "http")).origin, methods: [] });
    });
  pages.forEach(watch);
  if ("pages" in target) target.on("page", watch);
  return seen;
}

/**
 * In --dev mode, Vite reloads every open page when any agent edits any file of the shared app,
 * and a reload forgets the link (by design: it lives in the tab's memory only). The dev server's
 * own WebSocket (same origin as the site) is therefore answered here by a socket that never
 * reaches the server: no reload arrives mid-test. A built stand has no such socket; this changes
 * nothing there. The relay's socket is on another port and is not touched.
 */
export async function quietDevServer(context: BrowserContext, site: string): Promise<void> {
  const origin = new URL(site).origin.replace(/^http/, "ws");
  await context.routeWebSocket((url) => url.origin === origin, () => {
    // Accepted and left silent: not connected to the server, so no update and no reload comes.
  });
}

/** How many `eth_getLogs` calls the requests carried. */
export function getLogsCount(seen: readonly Seen[]): number {
  return seen.reduce((sum, item) => sum + item.methods.filter((method) => method === "eth_getLogs").length, 0);
}
