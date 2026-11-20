import {
  approveCall,
  chainNow,
  DescriptionTooLarge,
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
import { repeatsOnDevice, unlock, unlockedFor, type KeysTyped, type UnlockOutcome } from "../../store/keys";
import { approvalProbe, raisedProbe } from "../../wallet/effects";
import type { Intent, Probe, SendResult, StepInfo, TypedOutcome } from "../../wallet";
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
 * `useSend`, which tries the calls first; the raise's nonce kept before the wallet is asked, and its
 * hash, or the id of the batch that carries it, before waiting. From that moment the record is
 * never deleted here: only the chain's own answer ends it (a receipt, or its nonce gone to another
 * transaction with no `Raised` of its own). On the receipt: the Hand from its own `Raised` log, the
 * first link in the mode's shape.
 *
 * A raise whose wallet answer is lost, whose hash is replaced (a speed-up) or dropped is never
 * forgotten and never sent again: its record keeps the account, the nonce, the block, the root
 * key and the dataHash, and `resumeRaise` settles it by the nonce and the raise's own `Raised` log
 * (FINDINGS E-1, E-2). Found: it lands and its link is shown. Not found once the nonce moved on:
 * the record is marked dropped, the locked copy goes, and the form is free again.
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
  /** The account the wallet has connected now: a change stops the raise before the next send (W-5). */
  account(): Promise<Address | undefined>;
  /** Shows the keys card and waits: true when the person confirms it, false when they step back. */
  confirmKeys(twice: boolean): Promise<boolean>;
  /** The keys message, through the wallet's typed-data confirmation. */
  signKeys(typedData: KeysTyped): Promise<TypedOutcome>;
  send(
    calls: readonly Call[],
    options: { onIntent: (intent: Intent) => Promise<void>; steps: readonly StepInfo[]; between: (step: number, of: number) => Promise<boolean> },
  ): Promise<SendResult>;
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
  /** Values for the sentence besides `amount` (counts and caps, account addresses, sizes). */
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

/** A failure may hand back the record still on its way, for the screen to settle (`resumeRaise`). */
export type Outcome = { ok: true; up: Up } | { ok: false; problem: Problem; record?: HandRecord };

/* ───────────────────────────────────────── the keys, in memory only ── */

type KeysVerdict = { ok: true; master?: Hex } | { ok: false; problem: Problem };

/** A keys confirmation that did not come: refused, on another network (W-4), or failed. */
function typedProblem(outcome: Extract<TypedOutcome | UnlockOutcome, { ok: false }>): Problem {
  if (outcome.reason === "rejected") return { id: "common.error.refused" };
  if (outcome.reason === "wrong-network") return { id: "common.error.wrongNetwork" };
  return { id: "common.error.unknown" };
}

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
  if (!outcome.ok) return { ok: false, problem: typedProblem(outcome) };
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

/** Nothing from this raise left the account: the record says so, and the locked copy goes (D-63, §5 "lasts minutes"). */
async function markDropped(record: HandRecord): Promise<HandRecord> {
  const dropped: HandRecord = { ...record, status: "dropped" };
  await put("hands", dropped).catch(() => undefined);
  await dropSeed(record.intent).catch(() => undefined);
  return dropped;
}

/** The probe of a raise's own effect: a `Raised` by this raiser with this root key and dataHash. */
export function probeOf(record: HandRecord): Probe | undefined {
  return record.rootKey && record.dataHash ? raisedProbe(record.core as Address, { rootKey: record.rootKey, dataHash: record.dataHash }) : undefined;
}

/** The send intent a record stands for: its hash when known, and the nonce to settle it without one. */
export function intentOf(record: HandRecord): Intent | undefined {
  if (!record.txHash && (record.from === undefined || record.nonce === undefined)) return undefined;
  return {
    kind: "tx",
    chainId: record.chainId,
    step: 0,
    of: 1,
    action: "raise",
    ...(record.txHash ? { hash: record.txHash } : {}),
    ...(record.from !== undefined ? { from: record.from } : {}),
    ...(record.nonce !== undefined ? { nonce: record.nonce } : {}),
    ...(record.fromBlock !== undefined ? { fromBlock: record.fromBlock } : {}),
  };
}

/** A short form of an account for a sentence. */
function short(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
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
  let described: Described;
  try {
    described = describeHand({ mode: draft.mode, title, ...(content ? { content } : {}), inbox: inboxKeyOf(secret) });
  } catch (error) {
    if (error instanceof DescriptionTooLarge) return { ok: false, problem: { id: "raise.error.tooLarge", values: { bytes: String(error.bytes), max: String(error.max) } } };
    throw error;
  }

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
    rootKey,
    dataHash: described.dataHash,
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
  const steps: StepInfo[] = [];
  if (draft.reward > 0n && allowance < draft.reward) {
    calls.push(approveCall(token, core, draft.reward));
    steps.push({ action: "approve", probe: approvalProbe(token, core) });
  }
  calls.push(
    raiseCall(core, { token, reward: draft.reward, expiry, rootKey, payoutGasK: draft.payoutGasK, minClaimBps: draft.minClaimBps, dataHash: described.dataHash }),
  );
  steps.push({ action: "raise", probe: raisedProbe(core, { rootKey, dataHash: described.dataHash }) });
  const twoSteps = calls.length > 1;

  // W-5: the account that answers must still be the raiser, before each send.
  let changedTo: Address | undefined;
  const sameAccount = async (): Promise<boolean> => {
    const now = await ports.account().catch(() => undefined);
    if (now && !isAddressEqual(now, raiser)) {
      changedTo = now;
      return false;
    }
    return true;
  };
  if (!(await sameAccount())) {
    await forget(record);
    return { ok: false, problem: { id: "raise.error.accountChanged", values: { was: short(raiser), now: short(changedTo!) } } };
  }
  ports.onStep(twoSteps ? "allow" : "raise", calls.length);

  // The raise itself is in the wallet's hands: it gave back the raise's hash, or the id of the batch
  // that carries it. From here on the record and the locked copy stay until the chain answers.
  let handed = false;
  const result = await ports.send(calls, {
    steps,
    between: () => sameAccount(),
    onIntent: async (intent) => {
      const last = intent.kind === "batch" || intent.step === intent.of - 1;
      if (!last) {
        if (intent.hash) ports.onStep("raise", intent.of);
        return;
      }
      const batchId = intent.kind === "batch" ? intent.id : undefined;
      if (!intent.hash && !batchId) {
        // The wallet is about to be asked for the raise: from here a reload settles it by its nonce.
        record = {
          ...record,
          status: "asked",
          ...(intent.from ? { from: intent.from } : {}),
          ...(intent.nonce !== undefined ? { nonce: intent.nonce } : {}),
          ...(intent.fromBlock !== undefined ? { fromBlock: intent.fromBlock } : {}),
        };
        await put("hands", record);
        return;
      }
      // One batch is one step on screen, whatever it carries.
      if (intent.kind === "batch" && !handed) ports.onStep("raise", 1);
      handed = true;
      record = { ...record, status: "sent", ...(batchId ? { batchId } : {}), ...(intent.hash ? { txHash: intent.hash } : {}) };
      // Kept before anything is waited for. If the device refuses the write now, this tab still
      // follows the raise to its receipt; only a reload would lose sight of it.
      await put("hands", record).catch(() => undefined);
      ports.onSent(record);
    },
  });

  if (!result.ok) {
    // Whether the raise itself may have left: the wallet gave back its hash or its batch's id, or
    // its answer is not known. Only the chain's own answer ends such a raise: a receipt that says
    // "reverted", or its nonce gone to another transaction with no `Raised` of its own ("dropped").
    // A stop, a lost connection or the wallet's own word that a batch failed do not: the record
    // waits and a reload looks again.
    const raiseLeft =
      handed ||
      record.status === "sent" ||
      (record.status === "asked" && (result.reason === "unknown" || result.reason === "stopped" || result.reason === "dropped" || result.reason === "reverted"));
    if (raiseLeft) {
      if (result.reason === "reverted") {
        record = { ...record, status: "reverted" };
        await put("hands", record).catch(() => undefined);
        await dropSeed(record.intent).catch(() => undefined);
        return { ok: false, problem: { ...problemOfRefusal(result.refusal), id: result.refusal ? messageIdOf(result.refusal) : "raise.error.reverted" } };
      }
      if (result.reason === "dropped") {
        await markDropped(record);
        return { ok: false, problem: { id: "raise.error.dropped" } };
      }
      if (result.reason === "unknown") return { ok: false, problem: { id: "raise.error.unknown", pending: true }, record };
      return { ok: false, problem: { id: "raise.error.lostSight", pending: true }, record };
    }
    await forget(record);
    // W-3: the permission step went (its hash is in `sent`) and the raise did not.
    const allowSent = twoSteps && result.sent.length > 0;
    if (changedTo) {
      const values = { was: short(raiser), now: short(changedTo) };
      return { ok: false, problem: { id: allowSent ? "raise.error.accountChangedAllow" : "raise.error.accountChanged", values } };
    }
    if (twoSteps && result.step === 0 && (result.reason === "unknown" || result.reason === "dropped")) {
      return { ok: false, problem: { id: result.reason === "unknown" ? "raise.error.allowUnknown" : "raise.error.allowDropped" } };
    }
    if (allowSent) {
      const code = result.reason === "refused" ? result.refusal.name : result.reason.toUpperCase();
      return { ok: false, problem: { id: "raise.error.allowSent", code } };
    }
    switch (result.reason) {
      case "refused":
        return { ok: false, problem: problemOfRefusal(result.refusal) };
      case "rejected":
        return { ok: false, problem: { id: "common.error.refused" } };
      case "cannot-send":
        return { ok: false, problem: { id: "raise.error.cannotSend" } };
      case "offline":
        return { ok: false, problem: { id: "common.error.offline" } };
      case "wrong-network":
        return { ok: false, problem: { id: "common.error.wrongNetwork" } };
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
  receipt: { logs: Parameters<typeof raisedIn>[0]["logs"]; transactionHash?: Hex },
  ctx: RaiseContext,
  made: { seed: Hex; described: Described } | undefined,
): Promise<Outcome> {
  // After a reload the seed may be locked away, but the record keeps the root key it was sent with.
  const rootKey = made ? privateKeyToAddress(keyOfSeed(made.seed)) : (sent.rootKey as Address | undefined);
  // A batch may land beside other accounts' calls in one transaction: the Hand is this raiser's own.
  const raised = raisedIn(receipt, ctx.core, { raiser: sent.raiser as Address, ...(rootKey ? { rootKey } : {}) });
  if (made && rootKey) {
    if (!isAddressEqual(raised.hand.rootKey, rootKey) || raised.hand.dataHash !== made.described.dataHash) {
      return { ok: false, problem: { id: "raise.error.otherTerms" } };
    }
  }
  const txHash = (receipt as { transactionHash?: Hex }).transactionHash;
  const record: RaiseRecord = {
    ...sent,
    status: "up",
    handId: raised.hand.handId.toString(),
    hand: handKey(ctx.chainId, ctx.core, raised.hand.handId),
    ...(txHash ? { txHash } : {}),
  };
  await put("hands", record).catch(() => undefined);
  const locked = record.inboxSecret !== undefined;
  const written = made ? await writeLinks({ site: ctx.site, chainId: ctx.chainId, core: ctx.core, hand: raised.hand, seed: made.seed, described: made.described, options: ctx.options }) : undefined;
  return { ok: true, up: { record, raised, ...(written ? { written } : {}), locked } };
}

/* ─────────────────────────────────────────── after a reload ── */

/** Whether a record stands for a raise that may be on its way: sent with a hash or a batch id, or asked with a nonce. */
export function onItsWay(record: HandRecord): boolean {
  return (record.status === "sent" && (record.txHash !== undefined || record.batchId !== undefined)) || (record.status === "asked" && record.nonce !== undefined);
}

/** Raises this tab stopped waiting for ("Stop waiting"): hidden from /raise until this tab checks again. */
const notWaited = new Set<string>();

/** "Stop waiting": sends nothing, cancels nothing; /raise opens on the form until a reload checks again. */
export function stopWaiting(record: HandRecord): void {
  notWaited.add(record.intent);
}

/** Raises this device kept that are still on their way, or up and waiting for "I saved the link". */
export async function unfinished(ctx: RaiseContext): Promise<RaiseRecord | undefined> {
  const records: RaiseRecord[] = await all("hands");
  const here = records.filter((record) => record.chainId === ctx.chainId && record.core === ctx.core.toLowerCase());
  const sent = here.find((record) => onItsWay(record) && !notWaited.has(record.intent));
  if (sent) return sent;
  for (const record of here) {
    if (record.status === "up" && record.inboxSecret !== undefined && (await openSeed(record.intent))) return record;
  }
  return undefined;
}

/** The last raise of this device found dropped that /raise has not yet been past: said once more on opening. */
export async function lastDropped(ctx: RaiseContext): Promise<HandRecord | undefined> {
  const records = await all("hands");
  return records
    .filter((record) => record.chainId === ctx.chainId && record.core === ctx.core.toLowerCase() && record.status === "dropped" && !record.droppedSeen)
    .sort((a, b) => (b.fromBlock ?? 0) - (a.fromBlock ?? 0))[0];
}

/** A new raise begins: the dropped ones are no longer news. */
export async function droppedSeen(ctx: RaiseContext): Promise<void> {
  const records = await all("hands");
  for (const record of records) {
    if (record.chainId === ctx.chainId && record.core === ctx.core.toLowerCase() && record.status === "dropped" && !record.droppedSeen) await put("hands", { ...record, droppedSeen: true });
  }
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
export type Follow = (intent: Intent, options: { onIntent: (intent: Intent) => Promise<void>; probe?: Probe }) => Promise<SendResult>;

/**
 * A pending raise found after a reload, or one whose answer was unknown: followed by its stored
 * hash, or settled by its nonce and its own `Raised` log, and never sent again. A batch whose hash
 * was not known yet is asked for by its id, from the wallet that holds it: that needs the raiser's
 * account connected (`connected`), and nothing of a wallet survives a reload, so the first answer
 * is usually "connect it". Landed (under its hash or a replacement's): the link comes back from
 * the locked copy, or, for an account that repeats, after one confirmation (`rebuild`). Dropped:
 * the record says so, the locked copy goes, and /raise is free again.
 */
export async function resumeRaise(record: RaiseRecord, ctx: RaiseContext, follow: Follow, connected?: Address): Promise<Outcome> {
  if (record.status === "up" && record.handId) {
    const { view, hand } = await readHand(ctx.client, ctx.core, BigInt(record.handId));
    return fromLockedCopy(record, { hand, reward: view.reward, expiry: view.expiry }, ctx);
  }
  let intent: Intent | undefined;
  if (!record.txHash && record.batchId) {
    if (!connected) return { ok: false, problem: { id: "raise.error.connectToLook", pending: true, connect: true } };
    if (connected.toLowerCase() !== record.raiser) {
      return { ok: false, problem: { id: "raise.error.otherAccount", pending: true, connect: true, code: getAddress(record.raiser) } };
    }
    intent = { kind: "batch", chainId: ctx.chainId, id: record.batchId, of: 1, action: "raise" };
  } else intent = intentOf(record);
  if (!intent) return { ok: false, problem: { id: "common.error.unknown" } };

  let kept = record;
  const probe = probeOf(record);
  const result = await follow(intent, {
    onIntent: async (found) => {
      if (!found.hash || kept.txHash) return;
      kept = { ...kept, txHash: found.hash };
      await put("hands", kept).catch(() => undefined);
    },
    ...(probe ? { probe } : {}),
  });
  if (!result.ok) {
    if (result.reason === "reverted") {
      await put("hands", { ...kept, status: "reverted" }).catch(() => undefined);
      await dropSeed(kept.intent).catch(() => undefined);
      return { ok: false, problem: { id: "raise.error.reverted" } };
    }
    if (result.reason === "needs-wallet") return { ok: false, problem: { id: "raise.error.connectToLook", pending: true, connect: true } };
    if (result.reason === "dropped") {
      await markDropped(kept);
      return { ok: false, problem: { id: "raise.error.dropped" } };
    }
    return { ok: false, problem: { id: "raise.error.lostSight", pending: true }, record: kept };
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
