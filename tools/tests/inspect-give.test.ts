import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { Address, Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import { signGiveWithKey } from "../../packages/sdk/src/sign.ts";
import { domain, type Give, type Hand } from "../../packages/sdk/src/types.ts";
import { ANVIL_KEYS, FOUNDRY_BIN, KeyAccountFactoryAbi, chainOn, cli, giveAddress, keyGiver, liveAddress, raise, sh, testPort, undeployedGiver, type Chain } from "./fixtures.ts";

/**
 * `inspect` once called a contract wallet's 65-byte signature "a key's" and gave no
 * verdict even with --rpc, while thank-calldata said "Core refused: InvalidGiverSig". It now names
 * the signature's form, who checks it by the signer's code, and Core's checkGive answer.
 */

let chain: Chain;

beforeAll(async () => {
  chain = await chainOn(testPort(9));
}, 60_000);

afterAll(async () => {
  await chain?.stop();
});

const rowOf = (output: string, label: string) => new RegExp(`^${label}:\\s+(.*)$`, "m").exec(output)?.[1];

/** A KeyAccount deployed now for `ownerKey`; it signs a Give with its owner's key, in the 65-byte form. */
async function deployedAccountGiver(ownerKey: Hex, salt: bigint, hand: Hand) {
  const owner = privateKeyToAddress(ownerKey);
  const factory = chain.accountFactory!;
  const deploy = sh(`"${FOUNDRY_BIN}/cast" send ${factory} "createAccount(address,uint256)" ${owner} ${salt} --rpc-url ${chain.rpc} --private-key ${ANVIL_KEYS[9]}`);
  expect(deploy.status).toBe(0);
  const account = (await chain.client.readContract({ address: factory, abi: KeyAccountFactoryAbi, functionName: "getAddress", args: [owner, salt] })) as Address;
  return { signer: account, payee: account, sign: (give: Give) => signGiveWithKey(ownerKey, domain(chain.chainId, chain.core), hand, give) };
}

describe("inspect, on a give link, with --rpc", () => {
  test("a key's Give: the 65-byte form, recovered by Core, and Core accepts", async () => {
    const raised = await raise(chain, { raiser: 1 });
    const give = await giveAddress(chain, await liveAddress(chain, raised, "described"), raised.hand, keyGiver(ANVIL_KEYS[2]!)(chain, raised.hand));
    const run = cli("inspect", give, "--rpc", chain.rpc);
    expect(run.status).toBe(0);
    expect(rowOf(run.stdout, "signature")).toBe("65-byte form (r, s, v)");
    expect(rowOf(run.stdout, "checked by")).toBe("no code at the signer: Core recovers the signing key and compares it with the signer");
    expect(rowOf(run.stdout, "core says")).toBe("Core accepts");
  }, 60_000);

  test("a contract wallet whose code now refuses: not called a key's, and Core refused: InvalidGiverSig", async () => {
    const raised = await raise(chain, { raiser: 1 });
    const live = await liveAddress(chain, raised, "described");
    const giver = await deployedAccountGiver(ANVIL_KEYS[6]!, 77n, raised.hand);
    const give = await giveAddress(chain, live, raised.hand, giver);

    const before = cli("inspect", give, "--rpc", chain.rpc);
    expect(before.status).toBe(0);
    expect(rowOf(before.stdout, "signature")).toBe("65-byte form (r, s, v)");
    expect(rowOf(before.stdout, "checked by")).toMatch(/^a contract \(\d+ bytes of code\): Core asks its isValidSignature \(ERC-1271\)/);
    expect(rowOf(before.stdout, "core says")).toBe("Core accepts");

    // The giver's wallet changes its mind (the hostile-links `refuse` fixture): its code now refuses every signature.
    await (chain.client.request as (a: { method: string; params: unknown[] }) => Promise<unknown>)({ method: "anvil_setCode", params: [giver.signer, "0x60206000f3"] });
    const after = cli("inspect", give, "--rpc", chain.rpc);
    expect(after.status).toBe(0);
    expect(after.stdout).not.toContain("a key's");
    expect(rowOf(after.stdout, "checked by")).toMatch(/^a contract \(5 bytes of code\)/);
    expect(rowOf(after.stdout, "core says")).toBe(
      "Core refused: InvalidGiverSig. The giver's signature doesn't check out: wrong key, or the smart wallet refused or isn't deployed.",
    );
    // thank-calldata says the same.
    expect(cli("thank-calldata", give, "--rpc", chain.rpc).stderr).toContain("Core refused: InvalidGiverSig.");
  }, 60_000);

  test("a Give signed by another key than its signer: Core refused: InvalidGiverSig", async () => {
    const raised = await raise(chain, { raiser: 1 });
    const liar = keyGiver(ANVIL_KEYS[4]!)(chain, raised.hand);
    const give = await giveAddress(chain, await liveAddress(chain, raised, "described"), raised.hand, { ...liar, signer: privateKeyToAddress(ANVIL_KEYS[2]!), payee: privateKeyToAddress(ANVIL_KEYS[2]!) });
    const run = cli("inspect", give, "--rpc", chain.rpc);
    expect(run.status).toBe(0);
    expect(rowOf(run.stdout, "core says")).toStartWith("Core refused: InvalidGiverSig.");
  }, 60_000);

  test("an ERC-6492 Give of an account not deployed yet: named as wrapped, and asked after its setup through the forwarder", async () => {
    const raised = await raise(chain, { raiser: 1 });
    const giver = await undeployedGiver(chain, ANVIL_KEYS[7]!, 5n, raised.hand);
    const give = await giveAddress(chain, await liveAddress(chain, raised, "bare"), raised.hand, giver);
    const run = cli("inspect", give, "--rpc", chain.rpc, "--forwarder", chain.forwarder!);
    expect(run.status).toBe(0);
    expect(rowOf(run.stdout, "signature")).toStartWith("wrapped for an account not deployed yet (ERC-6492, ");
    expect(rowOf(run.stdout, "checked by")).toBe("no code at the signer yet: Core hears the account only after its setup call");
    expect(rowOf(run.stdout, "core says")).toBe("Core accepts, after the account's setup call (asked through the forwarder)");
    // Asking does not deploy it.
    expect(await chain.client.getCode({ address: giver.signer })).toBeUndefined();
  }, 60_000);
});
