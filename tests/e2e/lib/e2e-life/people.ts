/**
 * e2e-life's own helpers (PLAN rule 9: under tests/e2e/lib/<id>/ only). A "person" is one
 * isolated browser context at phone size, watched from the side:
 *
 * - every request and WebSocket it opens is logged with its origin and the JSON-RPC methods it
 *   carried; a request to any host other than 127.0.0.1 is intercepted, aborted and kept, so the
 *   spec can assert that the list is empty (nothing reaches the outside, even by accident);
 * - an init script in every page counts the moments after `load` at which `location.href` held a
 *   fragment (the count only, never the link itself), and notes whether a wallet prompt (the
 *   connect sheet or a dev wallet entry) ever appeared;
 * - the dev server's own WebSocket is answered silently (feat-hand's `quietDevServer`), so a file
 *   another agent saves cannot reload a page and make it forget the link it holds.
 *
 * Chain helpers decode a transaction's own receipt with Core's ABI, so the spec compares the
 * screen with what Core emitted in that transaction, not with a log window.
 */
import type { Browser, BrowserContext, Page, Request } from "@playwright/test";
import { decodeEventLog, isAddressEqual, type Address, type Hex } from "viem";

import { quietDevServer } from "../feat-hand/helpers";
import { coreAbi, type Rpc } from "../rpc";
import type { StandInfo } from "../stand";

/** One request a person's browser made. */
export interface Sent {
  url: string;
  host: string;
  origin: string;
  methods: string[];
}

export interface Person {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Every request and WebSocket opening, in order. */
  sent: Sent[];
  /** Requests to a host other than 127.0.0.1: intercepted and aborted. Must stay empty. */
  offHost: string[];
  watch: Watch;
  /** Uncaught page errors and console errors, as text. */
  errors: string[];
}

const LOCAL_HOST = "127.0.0.1";

function methodsOf(request: Request): string[] {
  try {
    const body = request.postDataJSON() as unknown;
    const list = Array.isArray(body) ? body : [body];
    return list
      .map((item) => (item && typeof item === "object" && "method" in item ? String((item as { method: unknown }).method) : ""))
      .filter(Boolean);
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

/** What the pages of a person reported, summed over every page and every load. */
export interface Watch {
  loads: number;
  fragmentsAfterLoad: number;
  prompt: boolean;
}

/**
 * Installed in every page before its own scripts. From `load` on, it checks the address bar and
 * the DOM every 40 ms and reports to the test through the `__lifeNote` binding: "load" once, a
 * "fragment" whenever `location.href` holds a `#`, "prompt" when a wallet prompt is on screen.
 * Only these words cross over, never the address itself.
 */
function watchScript(): void {
  const note = (window as unknown as { __lifeNote?: (kind: string) => Promise<void> }).__lifeNote;
  if (!note) return;
  let prompted = false;
  const check = () => {
    if (location.href.includes("#")) void note("fragment");
    if (!prompted && document.querySelector('[data-testid="kit-connect-sheet"], [data-testid^="dev-account-"]')) {
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

/** A new person: an isolated context at 390×844 with touch, watched as described above. */
export async function person(browser: Browser, name: string, stand: StandInfo): Promise<Person> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const sent: Sent[] = [];
  const offHost: string[] = [];
  await context.route(
    (url) => url.hostname !== LOCAL_HOST,
    async (route) => {
      offHost.push(route.request().url());
      await route.abort("blockedbyclient");
    },
  );
  await context.routeWebSocket(
    (url) => url.hostname !== LOCAL_HOST,
    (socket) => {
      offHost.push(socket.url());
      void socket.close({ code: 1008, reason: "off host" });
    },
  );
  if (stand.mode === "dev") await quietDevServer(context, stand.site!);
  context.on("request", (request) => {
    const at = hostOf(request.url());
    if (at) sent.push({ url: request.url(), ...at, methods: methodsOf(request) });
  });
  const watchSockets = (page: Page) =>
    page.on("websocket", (socket) => {
      const at = hostOf(socket.url().replace(/^ws/, "http"));
      if (at) sent.push({ url: socket.url(), ...at, methods: [] });
    });
  context.on("page", watchSockets);
  const watch: Watch = { loads: 0, fragmentsAfterLoad: 0, prompt: false };
  await context.exposeBinding("__lifeNote", (_source, kind: string) => {
    if (kind === "load") watch.loads++;
    else if (kind === "fragment") watch.fragmentsAfterLoad++;
    else if (kind === "prompt") watch.prompt = true;
  });
  await context.addInitScript(watchScript);
  const errors: string[] = [];
  const listen = (page: Page) => {
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
  };
  context.on("page", listen);
  const page = await context.newPage();
  // Leaving /raise before "I saved the link" asks first (beforeunload): this person agrees.
  page.on("dialog", (dialog) => void dialog.accept());
  return { name, context, page, sent, offHost, watch, errors };
}

/** JSON-RPC methods that would only appear if a wallet signed or sent something. */
export const WALLET_METHODS = ["eth_sendRawTransaction", "eth_sendTransaction", "eth_signTypedData_v4", "personal_sign", "eth_sign", "wallet_sendCalls"];

/** The origins a person's browser reached. */
export function originsOf(person: Person): Set<string> {
  return new Set(person.sent.map((item) => item.origin));
}

/** Every JSON-RPC method a person's browser sent. */
export function methodsSent(person: Person): string[] {
  return person.sent.flatMap((item) => item.methods);
}

/** One of Core's events in a transaction's receipt, decoded. */
export interface CoreEvent {
  eventName: string;
  args: Record<string, unknown>;
  logIndex: number;
}

/** Core's events in the receipt of transaction `hash`, in log order (other contracts' logs are left out). */
export async function coreEventsOf(chain: Rpc, core: Address, hash: Hex): Promise<{ status: string; block: bigint; events: CoreEvent[] }> {
  const receipt = await chain.client.getTransactionReceipt({ hash });
  const abi = coreAbi();
  const events: CoreEvent[] = [];
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, core)) continue;
    const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
    events.push({ eventName: String(decoded.eventName), args: (decoded.args ?? {}) as unknown as Record<string, unknown>, logIndex: log.logIndex });
  }
  return { status: receipt.status, block: receipt.blockNumber, events };
}

/** The payout rows of a list of Core events: Paid and Pending, as payee and amount. */
export function payoutsOf(events: CoreEvent[]): { kind: "paid" | "waiting"; payee: Address; amount: bigint }[] {
  return events
    .filter((event) => event.eventName === "Paid" || event.eventName === "Pending")
    .map((event) => ({
      kind: event.eventName === "Paid" ? ("paid" as const) : ("waiting" as const),
      payee: (event.args.payee ?? event.args.to) as Address,
      amount: event.args.amount as bigint,
    }));
}
