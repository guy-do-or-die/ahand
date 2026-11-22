import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isErc6492, unwrapErc6492 } from "@ahand/sdk";
import { createWalletClient, custom, parseErc6492Signature, recoverTypedDataAddress, type PublicClient, type TypedDataDefinition } from "viem";
import { base, foundry } from "viem/chains";

import { ANVIL_KEYS, startChain, type Chain } from "../../../../packages/sdk/tests/helpers/anvil";
import { devAccounts, devAddress, devConnectors, devProvider, devUnsetSetup, reviveTypedData, sayNoNext, type DevWho } from "./dev";
import { signTypedWith } from "./typed";
import { privateKeyToAccount } from "viem/accounts";
const HAND_PORT_BASE = process.env.HAND_TEST_PORT_BASE ? Number(process.env.HAND_TEST_PORT_BASE) : undefined;
const BASE_RPC_PORT = HAND_PORT_BASE === undefined ? 25051 : HAND_PORT_BASE + 3;

/**
 * The dev wallet's provider on a real anvil: what the wallet smoke checks in the browser, here
 * without one. Port 16112 is this file's; HAND_TEST_PORT_BASE=B moves it to B+2 (and the fake Base RPC below to B+3).
 */

let chain: Chain;
let client: PublicClient;

beforeAll(async () => {
  chain = await startChain({ port: HAND_PORT_BASE === undefined ? 16112 : HAND_PORT_BASE + 2 });
  client = chain.client;
}, 60_000);
afterAll(async () => {
  await chain?.stop();
});

function walletOf(who: DevWho) {
  const provider = devProvider({ who, chain: foundry, rpcUrl: chain.rpc, accountFactory: chain.accountFactory });
  return { provider, connect: async () => createWalletClient({ account: (await provider.address()), chain: foundry, transport: custom(provider) }) };
}

const typed = (n: bigint): TypedDataDefinition => ({
  domain: { name: "aHand dev wallet", version: "1", chainId: foundry.id, verifyingContract: chain.core },
  types: { Sample: [{ name: "text", type: "string" }, { name: "n", type: "uint256" }, { name: "list", type: "uint16[]" }] },
  primaryType: "Sample",
  message: { text: "The same message, asked twice.", n, list: [1n, 2n] },
});

describe("the dev wallet", () => {
  test("accounts 1 to 5 are anvil's; the sixth is the factory's account for account 6's key", async () => {
    const infos = devAccounts({ accountFactory: chain.accountFactory });
    expect(infos.map((i) => i.id)).toEqual(["dev-1", "dev-2", "dev-3", "dev-4", "dev-5", "dev-not-set-up"]);
    expect(infos.map((i) => i.role)).toEqual(["key", "key", "key", "key", "entropy", "unset"]);
    for (const who of [1, 2, 3, 4, 5] as const) expect(await devAddress(who, client, chain.accountFactory)).toBe(privateKeyToAccount(ANVIL_KEYS[who]!).address);
    const unset = await devAddress("not-set-up", client, chain.accountFactory);
    expect(await client.getCode({ address: unset })).toBeUndefined();
    expect(devAccounts({ accountFactory: null }).map((i) => i.id)).not.toContain("dev-not-set-up");
  });

  test("account 1 answers the same typed data with the same signature, through eth_signTypedData_v4", async () => {
    const wallet = await walletOf(1).connect();
    const a = await signTypedWith(wallet, client, typed(7n));
    const b = await signTypedWith(wallet, client, typed(7n));
    expect(a.signature).toBe(b.signature);
    expect(a).toMatchObject({ kind: "key", wrapped: false });
    expect(await recoverTypedDataAddress({ ...typed(7n), signature: a.signature })).toBe(wallet.account.address);
  });

  test("account 5 answers differently each time, and each answer is valid; others stay deterministic after it", async () => {
    const five = await walletOf(5).connect();
    const a = await signTypedWith(five, client, typed(8n));
    const b = await signTypedWith(five, client, typed(8n));
    expect(a.signature).not.toBe(b.signature);
    for (const s of [a, b]) expect(await recoverTypedDataAddress({ ...typed(8n), signature: s.signature })).toBe(five.account.address);
    const two = await walletOf(2).connect();
    expect((await signTypedWith(two, client, typed(9n))).signature).toBe((await signTypedWith(two, client, typed(9n))).signature);
  });

  test("'not set up yet' answers wrapped per ERC-6492, verifiable before the account exists, and cannot send", async () => {
    const { connect, provider } = walletOf("not-set-up");
    const wallet = await connect();
    const answer = await signTypedWith(wallet, client, typed(10n));
    expect(answer).toMatchObject({ wrapped: true, kind: "code" });
    expect(isErc6492(answer.signature)).toBe(true);
    const parts = unwrapErc6492(answer.signature)!;
    expect(parts.factory).toBe(chain.accountFactory!);
    expect(parts.factoryData).toBe(devUnsetSetup(chain.accountFactory!).factoryData);
    expect(await recoverTypedDataAddress({ ...typed(10n), signature: parseErc6492Signature(answer.signature).signature })).toBe(privateKeyToAccount(ANVIL_KEYS[6]!).address);
    // viem's verifier runs the ERC-6492 setup in a simulation and asks the account (ERC-1271).
    expect(await client.verifyTypedData({ ...typed(10n), address: wallet.account.address, signature: answer.signature })).toBe(true);
    await expect(provider.request({ method: "eth_sendTransaction", params: [{ from: wallet.account.address, to: chain.core, data: "0x" }] })).rejects.toMatchObject({ code: 4200 });
  });

  test("refuses what it does not do, and never passes signing to anvil's unlocked accounts", async () => {
    const { provider } = walletOf(1);
    const address = await provider.address();
    for (const method of ["eth_signTransaction", "eth_sendRawTransaction", "anvil_impersonateAccount", "eth_sendUnsignedTransaction"]) {
      await expect(provider.request({ method, params: [address] } as never)).rejects.toMatchObject({ code: 4200 });
    }
    expect(await provider.request({ method: "eth_chainId" })).toBe("0x7a69");
    expect((await provider.request({ method: "wallet_getCapabilities", params: [address] } as never)) as unknown).toEqual({ "0x7a69": { atomic: { status: "unsupported" } } });
    expect(BigInt((await provider.request({ method: "eth_blockNumber" })) as string)).toBeGreaterThan(0n);
  });

  test("says no once when asked to (4001), then answers again", async () => {
    const wallet = await walletOf(3).connect();
    sayNoNext(true);
    await expect(signTypedWith(wallet, client, typed(11n))).rejects.toMatchObject({ code: 4001 });
    expect((await signTypedWith(wallet, client, typed(11n))).wrapped).toBe(false);
  });

  test("typed data that arrives as JSON (numbers as strings) is hashed as viem would", () => {
    const json = JSON.stringify(
      { domain: { name: "x", version: "1", chainId: "31337" }, types: { EIP712Domain: [], M: [{ name: "a", type: "uint256" }, { name: "b", type: "N" }], N: [{ name: "c", type: "int8[]" }] }, primaryType: "M", message: { a: "5", b: { c: ["-1", "2"] } } },
    );
    const revived = reviveTypedData(json) as unknown as { domain: { chainId: number }; message: { a: bigint; b: { c: bigint[] } }; types: Record<string, unknown> };
    expect(revived.domain.chainId).toBe(31337);
    expect(revived.message).toEqual({ a: 5n, b: { c: [-1n, 2n] } });
    expect(Object.keys(revived.types)).toEqual(["M", "N"]);
  });
});

/**
 * The keys are public: the wallet must never act on a chain that is not anvil's, whatever the
 * configuration says. A real HTTP server on port 25051 answers `eth_chainId` as Base (8453) would.
 */
describe("the dev wallet refuses any chain but 31337", () => {
  let base8453: ReturnType<typeof Bun.serve> | undefined;
  beforeAll(() => {
    base8453 = Bun.serve({
      port: BASE_RPC_PORT,
      hostname: "127.0.0.1",
      async fetch(request) {
        const { id, method } = (await request.json()) as { id: number; method: string };
        const result = method === "eth_chainId" ? "0x2105" : method === "eth_blockNumber" ? "0x1" : null;
        return Response.json({ jsonrpc: "2.0", id, result });
      },
    });
  });
  afterAll(() => {
    base8453?.stop(true);
  });

  const json = (value: unknown) => JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  const chainConfig = (id: number, local: boolean) => ({ id, name: "x", rpcUrls: [`http://127.0.0.1:${BASE_RPC_PORT}`], blockTimeMs: 1000, local, hasL1: false });

  test("devConnectors refuses a configuration on chain 8453, or one that is not local", () => {
    expect(() => devConnectors({ chain: chainConfig(8453, true), accountFactory: null })).toThrow(/local chain 31337 only/);
    expect(() => devConnectors({ chain: chainConfig(31337, false), accountFactory: null })).toThrow(/not local/);
    expect(devConnectors({ chain: chainConfig(31337, true), accountFactory: null })).toHaveLength(5);
  });

  test("a provider built for chain 8453 refuses to connect, sign or send (4901)", async () => {
    const provider = devProvider({ who: 1, chain: base, rpcUrl: chain.rpc, accountFactory: null });
    const address = await provider.address();
    await expect(provider.request({ method: "eth_requestAccounts" })).rejects.toMatchObject({ code: 4901 });
    await expect(provider.request({ method: "eth_signTypedData_v4", params: [address, json(typed(1n))] } as never)).rejects.toMatchObject({ code: 4901 });
    await expect(provider.request({ method: "eth_sendTransaction", params: [{ from: address, to: chain.core, data: "0x" }] } as never)).rejects.toMatchObject({ code: 4901 });
  });

  test("a provider for 31337 whose RPC answers 8453 refuses too, and never signs", async () => {
    const provider = devProvider({ who: 2, chain: foundry, rpcUrl: `http://127.0.0.1:${BASE_RPC_PORT}`, accountFactory: null });
    const address = await provider.address();
    await expect(provider.request({ method: "eth_requestAccounts" })).rejects.toThrow(/answers chain 8453/);
    await expect(provider.request({ method: "eth_signTypedData_v4", params: [address, json(typed(2n))] } as never)).rejects.toMatchObject({ code: 4901 });
  });

  test("the same provider on anvil's own RPC connects", async () => {
    const provider = devProvider({ who: 2, chain: foundry, rpcUrl: chain.rpc, accountFactory: null });
    expect(await provider.request({ method: "eth_requestAccounts" })).toEqual([await provider.address()]);
  });
});
