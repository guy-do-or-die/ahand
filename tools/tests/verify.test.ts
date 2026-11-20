import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { privateKeyToAddress } from "viem/accounts";

import { seenIn } from "../../packages/sdk/src/address.ts";
import { fromText } from "../../packages/sdk/src/link.ts";
import { collect, passportOf, type Check } from "../../packages/sdk/src/proof.ts";
import { SENTENCES } from "../lib/passport.ts";
import { ANVIL_KEYS, advance, chainOn, cli, giveAddress, keyGiver, liveAddress, raise, thank, type Chain, type Raised } from "./fixtures.ts";

let chain: Chain;
let thanked: Raised;
let give: string;
const scratch = mkdtempSync(join(tmpdir(), "ahand-tools-verify-"));

/** The check lines of verify's output: id, verdict. */
function linesOf(stdout: string): { id: string; verdict: string }[] {
  const rows: { id: string; verdict: string }[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^(\S+)\s+(ok|FAIL|not checkable)\s{2,}\S/.exec(line);
    if (match) rows.push({ id: match[1]!, verdict: match[2]! });
  }
  return rows;
}

const verdict = (check: Check) => (check.ok === true ? "ok" : check.ok === false ? "FAIL" : "not checkable");

beforeAll(async () => {
  chain = await chainOn(18353);
  // A Hand passed once with a 10% share to account 3, answered by account 2, thanked by account 1.
  thanked = await raise(chain, { raiser: 1, content: "Two lessons a week." });
  const live = await liveAddress(chain, thanked, "faced");
  const passed = cli("pass", live, "--rpc", chain.rpc, "--share-bps", "1000", "--payee", privateKeyToAddress(ANVIL_KEYS[3]!));
  if (passed.status !== 0) throw new Error(passed.stderr);
  give = await giveAddress(chain, passed.stdout.trim(), thanked.hand, keyGiver(ANVIL_KEYS[2]!)(chain, thanked.hand));
  await thank(chain, thanked, give);
}, 120_000);

afterAll(async () => {
  await chain?.stop();
});

describe("verify --rpc", () => {
  test("a thanked Hand with its give address: every check ok, exit 0, the same ids and verdicts as passportOf", async () => {
    const run = cli("verify", "--rpc", chain.rpc, "--core", chain.core, String(thanked.hand.handId), "--give", give);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const printed = linesOf(run.stdout);
    expect(printed.length).toBeGreaterThan(15);
    expect(printed.every((row) => row.verdict === "ok")).toBe(true);

    const opened = give.indexOf("#");
    const record = await collect(chain.client, chain.core, thanked.hand.handId, {
      giveLink: fromText(give.slice(opened + 1)),
      outside: seenIn(give.slice(0, opened), { canonicalCore: chain.core }).data,
    });
    const checks = await passportOf(record);
    expect(printed.map((row) => row.id)).toEqual(checks.map((check) => check.id));
    // Without build facts the SDK cannot check the contract; the CLI gives it this clone's build.
    expect(printed.slice(1).map((row) => row.verdict)).toEqual(checks.slice(1).map(verdict));
    expect(checks.map((check) => check.id)).toContain("route-hash");
    expect(checks.map((check) => check.id)).toContain("payout.giver");
    expect(run.stdout).toMatch(/the contract is checked against the initcode this clone builds/);
    expect(run.stdout).toMatch(/\d+ checks: \d+ ok, 0 not checkable here, 0 failed/);
  });

  test("without a give address: signatures come from the thank's input; only the description is not checkable", async () => {
    const run = cli("verify", "--rpc", chain.rpc, "--core", chain.core, String(thanked.hand.handId));
    expect(run.status).toBe(0);
    const printed = linesOf(run.stdout);
    const record = await collect(chain.client, chain.core, thanked.hand.handId);
    expect(printed.map((row) => row.id)).toEqual((await passportOf(record)).map((check) => check.id));
    expect(printed.filter((row) => row.verdict !== "ok").map((row) => row.id)).toEqual(["description"]);
    expect(run.stdout).toMatch(/why\s+the words travel only in the link/);
  });

  test("every sentence key passportOf used has an English sentence", async () => {
    const record = await collect(chain.client, chain.core, thanked.hand.handId);
    for (const check of await passportOf(record)) expect(Object.keys(SENTENCES)).toContain(check.sentence);
  });

  test("--details prints formula, expected, actual and source under each check", () => {
    const run = cli("verify", "--rpc", chain.rpc, "--core", chain.core, String(thanked.hand.handId), "--details");
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/formula\s+giveHash\(Hand terms/);
    expect(run.stdout).toMatch(/source\s+event Thanked in block \d+, tx 0x[0-9a-f]{64}, log \d+/);
  });

  test("an open Hand has the first four checks; a refunded one its shorter list", async () => {
    const open = await raise(chain, { raiser: 4, days: 2 });
    const run = cli("verify", "--rpc", chain.rpc, "--core", chain.core, String(open.hand.handId));
    expect(run.status).toBe(0);
    expect(linesOf(run.stdout).map((row) => row.id)).toEqual(["core", "raised", "reward-time", "description"]);

    await advance(chain, 3 * 86_400);
    const { createWalletClient, http } = await import("viem");
    const { privateKeyToAccount } = await import("viem/accounts");
    const { foundry } = await import("viem/chains");
    const { AHandCoreAbi } = await import("@ahand/abi");
    const wallet = createWalletClient({ account: privateKeyToAccount(ANVIL_KEYS[5]!), chain: foundry, transport: http(chain.rpc) });
    const hash = await wallet.writeContract({ address: chain.core, abi: AHandCoreAbi, functionName: "refund", args: [open.hand.handId] });
    await chain.client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
    const refunded = cli("verify", "--rpc", chain.rpc, "--core", chain.core, String(open.hand.handId));
    expect(refunded.status).toBe(0);
    const ids = linesOf(refunded.stdout).map((row) => row.id);
    expect(ids.slice(0, 6)).toEqual(["core", "raised", "reward-time", "description", "refunded", "payout.raiser"]);
    expect(ids.at(-1)).toMatch(/^now\.0x/);
  });

  test("a number no Hand has, and a live link given as --give, are refused in one sentence", async () => {
    const missing = cli("verify", "--rpc", chain.rpc, "--core", chain.core, "999999");
    expect(missing.status).toBe(1);
    expect(missing.stderr).toBe(`ahand: Hand 999999 is not raised on Core ${chain.core} (chain 31337)\n`);
    const live = await liveAddress(chain, await raise(chain, { raiser: 1 }), "faced");
    const refused = cli("verify", "--rpc", chain.rpc, "--core", chain.core, String(thanked.hand.handId), "--give", live);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toMatch(/--give takes a give link .* this one is live: it is not used and not saved/);
  });
});

describe("verify --bundle", () => {
  test("a saved proof re-checks with no network and prints the same lines", () => {
    const file = join(scratch, "hand.proof.json");
    const online = cli("verify", "--rpc", chain.rpc, "--core", chain.core, String(thanked.hand.handId), "--give", give, "--save", file);
    expect(online.status).toBe(0);
    const offline = cli("verify", "--bundle", file);
    expect(offline.status).toBe(0);
    expect(offline.stdout).toMatch(/no network was used/);
    expect(linesOf(offline.stdout)).toEqual(linesOf(online.stdout));
  });

  test("a tampered bundle exits non-zero and names the check", () => {
    const file = join(scratch, "tampered.proof.json");
    expect(cli("verify", "--rpc", chain.rpc, "--core", chain.core, String(thanked.hand.handId), "--save", file).status).toBe(0);
    const bundle = JSON.parse(readFileSync(file, "utf8"));
    // The helper's payout grows by one unit.
    const given = bundle.logs.findIndex((log: { eventName: string }) => log.eventName === "Given");
    const payout = bundle.logs[given + 1];
    expect(["Paid", "Pending"]).toContain(payout.eventName);
    payout.args.amount = String(BigInt(payout.args.amount) + 1n);
    writeFileSync(file, JSON.stringify(bundle, null, 2));
    const run = cli("verify", "--bundle", file);
    expect(run.status).toBe(1);
    const failed = linesOf(run.stdout).filter((row) => row.verdict === "FAIL").map((row) => row.id);
    expect(failed).toEqual(["payout.giver", "payouts"]);
    expect(run.stderr).toBe("ahand: 2 checks failed: payout.giver, payouts\n");
    expect(run.stdout).toMatch(/expected\s+Paid or Pending · \d+ · 0x/);
  });

  test("a bundle whose Core is another than this clone builds fails the contract check", () => {
    const file = join(scratch, "other-core.proof.json");
    expect(cli("verify", "--rpc", chain.rpc, "--core", chain.core, String(thanked.hand.handId), "--save", file).status).toBe(0);
    const bundle = JSON.parse(readFileSync(file, "utf8"));
    bundle.core = privateKeyToAddress(ANVIL_KEYS[9]!);
    writeFileSync(file, JSON.stringify(bundle));
    const run = cli("verify", "--bundle", file);
    expect(run.status).toBe(1);
    expect(linesOf(run.stdout).find((row) => row.id === "core")?.verdict).toBe("FAIL");
  });

  test("something that is not a bundle is refused in one sentence", () => {
    const file = join(scratch, "nothing.json");
    writeFileSync(file, JSON.stringify({ format: "something else" }));
    const run = cli("verify", "--bundle", file);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^ahand: not an aHand proof bundle: /);
  });
});
