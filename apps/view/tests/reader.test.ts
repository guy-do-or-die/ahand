import { createServer, type IncomingMessage, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createPublicClient,
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  http,
  numberToHex,
  parseAbi,
  zeroHash,
  type Address,
  type Hex,
} from "viem";

import { aHandCoreAbi } from "@ahand/abi";

import { tokensOf, type ViewConfig } from "../src/config.ts";
import { readerFor } from "../src/preview.ts";

/**
 * The reader as it runs, with the client it makes for itself over VIEW_RPC (no client handed in),
 * against a scripted JSON-RPC node on 127.0.0.1. The node answers `hands(id)`, `thanks(id)` and the
 * latest block, and can be told to answer `hands(id)` with a CCIP-Read revert (`OffchainLookup`)
 * that names a second local server, or never to answer at all. What is checked is what the server
 * sends over the wire: how many HTTP requests, which calls, and whether anything ever reaches the
 * URL a contract names.
 */

const CORE: Address = "0x65ac707E2AE7392583de5d6192C619F1D8862309";
const DOLLAR: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const BLOCK_TIME = 1_797_724_800;

const OFFCHAIN_LOOKUP = parseAbi(["error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)"]);

type Mode = "hand" | "lookup" | "silent";

interface Rpc {
  url: string;
  mode: Mode;
  /** Each HTTP request: the JSON-RPC methods it carried (a batch carries several). */
  requests: string[][];
  close(): Promise<void>;
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    let text = "";
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => done(text));
    req.on("error", fail);
  });
}

function listen(server: Server): Promise<number> {
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done((server.address() as { port: number }).port)));
}

function closed(server: Server): Promise<void> {
  return new Promise((done) => {
    server.close(() => done());
    server.closeAllConnections();
  });
}

/** A web server that only counts the requests it gets: the URL an OffchainLookup names. */
async function gateway() {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url ?? "");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: "0x" }));
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}`, hits, close: () => closed(server) };
}

async function scriptedNode(lookupUrl: string): Promise<Rpc> {
  const rpc: Rpc = { url: "", mode: "hand", requests: [], close: async () => undefined };
  const answer = (call: { id: number; method: string; params: unknown[] }) => {
    if (call.method === "eth_getBlockByNumber") {
      return {
        id: call.id,
        jsonrpc: "2.0",
        result: { number: numberToHex(12), timestamp: numberToHex(BLOCK_TIME), hash: `0x${"ab".repeat(32)}`, parentHash: zeroHash, transactions: [] },
      };
    }
    if (call.method === "eth_call") {
      const { data } = call.params[0] as { to: Address; data: Hex };
      let functionName: string | undefined;
      try {
        functionName = decodeFunctionData({ abi: aHandCoreAbi, data }).functionName;
      } catch {
        // not one of Core's (the careless client's callback below): refused like any unscripted call
      }
      if (functionName === "hands" && rpc.mode === "lookup") {
        const revert = encodeErrorResult({
          abi: OFFCHAIN_LOOKUP,
          errorName: "OffchainLookup",
          args: [CORE, [`${lookupUrl}/{sender}/{data}.json`], "0x01", "0x12345678", "0x"],
        });
        return { id: call.id, jsonrpc: "2.0", error: { code: 3, message: "execution reverted", data: revert } };
      }
      if (functionName === "hands") {
        // raiser, expiry, openedAt, closedAt, token, payoutGasK, minClaimBps, reward, rootKey, dataHash
        const result = encodeFunctionResult({
          abi: aHandCoreAbi,
          functionName: "hands",
          result: ["0x0000000000000000000000000000000000000001", BLOCK_TIME + 86_400, BLOCK_TIME - 60, 0, DOLLAR, 250, 7_000, 40_000_000n, "0x0000000000000000000000000000000000000002", zeroHash],
        });
        return { id: call.id, jsonrpc: "2.0", result };
      }
    }
    return { id: call.id, jsonrpc: "2.0", error: { code: -32601, message: `not scripted: ${call.method}` } };
  };
  const server = createServer(async (req, res) => {
    const parsed = JSON.parse(await body(req)) as { id: number; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[];
    const calls = Array.isArray(parsed) ? parsed : [parsed];
    rpc.requests.push(calls.map((call) => call.method));
    if (rpc.mode === "silent") return; // never answers; the request stays open until the reader gives up
    const answers = calls.map(answer);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(Array.isArray(parsed) ? answers : answers[0]));
  });
  const port = await listen(server);
  rpc.url = `http://127.0.0.1:${port}`;
  rpc.close = () => closed(server);
  return rpc;
}

let node: Rpc;
let lookup: Awaited<ReturnType<typeof gateway>>;
let config: ViewConfig;

beforeAll(async () => {
  lookup = await gateway();
  node = await scriptedNode(lookup.url);
  config = {
    port: 0,
    dist: "/",
    rpc: node.url,
    chainId: 31337,
    trusted: [CORE],
    canonical: CORE,
    site: "http://view.test",
    relays: [],
    tokens: tokensOf(`${DOLLAR}:6:USDC:$`),
  };
});

afterAll(async () => {
  await node?.close();
  await lookup?.close();
});

describe("the reader's own client", () => {
  it("reads hands(id) and the latest block in one HTTP request, and calls nothing else", async () => {
    node.mode = "hand";
    node.requests.length = 0;
    const preview = await readerFor(config, undefined, { ttlMs: 0 }).preview("/31337/7", "");
    expect(preview).toMatchObject({ kind: "hand", handId: 7n, state: "open", block: 12n, reward: { amount: 40_000_000n, token: { symbol: "USDC", dollar: true } } });
    expect(node.requests).toHaveLength(1);
    expect(node.requests[0]!.toSorted()).toEqual(["eth_call", "eth_getBlockByNumber"]);
  });

  it("has CCIP-Read off: an OffchainLookup revert sends nothing to the URL it names, and the answer is the generic card", async () => {
    node.mode = "lookup";
    lookup.hits.length = 0;
    const preview = await readerFor(config, undefined, { ttlMs: 0 }).preview("/31337/7", "");
    // A revert of hands() is a reading that failed, not an answer about the Hand: transient.
    expect(preview).toEqual({ kind: "generic", transient: true });
    expect(lookup.hits).toEqual([]);

    // The same revert does reach the gateway through a client with CCIP-Read left on (viem's
    // default): the check above can tell the difference.
    const careless = createPublicClient({ transport: http(node.url, { retryCount: 0 }) });
    await careless.readContract({ address: CORE, abi: aHandCoreAbi, functionName: "hands", args: [7n] }).catch(() => undefined);
    expect(lookup.hits.length).toBeGreaterThan(0);
    expect(lookup.hits[0]).toStartWith(`/${CORE.toLowerCase()}/`);
  });

  it("gives up on a node that never answers at its deadline, with the generic card", async () => {
    node.mode = "silent";
    const started = performance.now();
    const preview = await readerFor(config, undefined, { ttlMs: 0, deadlineMs: 200 }).preview("/31337/7", "");
    const took = performance.now() - started;
    expect(preview).toEqual({ kind: "generic", transient: true });
    expect(took).toBeGreaterThanOrEqual(150);
    expect(took).toBeLessThan(2_000);
    node.mode = "hand";
  });

  it("reads only the path and d: a parameter the SDK would refuse cannot blank the address it rides on", async () => {
    node.mode = "hand";
    const reader = readerFor(config, undefined, { ttlMs: 60_000 });
    // A backslash, white space or a control character anywhere in an address makes the SDK refuse
    // it whole; the reader never hands it the parameters that are not `d`.
    expect(await reader.preview("/31337/7", "x=\\")).toMatchObject({ kind: "hand", handId: 7n });
    expect(await reader.preview("/31337/7", "")).toMatchObject({ kind: "hand", handId: 7n });
    expect(await reader.preview("/31337/8", "x=%20&y= \t")).toMatchObject({ kind: "hand", handId: 8n });
    // In `d` itself it is refused, as the SDK refuses it: an answer about that address only.
    expect(await reader.preview("/31337/9", "d=AQ\\")).toEqual({ kind: "generic" });
  });

  it("with no canonical Core configured, assumes none: an address must name its Core", async () => {
    node.mode = "hand";
    const { canonical: _, ...none } = config;
    const reader = readerFor(none, undefined, { ttlMs: 0 });
    node.requests.length = 0;
    expect(await reader.preview("/31337/7", "")).toEqual({ kind: "generic" });
    expect(node.requests).toEqual([]);
    expect(await reader.preview(`/31337/${CORE.toLowerCase()}/7`, "")).toMatchObject({ kind: "hand", core: CORE, handId: 7n });
    // With it configured, the same Core is named by leaving its address out, and only so.
    const canonical = readerFor(config, undefined, { ttlMs: 0 });
    expect(await canonical.preview("/31337/7", "")).toMatchObject({ kind: "hand", core: CORE });
    expect(await canonical.preview(`/31337/${CORE.toLowerCase()}/7`, "")).toEqual({ kind: "generic" });
  });

  it("remembers at most `entries` addresses, the least recently used forgotten first", async () => {
    node.mode = "hand";
    const reader = readerFor(config, undefined, { ttlMs: 60_000, entries: 2 });
    const one = reader.preview("/31337/1", "");
    const two = reader.preview("/31337/2", "");
    expect(reader.preview("/31337/1", "")).toBe(one);
    reader.preview("/31337/3", ""); // forgets /31337/2, the least recently used
    expect(reader.preview("/31337/1", "")).toBe(one);
    expect(reader.preview("/31337/2", "")).not.toBe(two);
    await Promise.all([one, two]);
  });
});
