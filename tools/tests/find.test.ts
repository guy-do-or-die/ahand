import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { privateKeyToAddress } from "viem/accounts";

import { ANVIL_KEYS, REPO, advance, chainOn, cli, raise, type Chain, testPort } from "./fixtures.ts";

/**
 * `find` through a recording proxy in front of the helper chain: the proxy counts each
 * eth_getLogs, can slow them down, and, at the first one, waits a moment and then takes what the
 * CLI had written to stderr by then. The CLI is blocked on that very request, so what it wrote
 * before is exactly what it printed before its first log request.
 */
const PROXY_PORT = testPort(5);

let chain: Chain;
let older: bigint;
let later: bigint[];
let other: bigint;

interface Proxy {
  url: string;
  getLogs: number;
  delayMs: number;
  /** stderr of the running CLI, as far as it has arrived. */
  stderr: () => string;
  /** stderr at the moment of the first eth_getLogs. */
  beforeFirst?: string;
  stop(): void;
}

function proxy(): Proxy {
  const state: Proxy = {
    url: `http://127.0.0.1:${PROXY_PORT}`,
    getLogs: 0,
    delayMs: 0,
    stderr: () => "",
    stop: () => server.stop(true),
  };
  const server = Bun.serve({
    port: PROXY_PORT,
    hostname: "127.0.0.1",
    async fetch(request) {
      const body = await request.text();
      const calls = [JSON.parse(body)].flat() as { method: string }[];
      if (calls.some((call) => call.method === "eth_getLogs")) {
        state.getLogs++;
        if (state.getLogs === 1) {
          await Bun.sleep(150);
          state.beforeFirst = state.stderr();
        }
        if (state.delayMs) await Bun.sleep(state.delayMs);
      }
      const answer = await fetch(chain.rpc, { method: "POST", headers: { "content-type": "application/json" }, body });
      return new Response(await answer.text(), { headers: { "content-type": "application/json" } });
    },
  });
  return state;
}

/** Runs the CLI as a child with live stderr; `onStderr` sees it as it arrives. */
async function run(args: string[], onStderr?: (text: string, child: ReturnType<typeof Bun.spawn>) => void) {
  const env = { ...process.env };
  delete env.RPC;
  delete env.CORE;
  const child = Bun.spawn(["bun", "tools/ahand.ts", ...args], { cwd: REPO, env, stdout: "pipe", stderr: "pipe" });
  let stderr = "";
  const reading = (async () => {
    const decoder = new TextDecoder();
    const reader = (child.stderr as ReadableStream<Uint8Array>).getReader();
    for (let part = await reader.read(); !part.done; part = await reader.read()) {
      stderr += decoder.decode(part.value, { stream: true });
      onStderr?.(stderr, child);
    }
  })();
  const stdout = await new Response(child.stdout as ReadableStream<Uint8Array>).text();
  const status = await child.exited;
  await reading;
  return { status, stdout, stderrText: stderr };
}

const raiser = privateKeyToAddress(ANVIL_KEYS[1]!);

beforeAll(async () => {
  chain = await chainOn(testPort(4));
  older = (await raise(chain, { raiser: 1 })).hand.handId;
  await advance(chain, 2 * 86_400);
  later = [(await raise(chain, { raiser: 1, reward: 5_000_000n })).hand.handId];
  other = (await raise(chain, { raiser: 3 })).hand.handId;
  later.push((await raise(chain, { raiser: 1, reward: 0n })).hand.handId);
}, 120_000);

afterAll(async () => {
  await chain?.stop();
});

describe("find", () => {
  test("prints its request count before the first log request, makes exactly that many, and finds the raiser's Hands in the window", async () => {
    const recording = proxy();
    try {
      let stderr = "";
      recording.stderr = () => stderr;
      const result = await run(["find", "--rpc", recording.url, "--core", chain.core, "--raiser", raiser, "--days", "1"], (text) => (stderr = text));
      expect(result.status).toBe(0);
      const count = /find: (\d+) requests?: eth_getLogs over blocks (\d+)–(\d+)/.exec(result.stderrText);
      expect(count).not.toBeNull();
      expect(recording.beforeFirst).toContain(count![0]);
      expect(recording.getLogs).toBe(Number(count![1]));
      const found = [...result.stdout.matchAll(/^#(\d+)\s+(\S+)\s+(.+?)\s+raised in block/gm)];
      expect(found.map((row) => BigInt(row[1]!))).toEqual(later);
      expect(found.map((row) => row[2])).toEqual(["open", "open"]);
      expect(found[0]![3]).toBe("5 mUSD (5000000 units)");
      expect(found[1]![3]).toBe("0 mUSD (0 units)");
      expect(result.stdout).not.toMatch(new RegExp(`^#(${older}|${other})\\b`, "m"));
      expect(result.stdout).toMatch(/^2 Hands raised by 0x[0-9a-fA-F]{40} in blocks \d+–\d+$/m);
    } finally {
      recording.stop();
    }
  });

  test("three days back it also finds the older Hand", () => {
    const result = cli("find", "--rpc", chain.rpc, "--core", chain.core, "--raiser", raiser, "--days", "3");
    expect(result.status).toBe(0);
    expect([...result.stdout.matchAll(/^#(\d+)/gm)].map((row) => BigInt(row[1]!))).toEqual([older, ...later]);
  });

  test("Ctrl-C stops it after the request in flight and prints what was found so far", async () => {
    const recording = proxy();
    recording.delayMs = 120;
    try {
      let sent = false;
      const result = await run(["find", "--rpc", recording.url, "--core", chain.core, "--raiser", raiser, "--days", "3", "--chunk", "1"], (_text, child) => {
        if (!sent && recording.getLogs >= 2) {
          sent = true;
          child.kill("SIGINT");
        }
      });
      // The progress lines (one per window or so) are what trigger the check above.
      expect(sent).toBe(true);
      expect(result.status).toBe(130);
      const total = Number(/find: (\d+) requests?:/.exec(result.stderrText)![1]);
      const stopped = /^stopped after (\d+) of (\d+) requests: \d+ Hands? found so far$/m.exec(result.stdout);
      expect(stopped).not.toBeNull();
      expect(Number(stopped![2])).toBe(total);
      expect(Number(stopped![1])).toBeLessThan(total);
      expect(recording.getLogs).toBeLessThan(total);
    } finally {
      recording.stop();
    }
  }, 60_000);

  test("its help says an indexer would replace it; a missing raiser is a usage error", () => {
    expect(cli("help").stdout).toMatch(/An indexer would replace this search\./);
    const missing = cli("find", "--rpc", chain.rpc, "--days", "1");
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(/^ahand: give the raiser: find --rpc URL/);
    expect(cli("find", "--rpc", chain.rpc, "--raiser", raiser, "--days", "0").status).toBe(2);
  });
});
