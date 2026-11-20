import {
  bytesToHex,
  decodeFunctionData,
  getAddress,
  getContractAddress,
  hexToBytes,
  isAddressEqual,
  recoverAddress,
  toFunctionSelector,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { z } from "zod";

import { LOG_WINDOW, handLogs, handLogsAt, handLogsInBlock, type HandEventName, type HandLog, type HandView } from "./chain.js";
import { readDescription } from "./describe.js";
import { CoreRefused } from "./errors.js";
import { digest, domainSeparator, giveHash, routeHash, shakeHash } from "./hash.js";
import { LinkError, openLink, type OpenedLink } from "./link.js";
import { CORE_ABI, innerGiverSig } from "./tx.js";
import { BPS, domain, type Give, type Hand, type Shake, type SignedGive, type SignedShake } from "./types.js";
import { isKeySignature, signedBy } from "./verify.js";

/**
 * The Hand passport (UX-SPEC §10.1) in two steps, so that a saved record can be checked again with
 * no network:
 *
 *   collect(client, core, handId)  reads views, logs and the thank's input once  → HandRecord
 *   passportOf(record)             proves every fact from that record alone       → Check[]
 *
 * It proves from events and views first (D-50): `Shaken` and `Given` carry every field of each
 * Shake and of the Give, so the route hash and the Give's hash are rebuilt with the `Raised` terms
 * and compared with `thanks(id).giveHash`. That holds whatever wallet sent the thank. Signatures
 * are an extra: they are recovered from the thank transaction's input when `thankInputOf` finds
 * the call there (at any offset, accepted only if it hashes to the stored giveHash), or from a
 * give link whose Give hashes the same; otherwise they read "not-checkable", never "failed".
 *
 * Nothing here reads a clock. `passportOf` is async only because signature recovery is.
 */

/** Facts of the build: the CREATE2 derivation of Core, and what the site served. */
export interface BuildFacts {
  /** The deterministic deployer Core was created through. */
  factory?: Address;
  salt?: Hex;
  /** keccak256 of Core's initcode, reproducible from the commit. */
  initcodeHash?: Hex;
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
  /** `eth_getLogs` requests reading it takes, in windows of at most 2 000 blocks. */
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
  view: HandView;
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
  /** A give link of this Hand, and the part of its address that travelled outside the link (`d`). */
  giveLink?: Uint8Array;
  outside?: Uint8Array;
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
 * the chain (`verifyBundle` with no network); it is never counted as ok.
 */
export type CheckVerdict = boolean | "not-checkable" | "recorded";

export interface Check {
  /** Stable id: `core`, `raised`, `reward-time`, `description`, `route.<i>`, `keys.<i>`, … (see `passportOf`). */
  id: string;
  /** The i18n key of the check's sentence. */
  sentence: string;
  formula?: string;
  inputs: Record<string, string>;
  expected: string;
  actual: string;
  ok: CheckVerdict;
  source: CheckSource;
  basis: CheckBasis;
}

/** A check as the passport builds it, before its basis is named. */
type Row = Omit<Check, "ok" | "basis"> & { ok: boolean | "not-checkable" };

export interface CollectOptions {
  giveLink?: Uint8Array;
  outside?: Uint8Array;
  build?: BuildFacts;
  /** Read the stretch between at once when it is needed (default: no, the record says what it costs). */
  readBetween?: boolean;
  /** Window size for that read, at most 2 000 blocks. */
  chunk?: number;
}

/* ---------------------------------------------------------------- collect */

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
export async function collect(
  client: PublicClient,
  core: Address,
  handId: bigint,
  extra: CollectOptions = {},
): Promise<HandRecord> {
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
  const view: HandView = { handId, raiser, expiry, openedAt, closedAt, token, payoutGasK, minClaimBps, reward, rootKey, dataHash };

  const opening = await handLogsAt(client, core, handId, openedAt);
  const closing = closedAt !== 0 && closedAt !== openedAt ? await handLogsAt(client, core, handId, closedAt) : [];
  let record: HandRecord = {
    chainId,
    core: getAddress(core),
    handId,
    block,
    view,
    thank: { giveHash: thanks[0], dataHash: thanks[1] },
    logs: merged(opening, closing),
    pending: [],
    coreHasCode: code !== undefined && code !== "0x",
  };
  if (extra.giveLink) record.giveLink = extra.giveLink;
  if (extra.outside) record.outside = extra.outside;
  if (extra.build) record.build = extra.build;

  const raised = find(record.logs, "Raised");
  const closer = find(record.logs, "Thanked") ?? find(record.logs, "Refunded");
  if (raised && (raised.args.reward !== reward || raised.args.expiry !== expiry)) {
    const fromBlock = raised.blockNumber + 1n;
    const toBlock = closer ? closer.blockNumber - 1n : block;
    const size = BigInt(Math.min(extra.chunk ?? LOG_WINDOW, LOG_WINDOW));
    const span = toBlock >= fromBlock ? toBlock - fromBlock + 1n : 0n;
    record.between = { fromBlock, toBlock, requests: Number((span + size - 1n) / size), read: false };
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
  const text = txInput.slice(2).toLowerCase();
  for (let at = text.indexOf(THANK_SELECTOR); at >= 0; at = text.indexOf(THANK_SELECTOR, at + 1)) {
    if (at % 2 !== 0) continue; // a selector starts on a whole byte
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
export function handOf(view: HandView): Hand {
  const { handId, raiser, token, rootKey, payoutGasK, minClaimBps, dataHash } = view;
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

/** The thank's rows in Core's event order (R-56, R-70), with each payout tied to the amount before it. */
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
  return { hand: handOf(record.view), shakes, give };
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
 * Opens the record's give link against this Hand's terms. A link that names its Core is read as
 * it is; one that leaves it out (the canonical Core) is read as naming this record's Core. Throws
 * for a link of another chain, Core or Hand.
 */
async function openGiveLink(record: HandRecord, hand: Hand): Promise<OpenedLink> {
  const bytes = record.giveLink!;
  const outside = record.outside;
  let opened: OpenedLink;
  try {
    opened = await openLink(bytes, async () => hand, { outside });
  } catch (error) {
    if (!(error instanceof LinkError) || error.code !== "unsupported") throw error;
    opened = await openLink(bytes, async () => hand, { outside, canonicalCore: record.core });
  }
  if (opened.head.chainId !== record.chainId || !isAddressEqual(opened.head.core, record.core)) {
    throw new Error("the link is for another chain or Core");
  }
  return opened;
}

/** Where signatures can be read: the thank's input, or else a give link of the same Give. */
async function signaturesOf(
  record: HandRecord,
  hand: Hand,
): Promise<{ from: "thank input" | "give link"; signedShakes: SignedShake[]; signedGive: SignedGive } | undefined> {
  if (record.thankInput) {
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
 * The passport: the ordered checks of UX-SPEC §10.1, proven from the record alone.
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
export async function passportOf(record: HandRecord): Promise<Check[]> {
  return (await passportRows(record)).map((row) => ({ ...row, basis: basisOf(row) }));
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

async function passportRows(record: HandRecord): Promise<Row[]> {
  const { view, logs, block } = record;
  const hand = handOf(view);
  const checks: Row[] = [];
  const handsView: CheckSource = { view: "hands(id)", block };
  const raised = find(logs, "Raised");

  // 1. This contract: the address derived from the factory, the salt and the code hash; code is there.
  const build = record.build;
  if (build?.factory && build.salt && build.initcodeHash) {
    const derived = getContractAddress({ opcode: "CREATE2", from: build.factory, salt: build.salt, bytecodeHash: build.initcodeHash });
    checks.push({
      id: "core",
      sentence: "proof.core",
      formula: "core = keccak256(0xff ‖ factory ‖ salt ‖ initcodeHash)[12:], and code is there",
      inputs: { factory: text(build.factory), salt: build.salt, initcodeHash: build.initcodeHash, chainId: String(record.chainId), code: record.coreHasCode ? "present" : "absent" },
      expected: record.core,
      actual: derived,
      ok: isAddressEqual(derived, record.core) && record.coreHasCode,
      source: "computed here",
    });
  } else {
    checks.push({
      id: "core",
      sentence: "proof.core",
      inputs: { chainId: String(record.chainId), code: record.coreHasCode ? "present" : "absent" },
      expected: record.core,
      actual: "no factory, salt and code hash were given",
      ok: "not-checkable",
      source: "computed here",
    });
  }

  // 2. Raised: the terms in the event equal hands(id).
  const terms = (t: { raiser: unknown; token: unknown; rootKey: unknown; payoutGasK: unknown; minClaimBps: unknown; dataHash: unknown }) =>
    [t.raiser, t.token, t.rootKey, t.payoutGasK, t.minClaimBps, t.dataHash].map(text).join(" · ");
  checks.push({
    id: "raised",
    sentence: "proof.raised",
    formula: "Raised.(raiser, token, rootKey, payoutGasK, minClaimBps, dataHash) = hands(id)",
    inputs: { handId: String(record.handId), openedAt: String(view.openedAt) },
    expected: terms(view),
    actual: raised ? terms(raised.args as never) : "no Raised event in the block of openedAt",
    ok: raised !== undefined && terms(raised.args as never) === terms(view) && raised.args.handId === record.handId,
    source: raised ? sourceOf(raised) : handsView,
  });

  // 3. Reward and time: Raised plus every Funded is the reward; the last Extended is the expiry.
  const funded = logs.filter((log) => log.eventName === "Funded");
  const extended = logs.filter((log) => log.eventName === "Extended");
  const expected3 = `reward ${view.reward} · expiry ${view.expiry}`;
  if (!raised) {
    checks.push({ id: "reward-time", sentence: "proof.rewardTime", inputs: {}, expected: expected3, actual: "no Raised event", ok: false, source: handsView });
  } else if (record.between && !record.between.read) {
    checks.push({
      id: "reward-time",
      sentence: "proof.rewardTime",
      inputs: { raisedReward: String(raised.args.reward), raisedExpiry: String(raised.args.expiry), requests: String(record.between.requests) },
      expected: expected3,
      actual: `not read: blocks ${record.between.fromBlock}–${record.between.toBlock} take ${record.between.requests} requests`,
      ok: "not-checkable",
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
      sentence: "proof.rewardTime",
      formula: "reward = Raised.reward + Σ Funded.amount; expiry = the last Extended.expiry, else Raised.expiry",
      inputs: {
        raisedReward: String(raised.args.reward),
        funded: funded.map((log) => String(log.args.amount)).join(" + ") || "none",
        raisedExpiry: String(raised.args.expiry),
        extended: extended.map((log) => String(log.args.expiry)).join(" → ") || "none",
      },
      expected: expected3,
      actual: `reward ${total} · expiry ${lastExpiry}`,
      ok: running && total === view.reward && lastExpiry === view.expiry,
      source: handsView,
    });
  }

  // 4. Description: attached and matching, none, or did not arrive. Only the raiser's own words.
  checks.push(await descriptionCheck(record, hand, handsView));

  const thanked = find(logs, "Thanked");
  const refunded = find(logs, "Refunded");
  if (view.closedAt === 0) return checks;
  if (refunded && !thanked) return [...checks, ...refundChecks(record, refunded)];
  if (!thanked) {
    checks.push({
      id: "closing",
      sentence: "proof.closing",
      inputs: { closedAt: String(view.closedAt) },
      expected: "a Thanked or Refunded event in the block of closedAt",
      actual: "none",
      ok: false,
      source: handsView,
    });
    return checks;
  }
  return [...checks, ...(await thankChecks(record, hand, thanked))];
}

async function descriptionCheck(record: HandRecord, hand: Hand, source: CheckSource): Promise<Row> {
  const base = { id: "description", sentence: "proof.description", inputs: { dataHash: hand.dataHash }, source };
  if (hand.dataHash.toLowerCase() === zeroHash) {
    return { ...base, expected: "none", actual: "none: the Hand has no description", ok: true };
  }
  if (!record.giveLink) {
    return { ...base, expected: "words that hash to dataHash", actual: "the words travel only in the link; none was given here", ok: "not-checkable" };
  }
  try {
    const opened = await openGiveLink(record, hand);
    const read = readDescription(opened);
    return {
      ...base,
      formula: "dataHash = hash of the raiser's statement list carried by the link",
      expected: "attached",
      actual: read.status === "attached" ? `attached${read.title ? `: ${read.title}` : ""}` : "did not arrive",
      ok: read.status === "attached" ? true : "not-checkable",
      source: "computed here",
    };
  } catch (error) {
    return { ...base, expected: "attached", actual: `the link given does not open for this Hand: ${(error as Error).message}`, ok: "not-checkable" };
  }
}

function payoutCheck(id: string, owed: { payee: Address; amount: bigint; after: HandLog; payout?: HandLog }): Row | undefined {
  if (owed.amount === 0n && !owed.payout) return undefined; // Core emits none for zero: nothing is expected
  const expected = owed.amount === 0n ? "no payout event" : `Paid or Pending · ${owed.amount} · ${owed.payee}`;
  const actual = owed.payout ? `${owed.payout.eventName} · ${owed.payout.args.amount} · ${text(owed.payout.args.payee)}` : "none";
  const ok =
    owed.amount !== 0n &&
    owed.payout !== undefined &&
    owed.payout.args.amount === owed.amount &&
    isAddressEqual(owed.payout.args.payee as Address, owed.payee);
  return {
    id,
    sentence: "proof.payout",
    formula: "one Paid or Pending after each amount above zero, none after zero",
    inputs: { payee: text(owed.payee), amount: String(owed.amount) },
    expected,
    actual,
    ok,
    source: sourceOf(owed.payout ?? owed.after),
  };
}

function nowChecks(record: HandRecord): Row[] {
  return record.pending.map(({ token, payee, amount }) => ({
    id: `now.${getAddress(payee)}`,
    sentence: "proof.now",
    formula: "pending(token, payee): counted per token and address, across every Hand",
    inputs: { token: text(token), payee: text(payee) },
    expected: String(amount),
    actual: String(amount),
    ok: true,
    source: { view: "pending(token, payee)", block: record.block },
  }));
}

function refundChecks(record: HandRecord, refunded: HandLog): Row[] {
  const { view } = record;
  const amount = refunded.args.reward as bigint;
  const rows = record.logs.filter((log) => log.transactionHash === refunded.transactionHash && log.logIndex > refunded.logIndex);
  const payout = rows.find((log) => log.eventName === "Paid" || log.eventName === "Pending");
  const checks: Row[] = [
    {
      id: "refunded",
      sentence: "proof.refunded",
      formula: "Refunded.reward = hands(id).reward, at or after the expiry",
      inputs: { expiry: String(view.expiry), closedAt: String(view.closedAt) },
      expected: String(view.reward),
      actual: String(amount),
      ok: amount === view.reward && view.closedAt >= view.expiry && record.thank.giveHash.toLowerCase() === zeroHash,
      source: sourceOf(refunded),
    },
  ];
  const paid = payoutCheck("payout.raiser", { payee: view.raiser, amount, after: refunded, payout });
  if (paid) checks.push(paid);
  return [...checks, ...nowChecks(record)];
}

async function thankChecks(record: HandRecord, hand: Hand, thanked: HandLog): Promise<Row[]> {
  const { view } = record;
  const checks: Row[] = [];
  const closing = closingOf(record.logs, thanked);
  const reward = thanked.args.reward as bigint;
  const separator = domainSeparator(domain(record.chainId, record.core));
  const signatures = await signaturesOf(record, hand);
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
      sentence: "proof.route",
      formula: "position = i; claimBps = the claim that reached it; nextClaimBps ≤ claimBps; a margin names a payee",
      inputs: { position: String(a.position), payee: text(shake.payee), claimBps: String(shake.claimBps), nextClaimBps: String(shake.nextClaimBps), nextKey: text(shake.nextKey) },
      expected: `position ${position} · claim ${claim}`,
      actual: `position ${a.position} · claim ${shake.claimBps}${anonymous ? " · a margin with no payee" : ""}`,
      ok: a.position === BigInt(position) && shake.claimBps === claim && shake.nextClaimBps <= shake.claimBps && !anonymous,
      source: sourceOf(owed.log),
    });
    const signedShake = signatures?.signedShakes[position];
    if (signatures && signedShake) {
      const hash = digest(separator, shakeHash(hand, shake));
      checks.push({
        id: `keys.${position}`,
        sentence: "proof.keys",
        formula: "ecrecover(EIP-712 digest of this Shake, keySig) = the key that held the link",
        inputs: { keySig: signedShake.keySig, from: signatures.from },
        expected: key,
        actual: await recoveredBy(hash, signedShake.keySig),
        ok: await signedBy(key, hash, signedShake.keySig),
        source: "computed here",
      });
    } else {
      checks.push({ id: `keys.${position}`, sentence: "proof.keys", inputs: {}, expected: key, actual: notCheckable, ok: "not-checkable", source: "computed here" });
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
      sentence: "proof.share",
      formula: "reward × (claimBps − nextClaimBps) / 10 000, rounded down",
      inputs: { reward: String(reward), claimBps: String(shake.claimBps), nextClaimBps: String(shake.nextClaimBps), payee: text(shake.payee) },
      expected: String(due),
      actual: String(owed.amount),
      ok: owed.amount === due,
      source: sourceOf(owed.log),
    });
  }

  const given = closing.given;
  if (!given) {
    checks.push({ id: "route-hash", sentence: "proof.routeHash", inputs: {}, expected: "a Given event after the Shakes", actual: "none", ok: false, source: sourceOf(thanked) });
    return checks;
  }
  const g = given.log.args;
  const give: Give = { signer: g.signer as Address, payee: g.payee as Address, claimBps: g.claimBps as number, routeHash: g.routeHash as Hex, dataHash: g.dataHash as Hex };

  // 7. Route hash, rebuilt here from the Shaken events and the Hand's terms.
  const rebuilt = routeHash(hand, shakes);
  checks.push({
    id: "route-hash",
    sentence: "proof.routeHash",
    formula: "h₀ = 0; hᵢ₊₁ = keccak256(hᵢ ‖ shakeHash(Shakeᵢ)); equals Given.routeHash",
    inputs: { shakes: String(shakes.length) },
    expected: give.routeHash,
    actual: rebuilt,
    ok: rebuilt.toLowerCase() === give.routeHash.toLowerCase(),
    source: sourceOf(given.log),
  });
  checks.push({
    id: "give-claim",
    sentence: "proof.giveClaim",
    formula: "Given.claimBps = what the route left ≥ minClaimBps",
    inputs: { minClaimBps: String(hand.minClaimBps) },
    expected: String(claim),
    actual: String(give.claimBps),
    ok: give.claimBps === claim && claim >= hand.minClaimBps,
    source: sourceOf(given.log),
  });

  // 8. The Give, rebuilt here, against thanks(id).giveHash: GIVEHASH MATCHES CORE.
  const rebuiltGive = giveHash(hand, give);
  checks.push({
    id: "give-hash",
    sentence: "proof.giveHash",
    formula: "giveHash(Hand terms, Given.(signer, payee, claimBps, routeHash, dataHash)) = thanks(id).giveHash",
    inputs: { signer: text(give.signer), payee: text(give.payee), claimBps: String(give.claimBps), routeHash: give.routeHash, dataHash: give.dataHash },
    expected: record.thank.giveHash,
    actual: rebuiltGive,
    ok: rebuiltGive.toLowerCase() === record.thank.giveHash.toLowerCase() && record.thank.giveHash.toLowerCase() !== zeroHash,
    source: { view: "thanks(id)", block: record.block },
  });
  const giveDigest = digest(separator, rebuiltGive);
  if (signatures) {
    const { keySig, giverSig } = signatures.signedGive;
    checks.push({
      id: "give-key",
      sentence: "proof.giveKey",
      formula: "ecrecover(EIP-712 digest of the Give, keySig) = the route's last key",
      inputs: { keySig, from: signatures.from },
      expected: key,
      actual: await recoveredBy(giveDigest, keySig),
      ok: await signedBy(key, giveDigest, keySig),
      source: "computed here",
    });
    const byKey = await signedBy(give.signer, giveDigest, giverSig);
    const byAccount = !byKey && record.giverHasCode === true;
    checks.push({
      id: "giver",
      sentence: byAccount ? "proof.giver.account" : "proof.giver.key",
      formula: byAccount
        ? "the signer is an account with code: its own code judged giverSig (ERC-1271) when Core accepted the thank"
        : "ecrecover(EIP-712 digest of the Give, giverSig) = Given.signer",
      inputs: { giverSig, from: signatures.from, code: record.giverHasCode ? "present" : "absent" },
      expected: text(give.signer),
      actual: byKey ? text(give.signer) : byAccount ? "signed by its account" : await recoveredBy(giveDigest, giverSig),
      ok: byKey || byAccount,
      source: "computed here",
    });
  } else {
    checks.push({ id: "give-key", sentence: "proof.giveKey", inputs: {}, expected: key, actual: notCheckable, ok: "not-checkable", source: "computed here" });
    checks.push({ id: "giver", sentence: "proof.giver.key", inputs: {}, expected: text(give.signer), actual: notCheckable, ok: "not-checkable", source: "computed here" });
  }

  // 9. The helper's amount: the reward minus the shares.
  checks.push({
    id: "giver-amount",
    sentence: "proof.giverAmount",
    formula: "reward − Σ shares",
    inputs: { reward: String(reward), shares: String(margins) },
    expected: String(reward - margins),
    actual: String(given.amount),
    ok: given.amount === reward - margins,
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
    sentence: "proof.payouts",
    formula: "Σ Paid + Σ Pending = Thanked.reward = hands(id).reward; nothing else in the thank",
    inputs: { thankedReward: String(reward), stray: String(closing.stray.length) },
    expected: String(view.reward),
    actual: String(paidOut),
    ok: paidOut === view.reward && reward === view.reward && closing.stray.length === 0,
    source: sourceOf(thanked),
  });

  // 11. Now: what still waits per payee.
  return [...checks, ...nowChecks(record)];
}

/* ----------------------------------------------------------------- bundle */

export const BUNDLE_FORMAT = "aHand.proof/1";

/** The record as JSON: bigints as decimal strings, bytes as hex. Holds no secret: a give link has none. */
export function exportBundle(record: HandRecord): string {
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

const argument = z.union([z.string(), z.number()]);
const logSchema = z.object({
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
});

const bundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  chainId: uint,
  core: address,
  handId: big,
  block: big,
  view: z.object({
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
  logs: z.array(logSchema),
  between: z.object({ fromBlock: big, toBlock: big, requests: uint, read: z.boolean() }).optional(),
  pending: z.array(z.object({ token: address, payee: address, amount: big })),
  coreHasCode: z.boolean(),
  giverHasCode: z.boolean().optional(),
  closingTx: word.optional(),
  thankInput: hex.optional(),
  giveLink: hex.transform((value) => hexToBytes(value)).optional(),
  outside: hex.transform((value) => hexToBytes(value)).optional(),
  build: z
    .object({
      factory: address.optional(),
      salt: word.optional(),
      initcodeHash: word.optional(),
      commit: z.string().optional(),
      dirty: z.boolean().optional(),
      buildHash: word.optional(),
    })
    .optional(),
});

/** Reads a bundle back into a record. Throws on anything that is not a bundle of this format. */
export function readBundle(json: string): HandRecord {
  const parsed = bundleSchema.safeParse(JSON.parse(json));
  if (!parsed.success) throw new Error(`not an aHand proof bundle: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  const { format: _format, ...record } = parsed.data;
  const out = { ...record } as HandRecord;
  for (const key of Object.keys(out) as (keyof HandRecord)[]) if (out[key] === undefined) delete out[key];
  return out;
}

/**
 * Re-runs the passport on a saved bundle, with no network. What a file alone proves is its
 * signatures, hashes and sums ("computed" rows keep their verdict). Its events and views are only
 * what the file says: a "recorded" row that holds within the file reads "recorded", never ok; one
 * that does not hold even there still fails. `verifyBundleOnChain` re-reads them.
 */
export async function verifyBundle(json: string): Promise<Check[]> {
  return offline(await passportOf(readBundle(json)));
}

const offline = (checks: Check[]): Check[] =>
  checks.map((check) => (check.basis === "recorded" && check.ok === true ? { ...check, ok: "recorded" } : check));

/**
 * Checks a saved bundle against the chain: every log it carries is read again by its block hash
 * (and the Hand's logs in those blocks must be exactly the file's), and `hands(id)`, `thanks(id)`,
 * Core's code, each `pending` and the giver's code are read again at the file's block, and the
 * thank transaction's input by its hash. The first row, `chain`, says whether the file equals the
 * chain; only then do its "recorded" rows count as ok. The client must be on the bundle's chain.
 */
export async function verifyBundleOnChain(client: PublicClient, json: string): Promise<Check[]> {
  const record = readBundle(json);
  const differences = await rereadRecord(client, record);
  const checks = await passportOf(record);
  const chain: Check = {
    id: "chain",
    sentence: "proof.chain",
    formula: "each log by blockHash and logIndex; hands(id), thanks(id), pending, code at the file's block; the thank's input by its hash",
    inputs: { block: String(record.block), logs: String(record.logs.length) },
    expected: "the file equals the chain",
    actual: differences.length === 0 ? "equal" : differences.join("; "),
    ok: differences.length === 0,
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
  const { core, handId, view } = record;

  const [hands, thanks, code] = await Promise.all([
    client.readContract({ address: core, abi: CORE_ABI, functionName: "hands", args: [handId], ...at }),
    client.readContract({ address: core, abi: CORE_ABI, functionName: "thanks", args: [handId], ...at }),
    client.getCode({ address: core, ...at }),
  ]);
  const [raiser, expiry, openedAt, closedAt, token, payoutGasK, minClaimBps, reward, rootKey, dataHash] = hands;
  const onChain: Record<string, string> = { raiser, expiry: String(expiry), openedAt: String(openedAt), closedAt: String(closedAt), token, payoutGasK: String(payoutGasK), minClaimBps: String(minClaimBps), reward: String(reward), rootKey, dataHash };
  for (const [field, value] of Object.entries(onChain)) {
    const inFile = String(view[field as keyof HandView]);
    if (inFile.toLowerCase() !== value.toLowerCase()) differences.push(`hands(${handId}).${field} is ${value}, the file says ${inFile}`);
  }
  if (view.handId !== handId) differences.push(`the file's view is of Hand ${view.handId}, not ${handId}`);
  if (thanks[0].toLowerCase() !== record.thank.giveHash.toLowerCase()) differences.push(`thanks(${handId}).giveHash is ${thanks[0]}, the file says ${record.thank.giveHash}`);
  if (thanks[1].toLowerCase() !== record.thank.dataHash.toLowerCase()) differences.push(`thanks(${handId}).dataHash is ${thanks[1]}, the file says ${record.thank.dataHash}`);
  const hasCode = code !== undefined && code !== "0x";
  if (hasCode !== record.coreHasCode) differences.push(`Core's code is ${hasCode ? "there" : "absent"}, the file says ${record.coreHasCode ? "there" : "absent"}`);

  for (const owed of record.pending) {
    const amount = await client.readContract({ address: core, abi: CORE_ABI, functionName: "pending", args: [owed.token, owed.payee], ...at });
    if (amount !== owed.amount) differences.push(`pending(${owed.token}, ${owed.payee}) is ${amount}, the file says ${owed.amount}`);
  }

  const blocks = [...new Set(record.logs.map((log) => log.blockHash.toLowerCase() as Hex))];
  for (const blockHash of blocks) {
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
