/**
 * A persona's browser, watched from the side (its pattern is tests/e2e/lib/e2e-life/people.ts's):
 *
 * - every request and WebSocket it opens is logged with its origin and the JSON-RPC methods it
 *   carried; with `local-only`, a request to any host other than 127.0.0.1 is intercepted, aborted
 *   and kept, so the scenario can assert that the list is empty;
 * - an init script in every page counts the moments after `load` at which `location.href` held a
 *   fragment (the count only, never the link itself), and notes whether a wallet prompt (the
 *   connect sheet or a dev wallet entry) ever appeared;
 * - page errors and console errors are kept.
 */
import type { BrowserContext, Page, Request } from "@playwright/test";

import { TID } from "../../../apps/web/src/testids";

export interface Sent {
  url: string;
  host: string;
  origin: string;
  methods: string[];
}

export interface Watched {
  sent: Sent[];
  offHost: string[];
  errors: string[];
  loads: number;
  fragmentsAfterLoad: number;
  prompt: boolean;
}

const LOCAL_HOST = "127.0.0.1";

/** JSON-RPC methods that would only appear if a wallet signed or sent something. */
export const WALLET_METHODS = ["eth_sendRawTransaction", "eth_sendTransaction", "eth_signTypedData_v4", "personal_sign", "eth_sign", "wallet_sendCalls"];

function methodsOf(request: Request): string[] {
  try {
    const body = request.postDataJSON() as unknown;
    const list = Array.isArray(body) ? body : [body];
    return list.map((item) => (item && typeof item === "object" && "method" in item ? String((item as { method: unknown }).method) : "")).filter(Boolean);
  } catch {
    return [];
  }
}

function hostOf(url: string): { host: string; origin: string } | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "data:" || parsed.protocol === "blob:" || parsed.protocol === "about:") return undefined;
    return { host: parsed.hostname, origin: parsed.origin };
  } catch {
    return undefined;
  }
}

/** Runs in every page before its own scripts; reports words only, never the address itself. */
function watchScript(prompts: string): void {
  const note = (window as unknown as { __demoWatch?: (kind: string) => Promise<void> }).__demoWatch;
  if (!note) return;
  let prompted = false;
  const check = () => {
    if (location.href.includes("#")) void note("fragment");
    if (!prompted && document.querySelector(prompts)) {
      prompted = true;
      void note("prompt");
    }
  };
  addEventListener("load", () => {
    void note("load");
    check();
    setInterval(check, 40);
    addEventListener("hashchange", check);
    addEventListener("popstate", check);
  });
}

export async function watch(context: BrowserContext, options: { localOnly: boolean }): Promise<Watched> {
  const w: Watched = { sent: [], offHost: [], errors: [], loads: 0, fragmentsAfterLoad: 0, prompt: false };
  if (options.localOnly) {
    await context.route(
      (url) => url.hostname !== LOCAL_HOST,
      async (route) => {
        w.offHost.push(route.request().url());
        await route.abort("blockedbyclient");
      },
    );
    await context.routeWebSocket(
      (url) => url.hostname !== LOCAL_HOST,
      (socket) => {
        w.offHost.push(socket.url());
        void socket.close({ code: 1008, reason: "off host" });
      },
    );
  }
  context.on("request", (request) => {
    const at = hostOf(request.url());
    if (at) w.sent.push({ url: request.url(), ...at, methods: methodsOf(request) });
  });
  const listen = (page: Page) => {
    page.on("websocket", (socket) => {
      const at = hostOf(socket.url().replace(/^ws/, "http"));
      if (at) w.sent.push({ url: socket.url(), ...at, methods: [] });
    });
    page.on("pageerror", (error) => w.errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") w.errors.push(`console: ${message.text()}`);
    });
  };
  context.on("page", listen);
  await context.exposeBinding("__demoWatch", (_source, kind: string) => {
    if (kind === "load") w.loads++;
    else if (kind === "fragment") w.fragmentsAfterLoad++;
    else if (kind === "prompt") w.prompt = true;
  });
  await context.addInitScript(watchScript, `[data-testid="${TID.kit.connectSheet}"], [data-testid^="${TID.wallet.devAccount}-"]`);
  return w;
}

/** Every JSON-RPC method a persona's browser sent. */
export function methodsSent(w: Watched): string[] {
  return w.sent.flatMap((item) => item.methods);
}
