import type { Check, HandLog, HandRecord } from "@ahand/sdk";
import { erc20Abi, formatEther, formatGwei, getAddress, isAddressEqual, keccak256, parseEventLogs, type Address, type Hex, type PublicClient } from "viem";

/**
 * What the passport reads beside the SDK's record: how the closing was sent (the
 * transaction's sender, the gas it used and what that cost), the token's own `Transfer` events in
 * that transaction, the times of the blocks that carry the raise and the closing, and, as
 * information, the hashes of the code at Core's address and at the factory's.
 *
 * Two checks come from it: `time.opened` and `time.closed` compare `hands(id).openedAt` and
 * `closedAt` with their blocks' own timestamps. The SDK finds those blocks by time, so the events
 * sit where the times say; these two lines close the circle from the other side, from each
 * event's block back to the time the contract keeps.
 *
 * Reads here (`readPageFacts`) and proof from what was read (`timeChecks`, `moveFor`) are kept
 * apart, like the SDK's `collectRecord` and `passportOf`. The SDK's record and bundle do not hold these
 * facts yet; the page adds them to the file it offers under `extra`, so the file holds everything
 * read; moving them into the SDK is left for later.
 */

/** One `Transfer` of the Hand's token out of Core, as the token itself logged it. */
export interface TokenMove {
  token: Address;
  from: Address;
  to: Address;
  amount: bigint;
  logIndex: number;
}

/** The closing transaction as its receipt tells it. */
export interface Sent {
  hash: Hex;
  from: Address;
  /** What the transaction called: Core itself, or a wallet's or a batch's contract. */
  to: Address | null;
  blockNumber: bigint;
  status: "success" | "reverted";
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  /** The L1 data fee an OP Stack chain adds, when the receipt names one. */
  l1Fee?: bigint;
  /** The token's Transfers from Core in this transaction, in log order. */
  moves: TokenMove[];
}

export interface BlockTime {
  block: bigint;
  timestamp: number;
}

export interface PageFacts {
  sent?: Sent;
  /** The block of the `Raised` event and its timestamp. */
  opened?: BlockTime;
  /** The block of the `Thanked` or `Refunded` event and its timestamp. */
  closed?: BlockTime;
  /** keccak256 of the code at Core's address at the record's block: information, not the proof. */
  runtimeHash?: Hex;
  /** keccak256 of the code at the factory's address at the record's block. */
  factoryCodeHash?: Hex;
}

/** The ids of the checks this page adds to the SDK's. */
export const PAGE_CHECK_IDS = ["time.opened", "time.closed"] as const;

export const isPageCheck = (id: string): boolean => (PAGE_CHECK_IDS as readonly string[]).includes(id);

const raisedOf = (record: HandRecord): HandLog | undefined => record.logs.find((log) => log.eventName === "Raised");
const closerOf = (record: HandRecord): HandLog | undefined =>
  record.logs.find((log) => log.eventName === "Thanked") ?? record.logs.find((log) => log.eventName === "Refunded");

/** A read that may fail without failing the passport: what could not be read is said as such. */
async function quiet<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch {
    return undefined;
  }
}

async function codeHash(client: PublicClient, address: Address, blockNumber: bigint): Promise<Hex | undefined> {
  const code = await client.getCode({ address, blockNumber });
  return code && code !== "0x" ? keccak256(code) : undefined;
}

/**
 * Reads the page's own facts for a record: the closing transaction's receipt, the two blocks'
 * times, and the two code hashes at the record's block. Each read stands alone; one that fails
 * leaves its fact out.
 */
export async function readPageFacts(client: PublicClient, record: HandRecord, factory?: Address): Promise<PageFacts> {
  const raised = raisedOf(record);
  const closer = closerOf(record);
  const blockTime = async (log: HandLog | undefined): Promise<BlockTime | undefined> => {
    if (!log) return undefined;
    const block = await client.getBlock({ blockNumber: log.blockNumber });
    // The block must be the very one the log stands in: a reorganised chain would show another hash.
    if (block.hash !== log.blockHash) return undefined;
    return { block: block.number, timestamp: Number(block.timestamp) };
  };
  const sentOf = async (): Promise<Sent | undefined> => {
    if (!record.closingTx) return undefined;
    const receipt = await client.getTransactionReceipt({ hash: record.closingTx });
    const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
    const moves: TokenMove[] = transfers
      .filter((log) => isAddressEqual(log.address, record.coreHand.token) && isAddressEqual(log.args.from, record.core))
      .map((log) => ({ token: getAddress(log.address), from: getAddress(log.args.from), to: getAddress(log.args.to), amount: log.args.value, logIndex: log.logIndex }));
    const l1Fee = (receipt as { l1Fee?: unknown }).l1Fee;
    return {
      hash: receipt.transactionHash,
      from: getAddress(receipt.from),
      to: receipt.to ? getAddress(receipt.to) : null,
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
      ...(typeof l1Fee === "bigint" ? { l1Fee } : typeof l1Fee === "string" && /^0x[0-9a-fA-F]+$/.test(l1Fee) ? { l1Fee: BigInt(l1Fee) } : {}),
      moves,
    };
  };
  const [sent, opened, closed, runtimeHash, factoryCodeHash] = await Promise.all([
    quiet(sentOf()),
    quiet(blockTime(raised)),
    quiet(blockTime(closer)),
    quiet(codeHash(client, record.core, record.block)),
    factory ? quiet(codeHash(client, factory, record.block)) : Promise.resolve(undefined),
  ]);
  return {
    ...(sent ? { sent } : {}),
    ...(opened ? { opened } : {}),
    ...(closed ? { closed } : {}),
    ...(runtimeHash ? { runtimeHash } : {}),
    ...(factoryCodeHash ? { factoryCodeHash } : {}),
  };
}

function timeCheck(id: string, sentence: string, log: HandLog, kept: number, field: "openedAt" | "closedAt", time: BlockTime | undefined): Check {
  const base = {
    id,
    messageId: sentence,
    formula: `block(${log.eventName}).timestamp = hands(id).${field}`,
    expected: String(kept),
    source: { event: log.eventName, block: log.blockNumber, tx: log.transactionHash, logIndex: log.logIndex },
    // A block's time read from the chain: a saved file can only record it.
    basis: "recorded" as const,
  };
  if (!time || time.block !== log.blockNumber) {
    return { ...base, inputs: { event: log.eventName, block: String(log.blockNumber) }, actual: "the block's time was not read", verdict: "not-checkable" };
  }
  return {
    ...base,
    inputs: { event: log.eventName, block: String(log.blockNumber), blockHash: log.blockHash },
    actual: String(time.timestamp),
    verdict: time.timestamp === kept,
  };
}

/**
 * `time.opened`: the block of `Raised` carries the timestamp `hands(id).openedAt`.
 * `time.closed`: the block of `Thanked` or `Refunded` carries `hands(id).closedAt` (a closed Hand
 * only). A line whose event the record does not hold is left out: the SDK's own `raised` and
 * `closing` lines already say that the event is missing.
 */
export function timeChecks(record: HandRecord, facts: PageFacts | undefined): Check[] {
  const checks: Check[] = [];
  const raised = raisedOf(record);
  if (raised) checks.push(timeCheck("time.opened", "proof.time.opened", raised, record.coreHand.openedAt, "openedAt", facts?.opened));
  const closer = closerOf(record);
  if (closer && record.coreHand.closedAt !== 0) {
    checks.push(timeCheck("time.closed", "proof.time.closed", closer, record.coreHand.closedAt, "closedAt", facts?.closed));
  }
  return checks;
}

/**
 * The SDK's checks for a site built without the contract's deployment facts: the SDK would judge
 * the address against its canonical build, which this site cannot vouch for, so the core line is
 * not checkable here (`proof.nc.core`), as it never was before the SDK had a canonical build.
 */
export function withoutCoreBuild(checks: readonly Check[]): Check[] {
  return checks.map((check) => (check.id === "core" ? { ...check, verdict: "not-checkable" as const } : check));
}

/**
 * The SDK's checks with the page's two set where they belong: `time.opened` right after `raised`;
 * `time.closed` right after `refunded`, or before the first payout line of a thank. The SDK's own
 * order is untouched.
 */
export function withPageChecks(checks: readonly Check[], extra: readonly Check[]): Check[] {
  const out = [...checks];
  const put = (check: Check, at: number) => out.splice(at < 0 ? out.length : at, 0, check);
  for (const check of extra) {
    if (check.id === "time.opened") {
      const raised = out.findIndex((line) => line.id === "raised");
      put(check, raised < 0 ? -1 : raised + 1);
    } else if (check.id === "time.closed") {
      const refunded = out.findIndex((line) => line.id === "refunded");
      const payout = out.findIndex((line) => line.id.startsWith("payout.") || line.id === "payouts");
      put(check, refunded >= 0 ? refunded + 1 : payout);
    } else put(check, -1);
  }
  return out;
}

/**
 * The token's own `Transfer` for a payout line that reads `Paid`: from Core, to the line's payee,
 * of the line's amount, standing between the Hand's event before the `Paid` (the `Shaken`, `Given`
 * or `Refunded` it follows) and the `Paid` itself. Core moves the money and then says `Paid`, so
 * the token's event stands right there. Undefined for a `Pending` line (nothing moved), and when
 * the token logged no such event.
 */
export function moveFor(check: Check, record: HandRecord, sent: Sent | undefined): TokenMove | undefined {
  if (!sent || !check.id.startsWith("payout.") || !check.actual.startsWith("Paid")) return undefined;
  if (check.source === "computed here" || !("event" in check.source) || check.source.event !== "Paid") return undefined;
  const paid = check.source;
  if (paid.tx !== sent.hash) return undefined;
  const payee = check.inputs.payee;
  const amount = check.inputs.amount;
  if (!payee || !amount || !/^\d+$/.test(amount)) return undefined;
  const before = record.logs
    .filter((log) => log.transactionHash === paid.tx && log.logIndex < paid.logIndex)
    .reduce((latest, log) => Math.max(latest, log.logIndex), -1);
  return sent.moves
    .filter((move) => move.logIndex > before && move.logIndex < paid.logIndex && isAddressEqual(move.to, payee as Address) && move.amount === BigInt(amount))
    .at(-1);
}

/** What sending the closing cost its sender, in wei: the gas used at the price paid, plus the L1 fee where there is one. */
export function feeOf(sent: Sent): bigint {
  return sent.gasUsed * sent.effectiveGasPrice + (sent.l1Fee ?? 0n);
}

/** Ether with three significant figures, never in exponent form: "0.000195", "1.25". */
export function ethShort(wei: bigint): string {
  const eth = Number(formatEther(wei));
  if (eth === 0) return "0";
  const decimals = Math.max(0, 2 - Math.floor(Math.log10(eth)));
  return eth.toFixed(Math.min(decimals, 18)).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
}

/** The transaction's lines for the lens, in the chain's own names. */
export function sentLines(sent: Sent, record: HandRecord): string[] {
  const own = record.logs.filter((log) => log.transactionHash === sent.hash).map((log) => log.logIndex);
  return [
    `tx ${sent.hash}`,
    `block ${sent.blockNumber} · status ${sent.status}`,
    `from ${sent.from}`,
    `to ${sent.to ?? "—"}`,
    `gasUsed ${sent.gasUsed} · effectiveGasPrice ${formatGwei(sent.effectiveGasPrice)} gwei`,
    ...(sent.l1Fee === undefined ? [] : [`l1Fee ${formatEther(sent.l1Fee)} ETH`]),
    `fee ${formatEther(feeOf(sent))} ETH`,
    ...(own.length > 0 ? [`this Hand's logs ${Math.min(...own)}–${Math.max(...own)} · the token's Transfer logs ${sent.moves.map((move) => move.logIndex).join(", ") || "none"}`] : []),
  ];
}

/** The page's facts as they go into the downloaded file, under `extra`. */
export function bundleExtra(facts: PageFacts | undefined): Record<string, unknown> {
  return { format: "aHand.proof-page/1", ...(facts ?? {}) };
}
