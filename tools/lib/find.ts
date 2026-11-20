/**
 * `find`: every Hand one raiser opened in the last N days, from `Raised` logs filtered by the
 * raiser's topic, in windows of at most 2 000 blocks (D-5, D-64).
 *
 * The app's own look for a newer Hand is the SDK's findLaterHands bounded to one day after a Hand
 * ended (216 windows: a day of Base at 200 ms blocks). This is the long one, for a terminal: it is
 * bounded by days, prints how many log requests it will make before the first, shows progress,
 * and stops on Ctrl-C with what it found so far. An indexer would replace it (D-5: after mainnet).
 * Every "now" is the latest block's timestamp.
 */
import { findBlockAt, findLaterHands, chainNow, readHand, LOG_WINDOW } from "../../packages/sdk/src/chain.ts";
import { Fail, addressFlag, amountOf, connect, group, trustedCore, utc, wholeFlag, type Args } from "./cli.ts";

const USAGE = "find --rpc URL [--core 0x...] --raiser 0x... [--days N] [--chunk BLOCKS]";
const MAX_DAYS = 366;

/** Exit status when the person stopped the search: what was found so far is printed. */
export const STOPPED = 130;

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
  const search = findLaterHands(chain.client, trusted.core, raiser, { fromBlock, toBlock: now.number, chunk, maxWindows: Number.MAX_SAFE_INTEGER });
  const blocks = now.number - fromBlock + 1n;
  console.error(
    `find: ${group(search.requests)} request${search.requests === 1 ? "" : "s"}: eth_getLogs over blocks ${fromBlock}–${now.number} (${group(blocks)} blocks, windows of ${group(chunk)}; a day of Base is about 216), then up to 4 reads per Hand found for its state and reward. Ctrl-C stops and prints what was found.`,
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
