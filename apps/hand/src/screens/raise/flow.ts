import {
  approveCall,
  chainNow,
  describeHand,
  inboxSecret,
  keyOfSeed,
  messageIdOf,
  newSeed,
  normalizeText,
  raiseCall,
  readHand,
  rootKeyOf,
  rootSeed,
  type Call,
  type CoreRefusal,
  type Described,
  type LinkOptions,
} from "@ahand/sdk";
import { erc20Abi, getAddress, isAddressEqual, type Address, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";

import { all, dropSeed, handKey, lockSeed, openSeed, put, remove, reserveNumber, stampSeed, type HandRecord, type Mode } from "../../store/db";
import { repeatsOnDevice, unlock, unlockedFor, type KeysTyped } from "../../store/keys";
import type { Intent, SendResult, TypedOutcome } from "../../wallet";
import { assertNewRoot, expiryFor, inboxKeyOf, MAX_DETAILS, MAX_TITLE, raisedIn, weigh, writeLinks, type Raised, type Weighed, type Written } from "./link";

/** What the device keeps of a raise: the store's record (with `batchId` while a batch has no hash yet). */
export type RaiseRecord = HandRecord;

/**
 * The flow behind the raise swipe (UX-SPEC §7.2, ARCHITECTURE §5 and §6 steps 1–4), in this order:
 * the words fit (their caps, and the address before `#`); the money is there; the keys confirmation (asked twice the first time an account raises on this
 * device, the verdict kept in `books`); the Hand number reserved before anything is derived; the
 * root seed and inbox secret derived (or, for an account whose confirmations differ, made fresh
 * and locked on the device before sending, D-63); the root key checked to be new on this device;
 * the description; the intent kept; then approve (skipped when not needed) and raise through
 * `useSend`, which tries the calls first; the raise's hash, or the id of the batch that carries it,
 * kept before waiting. From that moment the record is never deleted here: only the chain's own
 * answer (a receipt) ends it. On the receipt: the Hand from its own `Raised` log, the first link in
 * the mode's shape.
 *
 * No React here: the screen passes its ports (the keys card, the wallet's answers, the sender).
 */

export interface Draft {
  title: string;
  content: string;
  /** In the token's smallest units; zero is a hand with no reward. */
  reward: bigint;
  days: number;
  mode: Mode;
  minClaimBps: number;
  payoutGasK: number;
}

export interface RaiseContext {
  client: PublicClient;
  chainId: number;
  core: Address;
  token: Address;
  maxExpiryPeriod: number;
  site: string;
  options: LinkOptions;
}

export type Step = "keys" | "allow" | "raise";

export interface Ports {
  raiser: Address;
  /** Shows the keys card and waits: true when the person confirms it, false when they step back. */
  confirmKeys(twice: boolean): Promise<boolean>;
  /** The keys message, through the wallet's typed-data confirmation. */
  signKeys(typedData: KeysTyped): Promise<TypedOutcome>;
  send(calls: readonly Call[], options: { onIntent: (intent: Intent) => Promise<void> }): Promise<SendResult>;
  onStep(step: Step, of: number): void;
  /** The raise's hash or batch id is kept on the device: from here a reload resumes instead of sending again. */
  onSent(record: RaiseRecord): void;
}

/** A sentence for the screen: a catalogue id with its values, and what was not lost. */
export interface Problem {
  id: string;
  /** Money to write into the sentence, in the token's units. */
  amount?: bigint;
  /** Core's or the chain's own name for it, shown in mono. */
  code?: string;
  /** The raise was sent and may still land: a reload looks for it again. */
  pending?: boolean;
  /** Looking for it needs the account that sent it: the screen offers "Connect a wallet". */
  connect?: boolean;
  /** Other values the sentence names (counts and caps). */
  values?: Record<string, string>;
  /** The sentence itself does not say it, so the band adds "Nothing was sent." */
  nothingSent?: boolean;
}

/** The sentence for words that do not fit: the same one under the field and in a refusal. */
export function problemOfWeight(weighed: Weighed): Problem | undefined {
  switch (weighed.over) {
    case "title":
      return { id: "raise.what.tooLong", values: { n: String(weighed.title), max: String(MAX_TITLE) } };
    case "details":
      return { id: "raise.details.tooLong", values: { n: String(weighed.details), max: String(MAX_DETAILS) } };
    case "address":
      return { id: "raise.who.tooLong" };
    default:
      return undefined;
  }
}

export interface Up {
  record: RaiseRecord;
  raised: Raised;
  /** The link, when this tab holds the seed (or the locked copy opened); undefined until rebuilt. */
  written?: Written;
  /** The seed waits in the locked copy until the raiser ticks "I saved the link". */
  locked: boolean;
}

export type Outcome = { ok: true; up: Up } | { ok: false; problem: Problem };

/* ───────────────────────────────────────── the keys, in memory only ── */

type KeysVerdict = { ok: true; master?: Hex } | { ok: false; problem: Problem };

/**
 * The keys confirmation, through `store/keys.ts` (the one module /my uses too). Already given in
 * this tab: its master, without asking. An account this device knows answers differently each
 * time: no master and no question, its seeds are made fresh. Otherwise the screen says what is
 * asked (`confirmKeys`, twice the first time), then the account is asked.
 */
async function keysOf(ctx: RaiseContext, ports: Pick<Ports, "raiser" | "confirmKeys" | "signKeys" | "onStep">): Promise<KeysVerdict> {
  const { raiser } = ports;
  const known = unlockedFor(ctx.chainId, ctx.core, raiser);
  if (known) return { ok: true, ...(known.master ? { master: known.master } : {}) };
  const repeats = await repeatsOnDevice(raiser);
  if (repeats === false) return { ok: true };
  if (!(await ports.confirmKeys(repeats === undefined))) return { ok: false, problem: { id: "common.error.refused" } };
  ports.onStep("keys", 0);
  const outcome = await unlock(ctx.chainId, ctx.core, raiser, ports.signKeys);
  if (!outcome.ok) return { ok: false, problem: { id: outcome.reason === "rejected" ? "common.error.refused" : "common.error.unknown" } };
  return { ok: true, ...(outcome.unlocked.master ? { master: outcome.unlocked.master } : {}) };
}

/* ────────────────────────────────────── root keys this device used ── */

/**
 * Every root key this device's list stands for: read from `hands(id)` for raised Hands of this
 * Core, derived for this raiser's other numbers when the master is in memory.
 */
async function knownRootKeys(ctx: RaiseContext, raiser: Address, master: Hex | undefined): Promise<Address[]> {
  const records = await all("hands");
  const keys = await Promise.all(
    records.map(async (record): Promise<Address | undefined> => {
      if (record.handId && record.chainId === ctx.chainId && record.core.toLowerCase() === ctx.core.toLowerCase()) {
        const { view } = await readHand(ctx.client, ctx.core, BigInt(record.handId));
        return view.rootKey;
      }
      if (master && record.raiser === raiser.toLowerCase()) return rootKeyOf(master, record.book, record.n);
      return undefined;
    }),
  );
  return keys.filter((key): key is Address => key !== undefined);
}

/* ───────────────────────────────────────────────────── the raise ── */

function newIntent(): string {
  return crypto.randomUUID();
}

/**
 * A refusal or a failure before the raise was handed to the wallet: nothing is kept but the spent
 * number. Never called once the wallet gave back a hash or a batch id.
 */
async function forget(record: HandRecord): Promise<void> {
  await dropSeed(record.intent).catch(() => undefined);
  await remove("hands", record.intent).catch(() => undefined);
}

function problemOfRefusal(refusal: CoreRefusal | undefined): Problem {
  if (!refusal) return { id: "common.error.unknown" };
  const id = messageIdOf(refusal);
  return { id, code: refusal.name };
}

export async function raise(draft: Draft, ctx: RaiseContext, ports: Ports): Promise<Outcome> {
  const { client, core, token } = ctx;
  const { raiser } = ports;

  // 0. The words fit: the title and the details in their caps, and what the address shows before
  // `#` short enough for a server to take. Checked here too, whatever the screen let through.
  const tooMuch = problemOfWeight(weigh(draft, { site: ctx.site, chainId: ctx.chainId, core, options: ctx.options }));
  if (tooMuch) return { ok: false, problem: { ...tooMuch, nothingSent: true } };

  // 1. The money is there: the reward in the token and something to pay the cost with.
  let balance: bigint, allowance: bigint, eth: bigint;
  try {
    [balance, allowance, eth] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [raiser] }),
      client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [raiser, core] }),
      client.getBalance({ address: raiser }),
    ]);
  } catch {
    return { ok: false, problem: { id: "common.error.offline" } };
  }
  if (balance < draft.reward || eth === 0n) return { ok: false, problem: { id: "raise.error.short", amount: draft.reward } };

  // 2. The keys confirmation.
  let keys: KeysVerdict;
  try {
    keys = await keysOf(ctx, ports);
  } catch {
    return { ok: false, problem: { id: "raise.error.storage" } };
  }
  if (!keys.ok) return keys;

  // 3. The Hand number, reserved before anything is derived; never given back.
  let book: Hex, n: number;
  try {
    ({ book, n } = await reserveNumber(raiser));
  } catch {
    return { ok: false, problem: { id: "raise.error.storage" } };
  }

  // 4. The root seed and the inbox secret.
  const locked = keys.master === undefined;
  const seed = keys.master ? await rootSeed(keys.master, book, n) : newSeed();
  const secret = keys.master ? await inboxSecret(keys.master, book, n) : generatePrivateKey();
  const rootKey = privateKeyToAddress(keyOfSeed(seed));

  // 5. New on this device.
  try {
    assertNewRoot(rootKey, await knownRootKeys(ctx, raiser, keys.master));
  } catch (error) {
    return { ok: false, problem: { id: error instanceof Error && /link key/.test(error.message) ? "raise.error.reused" : "common.error.offline" } };
  }

  // 6. The description, with a fresh salt for unlisted and dark and the Hand's inbox.
  const title = normalizeText(draft.title);
  const content = draft.content.trim() ? normalizeText(draft.content) : undefined;
  const described = describeHand({ mode: draft.mode, title, ...(content ? { content } : {}), inbox: inboxKeyOf(secret) });

  // 7. The intent, kept before anything is sent; for a signer that does not repeat, the locked copy too.
  let record: RaiseRecord = {
    intent: newIntent(),
    raiser: raiser.toLowerCase(),
    chainId: ctx.chainId,
    core: core.toLowerCase(),
    book,
    n,
    mode: draft.mode,
    title,
    ...(content ? { content } : {}),
    ...(described.salt ? { salt: described.salt } : {}),
    ...(locked ? { inboxSecret: secret } : {}),
    status: "intent",
  };
  try {
    await put("hands", record);
    if (locked) await lockSeed(record.intent, seed);
  } catch {
    await forget(record);
    return { ok: false, problem: { id: "raise.error.storage" } };
  }

  // 8. The calls: approve when needed, then raise, with the expiry by the network's clock.
  let now: { timestamp: number };
  try {
    now = await chainNow(client);
  } catch {
    await forget(record);
    return { ok: false, problem: { id: "common.error.offline" } };
  }
  // The locked copy carries the chain's time, so the sweep (sweep.ts) can bound its life.
  if (locked) await stampSeed(record.intent, "lockedAt", now.timestamp).catch(() => undefined);
  const expiry = expiryFor(now.timestamp, draft.days, ctx.maxExpiryPeriod);
  const calls: Call[] = [];
  if (draft.reward > 0n && allowance < draft.reward) calls.push(approveCall(token, core, draft.reward));
  calls.push(
    raiseCall(core, { token, reward: draft.reward, expiry, rootKey, payoutGasK: draft.payoutGasK, minClaimBps: draft.minClaimBps, dataHash: described.dataHash }),
  );
  ports.onStep(calls.length > 1 ? "allow" : "raise", calls.length);

  // The raise itself is in the wallet's hands: it gave back the raise's hash, or the id of the batch
  // that carries it. From here on the record and the locked copy stay until the chain answers.
  let handed = false;
  const result = await ports.send(calls, {
    onIntent: async (intent) => {
      if (intent.kind === "tx" && intent.step < intent.of - 1) {
        ports.onStep("raise", intent.of);
        return;
      }
      handed = true;
      // One batch is one step on screen, whatever it carries.
      if (intent.kind === "batch") ports.onStep("raise", 1);
      record = { ...record, status: "sent", ...(intent.kind === "batch" ? { batchId: intent.id } : {}), ...(intent.hash ? { txHash: intent.hash } : {}) };
      // Kept before anything is waited for. If the device refuses the write now, this tab still
      // follows the raise to its receipt; only a reload would lose sight of it.
      await put("hands", record).catch(() => undefined);
      ports.onSent(record);
    },
  });

  if (!result.ok) {
    if (handed) {
      // Only a receipt that says "reverted" ends a raise that left; a stop, a lost connection or the
      // wallet's own word that a batch failed do not: the record waits and a reload looks again.
      if (result.reason !== "reverted") return { ok: false, problem: { id: "raise.error.lostSight", pending: true } };
      record = { ...record, status: "reverted" };
      await put("hands", record).catch(() => undefined);
      await dropSeed(record.intent).catch(() => undefined);
      return { ok: false, problem: { ...problemOfRefusal(result.refusal), id: result.refusal ? messageIdOf(result.refusal) : "raise.error.reverted" } };
    }
    await forget(record);
    switch (result.reason) {
      case "refused":
        return { ok: false, problem: problemOfRefusal(result.refusal) };
      case "rejected":
        return { ok: false, problem: { id: "common.error.refused" } };
      case "cannot-send":
        return { ok: false, problem: { id: "raise.error.cannotSend" } };
      case "offline":
        return { ok: false, problem: { id: "common.error.offline" } };
      case "failed-check":
        return { ok: false, problem: { id: "raise.error.short", amount: draft.reward, code: result.message } };
      default:
        return { ok: false, problem: { id: "common.error.unknown", ...("message" in result ? { code: result.message } : {}) } };
    }
  }

  return landed(record, result.receipt, ctx, { seed, described });
}

/** The receipt is in: the Hand from its own `Raised` log, checked against what was sent, and its link. */
async function landed(
  sent: RaiseRecord,
  receipt: { logs: Parameters<typeof raisedIn>[0]["logs"] },
  ctx: RaiseContext,
  made: { seed: Hex; described: Described } | undefined,
): Promise<Outcome> {
  const rootKey = made ? privateKeyToAddress(keyOfSeed(made.seed)) : undefined;
  // A batch may land beside other accounts' calls in one transaction: the Hand is this raiser's own.
  const raised = raisedIn(receipt, ctx.core, { raiser: sent.raiser as Address, ...(rootKey ? { rootKey } : {}) });
  if (made && rootKey) {
    if (!isAddressEqual(raised.hand.rootKey, rootKey) || raised.hand.dataHash !== made.described.dataHash) {
      return { ok: false, problem: { id: "raise.error.otherTerms" } };
    }
  }
  const record: RaiseRecord = { ...sent, status: "up", handId: raised.hand.handId.toString(), hand: handKey(ctx.chainId, ctx.core, raised.hand.handId) };
  await put("hands", record).catch(() => undefined);
  const locked = record.inboxSecret !== undefined;
  const written = made ? await writeLinks({ site: ctx.site, chainId: ctx.chainId, core: ctx.core, hand: raised.hand, seed: made.seed, described: made.described, options: ctx.options }) : undefined;
  return { ok: true, up: { record, raised, ...(written ? { written } : {}), locked } };
}

/* ─────────────────────────────────────────── after a reload ── */

/** Raises this device kept that are still on their way, or up and waiting for "I saved the link". */
export async function unfinished(ctx: RaiseContext): Promise<RaiseRecord | undefined> {
  const records: RaiseRecord[] = await all("hands");
  const here = records.filter((record) => record.chainId === ctx.chainId && record.core === ctx.core.toLowerCase());
  const sent = here.find((record) => record.status === "sent" && (record.txHash || record.batchId));
  if (sent) return sent;
  for (const record of here) {
    if (record.status === "up" && record.inboxSecret !== undefined && (await openSeed(record.intent))) return record;
  }
  return undefined;
}

/** The description again, from what the device kept: the same salt and inbox give the same dataHash. */
function describedAgain(record: HandRecord, secret: Hex): Described {
  return describeHand({
    mode: record.mode,
    title: record.title,
    ...(record.content ? { content: record.content } : {}),
    ...(record.salt ? { salt: record.salt } : {}),
    inbox: inboxKeyOf(secret),
  });
}

/** Watches a kept intent and sends nothing (`useSend().resume`); a batch's hash, once the wallet names it, comes through `onIntent`. */
export type Follow = (intent: Intent, options: { onIntent: (intent: Intent) => Promise<void> }) => Promise<SendResult>;

/**
 * A pending raise found after a reload: its receipt is followed by the stored hash, nothing is sent.
 * A batch whose hash was not known yet is asked for by its id, from the wallet that holds it: that
 * needs the raiser's account connected (`connected`), and nothing of a wallet survives a reload, so
 * the first answer is usually "connect it". The link comes back from the locked copy, or, for an
 * account that repeats, after one confirmation (`rebuild`).
 */
export async function resumeRaise(record: RaiseRecord, ctx: RaiseContext, follow: Follow, connected: Address | undefined): Promise<Outcome> {
  if (record.status === "up" && record.handId) {
    const { view, hand } = await readHand(ctx.client, ctx.core, BigInt(record.handId));
    return fromLockedCopy(record, { hand, reward: view.reward, expiry: view.expiry }, ctx);
  }
  let intent: Intent;
  if (record.txHash) intent = { kind: "tx", chainId: ctx.chainId, hash: record.txHash, step: 0, of: 1 };
  else if (record.batchId) {
    if (!connected) return { ok: false, problem: { id: "raise.error.connectToLook", pending: true, connect: true } };
    if (connected.toLowerCase() !== record.raiser) {
      return { ok: false, problem: { id: "raise.error.otherAccount", pending: true, connect: true, code: getAddress(record.raiser) } };
    }
    intent = { kind: "batch", chainId: ctx.chainId, id: record.batchId, of: 1 };
  } else return { ok: false, problem: { id: "common.error.unknown" } };

  let kept = record;
  const result = await follow(intent, {
    onIntent: async (found) => {
      if (!found.hash || kept.txHash) return;
      kept = { ...kept, txHash: found.hash };
      await put("hands", kept).catch(() => undefined);
    },
  });
  if (!result.ok) {
    if (result.reason === "reverted") {
      await put("hands", { ...kept, status: "reverted" }).catch(() => undefined);
      await dropSeed(kept.intent).catch(() => undefined);
      return { ok: false, problem: { id: "raise.error.reverted" } };
    }
    if (result.reason === "needs-wallet") return { ok: false, problem: { id: "raise.error.connectToLook", pending: true, connect: true } };
    return { ok: false, problem: { id: "raise.error.lostSight", pending: true } };
  }
  const up = await landed(kept, result.receipt, ctx, undefined);
  if (!up.ok || kept.inboxSecret === undefined) return up;
  return fromLockedCopy(up.up.record, up.up.raised, ctx);
}

async function fromLockedCopy(record: RaiseRecord, raised: Raised, ctx: RaiseContext): Promise<Outcome> {
  const seed = await openSeed(record.intent);
  if (!seed || record.inboxSecret === undefined) return { ok: false, problem: { id: "raise.error.copyLost" } };
  const described = describedAgain(record, record.inboxSecret);
  if (described.dataHash !== raised.hand.dataHash || !isAddressEqual(privateKeyToAddress(keyOfSeed(seed)), raised.hand.rootKey)) {
    return { ok: false, problem: { id: "raise.error.otherTerms" } };
  }
  const written = await writeLinks({ site: ctx.site, chainId: ctx.chainId, core: ctx.core, hand: raised.hand, seed, described, options: ctx.options });
  return { ok: true, up: { record, raised, written, locked: true } };
}

/** For an account that repeats: the link of a raised Hand, rebuilt after one keys confirmation. */
export async function rebuild(up: Up, ctx: RaiseContext, ports: Pick<Ports, "raiser" | "confirmKeys" | "signKeys" | "onStep">): Promise<Outcome> {
  const keys = await keysOf(ctx, ports);
  if (!keys.ok) return keys;
  if (!keys.master) return { ok: false, problem: { id: "raise.error.copyLost" } };
  const { record, raised } = up;
  const seed = await rootSeed(keys.master, record.book, record.n);
  const described = describedAgain(record, await inboxSecret(keys.master, record.book, record.n));
  if (described.dataHash !== raised.hand.dataHash || !isAddressEqual(privateKeyToAddress(keyOfSeed(seed)), raised.hand.rootKey)) {
    return { ok: false, problem: { id: "raise.error.otherTerms" } };
  }
  const written = await writeLinks({ site: ctx.site, chainId: ctx.chainId, core: ctx.core, hand: raised.hand, seed, described, options: ctx.options });
  return { ok: true, up: { ...up, written } };
}

/** "I saved the link": the locked copy is deleted. */
export async function saved(record: HandRecord): Promise<void> {
  await dropSeed(record.intent);
}
