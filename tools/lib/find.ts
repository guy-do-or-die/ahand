/**
 * `find`: every Hand one raiser opened in the last N days, from `Raised` logs filtered by the
 * raiser's topic, in windows of at most 2 000 blocks (D-5).
 *
 * The app's own look for a newer Hand is the SDK's findLaterHands, which reads Hands by their
 * numbers after the one at hand (D-64) and reads no log. This one is bounded by days instead, for a
 * terminal: it prints how many log requests it will make before the first, shows progress, and
 * stops on Ctrl-C with what it found so far. A node that takes fewer blocks per request than the
 * window (Base Sepolia's public RPC: 200) gets each window in smaller pieces (the SDK's
 * readLogWindows), so it then makes more requests than it announced. An indexer would replace it
 * (D-5: after mainnet). Every "now" is the latest block's timestamp.
 */
import { getAbiItem, type AbiEvent, type Address, type PublicClient } from "viem";

import { findBlockAt, chainNow, readHand, readLogWindows, LOG_WINDOW } from "../../packages/sdk/src/chain.ts";
import { CORE_ABI } from "../../packages/sdk/src/tx.ts";
import { Fail, addressFlag, amountOf, connect, group, trustedCore, utc, wholeFlag, type Args } from "./cli.ts";

const USAGE = "find --rpc URL [--core 0x...] --raiser 0x... [--days N] [--chunk BLOCKS]";
const MAX_DAYS = 366;

/** Exit status when the person stopped the search: what was found so far is printed. */
export const STOPPED = 130;

const RAISED = getAbiItem({ abi: CORE_ABI, name: "Raised" }) as AbiEvent;

/**
 * The raiser's `Raised` logs in `[fromBlock, toBlock]`, in windows of `chunk` blocks: `requests`
 * is known before any is made. `onProgress` returning `false` stops after that window.
 */
function raisedBy(client: PublicClient, core: Address, raiser: Address, range: { fromBlock: bigint; toBlock: bigint; chunk: number }) {
  const size = BigInt(range.chunk);
  const span = range.toBlock >= range.fromBlock ? range.toBlock - range.fromBlock + 1n : 0n;
  const requests = Number((span + size - 1n) / size);
  return {
    requests,
    async run(onProgress: (found: { handId: bigint; block: bigint }[], done: number) => boolean) {
      const found: { handId: bigint; block: bigint }[] = [];
      for (let done = 0; done < requests; ) {
        const from = range.fromBlock + BigInt(done) * size;
        const end = from + size - 1n < range.toBlock ? from + size - 1n : range.toBlock;
        const logs = await readLogWindows(client, { fromBlock: from, toBlock: end, window: range.chunk }, (a, b) =>
          client.getLogs({ address: core, event: RAISED, args: { raiser }, fromBlock: a, toBlock: b, strict: true }),
        );
        for (const log of logs) found.push({ handId: (log.args as { handId: bigint }).handId, block: log.blockNumber });
        done++;
        if (!onProgress([...found], done)) break;
      }
      return found;
    },
  };
}

export async function findCommand(args: Args): Promise<number> {
  const raiser = addressFlag(args, "--raiser");
  if (!raiser) throw new Fail(`give the raiser: ${USAGE}`, 2);
  if (args.positional.length) throw new Fail(`find takes no positional arguments: ${USAGE}`, 2);
  const days = wholeFlag(args, "--days", 1, 1, MAX_DAYS);
  const chunk = wholeFlag(args, "--chunk", LOG_WINDOW, 1, LOG_WINDOW);
  const chain = (await connect(args, true))!;
  const trusted = trustedCore(args, chain.chainId);

  console.error(`find: Hands raised by ${raiser} on Core ${trusted.core} (chain ${chain.chainId}) in the last ${days} day${days === 1 ? "" : "s"} by the chain's clock.`);
  console.error("find: first the window: the latest block, then a binary search over block times for its start (about 25 block reads on Base).");
  const now = await chainNow(chain.client);
  const since = now.timestamp - days * 86_400;
  const fromBlock = await findBlockAt(chain.client, Math.max(since, 0));
  const search = raisedBy(chain.client, trusted.core, raiser, { fromBlock, toBlock: now.number, chunk });
  const blocks = now.number - fromBlock + 1n;
  console.error(
    `find: ${group(search.requests)} request${search.requests === 1 ? "" : "s"}: eth_getLogs over blocks ${fromBlock}–${now.number} (${group(blocks)} blocks, windows of ${group(chunk)}; a day of Base is about 216; a node that takes fewer blocks at once gets each window in smaller pieces), then up to 4 reads per Hand found for its state and reward. Ctrl-C stops and prints what was found.`,
  );

  let stop = false;
  const onInterrupt = () => {
    if (stop) process.exit(STOPPED);
    stop = true;
    console.error("\nfind: stopping after the request in flight (Ctrl-C again quits at once)");
  };
  process.on("SIGINT", onInterrupt);
  const tty = process.stderr.isTTY === true;
  const every = Math.max(1, Math.ceil(search.requests / 20));
  let done = 0;
  let found: { handId: bigint; block: bigint }[];
  try {
    found = await search.run((sofar, count) => {
      done = count;
      const line = `find: ${count}/${search.requests} windows read, ${sofar.length} Hand${sofar.length === 1 ? "" : "s"} found`;
      if (tty) process.stderr.write(`\r${line}`);
      else if (count % every === 0 || count === search.requests) console.error(line);
      return !stop;
    });
  } finally {
    process.off("SIGINT", onInterrupt);
  }
  if (tty) process.stderr.write("\n");

  const lines: string[] = [];
  const at = await chainNow(chain.client);
  for (const { handId, block } of found) {
    const { view, stateAt } = await readHand(chain.client, trusted.core, handId);
    lines.push(`#${handId}  ${stateAt(at.timestamp).padEnd(9)}  ${await amountOf(chain, view.token, view.reward)}  raised in block ${block}, ${utc(view.openedAt)}`);
  }
  const head = stop
    ? `stopped after ${done} of ${search.requests} requests: ${found.length} Hand${found.length === 1 ? "" : "s"} found so far`
    : `${found.length} Hand${found.length === 1 ? "" : "s"} raised by ${raiser} in blocks ${fromBlock}–${now.number}`;
  console.log([head, `state by block ${at.number}, ${utc(at.timestamp)} (the chain's time)`, ...lines].join("\n"));
  return stop ? STOPPED : 0;
}
