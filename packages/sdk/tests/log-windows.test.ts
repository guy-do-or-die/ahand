import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, http, numberToHex, type Hex, type PublicClient } from "viem";

import { LOG_WINDOW, handLogs, logRangeRefusal, logWindowOf, logWindowsOver, readLogWindows, setLogWindow } from "../src/index.js";

/**
 * Log windows that shrink themselves, against an HTTP node of this file's own that refuses wide
 * `eth_getLogs` ranges the way real nodes do:
 *
 * - "base": Base Sepolia's public RPC (https://sepolia.base.org, 2026-11-21) answers a range over
 *   200 blocks with HTTP 413 and `{"code":-32614,"message":"eth_getLogs is limited to a 200 range"}`;
 * - "results": a node that answers -32005 "query returned more than 10000 results" over 300 blocks,
 *   naming no range (Infura's words);
 * - "broken": a node that fails every `eth_getLogs` for another reason (-32000 "header not found");
 * - "lag": a node whose head is behind the block asked, in reth's words (-32000 "block range extends
 *   beyond current head block"): it says "block range", but no smaller window helps;
 * - "dense": one block near the tip holds more logs than the node returns at once, so any window
 *   over one block that holds it is refused with -32005 "query returned more than 10000 results";
 * - "always": a node that refuses every `eth_getLogs` the way Base does, whatever its range.
 *
 * The clients are viem's own `http` clients with viem's own retries, so the errors arrive wrapped
 * exactly as the app meets them, and every request viem makes is counted.
 */

const TIP = 61_441_608n;
const CORE = "0x65ac707E2AE7392583de5d6192C619F1D8862309";
const DENSE = TIP - 1_500n;

type Mode = "base" | "results" | "broken" | "lag" | "dense" | "always";
interface Asked {
  mode: Mode;
  from: bigint;
  to: bigint;
  refused: boolean;
}

let server: Server;
let url = "";
const asked: Asked[] = [];

function answer(mode: Mode, body: { id: number; method: string; params?: [{ fromBlock: Hex; toBlock: Hex }] }): { status: number; json: unknown } {
  const reply = (result: unknown) => ({ status: 200, json: { jsonrpc: "2.0", id: body.id, result } });
  const fail = (status: number, code: number, message: string) => ({ status, json: { jsonrpc: "2.0", id: body.id, error: { code, message } } });
  if (body.method === "eth_chainId") return reply("0x14a34");
  if (body.method === "eth_blockNumber") return reply(numberToHex(TIP));
  if (body.method !== "eth_getLogs") return fail(200, -32601, `the method ${body.method} does not exist`);
  const from = BigInt(body.params![0].fromBlock);
  const to = BigInt(body.params![0].toBlock);
  const span = to - from + 1n;
  const refused =
    mode === "broken" ||
    mode === "always" ||
    (mode === "base" && span > 200n) ||
    (mode === "results" && span > 300n) ||
    (mode === "lag" && to >= TIP) ||
    (mode === "dense" && span > 1n && from <= DENSE && DENSE <= to);
  asked.push({ mode, from, to, refused });
  if (mode === "broken") return fail(200, -32000, "header not found");
  if (refused && mode === "lag") return fail(200, -32000, "block range extends beyond current head block");
  if (refused && (mode === "base" || mode === "always")) return fail(413, -32614, "eth_getLogs is limited to a 200 range");
  if (refused) return fail(200, -32005, "query returned more than 10000 results");
  return reply([]);
}

beforeAll(async () => {
  server = createServer((request, response) => {
    let text = "";
    request.on("data", (part) => (text += part));
    request.on("end", () => {
      const mode = (request.url ?? "/base").slice(1) as Mode;
      const { status, json } = answer(mode, JSON.parse(text));
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((done) => server.close(() => done())));

/**
 * A fresh viem client of one node, with viem's default retries: viem asks a -32005 refusal (and an
 * HTTP 413 with no JSON-RPC body) four times before the SDK sees it, and those requests are counted
 * here as the app makes them. Only the wait between them is shortened, to keep the test quick.
 */
const clientOf = (mode: Mode): PublicClient => createPublicClient({ transport: http(`${url}/${mode}`, { retryDelay: 1 }) }) as PublicClient;
const take = (mode: Mode) => asked.splice(0).filter((one) => one.mode === mode);
const spans = (list: Asked[]) => list.map((one) => Number(one.to - one.from + 1n));

/** Every block of the range asked once by the windows the node took, in order, with no gap. */
function coversOnce(list: Asked[], from: bigint, to: bigint) {
  let next = from;
  for (const one of list.filter((a) => !a.refused)) {
    expect(one.from).toBe(next);
    next = one.to + 1n;
  }
  expect(next).toBe(to + 1n);
}

describe("readLogWindows: a window the node refuses for its range shrinks", () => {
  it("on Base Sepolia's public RPC (HTTP 413, -32614, 'limited to a 200 range') goes to 200 at once and keeps it", async () => {
    const client = clientOf("base");
    const fromBlock = TIP - 999n;
    asked.length = 0;
    expect(await handLogs(client, CORE, 2n, { fromBlock, toBlock: TIP })).toEqual([]);
    const first = take("base");
    // 1 000 blocks: refused once, then the node's own 200 named in its refusal, five windows.
    expect(spans(first)).toEqual([1_000, 200, 200, 200, 200, 200]);
    expect(first[0]!.refused).toBe(true);
    coversOnce(first, fromBlock, TIP);

    // The client learnt it: the next read starts at 200 and is never refused; a fresh client starts at 2 000.
    expect(logWindowOf(client)).toBe(200);
    expect(logWindowsOver(client, fromBlock, TIP)).toBe(5);
    await handLogs(client, CORE, 2n, { fromBlock, toBlock: TIP });
    expect(spans(take("base"))).toEqual([200, 200, 200, 200, 200]);
    expect(logWindowOf(clientOf("base"))).toBe(LOG_WINDOW);
  });

  it("halves a window refused with -32005 'more than 10000 results', which names no range", async () => {
    const client = clientOf("results");
    const fromBlock = TIP - 1_199n;
    asked.length = 0;
    const read = await readLogWindows(client, { fromBlock, toBlock: TIP }, (from, to) =>
      client.request({ method: "eth_getLogs", params: [{ address: CORE, fromBlock: numberToHex(from), toBlock: numberToHex(to) }] }),
    );
    expect(read).toEqual([]);
    const list = take("results");
    // 1 200 refused, then 600, each asked four times by viem's retries; 300 is taken. After two
    // windows taken it tries 600 again (refused: it is a node limit dressed as a result limit), then 300.
    expect(spans(list)).toEqual([1_200, 1_200, 1_200, 1_200, 600, 600, 600, 600, 300, 300, 600, 600, 600, 600, 300, 300]);
    coversOnce(list, fromBlock, TIP);
    // Too many results is a fact about those blocks, not about the node: the client keeps 2 000.
    expect(logWindowOf(client)).toBe(LOG_WINDOW);
  });

  it("shrinks around one dense block only, then grows back, and keeps nothing for the client", async () => {
    const client = clientOf("dense");
    setLogWindow(client, 200);
    const fromBlock = TIP - 1_999n;
    asked.length = 0;
    await handLogs(client, CORE, 2n, { fromBlock, toBlock: TIP });
    const list = take("dense");
    coversOnce(list, fromBlock, TIP);
    const taken = spans(list.filter((one) => !one.refused));
    // Down to the one dense block alone, then back up to 200 within a few windows of it.
    expect(taken).toContain(1);
    expect(Math.max(...taken.slice(taken.lastIndexOf(1)))).toBe(200);
    expect(list.length).toBeLessThan(80);
    expect(logWindowOf(client)).toBe(200);
  });

  it("does not take a head behind the block asked for a limit of the range", async () => {
    const client = clientOf("lag");
    asked.length = 0;
    const error = await handLogs(client, CORE, 2n, { fromBlock: TIP - 999n, toBlock: TIP }).catch((e: unknown) => e);
    expect(take("lag")).toHaveLength(1);
    expect((error as { details?: string }).details).toBe("block range extends beyond current head block");
    expect(logRangeRefusal(error)).toBeUndefined();
    expect(logWindowOf(client)).toBe(LOG_WINDOW);
  });

  it("keeps no size from a read the node refused all the way down", async () => {
    const client = clientOf("always");
    asked.length = 0;
    const error = await handLogs(client, CORE, 2n, { fromBlock: TIP - 999n, toBlock: TIP }).catch((e: unknown) => e);
    expect((error as { code?: number }).code).toBe(-32614);
    // 1 000, then the 200 the node named, then halving to one block: nothing was ever taken.
    expect(spans(take("always"))).toEqual([1_000, 200, 100, 50, 25, 12, 6, 3, 1]);
    expect(logWindowOf(client)).toBe(LOG_WINDOW);
  });

  it("passes any other error through unchanged, after one request", async () => {
    const client = clientOf("broken");
    asked.length = 0;
    const direct = await client.request({ method: "eth_getLogs", params: [{ address: CORE, fromBlock: numberToHex(TIP - 9n), toBlock: numberToHex(TIP) }] }).catch((e: unknown) => e);
    take("broken");
    const error = await handLogs(client, CORE, 2n, { fromBlock: TIP - 999n, toBlock: TIP }).catch((e: unknown) => e);
    expect(take("broken")).toHaveLength(1);
    expect(error).toBeInstanceOf((direct as Error).constructor);
    expect((error as { details?: string }).details).toBe("header not found");
    expect(logRangeRefusal(error)).toBeUndefined();
    expect(logWindowOf(client)).toBe(LOG_WINDOW);

    // A plain error from the read itself is the caller's own: it comes back as it was, not shrunk.
    const own = new Error("not a node's answer");
    await expect(readLogWindows(client, { fromBlock: 1n, toBlock: 5_000n }, async () => Promise.reject(own))).rejects.toBe(own);
  });

  it("a refusal of a single block is thrown: there is nothing smaller to ask", async () => {
    const refusal = Object.assign(new Error("block range too large"), { code: -32005 });
    const reads: number[] = [];
    const client = {};
    await expect(
      readLogWindows(client, { fromBlock: 1n, toBlock: 3n }, async (from, to) => {
        reads.push(Number(to - from + 1n));
        throw refusal;
      }),
    ).rejects.toBe(refusal);
    expect(reads).toEqual([3, 1]);
  });

  it("starts at a chain's configured window, and at a smaller one asked for a read", async () => {
    const client = clientOf("base");
    setLogWindow(client, 200);
    asked.length = 0;
    await handLogs(client, CORE, 2n, { fromBlock: TIP - 399n, toBlock: TIP });
    expect(spans(take("base"))).toEqual([200, 200]);
    await handLogs(client, CORE, 2n, { fromBlock: TIP - 399n, toBlock: TIP, chunk: 150 });
    expect(spans(take("base"))).toEqual([150, 150, 100]);
    expect(logWindowOf(client, 5_000)).toBe(200);
    expect(() => setLogWindow(client, 0)).toThrow(RangeError);
    expect(() => logWindowOf(client, 1.5)).toThrow(RangeError);
  });
});

describe("logRangeRefusal: what counts as a refusal of the range", () => {
  it("reads the node's words and codes, not viem's", () => {
    expect(logRangeRefusal({ status: 413, details: "Payload Too Large" })).toEqual({ kind: "range" });
    expect(logRangeRefusal({ code: -32614, message: "eth_getLogs is limited to a 200 range" })).toEqual({ kind: "range", limit: 200 });
    expect(logRangeRefusal(new Error("query exceeds max block range 1000", { cause: { code: -32602 } }))).toEqual({ kind: "range", limit: 1_000 });
    expect(logRangeRefusal({ code: -32602, message: "invalid params: maximum block range of 500 exceeded" })).toEqual({ kind: "range", limit: 500 });
    expect(logRangeRefusal({ code: -32000, message: "You can make eth_getLogs requests with up to a 2,000 block range" })).toEqual({ kind: "range", limit: 2_000 });
    expect(logRangeRefusal({ code: -32005, message: "query returned more than 10000 results" })).toEqual({ kind: "results" });
    // A node without the blocks asked says "block range" too, but a smaller window would not help.
    expect(logRangeRefusal({ code: -32000, message: "block range extends beyond current head block" })).toBeUndefined();
    expect(logRangeRefusal({ code: -32000, message: "header not found" })).toBeUndefined();
    // viem's own sentence for -32005 says "limit" but nothing of the range; a rate limit is not the range either.
    expect(logRangeRefusal({ name: "LimitExceededRpcError", shortMessage: "Request exceeds defined limit.", message: "Request exceeds defined limit.", code: -32005 })).toBeUndefined();
    expect(logRangeRefusal({ code: -32005, message: "daily request count exceeded, request rate limited" })).toBeUndefined();
    expect(logRangeRefusal({ code: 429, message: "Too Many Requests: too many results per second" })).toBeUndefined();
    expect(logRangeRefusal(new TypeError("fetch failed"))).toBeUndefined();
    expect(logRangeRefusal(undefined)).toBeUndefined();
  });
});
