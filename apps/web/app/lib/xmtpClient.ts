import { hexToBytes } from "viem";
import type { Client, ClientOptions, Signer } from "@xmtp/browser-sdk";
import { XMTP_ENV, xmtpRegisteredKey } from "../config/xmtp";
import { isUserRejection } from "./errors";
import { parseGiveMessage, type GiveMessage } from "./giveLink";

/**
 * The only module that touches @xmtp/browser-sdk. The SDK is WASM + OPFS
 * and must never load during SSR, so every entry point dynamically imports
 * it and throws early off the client. Type-only imports are erased.
 */

export type XmtpClient = Client<unknown>;

/** Hex-signature callback the app supplies (wagmi signMessageAsync). */
export type SignHex = (message: string) => Promise<`0x${string}`>;

/** Another tab holds the OPFS database — the feature degrades, never crashes. */
export class XmtpBusyError extends Error {
  constructor() {
    super("xmtp database is held by another tab");
    this.name = "XmtpBusyError";
  }
}

/** The XMTP network didn't answer — treat like unreachable, keep the copy-link path. */
export class XmtpNetworkError extends Error {
  constructor(cause?: unknown) {
    super("xmtp network unavailable");
    this.name = "XmtpNetworkError";
    this.cause = cause;
  }
}

function assertBrowser(): void {
  if (typeof window === "undefined") {
    throw new Error("xmtpClient is browser-only");
  }
}

/** Loud, greppable diagnostics — this layer has bitten us too many times. */
function diag(...args: unknown[]): void {
  console.info("[ahand-xmtp]", ...args);
}

function isHandleCollision(err: unknown): boolean {
  const s = (String((err as Error)?.message ?? err) + " " + String((err as Error)?.name ?? "")).toLowerCase();
  return s.includes("access handle") || s.includes("accesshandle") || s.includes("nomodificationallowed");
}

/**
 * OPFS handles free lazily and unpredictably (slower machines lag far past
 * any fixed settle) — retrying beats guessing a delay.
 */
async function withHandleRetry<T>(label: string, job: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await job();
    } catch (err) {
      lastErr = err;
      if (!isHandleCollision(err)) throw err;
      diag(`${label}: file handle still held (attempt ${attempt}/4), retrying…`);
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastErr;
}

function toXmtpError(err: unknown): Error {
  diag("raw error:", (err as Error)?.name, "—", String((err as Error)?.message ?? err).slice(0, 160));
  // A closed confirm sheet must survive untouched so callers can recognize it.
  if (isUserRejection(err)) return err as Error;
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  const name = String((err as Error)?.name ?? "").toLowerCase();
  if (
    msg.includes("locked") ||
    msg.includes("access handle") || // OPFS: "Access Handles cannot be created…"
    msg.includes("accesshandle") || // "createSyncAccessHandle"
    msg.includes("nomodificationallowed") ||
    msg.includes("opfs") ||
    name.includes("nomodificationallowed")
  ) {
    return new XmtpBusyError();
  }
  // NOTE: no bare "connect" here — it would swallow wagmi's
  // "Connector not connected", which is a wallet-session hiccup, not the net.
  if (msg.includes("fetch") || msg.includes("network") || msg.includes("timeout") || msg.includes("unreachable")) {
    return new XmtpNetworkError(err);
  }
  return err instanceof Error ? err : new Error(String(err));
}

const sdk = () => import("@xmtp/browser-sdk");

// Typed as ClientOptions: create/build declare Omit<ClientOptions, …>,
// and TS's Omit over the options union erases `env` from the param type.
const clientOptions: ClientOptions = { env: XMTP_ENV };

async function ethereumIdentifier(address: string) {
  const { IdentifierKind } = await sdk();
  return { identifier: address.toLowerCase(), identifierKind: IdentifierKind.Ethereum };
}

function makeSigner(address: string, signHex: SignHex): Signer {
  return {
    type: "EOA",
    getIdentifier: () => ethereumIdentifier(address),
    signMessage: async (message: string) => hexToBytes(await signHex(message)),
  };
}

/**
 * Client.build resolves even with nothing to resume — it happily mints a
 * hollow local installation (inboxId included, so that's no tell). Only
 * client.isRegistered() separates a real resumed identity from a husk.
 */
async function assertResumed(client: XmtpClient): Promise<void> {
  const registered = await client.isRegistered().catch(() => false);
  if (!registered) {
    await closeAndSettle(client);
    throw new Error("nothing to resume in this browser");
  }
}

/**
 * close() terminates the worker, but its OPFS access handle frees a beat
 * later — opening the next engine immediately collides with the carcass
 * ("Access Handles cannot be created…"). Always settle before reopening.
 */
async function closeAndSettle(client: XmtpClient): Promise<void> {
  try {
    client.close();
  } catch {
    /* already dead */
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

let cached: { address: string; promise: Promise<XmtpClient> } | null = null;
/** Teardown chain — every new engine waits for prior carcasses to clear. */
let closing: Promise<void> = Promise.resolve();

/**
 * ONE engine at a time — even the static Client.canMessage secretly spins
 * a temporary db-backed engine, and two engines on the same address's file
 * collide into hollow sessions (the raiser's mount runs reachability and
 * resume for the SAME address concurrently). Everything queues here.
 */
let engineTurn: Promise<void> = Promise.resolve();
function queueEngine<T>(job: () => Promise<T>): Promise<T> {
  const turn = engineTurn.then(job);
  // Small gap between turns: even short-lived engines free their file
  // handles a beat after they finish.
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 300));
  engineTurn = turn.then(settle, settle);
  return turn;
}

let heldLock: { address: string; release: () => void } | null = null;

/**
 * One tab per pocket's message store — the OPFS db can't be shared, and
 * the SDK fails murkily when it is (a second engine limps into a hollow
 * session instead of throwing). A Web Locks advisory lock makes "who holds
 * it" deterministic across this origin's tabs; auto-released on tab close.
 */
async function acquireTabLock(addr: string): Promise<boolean> {
  if (heldLock?.address === addr) return true;
  heldLock?.release();
  heldLock = null;
  if (typeof navigator === "undefined" || !("locks" in navigator)) return true;
  const tryOnce = () =>
    new Promise<boolean>((resolve) => {
      void navigator.locks
        .request(`ahand.xmtp.${addr}`, { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }
          resolve(true);
          // Hold until resetClient releases (or the tab closes).
          return new Promise<void>((release) => {
            heldLock = { address: addr, release };
          });
        })
        .catch(() => resolve(true)); // lock API misbehaving — don't block the app
    });
  // Releases (ours or a closing tab's) land asynchronously — a genuinely
  // held lock survives these retries, a just-released one frees within ms.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await tryOnce()) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return tryOnce();
}

function cacheClient(address: string, init: () => Promise<XmtpClient>): Promise<XmtpClient> {
  const addr = address.toLowerCase();
  if (cached?.address === addr) return cached.promise;
  if (cached) resetClient(); // address switch: free the old worker's OPFS handle
  const promise = queueEngine(async () => {
    await closing; // let any prior engine's teardown finish first
    if (!(await acquireTabLock(addr))) throw new XmtpBusyError();
    return init();
  }).then(
    (client) => {
      reachCache.set(addr, Promise.resolve(true));
      return client;
    },
    (err) => {
      if (cached?.address === addr) cached = null; // allow retry
      throw toXmtpError(err);
    },
  );
  cached = { address: addr, promise };
  return promise;
}

/**
 * Silent rehydrate — Client.build resumes an identity from the local db.
 * Never asks the pocket for anything, so it's safe to attempt even without
 * the localStorage marker (browsers wipe localStorage and OPFS separately;
 * a surviving db self-heals here). Throws if there is nothing to resume.
 */
export function buildClientSilently(address: string): Promise<XmtpClient> {
  assertBrowser();
  const addr = address.toLowerCase();
  return cacheClient(addr, async () => {
    diag("resume: attempting silent build for", addr);
    const { Client } = await sdk();
    const client = await withHandleRetry(
      "resume",
      async () => (await Client.build(await ethereumIdentifier(addr), clientOptions)) as XmtpClient,
    );
    await assertResumed(client);
    diag("resume: OK — live client for", addr);
    localStorage.setItem(xmtpRegisteredKey(addr), "1"); // restore the hint
    return client;
  });
}

/**
 * Full path — build when possible, otherwise Client.create, which asks the
 * pocket for one OK on first registration. Only call from a user action.
 */
export function getOrCreateClient(address: string, signHex: SignHex): Promise<XmtpClient> {
  assertBrowser();
  const addr = address.toLowerCase();
  return cacheClient(addr, async () => {
    const { Client } = await sdk();
    const identifier = await ethereumIdentifier(addr);
    if (localStorage.getItem(xmtpRegisteredKey(addr))) {
      try {
        const built = await withHandleRetry(
          "register/build",
          async () => (await Client.build(identifier, clientOptions)) as XmtpClient,
        );
        await assertResumed(built);
        diag("register: resumed without a prompt for", addr);
        return built;
      } catch {
        // Stale marker (wiped OPFS db, new browser profile) — full create below.
      }
    }
    diag("register: creating new installation for", addr, "— the pocket should ask for an OK now");
    const client = await withHandleRetry(
      "register/create",
      async () => (await Client.create(makeSigner(addr, signHex), clientOptions)) as XmtpClient,
    );
    diag("register: created + registered for", addr);
    localStorage.setItem(xmtpRegisteredKey(addr), "1");
    return client;
  });
}

/** Forget the cached client (disconnect / address switch). */
export function resetClient(): void {
  const prev = cached;
  cached = null;
  heldLock?.release();
  heldLock = null;
  if (prev) {
    // Queue the teardown; the next engine awaits it via `closing`.
    closing = closing
      .then(() => prev.promise)
      .then((client) => closeAndSettle(client))
      .catch(() => {});
  }
}

const reachCache = new Map<string, Promise<boolean>>();

/**
 * Whether an address can receive XMTP messages — a static network check,
 * no local client or signature involved. Only a positive answer is cached:
 * "not reachable" flips the moment they switch delivery on, so pinning it
 * for the session would hide the direct path from every open sheet.
 */
export function canReachAddress(address: string): Promise<boolean> {
  assertBrowser();
  const addr = address.toLowerCase();
  const hit = reachCache.get(addr);
  if (hit) return hit;
  const promise = (async () => {
    const identifier = await ethereumIdentifier(addr);
    // A live client answers directly; otherwise the static check spins a
    // TEMPORARY db-backed engine, so it must take an engine turn like
    // everyone else or it collides with a resume for the same address.
    const live = cached ? await cached.promise.catch(() => null) : null;
    diag("reach: checking", addr, live ? "(via live client)" : "(via temp engine)");
    const reachable = live
      ? await live.canMessage([identifier])
      : await queueEngine(() =>
          withHandleRetry("reach", async () => {
            const { Client } = await sdk();
            return Client.canMessage([identifier], XMTP_ENV);
          }),
        );
    const ok = reachable.get(identifier.identifier) === true;
    if (!ok) reachCache.delete(addr); // re-ask next time — they may enable any minute
    return ok;
  })().catch((err) => {
    reachCache.delete(addr); // don't pin a transient failure
    throw toXmtpError(err);
  });
  reachCache.set(addr, promise);
  return promise;
}

/** Find-or-create the DM with a peer address and send one text message. */
export async function sendDmText(client: XmtpClient, peerAddress: string, text: string): Promise<void> {
  assertBrowser();
  try {
    const dm = await client.conversations.createDmWithIdentifier(await ethereumIdentifier(peerAddress));
    await dm.sendText(text);
  } catch (err) {
    throw toXmtpError(err);
  }
}

export type InboxGive = GiveMessage & {
  messageId: string;
  conversationId: string;
  senderInboxId: string;
  sentAt: Date;
  /** Newest plain word in the same thread — the row's live preview. */
  latestWord: { text: string; mine: boolean; sentAt: Date } | null;
};

export type InboxReply = {
  messageId: string;
  conversationId: string;
  /** The other side's address, when resolvable — for a "who said it" chip. */
  peerAddress: string | null;
  sentAt: Date;
  text: string;
};

export type Inbox = {
  /** Incoming gives (raiser side), newest first, deduped per proof. */
  gives: InboxGive[];
  /** Latest incoming plain word per conversation (giver side), newest first. */
  replies: InboxReply[];
};

async function peerAddressOf(dm: { members(): Promise<any[]> }, client: XmtpClient): Promise<string | null> {
  try {
    const members = await dm.members();
    const peer = members.find((m) => m.inboxId !== client.inboxId);
    return peer?.accountIdentifiers?.[0]?.identifier ?? null;
  } catch {
    return null;
  }
}

/**
 * Sync from the network and split what came in: give-proofs for the raiser
 * view, and the latest plain reply per conversation for the giver view.
 * One pass on purpose — two consumers must not double-sync the same db.
 * Sync-on-open by design: no streams, no persistent OPFS worker.
 * Replies only surface in conversations where this pocket has spoken
 * (i.e. threads the user started by sending a give) — cold spam stays out.
 */
export async function listInbox(client: XmtpClient): Promise<Inbox> {
  assertBrowser();
  try {
    const { SortDirection } = await sdk();
    await client.conversations.syncAll();
    // Bounded on purpose: a spam flood must not turn the pocket into a
    // full-history scan. Newest DMs and newest messages win.
    const dms = await client.conversations.listDms({ limit: 200n });
    const byFragment = new Map<string, InboxGive>();
    const replies: InboxReply[] = [];
    for (const dm of dms) {
      const messages = await dm.messages({ limit: 100n, direction: SortDirection.Descending });
      let latestPeerReply: (typeof messages)[number] | null = null;
      let latestWord: InboxGive["latestWord"] = null;
      let ownVoice = false;
      let dmHasGive = false;
      for (const message of messages) {
        const mine = message.senderInboxId === client.inboxId;
        if (mine) ownVoice = true;
        if (typeof message.content !== "string" || !(message.content as string).trim()) continue;
        const raw = (message.content as string).trim();
        const give = mine ? null : parseGiveMessage(raw);
        if (give) {
          dmHasGive = true;
          const existing = byFragment.get(give.fragment);
          if (existing && existing.sentAt >= message.sentAt) continue;
          byFragment.set(give.fragment, {
            ...give,
            messageId: message.id,
            conversationId: message.conversationId,
            senderInboxId: message.senderInboxId,
            sentAt: message.sentAt,
            latestWord: null, // attached after the scan
          });
          continue;
        }
        if (parseGiveMessage(raw)) continue; // own give-sends aren't chat
        if (!latestWord) latestWord = { text: raw, mine, sentAt: message.sentAt };
        if (!mine && !latestPeerReply) latestPeerReply = message;
      }
      if (dmHasGive) {
        // The give row IS this conversation — feed it the freshest word
        // instead of duplicating the thread as a second "word back" row.
        for (const entry of byFragment.values()) {
          if (entry.conversationId === dm.id && latestWord && latestWord.sentAt > entry.sentAt) {
            entry.latestWord = latestWord;
          }
        }
      } else if (latestPeerReply && ownVoice) {
        replies.push({
          messageId: latestPeerReply.id,
          conversationId: latestPeerReply.conversationId,
          peerAddress: await peerAddressOf(dm, client),
          sentAt: latestPeerReply.sentAt,
          text: (latestPeerReply.content as string).trim(),
        });
      }
    }
    return {
      gives: [...byFragment.values()].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime()),
      replies: replies.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime()),
    };
  } catch (err) {
    throw toXmtpError(err);
  }
}

export type ThreadMessage = {
  id: string;
  mine: boolean;
  text: string;
  /** This message carried a give — text is just its note, link stripped. */
  isGive: boolean;
  sentAt: Date;
};

/**
 * One conversation's recent plain words, oldest first for display.
 * Syncs just this conversation — cheaper than a full inbox pass.
 */
export async function loadThread(client: XmtpClient, conversationId: string): Promise<ThreadMessage[]> {
  assertBrowser();
  try {
    const { SortDirection } = await sdk();
    const convo = await client.conversations.getConversationById(conversationId);
    if (!convo) return [];
    await convo.sync();
    const messages = await convo.messages({ limit: 80n, direction: SortDirection.Descending });
    return messages
      .filter((m) => typeof m.content === "string" && (m.content as string).trim())
      .map((m) => {
        const raw = (m.content as string).trim();
        const give = parseGiveMessage(raw);
        return {
          id: m.id,
          mine: m.senderInboxId === client.inboxId,
          text: give ? give.note || "🙌" : raw,
          isGive: Boolean(give),
          sentAt: m.sentAt,
        };
      })
      .reverse();
  } catch (err) {
    throw toXmtpError(err);
  }
}

export async function sendToThread(client: XmtpClient, conversationId: string, text: string): Promise<void> {
  assertBrowser();
  try {
    const convo = await client.conversations.getConversationById(conversationId);
    if (!convo) throw new Error("conversation not found");
    await convo.sendText(text);
  } catch (err) {
    throw toXmtpError(err);
  }
}
