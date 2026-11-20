import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { privateKeyToAddress } from "viem/accounts";

import {
  ANVIL_KEYS,
  FOUNDRY_BIN,
  balanceOf,
  chainOn,
  cli,
  giveAddress,
  handOnChain,
  keyGiver,
  liveAddress,
  raise,
  sh,
  undeployedGiver,
  type Chain,
} from "./fixtures.ts";

let chain: Chain;
const scratch = mkdtempSync(join(tmpdir(), "ahand-tools-thank-"));

beforeAll(async () => {
  chain = await chainOn(18358);
}, 60_000);

afterAll(async () => {
  await chain?.stop();
});

/** Sends the thank with the shell exit kit, as the raiser, with the worst gas the CLI printed. */
function thankWithExitKit(output: string, file: string, raiserKey: string) {
  const gas = /--gas-limit (\d+)/.exec(output)?.[1];
  expect(gas).toBeDefined();
  return sh(`bash contracts/exit/ahand.sh thank ${file} -- --gas-limit ${gas} --private-key ${raiserKey}`, {
    RPC: chain.rpc,
    CORE: chain.core,
    FOUNDRY_BIN,
  });
}

describe("thank-calldata", () => {
  test("its calldata, sent with ahand.sh thank, closes the Hand as thanked and pays the route", async () => {
    const raised = await raise(chain, { raiser: 1 });
    const live = await liveAddress(chain, raised, "faced");
    // One holder keeps 10% for account 3, then the giver (account 2) answers.
    const holder = privateKeyToAddress(ANVIL_KEYS[3]!);
    const passed = cli("pass", live, "--rpc", chain.rpc, "--share-bps", "1000", "--payee", holder);
    expect(passed.status).toBe(0);
    const give = await giveAddress(chain, passed.stdout.trim(), raised.hand, keyGiver(ANVIL_KEYS[2]!)(chain, raised.hand));

    const file = join(scratch, "thank.hex");
    const run = cli("thank-calldata", give, "--rpc", chain.rpc, "--out", file);
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/core says:\s+checkGive accepts it \(give hash 0x[0-9a-f]{64}\)/);
    expect(run.stdout).toMatch(/worst gas:\s+[\d ]+ \(every payee burns its 250k limit/);
    expect(run.stdout).not.toContain("step 1 of 2");
    const calldata = readFileSync(file, "utf8").trim();
    expect(run.stdout).toContain(`thank ${calldata}`);

    const giver = privateKeyToAddress(ANVIL_KEYS[2]!);
    const [giverBefore, holderBefore] = [await balanceOf(chain, giver), await balanceOf(chain, holder)];
    const sent = thankWithExitKit(run.stdout, file, raised.raiserKey);
    expect(sent.stderr).toBe("");
    expect(sent.status).toBe(0);

    const after = await handOnChain(chain, raised.hand.handId);
    expect(after.closedAt).toBeGreaterThan(0);
    expect(after.giveHash).toBe(/give hash (0x[0-9a-f]{64})/.exec(run.stdout)![1]! as `0x${string}`);
    expect((await balanceOf(chain, holder)) - holderBefore).toBe(raised.reward / 10n);
    expect((await balanceOf(chain, giver)) - giverBefore).toBe((raised.reward * 9n) / 10n);

    // Asked again, the Hand is closed: a plain refusal.
    const again = cli("thank-calldata", give, "--rpc", chain.rpc);
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/^ahand: Hand \d+ cannot be thanked: closed: thanked at/);
  }, 60_000);

  test("a Give wrapped per ERC-6492: the setup line, then the thank calldata; in that order they close the Hand", async () => {
    const raised = await raise(chain, { raiser: 1 });
    const live = await liveAddress(chain, raised, "bare");
    const giver = await undeployedGiver(chain, ANVIL_KEYS[6]!, 42n, raised.hand);
    expect(await chain.client.getCode({ address: giver.signer })).toBeUndefined();
    const give = await giveAddress(chain, live, raised.hand, giver);

    const file = join(scratch, "thank-6492.hex");
    const run = cli("thank-calldata", give, "--rpc", chain.rpc, "--forwarder", chain.forwarder!, "--out", file);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("wrapped for an account not deployed yet (ERC-6492");
    expect(run.stdout).toMatch(/core says:\s+checkGive accepts it after the setup call, asked through the forwarder/);
    const lines = run.stdout.split("\n");
    const setupAt = lines.findIndex((line) => line.startsWith("setup "));
    const thankAt = lines.findIndex((line) => line.startsWith("thank 0x"));
    expect(setupAt).toBeGreaterThan(-1);
    expect(thankAt).toBeGreaterThan(setupAt);
    const calldata = readFileSync(file, "utf8").trim();
    expect(lines[thankAt]).toBe(`thank ${calldata}`);
    // The thank carries the inner signature, never the wrapper.
    expect(calldata).not.toContain("6492649264926492649264926492649264926492649264926492649264926492");

    // Thanking before the setup fails: Core cannot hear an account that does not exist. With an
    // explicit gas limit cast sends without simulating, so the refusal shows as a failed
    // transaction; ahand.sh says so, names Core's error by replaying it, and exits 1. The Hand
    // stays open.
    const early = thankWithExitKit(run.stdout, file, raised.raiserKey);
    expect(early.status).toBe(1);
    expect(early.stdout).toMatch(/status\s+0 \(failed\)/);
    expect(early.stderr).toContain("the transaction was mined and reverted");
    expect(early.stderr).toContain("Core refused: InvalidGiverSig.");
    expect((await handOnChain(chain, raised.hand.handId)).closedAt).toBe(0);

    // Step 1, sent by someone who is neither raiser nor giver (account 9), then step 2.
    const setup = lines[setupAt]!.slice("setup ".length).replace("<your signing option>", `--private-key ${ANVIL_KEYS[9]}`);
    const setupRun = sh(setup);
    expect(setupRun.status).toBe(0);
    expect(await chain.client.getCode({ address: giver.signer })).not.toBeUndefined();

    const before = await balanceOf(chain, giver.signer);
    const sent = thankWithExitKit(run.stdout, file, raised.raiserKey);
    expect(sent.status).toBe(0);
    const after = await handOnChain(chain, raised.hand.handId);
    expect(after.closedAt).toBeGreaterThan(0);
    expect(after.giveHash).not.toBe(`0x${"0".repeat(64)}`);
    expect((await balanceOf(chain, giver.signer)) - before).toBe(raised.reward);
  }, 60_000);

  test("once the account exists, the same give link thanks directly with the inner signature", async () => {
    const raised = await raise(chain, { raiser: 1 });
    const live = await liveAddress(chain, raised, "faced");
    const giver = await undeployedGiver(chain, ANVIL_KEYS[6]!, 43n, raised.hand);
    // Someone deploys the account beforehand (R-28's second way).
    const deploy = sh(
      `"${FOUNDRY_BIN}/cast" send ${chain.accountFactory} "createAccount(address,uint256)" ${privateKeyToAddress(ANVIL_KEYS[6]!)} 43 --rpc-url ${chain.rpc} --private-key ${ANVIL_KEYS[9]}`,
    );
    expect(deploy.status).toBe(0);
    expect(await chain.client.getCode({ address: giver.signer })).not.toBeUndefined();
    const give = await giveAddress(chain, live, raised.hand, giver);
    const file = join(scratch, "thank-deployed.hex");
    const run = cli("thank-calldata", give, "--rpc", chain.rpc, "--out", file);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("the account is deployed by now, so the inner signature is used");
    expect(run.stdout).not.toContain("setup ");
    expect(thankWithExitKit(run.stdout, file, raised.raiserKey).status).toBe(0);
    expect((await handOnChain(chain, raised.hand.handId)).closedAt).toBeGreaterThan(0);
  }, 60_000);

  test("refuses with Core's reason when Core refuses", async () => {
    const raised = await raise(chain, { raiser: 1 });
    const live = await liveAddress(chain, raised, "faced");
    // The Give names account 2 as its signer, but account 4's key signs it.
    const liar = keyGiver(ANVIL_KEYS[4]!)(chain, raised.hand);
    const give = await giveAddress(chain, live, raised.hand, { ...liar, signer: privateKeyToAddress(ANVIL_KEYS[2]!), payee: privateKeyToAddress(ANVIL_KEYS[2]!) });
    const run = cli("thank-calldata", give, "--rpc", chain.rpc);
    expect(run.status).toBe(1);
    expect(run.stderr.trim()).toBe(
      "ahand: Core refused: InvalidGiverSig. The giver's signature doesn't check out: wrong key, or the smart wallet refused or isn't deployed.",
    );
  }, 60_000);

  test("without a forwarder, an undeployed giver is pointed to the third way", async () => {
    const raised = await raise(chain, { raiser: 1 });
    const live = await liveAddress(chain, raised, "faced");
    const giver = await undeployedGiver(chain, ANVIL_KEYS[7]!, 1n, raised.hand);
    const give = await giveAddress(chain, live, raised.hand, giver);
    const run = cli("thank-calldata", give, "--rpc", chain.rpc);
    if (run.status === 0) {
      // A deployment file for 31337 names a forwarder; then the line is printed.
      expect(run.stdout).toContain("setup ");
    } else {
      expect(run.stderr).toContain("R-28's third way");
    }
  }, 60_000);

  test("a live link is not a give link", async () => {
    const raised = await raise(chain, { raiser: 1 });
    const live = await liveAddress(chain, raised, "faced");
    const run = cli("thank-calldata", live, "--rpc", chain.rpc);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("not a give link");
  }, 60_000);
});
