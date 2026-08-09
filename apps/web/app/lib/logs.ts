/** Chunked event scanning — public Base RPCs cap eth_getLogs at 2000 blocks. */
import type { PublicClient } from "viem";

/** Widest range a single eth_getLogs may cover (sepolia.base.org rejects > 2000). */
const MAX_RANGE = 1999n;
/** Parallel range queries in flight — modest, to stay under public rate limits. */
const CONCURRENCY = 5;

export type LogRange = { fromBlock: bigint; toBlock: bigint };

/**
 * Run one logical getLogs query as a series of range-capped requests and
 * return the results in block order. The caller supplies the actual query so
 * viem's event typing flows through unchanged:
 *
 *   scanLogs(client, FROM_BLOCK, (range) =>
 *     client.getLogs({ address, event: RAISED, args: { raiser }, ...range }))
 */
export async function scanLogs<T>(
  client: PublicClient,
  fromBlock: bigint,
  fetchRange: (range: LogRange) => Promise<T[]>,
): Promise<T[]> {
  const latest = await client.getBlockNumber();
  if (latest < fromBlock) return [];

  const ranges: LogRange[] = [];
  for (let start = fromBlock; start <= latest; start += MAX_RANGE + 1n) {
    const end = start + MAX_RANGE < latest ? start + MAX_RANGE : latest;
    ranges.push({ fromBlock: start, toBlock: end });
  }

  const chunks: T[][] = new Array(ranges.length);
  let next = 0;
  const worker = async () => {
    while (next < ranges.length) {
      const i = next++;
      chunks[i] = await fetchRange(ranges[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ranges.length) }, worker),
  );
  return chunks.flat();
}
