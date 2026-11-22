import {
  bytesToHex,
  decodeFunctionData,
  getAddress,
  hexToBytes,
  isAddressEqual,
  recoverAddress,
  size,
  toFunctionSelector,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { z } from "zod";

import { handLogs, handLogsAt, handLogsInBlock, logWindowsOver, type HandEventName, type HandLog, type CoreHand } from "./chain.js";
import { CANONICAL_CORE_BUILD, coreAddressOf, type CoreBuild } from "./canonical.js";
import { readDescription } from "./describe.js";
import { LONGEST_ROUTE, TX_BYTES_LIMIT } from "./gas.js";
import { CoreRefused } from "./errors.js";
import { digest, domainSeparator, giveHash, routeHash, shakeHash } from "./hash.js";
import { mayCarrySecret, openLink, type OpenedLink } from "./link.js";
import { CORE_ABI, innerGiverSig } from "./tx.js";
import { BPS, domain, type Give, type Hand, type Shake, type SignedGive, type SignedShake } from "./types.js";
import { isKeySignature, signedBy } from "./verify.js";

/**
 * The Hand passport, every fact of a Hand proven, in two steps, so that a saved record can be
 * checked again with no network:
 *
 *   collectRecord(client, core, handId)  reads views, logs and the thank's input once  → HandRecord
 *   passportOf(record, options)          proves every fact from that record alone,      → Check[]
 *                                        against the Core the reader trusts
 *
 * It proves from events and views first: `Shaken` and `Given` carry every field of each
 * Shake and of the Give, so the route hash and the Give's hash are rebuilt with the `Raised` terms
 * and compared with `thanks(id).giveHash`. That holds whatever wallet sent the thank. Signatures
 * are an extra: they are recovered from the thank transaction's input when `thankInputOf` finds
 * the call there (at any offset, accepted only if it hashes to the stored giveHash), or from a
 * give link whose Give hashes the same; otherwise they read "not-checkable", never "failed".
 *
 * Nothing here reads a clock. `passportOf` is async only because signature recovery is.
 */

/**
 * Facts of what the site served, kept with a record for whoever reads it. Nothing here is trusted
 * about Core: which Core is trusted is the reader's (`ProofOptions.coreBuild`), never the file's.
 */
export interface BuildFacts {
  commit?: string;
  dirty?: boolean;
  /** sha256 of the build's files, from build.json. */
  buildHash?: Hex;
}

/**
 * The blocks between the raise and the closing (or the record's block), where only `Funded` and
 * `Extended` can lie. Present only when `hands(id)` shows a reward or an expiry other than
 * `Raised`'s; its `requests` are known before any is made, so a screen can ask first.
 */
export interface Between {
  fromBlock: bigint;
  toBlock: bigint;
  /**
   * `eth_getLogs` requests reading it takes, in the client's window (at most 2 000 blocks). A node
   * that refuses that window makes it more: the window then shrinks (`readLogWindows`).
   */
  requests: number;
  read: boolean;
}

/** Everything the passport needs, collected once, so a saved record can be checked offline. */
export interface HandRecord {
  chainId: number;
  core: Address;
  handId: bigint;
  /** The block the views were read at. */
  block: bigint;
  coreHand: CoreHand;
  /** `thanks(id)` at `block`; zero hashes for a Hand that was not thanked. */
  thank: { giveHash: Hex; dataHash: Hex };
  /** The Hand's logs read where they must be: the raise's second, the closing's, and `between` if read. */
  logs: HandLog[];
  between?: Between;
  /** `pending(token, payee)` at `block` for each payee of the closing. */
  pending: { token: Address; payee: Address; amount: bigint }[];
  /** Whether Core's address held code at `block`. */
  coreHasCode: boolean;
  /** Whether the Give's signer held code at `block` (an account), when the Hand was thanked. */
  giverHasCode?: boolean;
  /** The closing transaction (thank or refund). */
  closingTx?: Hex;
  /** The thank transaction's input. */
  thankInput?: Hex;
  /** A give link of this Hand, and the public part of its address (`d`), which travelled outside the link. */
  giveLink?: Uint8Array;
  publicPart?: Uint8Array;
  build?: BuildFacts;
}

export type CheckSource =
  | { event: string; block: bigint; tx: Hex; logIndex: number }
  | { view: string; block: bigint }
  | "computed here";

/** What a saved file alone can prove about a check: see `passportOf`'s `basisOf`. */
export type CheckBasis = "computed" | "recorded";

/**
 * A check's verdict. `true`/`false`: it holds or fails. "not-checkable": what it needs is not
 * here. "recorded": it holds within a saved file, but its events or views were not re-read from
 * the chain (`verifyBundle` with no network); it is never counted as holding.
 */
export type CheckVerdict = boolean | "not-checkable" | "recorded";

export interface Check {
  /** Stable id: `core`, `raised`, `reward-time`, `description`, `route.<i>`, `keys.<i>`, … (see `passportOf`). */
  id: string;
  /** The i18n key of the check's sentence, such as `proof.route`. */
  messageId: string;
  formula?: string;
  inputs: Record<string, string>;
  expected: string;
  actual: string;
  /** Whether it holds: `true`, `false`, "not-checkable" or "recorded" (`CheckVerdict`). */
  verdict: CheckVerdict;
  source: CheckSource;
  basis: CheckBasis;
}

/** A check as the passport builds it, before its basis is named. */
type Row = Omit<Check, "verdict" | "basis"> & { verdict: boolean | "not-checkable" };

export interface CollectOptions {
  /**
   * A give link of this Hand, or an addressed one: a record is public, so a live link, whose seed
   * is the route's key, is refused.
   */
  giveLink?: Uint8Array;
  /** The public part of the give link's address (`d`), if it had one. */
  publicPart?: Uint8Array;
  build?: BuildFacts;
  /** Read the stretch between at once when it is needed (default: no, the record says what it costs). */
  readBetween?: boolean;
  /** The window that read starts at, at most 2 000 blocks; a node's refusal shrinks it. */
  chunk?: number;
}

/* ---------------------------------------------------------- collectRecord */

/** A record is public: a link that may carry the route's key is never put in one. */
function noSecret(link: Uint8Array): void {
  if (mayCarrySecret(link)) throw new Error("a live link carries the route's key and is never kept in a record: give a give link or an addressed one");
}

const byChainOrder = (a: HandLog, b: HandLog) =>
  a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;

function merged(...lists: HandLog[][]): HandLog[] {
  const seen = new Map<string, HandLog>();
  for (const log of lists.flat()) seen.set(`${log.blockHash}:${log.logIndex}`, log);
  return [...seen.values()].sort(byChainOrder);
}

const find = (logs: HandLog[], name: HandEventName) => logs.find((log) => log.eventName === name);

/**
 * Reads what the passport needs at one block: `hands(id)`, `thanks(id)`, Core's code, the logs in
 * the blocks of the raise and of the closing, `pending` for each payee of the closing, the thank
 * transaction's input, and whether the giver is an account with code. The stretch between is read
 * only with `readBetween`; otherwise `record.between` says how many requests it takes.
 * Throws Core's `NotRaised` for a number no Hand has.
 */
export async function collectRecord(
  client: PublicClient,
  core: Address,
  handId: bigint,
  extra: CollectOptions = {},
): Promise<HandRecord> {
  if (extra.giveLink) noSecret(extra.giveLink);
  const chainId = await client.getChainId();
  const block = await client.getBlockNumber({ cacheTime: 0 });
  const at = { blockNumber: block };
  const [hands, thanks, code] = await Promise.all([
    client.readContract({ address: core, abi: CORE_ABI, functionName: "hands", args: [handId], ...at }),
    client.readContract({ address: core, abi: CORE_ABI, functionName: "thanks", args: [handId], ...at }),
    client.getCode({ address: core, ...at }),
  ]);
  const [raiser, expiry, openedAt, closedAt, token, payoutGasK, minClaimBps, reward, rootKey, dataHash] = hands;
  if (openedAt === 0) throw new CoreRefused({ name: "NotRaised" });
  const coreHand: CoreHand = { handId, raiser, expiry, openedAt, closedAt, token, payoutGasK, minClaimBps, reward, rootKey, dataHash };

  const opening = await handLogsAt(client, core, handId, openedAt);
  const closing = closedAt !== 0 && closedAt !== openedAt ? await handLogsAt(client, core, handId, closedAt) : [];
  let record: HandRecord = {
    chainId,
    core: getAddress(core),
    handId,
    block,
    coreHand,
    thank: { giveHash: thanks[0], dataHash: thanks[1] },
    logs: merged(opening, closing),
    pending: [],
    coreHasCode: code !== undefined && code !== "0x",
  };
  if (extra.giveLink) record.giveLink = extra.giveLink;
  if (extra.publicPart) record.publicPart = extra.publicPart;
  if (extra.build) record.build = extra.build;

  const raised = find(record.logs, "Raised");
  const closer = find(record.logs, "Thanked") ?? find(record.logs, "Refunded");
  if (raised && (raised.args.reward !== reward || raised.args.expiry !== expiry)) {
    const fromBlock = raised.blockNumber + 1n;
    const toBlock = closer ? closer.blockNumber - 1n : block;
    record.between = { fromBlock, toBlock, requests: logWindowsOver(client, fromBlock, toBlock, extra.chunk), read: false };
    if (extra.readBetween) record = await readBetween(client, record, extra.chunk);
  }

  if (closer) {
    record.closingTx = closer.transactionHash;
    const inClosing = record.logs.filter((log) => log.transactionHash === closer.transactionHash);
    const payees = new Map<string, Address>();
    for (const log of inClosing) {
      const payee = log.args.payee as Address | undefined;
      if (payee && !isAddressEqual(payee, zeroAddress)) payees.set(payee.toLowerCase(), payee);
    }
    if (closer.eventName === "Refunded") payees.set(raiser.toLowerCase(), raiser);
    record.pending = await Promise.all(
      [...payees.values()].map(async (payee) => ({
        token,
        payee,
        amount: await client.readContract({ address: core, abi: CORE_ABI, functionName: "pending", args: [token, payee], ...at }),
      })),
    );
    if (closer.eventName === "Thanked") {
      const tx = await client.getTransaction({ hash: closer.transactionHash });
      record.thankInput = tx.input;
      const given = inClosing.find((log) => log.eventName === "Given");
      if (given) {
        const giverCode = await client.getCode({ address: given.args.signer as Address, ...at });
        record.giverHasCode = giverCode !== undefined && giverCode !== "0x";
      }
    }
  }
  return record;
}

/** Reads the stretch between (`record.between`) window by window and returns the record with its logs. */
export async function readBetween(client: PublicClient, record: HandRecord, chunk?: number): Promise<HandRecord> {
  const between = record.between;
  if (!between || between.read) return record;
  const logs =
    between.toBlock >= between.fromBlock
      ? await handLogs(client, record.core, record.handId, { fromBlock: between.fromBlock, toBlock: between.toBlock, chunk })
      : [];
  return { ...record, logs: merged(record.logs, logs), between: { ...between, read: true } };
}

/* -------------------------------------------------------- the thank input */

/** The most places naming this Hand that `thankInputOf` decodes: an honest input has one, a batch a few. */
export const THANK_TRIES = 16;
const THANK_SELECTOR = toFunctionSelector(CORE_ABI.find((item) => item.type === "function" && item.name === "thank")!).slice(2);

/**
 * Finds a `thank` call anywhere in a transaction's input: as the call itself, or inside a wallet's
 * batch, an ERC-4337 operation, a Safe or an `execute(address,uint256,bytes)`. Every place the
 * selector stands is tried; a decoding is accepted only when it names this Hand and its Give hashes
 * to `giveHash`, the hash Core kept, so a false match cannot be taken. Undefined when none fits.
 *
 * Takes the Hand's terms (not only its number), because the Give's hash is over them.
 */
export function thankInputOf(
  txInput: Hex,
  hand: Hand,
  giveHashKept: Hex,
): { signedShakes: SignedShake[]; signedGive: SignedGive } | undefined {
  // Whoever sends the transaction chooses its input: more than one transaction carries is no thank,
  // and only places whose first word is this Hand's number are decoded, at most `THANK_TRIES` of
  // them, so an input full of selectors costs no more than a few decodings.
  if (size(txInput) > TX_BYTES_LIMIT) return undefined;
  const text = txInput.slice(2).toLowerCase();
  const handWord = hand.handId.toString(16).padStart(64, "0");
  let tries = 0;
  for (let at = text.indexOf(THANK_SELECTOR); at >= 0; at = text.indexOf(THANK_SELECTOR, at + 1)) {
    if (at % 2 !== 0) continue; // a selector starts on a whole byte
    if (text.slice(at + 8, at + 72) !== handWord) continue;
    if (++tries > THANK_TRIES) return undefined;
    let decoded;
    try {
      decoded = decodeFunctionData({ abi: CORE_ABI, data: `0x${text.slice(at)}` });
    } catch {
      continue;
    }
    if (decoded.functionName !== "thank") continue;
    const [handId, shakes, signed] = decoded.args;
    if (handId !== hand.handId) continue;
    const signedShakes: SignedShake[] = shakes.map(({ shake, keySig }) => ({ shake: { ...shake }, keySig }));
    const signedGive: SignedGive = { give: { ...signed.give }, keySig: signed.keySig, giverSig: signed.giverSig };
    if (giveHash(hand, signedGive.give).toLowerCase() !== giveHashKept.toLowerCase()) continue;
    return { signedShakes, signedGive };
  }
  return undefined;
}

/* --------------------------------------------------------------- passport */

const text = (value: unknown): string =>
  typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) ? getAddress(value) : String(value);

const sourceOf = (log: HandLog): CheckSource => ({
  event: log.eventName,
  block: log.blockNumber,
  tx: log.transactionHash,
  logIndex: log.logIndex,
});

/** floor(reward × (claim − next) / 10 000): Core's `Math.mulDiv`, exact in bigints. */
export const marginOf = (reward: bigint, claimBps: number, nextClaimBps: number): bigint =>
  (reward * BigInt(claimBps - nextClaimBps)) / BigInt(BPS);

/** The Hand's signed terms, as `hands(id)` keeps them. */
export function handOf(coreHand: CoreHand): Hand {
  const { handId, raiser, token, rootKey, payoutGasK, minClaimBps, dataHash } = coreHand;
  return { handId, raiser, token, rootKey, payoutGasK, minClaimBps, dataHash };
}

/** One row of the closing as the passport reads it: an amount and the payout event that follows it. */
interface Owed {
  log: HandLog;
  payee: Address;
  amount: bigint;
  payout?: HandLog;
}

interface Closing {
  thanked: HandLog;
  shakes: Owed[];
  given?: Owed;
  /** Payout events that follow no amount, or a second one after the same amount. */
  stray: HandLog[];
}

/** The thank's rows in Core's event order, with each payout tied to the amount before it. */
function closingOf(logs: HandLog[], thanked: HandLog): Closing {
  const rows = logs.filter((log) => log.transactionHash === thanked.transactionHash && log.logIndex > thanked.logIndex);
  const closing: Closing = { thanked, shakes: [], stray: [] };
  let current: Owed | undefined;
  for (const log of rows) {
    if (log.eventName === "Shaken" || log.eventName === "Given") {
      current = { log, payee: log.args.payee as Address, amount: (log.eventName === "Shaken" ? log.args.margin : log.args.amount) as bigint };
      if (log.eventName === "Shaken") closing.shakes.push(current);
      else closing.given = current;
    } else if ((log.eventName === "Paid" || log.eventName === "Pending") && current && !current.payout) {
      current.payout = log;
    } else {
      closing.stray.push(log);
    }
  }
  return closing;
}

/** The route and the Give, rebuilt from `Shaken` and `Given` alone: the facts a thank left. */
export function routeOf(record: HandRecord): { hand: Hand; shakes: Shake[]; give: Give } | undefined {
  const thanked = find(record.logs, "Thanked");
  if (!thanked) return undefined;
  const closing = closingOf(record.logs, thanked);
  if (!closing.given) return undefined;
  const shakes = closing.shakes.map(({ log: { args } }): Shake => ({
    nextKey: args.nextKey as Address,
    payee: args.payee as Address,
    claimBps: args.claimBps as number,
    nextClaimBps: args.nextClaimBps as number,
    dataHash: args.dataHash as Hex,
  }));
  const a = closing.given.log.args;
  const give: Give = {
    signer: a.signer as Address,
    payee: a.payee as Address,
    claimBps: a.claimBps as number,
    routeHash: a.routeHash as Hex,
    dataHash: a.dataHash as Hex,
  };
  return { hand: handOf(record.coreHand), shakes, give };
}

async function recoveredBy(hash: Hex, signature: Hex): Promise<string> {
  if (!isKeySignature(signature)) return "not a key's signature";
  try {
    return await recoverAddress({ hash, signature });
  } catch {
    return "unreadable";
  }
}

/**
 * Opens the record's give link against this Hand's terms. A link that leaves Core's address out
 * names the canonical Core, whatever the record says. Throws for a link of another chain, Core or
 * Hand.
 */
async function openGiveLink(record: HandRecord, hand: Hand): Promise<OpenedLink> {
  const opened = await openLink(record.giveLink!, async () => hand, { publicPart: record.publicPart });
  if (opened.head.chainId !== record.chainId || !isAddressEqual(opened.head.core, record.core)) {
    throw new Error("the link is for another chain or Core");
  }
  return opened;
}

/** Where signatures can be read: the thank's input, or else a give link of the same Give. */
async function signaturesOf(
  record: HandRecord,
  hand: Hand,
  thankTx: Hex,
): Promise<{ from: "thank input" | "give link"; signedShakes: SignedShake[]; signedGive: SignedGive } | undefined> {
  // Only the input of the transaction that emitted Thanked: another one may hold a call for the same Give.
  if (record.thankInput && record.closingTx?.toLowerCase() === thankTx.toLowerCase()) {
    const found = thankInputOf(record.thankInput, hand, record.thank.giveHash);
    if (found) return { from: "thank input", ...found };
  }
  if (record.giveLink) {
    try {
      const opened = await openGiveLink(record, hand);
      if (
        opened.signedGive &&
        giveHash(hand, opened.signedGive.give).toLowerCase() === record.thank.giveHash.toLowerCase()
      ) {
        const signedGive = { ...opened.signedGive, giverSig: innerGiverSig(opened.signedGive.giverSig) };
        return { from: "give link", signedShakes: opened.signedShakes, signedGive };
      }
    } catch {
      // A give link of another Hand or Give proves nothing here.
    }
  }
  return undefined;
}

/**
 * The passport: the ordered checks below, proven from the record alone.
 *
 * For a thanked Hand, in order:
 *   core · raised · reward-time · description ·
 *   route.<i> and keys.<i> for each Shake · share.<i> for each Shake ·
 *   route-hash · give-claim · give-hash · give-key · giver · giver-amount ·
 *   payout.shake.<i> and payout.giver for each amount above zero (none for zero) · payouts ·
 *   now.<payee> for each payee.
 * For a refunded Hand: core · raised · reward-time · description · refunded · payout.raiser
 * (above zero only) · now.<raiser>. For an open Hand: the first four.
 */
export async function passportOf(record: HandRecord, options: ProofOptions = {}): Promise<Check[]> {
  return (await passportRows(record, trustedBuild(options))).map((row) => ({ ...row, basis: basisOf(row) }));
}

/** What the reader of a record trusts. */
export interface ProofOptions {
  /**
   * How the Core the record must be of was deployed: the factory, salt and initcode hash its
   * address is derived from (`coreAddressOf`), not the address itself. Left out, it is the
   * canonical Core (`CANONICAL_CORE_BUILD`); tests and a reader of another Core name another, for
   * example `{ ...CANONICAL_CORE_BUILD, initcodeHash }`. A record of any other address fails the
   * core row, however well it agrees with itself: a contract that copies Core's events would.
   */
  coreBuild?: CoreBuild;
}

/** The Core build the reader trusts; an address or anything else given in its place is refused. */
function trustedBuild(options: ProofOptions): CoreBuild {
  const build = options.coreBuild;
  if (build === undefined) return CANONICAL_CORE_BUILD;
  if (typeof build !== "object" || build === null || !build.factory || !build.salt || !build.initcodeHash) {
    throw new TypeError("ProofOptions.coreBuild takes { factory, salt, initcodeHash } (a CoreBuild), not a Core's address");
  }
  return build;
}

/**
 * What a record alone can prove about a row. "computed": a signature, a hash or a sum worked out
 * here from what the row names. "recorded": the row compares events and views the record carries;
 * read from the chain they are the chain's, but in a saved file they are only what the file says,
 * and nothing in a file anchors them to the chain (the reward is under no signature). The core row
 * is "recorded": its derivation is arithmetic, but "code is there" is read from the chain.
 */
function basisOf(row: Row): CheckBasis {
  return row.source === "computed here" && row.id !== "core" ? "computed" : "recorded";
}

async function passportRows(record: HandRecord, trusted: CoreBuild): Promise<Row[]> {
  const { coreHand, logs, block } = record;
  const hand = handOf(coreHand);
  const checks: Row[] = [];
  const handsView: CheckSource = { view: "hands(id)", block };
  const raised = find(logs, "Raised");

  // 1. This contract is the trusted Core: the address derived from the trusted factory, salt and
  // code hash, never from facts the record carries; and code is there.
  const derived = coreAddressOf(trusted);
  checks.push({
    id: "core",
    messageId: "proof.core",
    formula: "core = keccak256(0xff ‖ factory ‖ salt ‖ initcodeHash)[12:], and code is there",
    inputs: { factory: text(trusted.factory), salt: trusted.salt, initcodeHash: trusted.initcodeHash, chainId: String(record.chainId), code: record.coreHasCode ? "present" : "absent" },
    expected: derived,
    actual: record.core,
    verdict: isAddressEqual(derived, record.core) && record.coreHasCode,
    source: "computed here",
  });

  // 2. Raised: the terms in the event equal hands(id).
  const terms = (t: { raiser: unknown; token: unknown; rootKey: unknown; payoutGasK: unknown; minClaimBps: unknown; dataHash: unknown }) =>
    [t.raiser, t.token, t.rootKey, t.payoutGasK, t.minClaimBps, t.dataHash].map(text).join(" · ");
  checks.push({
    id: "raised",
    messageId: "proof.raised",
    formula: "Raised.(raiser, token, rootKey, payoutGasK, minClaimBps, dataHash) = hands(id)",
    inputs: { handId: String(record.handId), openedAt: String(coreHand.openedAt) },
    expected: terms(coreHand),
    actual: raised ? terms(raised.args as never) : "no Raised event in the block of openedAt",
    verdict: raised !== undefined && terms(raised.args as never) === terms(coreHand) && raised.args.handId === record.handId,
    source: raised ? sourceOf(raised) : handsView,
  });

  // 3. Reward and time: Raised plus every Funded is the reward; the last Extended is the expiry.
  const funded = logs.filter((log) => log.eventName === "Funded");
  const extended = logs.filter((log) => log.eventName === "Extended");
  const expected3 = `reward ${coreHand.reward} · expiry ${coreHand.expiry}`;
  if (!raised) {
    checks.push({ id: "reward-time", messageId: "proof.rewardTime", inputs: {}, expected: expected3, actual: "no Raised event", verdict: false, source: handsView });
  } else if (record.between && !record.between.read) {
    checks.push({
      id: "reward-time",
      messageId: "proof.rewardTime",
      inputs: { raisedReward: String(raised.args.reward), raisedExpiry: String(raised.args.expiry), requests: String(record.between.requests) },
      expected: expected3,
      actual: `not read: blocks ${record.between.fromBlock}–${record.between.toBlock} take ${record.between.requests} requests`,
      verdict: "not-checkable",
      source: handsView,
    });
  } else {
    let total = raised.args.reward as bigint;
    let running = true;
    for (const log of funded) {
      total += log.args.amount as bigint;
      if (log.args.reward !== total) running = false;
    }
    const lastExpiry = extended.length ? (extended[extended.length - 1]!.args.expiry as number) : (raised.args.expiry as number);
    checks.push({
      id: "reward-time",
      messageId: "proof.rewardTime",
      formula: "reward = Raised.reward + Σ Funded.amount; expiry = the last Extended.expiry, else Raised.expiry",
      inputs: {
        raisedReward: String(raised.args.reward),
        funded: funded.map((log) => String(log.args.amount)).join(" + ") || "none",
        raisedExpiry: String(raised.args.expiry),
        extended: extended.map((log) => String(log.args.expiry)).join(" → ") || "none",
      },
      expected: expected3,
      actual: `reward ${total} · expiry ${lastExpiry}`,
      verdict: running && total === coreHand.reward && lastExpiry === coreHand.expiry,
      source: handsView,
    });
  }

  // 4. Description: attached and matching, none, or did not arrive. Only the raiser's own words.
  checks.push(await descriptionCheck(record, hand, handsView));

  const thanked = find(logs, "Thanked");
  const refunded = find(logs, "Refunded");
  if (coreHand.closedAt === 0) return checks;
  if (refunded && !thanked) return [...checks, ...refundChecks(record, refunded)];
  if (!thanked) {
    checks.push({
      id: "closing",
      messageId: "proof.closing",
      inputs: { closedAt: String(coreHand.closedAt) },
      expected: "a Thanked or Refunded event in the block of closedAt",
      actual: "none",
      verdict: false,
      source: handsView,
    });
    return checks;
  }
  return [...checks, ...(await thankChecks(record, hand, thanked))];
}

async function descriptionCheck(record: HandRecord, hand: Hand, source: CheckSource): Promise<Row> {
  const base = { id: "description", messageId: "proof.description", inputs: { dataHash: hand.dataHash }, source };
  if (hand.dataHash.toLowerCase() === zeroHash) {
    return { ...base, expected: "none", actual: "none: the Hand has no description", verdict: true };
  }
  if (!record.giveLink) {
    return { ...base, expected: "words that hash to dataHash", actual: "the words travel only in the link; none was given here", verdict: "not-checkable" };
  }
  try {
    const opened = await openGiveLink(record, hand);
    const read = readDescription(opened);
    return {
      ...base,
      formula: "dataHash = hash of the raiser's statement list carried by the link",
      expected: "attached",
      actual: read.status === "attached" ? `attached${read.title ? `: ${read.title}` : ""}` : "did not arrive",
      verdict: read.status === "attached" ? true : "not-checkable",
      source: "computed here",
    };
  } catch (error) {
    return { ...base, expected: "attached", actual: `the link given does not open for this Hand: ${(error as Error).message}`, verdict: "not-checkable" };
  }
}

function payoutCheck(id: string, owed: { payee: Address; amount: bigint; after: HandLog; payout?: HandLog }): Row | undefined {
  if (owed.amount === 0n && !owed.payout) return undefined; // Core emits none for zero: nothing is expected
  const expected = owed.amount === 0n ? "no payout event" : `Paid or Pending · ${owed.amount} · ${owed.payee}`;
  const actual = owed.payout ? `${owed.payout.eventName} · ${owed.payout.args.amount} · ${text(owed.payout.args.payee)}` : "none";
  const verdict =
    owed.amount !== 0n &&
    owed.payout !== undefined &&
    owed.payout.args.amount === owed.amount &&
    isAddressEqual(owed.payout.args.payee as Address, owed.payee);
  return {
    id,
    messageId: "proof.payout",
    formula: "one Paid or Pending after each amount above zero, none after zero",
    inputs: { payee: text(owed.payee), amount: String(owed.amount) },
    expected,
    actual,
    verdict,
    source: sourceOf(owed.payout ?? owed.after),
  };
}

function nowChecks(record: HandRecord): Row[] {
  return record.pending.map(({ token, payee, amount }) => ({
    id: `now.${getAddress(payee)}`,
    messageId: "proof.now",
    formula: "pending(token, payee): counted per token and address, across every Hand",
    inputs: { token: text(token), payee: text(payee) },
    expected: String(amount),
    actual: String(amount),
    verdict: true,
    source: { view: "pending(token, payee)", block: record.block },
  }));
}

function refundChecks(record: HandRecord, refunded: HandLog): Row[] {
  const { coreHand } = record;
  const amount = refunded.args.reward as bigint;
  const rows = record.logs.filter((log) => log.transactionHash === refunded.transactionHash && log.logIndex > refunded.logIndex);
  const payout = rows.find((log) => log.eventName === "Paid" || log.eventName === "Pending");
  const checks: Row[] = [
    {
      id: "refunded",
      messageId: "proof.refunded",
      formula: "Refunded.reward = hands(id).reward, at or after the expiry",
      inputs: { expiry: String(coreHand.expiry), closedAt: String(coreHand.closedAt) },
      expected: String(coreHand.reward),
      actual: String(amount),
      verdict: amount === coreHand.reward && coreHand.closedAt >= coreHand.expiry && record.thank.giveHash.toLowerCase() === zeroHash,
      source: sourceOf(refunded),
    },
  ];
  const paid = payoutCheck("payout.raiser", { payee: coreHand.raiser, amount, after: refunded, payout });
  if (paid) checks.push(paid);
  return [...checks, ...nowChecks(record)];
}

async function thankChecks(record: HandRecord, hand: Hand, thanked: HandLog): Promise<Row[]> {
  const { coreHand } = record;
  const checks: Row[] = [];
  const closing = closingOf(record.logs, thanked);
  const reward = thanked.args.reward as bigint;
  const separator = domainSeparator(domain(record.chainId, record.core));
  const signatures = await signaturesOf(record, hand, thanked.transactionHash);
  const notCheckable = "the thank's input holds no call that hashes to the stored giveHash, and no give link was given";

  // 5. The route: each hand continues the claim that reached it; its key signed it.
  const shakes: Shake[] = [];
  let claim = BPS;
  let key: Address = hand.rootKey;
  for (const [position, owed] of closing.shakes.entries()) {
    const a = owed.log.args;
    const shake: Shake = {
      nextKey: a.nextKey as Address,
      payee: a.payee as Address,
      claimBps: a.claimBps as number,
      nextClaimBps: a.nextClaimBps as number,
      dataHash: a.dataHash as Hex,
    };
    shakes.push(shake);
    const anonymous = isAddressEqual(shake.payee, zeroAddress) && shake.nextClaimBps !== shake.claimBps;
    checks.push({
      id: `route.${position}`,
      messageId: "proof.route",
      formula: "position = i; claimBps = the claim that reached it; nextClaimBps ≤ claimBps; a margin names a payee",
      inputs: { position: String(a.position), payee: text(shake.payee), claimBps: String(shake.claimBps), nextClaimBps: String(shake.nextClaimBps), nextKey: text(shake.nextKey) },
      expected: `position ${position} · claim ${claim}`,
      actual: `position ${a.position} · claim ${shake.claimBps}${anonymous ? " · a margin with no payee" : ""}`,
      verdict: a.position === BigInt(position) && shake.claimBps === claim && shake.nextClaimBps <= shake.claimBps && !anonymous,
      source: sourceOf(owed.log),
    });
    const signedShake = signatures?.signedShakes[position];
    if (signatures && signedShake) {
      const hash = digest(separator, shakeHash(hand, shake));
      checks.push({
        id: `keys.${position}`,
        messageId: "proof.keys",
        formula: "ecrecover(EIP-712 digest of this Shake, keySig) = the key that held the link",
        inputs: { keySig: signedShake.keySig, from: signatures.from },
        expected: key,
        actual: await recoveredBy(hash, signedShake.keySig),
        verdict: await signedBy(key, hash, signedShake.keySig),
        source: "computed here",
      });
    } else {
      checks.push({ id: `keys.${position}`, messageId: "proof.keys", inputs: {}, expected: key, actual: notCheckable, verdict: "not-checkable", source: "computed here" });
    }
    claim = shake.nextClaimBps;
    key = shake.nextKey;
  }

  // 6. Shares: each margin is reward × (claim − next) / 10 000, rounded down.
  let margins = 0n;
  for (const [position, owed] of closing.shakes.entries()) {
    const shake = shakes[position]!;
    const due = marginOf(reward, shake.claimBps, shake.nextClaimBps);
    margins += owed.amount;
    checks.push({
      id: `share.${position}`,
      messageId: "proof.share",
      formula: "reward × (claimBps − nextClaimBps) / 10 000, rounded down",
      inputs: { reward: String(reward), claimBps: String(shake.claimBps), nextClaimBps: String(shake.nextClaimBps), payee: text(shake.payee) },
      expected: String(due),
      actual: String(owed.amount),
      verdict: owed.amount === due,
      source: sourceOf(owed.log),
    });
  }

  const given = closing.given;
  if (!given) {
    checks.push({ id: "route-hash", messageId: "proof.routeHash", inputs: {}, expected: "a Given event after the Shakes", actual: "none", verdict: false, source: sourceOf(thanked) });
    return checks;
  }
  const g = given.log.args;
  const give: Give = { signer: g.signer as Address, payee: g.payee as Address, claimBps: g.claimBps as number, routeHash: g.routeHash as Hex, dataHash: g.dataHash as Hex };

  // 7. Route hash, rebuilt here from the Shaken events and the Hand's terms.
  const rebuilt = routeHash(hand, shakes);
  checks.push({
    id: "route-hash",
    messageId: "proof.routeHash",
    formula: "h₀ = 0; hᵢ₊₁ = keccak256(hᵢ ‖ shakeHash(Shakeᵢ)); equals Given.routeHash",
    inputs: { shakes: String(shakes.length) },
    expected: give.routeHash,
    actual: rebuilt,
    verdict: rebuilt.toLowerCase() === give.routeHash.toLowerCase(),
    source: sourceOf(given.log),
  });
  checks.push({
    id: "give-claim",
    messageId: "proof.giveClaim",
    formula: "Given.claimBps = what the route left ≥ minClaimBps",
    inputs: { minClaimBps: String(hand.minClaimBps) },
    expected: String(claim),
    actual: String(give.claimBps),
    verdict: give.claimBps === claim && claim >= hand.minClaimBps,
    source: sourceOf(given.log),
  });

  // 8. The Give, rebuilt here, against thanks(id).giveHash: GIVEHASH MATCHES CORE.
  const rebuiltGive = giveHash(hand, give);
  checks.push({
    id: "give-hash",
    messageId: "proof.giveHash",
    formula: "giveHash(Hand terms, Given.(signer, payee, claimBps, routeHash, dataHash)) = thanks(id).giveHash",
    inputs: { signer: text(give.signer), payee: text(give.payee), claimBps: String(give.claimBps), routeHash: give.routeHash, dataHash: give.dataHash },
    expected: record.thank.giveHash,
    actual: rebuiltGive,
    verdict: rebuiltGive.toLowerCase() === record.thank.giveHash.toLowerCase() && record.thank.giveHash.toLowerCase() !== zeroHash,
    source: { view: "thanks(id)", block: record.block },
  });
  const giveDigest = digest(separator, rebuiltGive);
  if (signatures) {
    const { keySig, giverSig } = signatures.signedGive;
    checks.push({
      id: "give-key",
      messageId: "proof.giveKey",
      formula: "ecrecover(EIP-712 digest of the Give, keySig) = the route's last key",
      inputs: { keySig, from: signatures.from },
      expected: key,
      actual: await recoveredBy(giveDigest, keySig),
      verdict: await signedBy(key, giveDigest, keySig),
      source: "computed here",
    });
    const byKey = await signedBy(give.signer, giveDigest, giverSig);
    const byAccount = !byKey && record.giverHasCode === true;
    checks.push({
      id: "giver",
      messageId: byAccount ? "proof.giver.account" : "proof.giver.key",
      formula: byAccount
        ? "the signer is an account with code: its own code judged giverSig (ERC-1271) when Core accepted the thank"
        : "ecrecover(EIP-712 digest of the Give, giverSig) = Given.signer",
      inputs: { giverSig, from: signatures.from, code: record.giverHasCode ? "present" : "absent" },
      expected: text(give.signer),
      actual: byKey ? text(give.signer) : byAccount ? "signed by its account" : await recoveredBy(giveDigest, giverSig),
      verdict: byKey || byAccount,
      // An account's verdict rests on a fact read from the chain, its code: a saved file only records it.
      source: byAccount ? { view: "eth_getCode(signer)", block: record.block } : "computed here",
    });
  } else {
    checks.push({ id: "give-key", messageId: "proof.giveKey", inputs: {}, expected: key, actual: notCheckable, verdict: "not-checkable", source: "computed here" });
    checks.push({ id: "giver", messageId: "proof.giver.key", inputs: {}, expected: text(give.signer), actual: notCheckable, verdict: "not-checkable", source: "computed here" });
  }

  // 9. The helper's amount: the reward minus the shares.
  checks.push({
    id: "giver-amount",
    messageId: "proof.giverAmount",
    formula: "reward − Σ shares",
    inputs: { reward: String(reward), shares: String(margins) },
    expected: String(reward - margins),
    actual: String(given.amount),
    verdict: given.amount === reward - margins,
    source: sourceOf(given.log),
  });

  // 10. Payouts: one Paid or Pending after each amount above zero; together the reward.
  let paidOut = 0n;
  for (const [position, owed] of closing.shakes.entries()) {
    const check = payoutCheck(`payout.shake.${position}`, { ...owed, after: owed.log });
    if (check) checks.push(check);
    if (owed.payout) paidOut += owed.payout.args.amount as bigint;
  }
  const giverPayout = payoutCheck("payout.giver", { ...given, after: given.log });
  if (giverPayout) checks.push(giverPayout);
  if (given.payout) paidOut += given.payout.args.amount as bigint;
  checks.push({
    id: "payouts",
    messageId: "proof.payouts",
    formula: "Σ Paid + Σ Pending = Thanked.reward = hands(id).reward; nothing else in the thank",
    inputs: { thankedReward: String(reward), stray: String(closing.stray.length) },
    expected: String(coreHand.reward),
    actual: String(paidOut),
    verdict: paidOut === coreHand.reward && reward === coreHand.reward && closing.stray.length === 0,
    source: sourceOf(thanked),
  });

  // 11. Now: what still waits per payee.
  return [...checks, ...nowChecks(record)];
}

/* ----------------------------------------------------------------- bundle */

export const BUNDLE_FORMAT = "aHand.proof/1";

/** The record as JSON: bigints as decimal strings, bytes as hex. Holds no secret: a live link is refused. */
export function exportBundle(record: HandRecord): string {
  if (record.giveLink) noSecret(record.giveLink);
  return JSON.stringify(
    { format: BUNDLE_FORMAT, ...record },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value instanceof Uint8Array ? bytesToHex(value) : value),
    2,
  );
}

const big = z.string().regex(/^\d+$/).transform((value) => BigInt(value));
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((value) => getAddress(value));
const hex = z.string().regex(/^0x([0-9a-fA-F]{2})*$/).transform((value) => value as Hex);
const word = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((value) => value as Hex);
const uint = z.number().int().nonnegative();

const BIG_ARGS = new Set(["handId", "reward", "amount", "margin", "position"]);
const NUMBER_ARGS = new Set(["expiry", "payoutGasK", "minClaimBps", "claimBps", "nextClaimBps"]);
const ADDRESS_ARGS = new Set(["raiser", "token", "rootKey", "payee", "signer", "nextKey", "to"]);

/** Each event's arguments, as Core declares them: a log of the file must carry exactly these. */
const EVENT_ARGS = new Map(
  CORE_ABI.filter((item) => item.type === "event").map((event) => [event.name as string, event.inputs.map((input) => input.name!).sort().join(",")]),
);

/**
 * Bounds on a file, so that reading or re-reading it costs no more than an honest one could: the
 * logs of a Hand (a raise, a closing and every Funded and Extended between), the payees of a
 * closing (each Shake and the Give's payee, with room to spare), and the differences listed before
 * re-reading stops.
 */
export const BUNDLE_MAX_LOGS = 10_000;
export const BUNDLE_MAX_PENDING = LONGEST_ROUTE + 2;
export const MAX_DIFFERENCES = 20;

const argument = z.union([z.string(), z.number()]);
const logSchema = z
  .object({
  eventName: z.enum(["Raised", "Funded", "Extended", "Shaken", "Given", "Thanked", "Refunded", "Paid", "Pending"]),
  args: z.record(argument).transform((args, ctx) => {
    const out: HandLog["args"] = {};
    for (const [name, value] of Object.entries(args)) {
      const parsed = BIG_ARGS.has(name)
        ? big.safeParse(value)
        : NUMBER_ARGS.has(name)
          ? uint.safeParse(value)
          : ADDRESS_ARGS.has(name)
            ? address.safeParse(value)
            : word.safeParse(value);
      if (!parsed.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `argument ${name} is malformed` });
        return z.NEVER;
      }
      out[name] = parsed.data;
    }
    return out;
  }),
  blockNumber: big,
  blockHash: word,
  transactionHash: word,
  logIndex: uint,
})
  .superRefine((log, ctx) => {
    const names = Object.keys(log.args).sort().join(",");
    if (names !== EVENT_ARGS.get(log.eventName)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${log.eventName} carries (${names}), Core's carries (${EVENT_ARGS.get(log.eventName)})` });
    }
  });

const bundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  chainId: uint,
  core: address,
  handId: big,
  block: big,
  coreHand: z.object({
    handId: big,
    raiser: address,
    expiry: uint,
    openedAt: uint,
    closedAt: uint,
    token: address,
    payoutGasK: uint,
    minClaimBps: uint,
    reward: big,
    rootKey: address,
    dataHash: word,
  }),
  thank: z.object({ giveHash: word, dataHash: word }),
  logs: z.array(logSchema).max(BUNDLE_MAX_LOGS),
  between: z.object({ fromBlock: big, toBlock: big, requests: uint, read: z.boolean() }).optional(),
  pending: z.array(z.object({ token: address, payee: address, amount: big })).max(BUNDLE_MAX_PENDING),
  coreHasCode: z.boolean(),
  giverHasCode: z.boolean().optional(),
  closingTx: word.optional(),
  thankInput: hex.refine((value) => size(value) <= TX_BYTES_LIMIT, "longer than any transaction").optional(),
  giveLink: hex.transform((value) => hexToBytes(value)).optional(),
  publicPart: hex.transform((value) => hexToBytes(value)).optional(),
  // Facts about Core a file may still carry are dropped unread: the reader decides which Core it trusts.
  build: z
    .object({
      commit: z.string().optional(),
      dirty: z.boolean().optional(),
      buildHash: word.optional(),
    })
    .optional(),
});

/**
 * Keys earlier writers of the same format used, and the key each is read as: `hands(id)`'s record
 * was `view`, and the public part of the give link's address was `outside`. `exportBundle` writes
 * only the new keys.
 */
const EARLIER_KEYS: readonly (readonly [earlier: string, now: string])[] = [
  ["view", "coreHand"],
  ["outside", "publicPart"],
];

/**
 * Reads a bundle back into a record. Throws on anything that is not a bundle of this format. A
 * file from an earlier writer is read as if it used the keys of today (`EARLIER_KEYS`); a file
 * that carries both an earlier key and the key it became is refused, since which one it means
 * cannot be told.
 */
export function readBundle(json: string): HandRecord {
  const raw: unknown = JSON.parse(json);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return readParsed(bundleSchema.safeParse(raw));
  const fields = { ...(raw as Record<string, unknown>) };
  for (const [earlier, now] of EARLIER_KEYS) {
    if (!(earlier in fields)) continue;
    if (now in fields) throw new Error(`not an aHand proof bundle: it carries both ${earlier} and ${now}`);
    fields[now] = fields[earlier];
    delete fields[earlier];
  }
  return readParsed(bundleSchema.safeParse(fields));
}

function readParsed(parsed: z.SafeParseReturnType<unknown, z.infer<typeof bundleSchema>>): HandRecord {
  if (!parsed.success) throw new Error(`not an aHand proof bundle: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  const { format: _format, ...record } = parsed.data;
  const out = { ...record } as HandRecord;
  for (const key of Object.keys(out) as (keyof HandRecord)[]) if (out[key] === undefined) delete out[key];
  return out;
}

/**
 * Re-runs the passport on a saved bundle, with no network. What a file alone proves is its
 * signatures, hashes and sums ("computed" rows keep their verdict). Its events and views are only
 * what the file says: a "recorded" row that holds within the file reads "recorded", never `true`; one
 * that does not hold even there still fails. `verifyBundleOnChain` re-reads them.
 */
export async function verifyBundle(json: string, options: ProofOptions = {}): Promise<Check[]> {
  return offline(await passportOf(readBundle(json), options));
}

const offline = (checks: Check[]): Check[] =>
  checks.map((check) => (check.basis === "recorded" && check.verdict === true ? { ...check, verdict: "recorded" } : check));

/**
 * Checks a saved bundle against the chain: every log it carries is read again by its block hash
 * (and the Hand's logs in those blocks must be exactly the file's), and `hands(id)`, `thanks(id)`,
 * Core's code, each `pending` and the giver's code are read again at the file's block, and the
 * thank transaction's input by its hash. The first row, `chain`, says whether the file equals the
 * chain; only then do its "recorded" rows count as holding. The client must be on the bundle's chain.
 */
export async function verifyBundleOnChain(client: PublicClient, json: string, options: ProofOptions = {}): Promise<Check[]> {
  const record = readBundle(json);
  const differences = await rereadRecord(client, record);
  const checks = await passportOf(record, options);
  const chain: Check = {
    id: "chain",
    messageId: "proof.chain",
    formula: "each log by blockHash and logIndex; hands(id), thanks(id), pending, code at the file's block; the thank's input by its hash",
    inputs: { block: String(record.block), logs: String(record.logs.length) },
    expected: "the file equals the chain",
    actual: differences.length === 0 ? "equal" : differences.join("; "),
    verdict: differences.length === 0,
    source: { view: "eth_getLogs by blockHash, hands(id), thanks(id), pending, eth_getCode, the thank transaction", block: record.block },
    basis: "recorded",
  };
  return [chain, ...(differences.length === 0 ? checks : offline(checks))];
}

/** One log as a comparable line: every field, numbers as decimals, addresses and hashes in lower case. */
function logLine(log: HandLog): string {
  const args = Object.keys(log.args)
    .sort()
    .map((name) => `${name}=${String(log.args[name]).toLowerCase()}`)
    .join(",");
  return `${log.eventName}(${args}) block ${log.blockNumber} ${log.blockHash.toLowerCase()} tx ${log.transactionHash.toLowerCase()} log ${log.logIndex}`;
}

/**
 * Where a record differs from the chain, as sentences; empty when every log and view it carries
 * is the chain's. Reads at the record's block, so the node must still serve that state.
 */
export async function rereadRecord(client: PublicClient, record: HandRecord): Promise<string[]> {
  const differences: string[] = [];
  const chainId = await client.getChainId();
  if (chainId !== record.chainId) return [`the RPC is chain ${chainId}, the file names chain ${record.chainId}`];
  const at = { blockNumber: record.block };
  const { core, handId, coreHand } = record;

  const [hands, thanks, code] = await Promise.all([
    client.readContract({ address: core, abi: CORE_ABI, functionName: "hands", args: [handId], ...at }),
    client.readContract({ address: core, abi: CORE_ABI, functionName: "thanks", args: [handId], ...at }),
    client.getCode({ address: core, ...at }),
  ]);
  const [raiser, expiry, openedAt, closedAt, token, payoutGasK, minClaimBps, reward, rootKey, dataHash] = hands;
  const onChain: Record<string, string> = { raiser, expiry: String(expiry), openedAt: String(openedAt), closedAt: String(closedAt), token, payoutGasK: String(payoutGasK), minClaimBps: String(minClaimBps), reward: String(reward), rootKey, dataHash };
  for (const [field, value] of Object.entries(onChain)) {
    const inFile = String(coreHand[field as keyof CoreHand]);
    if (inFile.toLowerCase() !== value.toLowerCase()) differences.push(`hands(${handId}).${field} is ${value}, the file says ${inFile}`);
  }
  if (coreHand.handId !== handId) differences.push(`the file's hands(id) record is of Hand ${coreHand.handId}, not ${handId}`);
  if (thanks[0].toLowerCase() !== record.thank.giveHash.toLowerCase()) differences.push(`thanks(${handId}).giveHash is ${thanks[0]}, the file says ${record.thank.giveHash}`);
  if (thanks[1].toLowerCase() !== record.thank.dataHash.toLowerCase()) differences.push(`thanks(${handId}).dataHash is ${thanks[1]}, the file says ${record.thank.dataHash}`);
  const hasCode = code !== undefined && code !== "0x";
  if (hasCode !== record.coreHasCode) differences.push(`Core's code is ${hasCode ? "there" : "absent"}, the file says ${record.coreHasCode ? "there" : "absent"}`);

  for (const owed of record.pending) {
    if (differences.length >= MAX_DIFFERENCES) break;
    const amount = await client.readContract({ address: core, abi: CORE_ABI, functionName: "pending", args: [owed.token, owed.payee], ...at });
    if (amount !== owed.amount) differences.push(`pending(${owed.token}, ${owed.payee}) is ${amount}, the file says ${owed.amount}`);
  }

  const blocks = [...new Set(record.logs.map((log) => log.blockHash.toLowerCase() as Hex))];
  for (const blockHash of blocks) {
    if (differences.length >= MAX_DIFFERENCES) break;
    let read: HandLog[];
    try {
      read = await handLogsInBlock(client, core, handId, blockHash);
    } catch (error) {
      differences.push(`block ${blockHash} could not be read: ${(error as Error).message.split("\n")[0]}`);
      continue;
    }
    const chainLines = new Set(read.map(logLine));
    const fileLines = new Set(record.logs.filter((log) => log.blockHash.toLowerCase() === blockHash).map(logLine));
    for (const line of fileLines) if (!chainLines.has(line)) differences.push(`not on chain: ${line}`);
    for (const line of chainLines) if (!fileLines.has(line)) differences.push(`missing from the file: ${line}`);
  }

  const closer = find(record.logs, "Thanked") ?? find(record.logs, "Refunded");
  if (record.closingTx !== undefined && closer && record.closingTx.toLowerCase() !== closer.transactionHash.toLowerCase()) {
    differences.push(`the closing transaction is ${closer.transactionHash}, the file says ${record.closingTx}`);
  }
  if (record.thankInput !== undefined) {
    if (!record.closingTx) differences.push("the file carries a thank input but no closing transaction");
    else {
      const tx = await client.getTransaction({ hash: record.closingTx });
      if (tx.input.toLowerCase() !== record.thankInput.toLowerCase()) differences.push(`the input of ${record.closingTx} differs from the file's`);
    }
  }
  if (record.giverHasCode !== undefined) {
    const given = find(record.logs, "Given");
    if (given) {
      const giverCode = await client.getCode({ address: given.args.signer as Address, ...at });
      const has = giverCode !== undefined && giverCode !== "0x";
      if (has !== record.giverHasCode) differences.push(`the giver's code is ${has ? "there" : "absent"}, the file says ${record.giverHasCode ? "there" : "absent"}`);
    }
  }
  return differences;
}
