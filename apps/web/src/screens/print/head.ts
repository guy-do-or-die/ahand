import type { LinkHead, ReceiptRow } from "@ahand/sdk";

/**
 * The printed receipt's head: what was asked, when the Hand closed, in which
 * block and how. Pure: no network, no clock; the dates are a block's own second.
 */

/** How the Hand closed and in which block, from the closing row Core logged. */
export function closingOf(rows: readonly ReceiptRow[]): { how: "thanked" | "refunded"; block: bigint } | undefined {
  const row = rows.find((item) => item.eventName === "Thanked" || item.eventName === "Refunded");
  if (!row) return undefined;
  return { how: row.eventName === "Thanked" ? "thanked" : "refunded", block: row.log.blockNumber };
}

/**
 * A date for paper, with its year: "30 Dec 2026" / «30 дек 2026». `day` is the screen's own
 * "30 Dec" (ui/format.ts); the year is read in the same time zone from the same second.
 */
export function paperDate(timestamp: number, day: (timestamp: number) => string, timeZone?: string): string {
  const year = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone }).format(new Date(timestamp * 1000));
  return `${day(timestamp)} ${year}`;
}

/** Whether the link this tab holds names this very Hand: the question is taken only from it. */
export function namesHand(head: Pick<LinkHead, "chainId" | "core" | "handId"> | undefined, chainId: number, core: string, handId: bigint): boolean {
  return head !== undefined && head.chainId === chainId && head.core.toLowerCase() === core.toLowerCase() && head.handId === handId;
}
