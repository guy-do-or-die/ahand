import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { keysTypedData, masterOf, newBook, rootSeed } from "../../packages/sdk/src/keys.ts";
import { fromText, openLink } from "../../packages/sdk/src/link.ts";
import { ANVIL_KEYS, chainOn, cli, cliWithInput, leaks, raise, type Chain, type Raised, testPort } from "./fixtures.ts";

let chain: Chain;
let raised: Raised;
let signature: Hex;
let master: Hex;
let book: Hex;
const N = 7;

beforeAll(async () => {
  chain = await chainOn(testPort(6));
  // The raiser signs the keys message as the app asks for it; the root key is that of Hand number 7 in a fresh book.
  const account = privateKeyToAccount(ANVIL_KEYS[1]!);
  signature = await account.signTypedData(keysTypedData(chain.chainId, chain.core, account.address));
  master = await masterOf(signature);
  book = newBook();
  raised = await raise(chain, { raiser: 1, seed: await rootSeed(master, book, N) });
}, 60_000);

afterAll(async () => {
  await chain?.stop();
});

const id = () => String(raised.hand.handId);
const secretsIn = (text: string) => ({ seed: leaks(text, raised.seed), signature: leaks(text, signature), master: leaks(text, master) });
const none = { seed: [], signature: [], master: [] };

describe("recover", () => {
  test("finds n from the signature on standard input, and by default prints no secret in any of three forms", () => {
    const run = cliWithInput(`${signature}\n`, "recover", "--book", book, "--max", "20", "--rpc", chain.rpc, "--core", chain.core, id());
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`found: n = ${N} in book ${book}`);
    expect(run.stdout).toContain(`root key ${raised.hand.rootKey.slice(0, 10)}… is Hand ${id()}'s (first characters only)`);
    expect(run.stdout).toMatch(/add --print-link to print it/);
    expect(run.stdout).not.toContain(raised.hand.rootKey);
    expect(secretsIn(run.stdout + run.stderr)).toEqual(none);
  });

  test("the book is accepted as the 16-character code, without 0x", () => {
    const run = cliWithInput(signature.slice(2), "recover", "--book", book.slice(2).toUpperCase(), "--max", "20", "--rpc", chain.rpc, "--core", chain.core, id());
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`found: n = ${N}`);
  });

  test("--print-link prints the live link, which opens with the Hand's seed, under a warning", async () => {
    const run = cliWithInput(signature, "recover", "--book", book, "--rpc", chain.rpc, "--core", chain.core, id(), "--print-link", "--site", "http://127.0.0.1:18399");
    expect(run.status).toBe(0);
    expect(run.stderr).toMatch(/WARNING: the next line is this Hand's live link/);
    const address = run.stdout.trim().split("\n").at(-1)!;
    expect(address).toMatch(/^http:\/\/127\.0\.0\.1:18399\/#[A-Za-z0-9_-]+$/);
    const opened = await openLink(fromText(address.split("#")[1]!), async () => raised.hand, { canonicalCore: chain.core });
    expect(opened.seed).toBe(raised.seed);
    expect(secretsIn(run.stderr)).toEqual(none);
  });

  test("a wrong book or a too small --max finds nothing, says why, and prints no secret", () => {
    const wrong = cliWithInput(signature, "recover", "--book", newBook(), "--max", "20", "--rpc", chain.rpc, "--core", chain.core, id());
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toMatch(/ahand: no n from 0 to 20 in book 0x[0-9a-f]{16} gives the root key of Hand \d+/);
    expect(secretsIn(wrong.stdout + wrong.stderr)).toEqual(none);
    const short = cliWithInput(signature, "recover", "--book", book, "--max", String(N - 1), "--rpc", chain.rpc, "--core", chain.core, id());
    expect(short.status).toBe(1);
  });

  test("another key's signature is named as such", async () => {
    const other = privateKeyToAccount(ANVIL_KEYS[2]!);
    const foreign = await other.signTypedData(keysTypedData(chain.chainId, chain.core, raised.hand.raiser));
    const run = cliWithInput(foreign, "recover", "--book", book, "--max", "10", "--rpc", chain.rpc, "--core", chain.core, id());
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`that key is ${other.address}, not the raiser ${raised.hand.raiser}`);
  });

  test("the signature is never taken from an argument, and nothing on standard input is a usage error", () => {
    const asArgument = cli("recover", "--book", book, "--rpc", chain.rpc, "--core", chain.core, id(), "--signature", signature);
    expect(asArgument.status).toBe(2);
    expect(asArgument.stderr).toBe("ahand: unknown option --signature; see bun tools/ahand.ts help\n");
    const empty = cliWithInput("", "recover", "--book", book, "--rpc", chain.rpc, "--core", chain.core, id());
    expect(empty.status).toBe(2);
    expect(empty.stderr).toMatch(/no signature on standard input/);
  });
});

describe("help", () => {
  test("lists every command with an example", () => {
    const run = cli("help");
    expect(run.status).toBe(0);
    for (const command of ["inspect", "thank-calldata", "pass", "manifest", "core-check", "verify", "find", "recover"]) {
      expect(run.stdout).toMatch(new RegExp(`^  ${command} `, "m"));
      expect(run.stdout).toMatch(new RegExp(`e\\.g\\. .*bun tools/ahand\\.ts ${command} `));
    }
  });
});
