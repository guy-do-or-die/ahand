import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hexToBigInt, hexToBytes } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import { toText } from "../../packages/sdk/src/link.ts";
import { ANVIL_KEYS, chainOn, cli, liveAddress, openWith, raise, type Chain, type Raised } from "./fixtures.ts";

let chain: Chain;
let raised: Raised;
let faced: string;

beforeAll(async () => {
  chain = await chainOn(18357);
  raised = await raise(chain, { content: "Twice a week, evenings.\nBeginner, adult." });
  faced = await liveAddress(chain, raised, "faced");
}, 60_000);

afterAll(async () => {
  await chain?.stop();
});

/** Every way a seed could leak into text: hex (any case, with or without 0x), base64url, decimal digits. */
function leaks(output: string, seed: `0x${string}`): string[] {
  const found: string[] = [];
  if (output.toLowerCase().includes(seed.slice(2).toLowerCase())) found.push("hex");
  if (output.includes(toText(hexToBytes(seed)))) found.push("base64url");
  if (output.includes(hexToBigInt(seed).toString(10))) found.push("digits");
  return found;
}

describe("inspect", () => {
  test("prints the head, the sizes and the route, and never the seed", async () => {
    const run = cli("inspect", faced, "--rpc", chain.rpc);
    expect(run.status).toBe(0);
    const output = run.stdout + run.stderr;
    expect(output).toMatch(/secret:\s+present \(16 bytes\)/);
    expect(output).toMatch(new RegExp(`hand:\\s+${raised.hand.handId} on chain 31337`));
    expect(output).toMatch(/size:\s+link \d+ bytes · \d+ characters as text · \d+ digits for a QR code · address \d+ characters/);
    expect(output).toMatch(/route:\s+0 passes from the root key/);
    expect(output).toContain('title     "Looking for a violin teacher in Tbilisi"');
    expect(output).toContain('content   "Twice a week, evenings.\\nBeginner, adult."');
    expect(output).toMatch(/state:\s+open, (29d 23h|30d 0h)/);
    expect(leaks(output, raised.seed)).toEqual([]);
    // Nor the link itself, in either form.
    expect(output).not.toContain(faced.slice(faced.indexOf("#") + 1));
  });

  test("offline, it prints the head and the sizes and says the route needs the chain", () => {
    const run = cli("inspect", faced, "--core", chain.core);
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/secret:\s+present \(16 bytes\)/);
    expect(run.stdout).toContain("add --rpc URL");
    expect(leaks(run.stdout + run.stderr, raised.seed)).toEqual([]);
  });

  test("a broken link is a plain sentence and a non-zero exit", () => {
    const cut = faced.slice(0, -6);
    const run = cli("inspect", cut, "--rpc", chain.rpc);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^ahand: /);
    expect(run.stderr.split("\n").filter(Boolean)).toHaveLength(1);
  });
});

describe("pass", () => {
  test("produces an address that opens with one more pass and the chosen share, in the same shape", async () => {
    const payee = privateKeyToAddress(ANVIL_KEYS[3]!);
    const first = cli("pass", faced, "--rpc", chain.rpc, "--share-bps", "1000", "--payee", payee);
    expect(first.status).toBe(0);
    const next = first.stdout.trim();
    expect(next.split("\n")).toHaveLength(1);
    expect(next).toMatch(/^http:\/\/127\.0\.0\.1:15299\/31337\/\d+\?d=[A-Za-z0-9_-]+#[A-Za-z0-9_-]+$/);
    expect(first.stderr).toContain(`pays ${payee} 10% if its route is thanked`);
    expect(leaks(next, raised.seed)).toEqual([]);

    const opened = await openWith(chain, next, raised.hand);
    expect(opened.signedShakes).toHaveLength(1);
    const shake = opened.signedShakes[0]!.shake;
    expect(shake.payee).toBe(payee);
    expect(shake.claimBps - shake.nextClaimBps).toBe(1000);
    expect(opened.ofHand.texts).toContain("Looking for a violin teacher in Tbilisi");

    // And once more, at 0%, with no payee: two passes now, the second keeping nothing.
    const second = cli("pass", next, "--rpc", chain.rpc);
    expect(second.status).toBe(0);
    const again = await openWith(chain, second.stdout.trim(), raised.hand);
    expect(again.signedShakes).toHaveLength(2);
    expect(again.signedShakes[1]!.shake.nextClaimBps).toBe(9000);

    const inspected = cli("inspect", second.stdout.trim(), "--rpc", chain.rpc);
    expect(inspected.status).toBe(0);
    expect(inspected.stdout).toMatch(/route:\s+2 passes/);
    expect(inspected.stdout).toContain(`payee ${payee} · share 10% of the reward`);
  });

  test("a bare address stays bare and carries its words inside", async () => {
    const other = await raise(chain, { title: "Dark one" });
    const bare = await liveAddress(chain, other, "bare");
    const run = cli("pass", bare, "--rpc", chain.rpc);
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toMatch(/^http:\/\/127\.0\.0\.1:15299\/#[A-Za-z0-9_-]+$/);
    const opened = await openWith(chain, run.stdout.trim(), other.hand);
    expect(opened.inside.texts).toEqual(["Dark one"]);
  });

  test("refuses a share that leaves the giver less than the minimum, and a share with nowhere to land", () => {
    const payee = privateKeyToAddress(ANVIL_KEYS[3]!);
    const greedy = cli("pass", faced, "--rpc", chain.rpc, "--share-bps", "3500", "--payee", payee);
    expect(greedy.status).toBe(1);
    expect(greedy.stderr).toContain("the giver must keep at least 70%, so at most 30% can be kept");
    const nowhere = cli("pass", faced, "--rpc", chain.rpc, "--share-bps", "100");
    expect(nowhere.status).toBe(2);
    expect(nowhere.stderr).toContain("a share needs somewhere to land");
    const core = cli("pass", faced, "--rpc", chain.rpc, "--share-bps", "100", "--payee", chain.core);
    expect(core.status).toBe(1);
    expect(core.stderr).toContain("that address is the contract itself");
  });

  test("refuses a link of another Core than the trusted one", () => {
    const run = cli("inspect", faced, "--rpc", chain.rpc, "--core", chain.tokens[0]!.address);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/ahand: /);
  });
});
