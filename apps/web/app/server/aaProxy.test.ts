import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  parseAbi,
  toHex,
  type Abi,
  type AbiParameter,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { entryPoint07Address, entryPoint08Address } from "viem/account-abstraction";
import { baseSepolia } from "viem/chains";
import { AHandCoreAbi, AHandSignalsAbi, MockUSDAbi, DeployedAddresses } from "@ahand/abi";
import type { SenderCall } from "../hooks/useSender";
import { raiseCalls, raisedReceiptCall } from "../lib/raise";
import { getSmartAccountClient, sendSponsoredBatch } from "../lib/smartAccount";
import { FEE_HEADROOM, GAS_CEILINGS, aaUpstream, proxyAaRequest, screenAaRequest, type AaPolicy, type ReadCode } from "./aaProxy";

vi.mock("../config/web3", async () => ({
  activeChain: (await import("viem/chains")).baseSepolia,
  POLLING_INTERVAL: 1,
}));
vi.mock("../config/aa", async () => ({
  AA: {
    enabled: true,
    // Absolute only because Request() in node has no page origin to resolve against.
    bundlerUrl: "https://app.test/api/aa",
    paymasterUrl: "https://app.test/api/aa",
    entryPoint: { address: (await import("viem/account-abstraction")).entryPoint08Address, version: "0.8" },
  },
  SIMPLE_7702_IMPLEMENTATION: "0xe6Cae83BdE06E4c305530e199D7217f42808555B",
}));

const IMPL = "0xe6Cae83BdE06E4c305530e199D7217f42808555B" as Address;
const STRANGER = `0x${"de".repeat(20)}` as Address;
const PAYMASTER = `0x${"7a".repeat(20)}` as Address;
const USEROP_HASH = `0x${"44".repeat(32)}` as Hex;

const DELEGATED = `0xef0100${IMPL.slice(2).toLowerCase()}` as Hex;
/** The chain as the proxy's sender check sees it: every sender already delegated. */
const delegatedChain: ReadCode = async () => DELEGATED;

const POLICY: AaPolicy = {
  chainId: baseSepolia.id,
  entryPoint: entryPoint08Address,
  implementation: IMPL,
  core: DeployedAddresses.AHandCore,
  signals: DeployedAddresses.AHandSignals,
  token: DeployedAddresses.mockUSD,
  sponsorshipPolicyId: "sp_server",
};

const ACCOUNT_ABI = parseAbi([
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
]);

/** A value for every ABI slot; arrays at the route cap and 65-byte blobs, so bodies are worst-case sized. */
function sample(p: AbiParameter): unknown {
  const array = p.type.match(/^(.*)\[(\d*)\]$/);
  if (array) return Array.from({ length: array[2] ? Number(array[2]) : 6 }, () => sample({ ...p, type: array[1] }));
  if (p.type === "tuple") {
    const components = (p as { components: readonly AbiParameter[] }).components;
    return Object.fromEntries(components.map((c) => [c.name, sample(c)]));
  }
  if (p.type === "address") return STRANGER;
  if (p.type === "bool") return true;
  if (p.type === "string") return "x".repeat(64);
  if (p.type === "bytes") return `0x${"ab".repeat(65)}`;
  if (p.type.startsWith("bytes")) return `0x${"cd".repeat(Number(p.type.slice(5)))}`;
  return 1n;
}

function call(address: Address, abi: Abi, functionName: string, args?: readonly unknown[]): SenderCall {
  const fn = abi.find((x) => x.type === "function" && x.name === functionName) as { inputs: readonly AbiParameter[] };
  return { address, abi, functionName, args: args ?? fn.inputs.map(sample) };
}
const core = (fn: string, args?: readonly unknown[]) => call(DeployedAddresses.AHandCore, AHandCoreAbi as Abi, fn, args);
const signals = (fn: string) => call(DeployedAddresses.AHandSignals, AHandSignalsAbi as Abi, fn);
const token = (fn: string, args: readonly unknown[]) => call(DeployedAddresses.mockUSD, MockUSDAbi as Abi, fn, args);

type Raw = { to: Address; value?: bigint; data: Hex };
const raw = (c: SenderCall): Raw => ({
  to: c.address,
  data: encodeFunctionData({ abi: c.abi, functionName: c.functionName, args: c.args as unknown[] }),
  ...(c.value !== undefined ? { value: c.value } : {}),
});

function callData(calls: Raw[]): Hex {
  if (calls.length === 1) {
    return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "execute", args: [calls[0].to, calls[0].value ?? 0n, calls[0].data] });
  }
  return encodeFunctionData({
    abi: ACCOUNT_ABI,
    functionName: "executeBatch",
    args: [calls.map((c) => ({ target: c.to, value: c.value ?? 0n, data: c.data }))],
  });
}

function userOp(calls: SenderCall[] | Raw[], extra: Record<string, unknown> = {}) {
  const raws = calls.map((c) => ("abi" in c ? raw(c) : c));
  return {
    sender: STRANGER,
    nonce: "0x0",
    factory: "0x7702",
    factoryData: "0x",
    callData: callData(raws),
    callGasLimit: toHex(900_000n),
    verificationGasLimit: toHex(150_000n),
    preVerificationGas: toHex(90_000n),
    maxFeePerGas: "0x3b9aca00",
    maxPriorityFeePerGas: "0x3b9aca00",
    signature: "0x",
    eip7702Auth: { address: IMPL, chainId: toHex(baseSepolia.id), nonce: "0x0", r: "0x01", s: "0x01", yParity: "0x0" },
    ...extra,
  };
}

const rpc = (method: string, params: unknown[]) => JSON.stringify({ jsonrpc: "2.0", id: 7, method, params });
const sponsor = (op: unknown, context: unknown = null, policy = POLICY) =>
  screenAaRequest(rpc("pm_getPaymasterData", [op, entryPoint08Address, toHex(baseSepolia.id), context]), policy);

function refusal(screen: ReturnType<typeof screenAaRequest>) {
  expect(screen.ok).toBe(false);
  if (screen.ok) throw new Error("unreachable");
  return { status: screen.status, ...(JSON.parse(screen.body) as { id: unknown; error: { code: number; message: string } }) };
}

const APPROVE = token("approve", [DeployedAddresses.AHandCore, 150_000_000n]);
const RAISE = core("raise");

describe("screenAaRequest: sponsorship", () => {
  it("forwards the app's own op with the server's policy in place of the caller's context", () => {
    const screen = sponsor(userOp([APPROVE, RAISE]), { sponsorshipPolicyId: "sp_attacker" });
    expect(screen.ok).toBe(true);
    const sent = JSON.parse((screen as { body: string }).body);
    expect(sent.method).toBe("pm_getPaymasterData");
    expect(sent.id).toBe(7);
    expect(sent.params[3]).toEqual({ sponsorshipPolicyId: "sp_server" });
  });

  it("drops the caller's context even when the server has no policy", () => {
    const screen = sponsor(userOp([RAISE]), { sponsorshipPolicyId: "sp_attacker" }, { ...POLICY, sponsorshipPolicyId: undefined });
    expect(JSON.parse((screen as { body: string }).body).params[3]).toBeNull();
  });

  it.each([
    ["a foreign contract", [call(STRANGER, MockUSDAbi as Abi, "approve", [DeployedAddresses.AHandCore, 1n])]],
    ["a token transfer", [token("transfer", [STRANGER, 1n])]],
    ["an approval to anyone but Core", [token("approve", [STRANGER, 1n])]],
    ["the faucet mint off anvil", [token("mint", [STRANGER, 1n])]],
    ["an admin call on Core", [core("setTokenEnabled")]],
    ["an allowed call batched with a foreign one", [RAISE, call(STRANGER, AHandCoreAbi as Abi, "raise")]],
  ])("refuses %s", (_, calls) => {
    const r = refusal(sponsor(userOp(calls as SenderCall[])));
    expect(r.status).toBe(403);
    expect(r.error.code).toBe(-32602);
    expect(r.error.message).toMatch(/not sponsored/);
  });

  it("refuses calls that move value", () => {
    const r = refusal(sponsor(userOp([{ ...raw(RAISE), value: 1n }])));
    expect(r.error.message).toMatch(/no value/);
  });

  it("allows the faucet mint on anvil only", () => {
    const mint = [token("mint", [STRANGER, 1_000_000_000n])];
    const anvil = { ...POLICY, chainId: 31337 };
    const op = userOp(mint, { eip7702Auth: { ...userOp(mint).eip7702Auth, chainId: toHex(31337) } });
    expect(screenAaRequest(rpc("pm_getPaymasterData", [op, entryPoint08Address, toHex(31337), null]), anvil).ok).toBe(true);
  });

  it("refuses more calls than any flow sends, and none", () => {
    expect(refusal(sponsor(userOp([RAISE, RAISE, RAISE, RAISE]))).error.message).toMatch(/1 to 3 calls/);
    const empty = encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "executeBatch", args: [[]] });
    expect(refusal(sponsor(userOp([RAISE], { callData: empty }))).error.message).toMatch(/1 to 3 calls/);
  });

  it("refuses callData that is not an account execute", () => {
    expect(refusal(sponsor(userOp([RAISE], { callData: raw(RAISE).data }))).error.message).toMatch(/execute/);
  });

  it.each([
    ["a real factory", { factory: STRANGER, factoryData: "0x1234" }],
    ["factoryData beside the marker", { factoryData: "0x1234" }],
    ["a v0.6 initCode", { initCode: `${STRANGER}1234` }],
    ["delegation to another implementation", { eip7702Auth: { address: STRANGER, chainId: toHex(baseSepolia.id) } }],
    ["a chain-agnostic delegation", { eip7702Auth: { address: IMPL, chainId: "0x0" } }],
    ["callGasLimit over the ceiling", { callGasLimit: toHex(GAS_CEILINGS.callGasLimit + 1n) }],
    ["verificationGasLimit over the ceiling", { verificationGasLimit: toHex(GAS_CEILINGS.verificationGasLimit + 1n) }],
    ["paymaster verification gas over the ceiling", { paymasterVerificationGasLimit: toHex(GAS_CEILINGS.paymasterVerificationGasLimit + 1n) }],
    ["paymaster postOp gas over the ceiling", { paymasterPostOpGasLimit: toHex(GAS_CEILINGS.paymasterPostOpGasLimit + 1n) }],
    ["preVerificationGas over the ceiling", { preVerificationGas: toHex(GAS_CEILINGS.preVerificationGas + 1n) }],
    ["a non-hex gas value", { callGasLimit: "lots" }],
    ["a non-hex fee", { maxFeePerGas: "lots" }],
  ])("refuses %s", (_, extra) => {
    expect(refusal(sponsor(userOp([RAISE], extra))).status).toBe(403);
  });

  it("accepts the already-delegated shape (no marker, no authorization)", () => {
    expect(sponsor(userOp([RAISE], { factory: undefined, factoryData: undefined, eip7702Auth: undefined })).ok).toBe(true);
  });

  it.each([
    ["the 7702 marker without its authorization", { eip7702Auth: undefined }],
    ["an op without a sender", { sender: undefined }],
    ["a malformed sender", { sender: "0x1234" }],
    ["a delegation without a signature", { eip7702Auth: { address: IMPL, chainId: toHex(baseSepolia.id), nonce: "0x0" } }],
  ])("refuses %s", (_, extra) => {
    expect(refusal(sponsor(userOp([RAISE], extra))).status).toBe(403);
  });

  it("refuses another entry point or chain", () => {
    const op = userOp([RAISE]);
    expect(refusal(screenAaRequest(rpc("pm_getPaymasterData", [op, entryPoint07Address, toHex(baseSepolia.id), null]), POLICY)).error.message).toMatch(/entry point/);
    expect(refusal(screenAaRequest(rpc("pm_getPaymasterStubData", [op, entryPoint08Address, toHex(8453), null]), POLICY)).error.message).toMatch(/chain/);
  });

  it("screens bundler methods by the same rules", () => {
    const foreign = userOp([token("transfer", [STRANGER, 1n])]);
    expect(refusal(screenAaRequest(rpc("eth_estimateUserOperationGas", [foreign, entryPoint08Address]), POLICY)).status).toBe(403);
    expect(refusal(screenAaRequest(rpc("eth_sendUserOperation", [foreign, entryPoint08Address]), POLICY)).status).toBe(403);
    expect(screenAaRequest(rpc("eth_sendUserOperation", [userOp([RAISE]), entryPoint08Address]), POLICY).ok).toBe(true);
  });
});

describe("screenAaRequest: methods and framing", () => {
  it.each([
    "pm_sponsorUserOperation",
    "pm_validateSponsorshipPolicies",
    "pimlico_sendCompressedUserOperation",
    "pimlico_getTokenQuotes",
    "eth_sendTransaction",
    "eth_sendRawTransaction",
    "debug_traceCall",
  ])("refuses %s", (method) => {
    const r = refusal(screenAaRequest(rpc(method, [userOp([RAISE]), entryPoint08Address]), POLICY));
    expect(r.status).toBe(403);
    expect(r.error.code).toBe(-32601);
    expect(r.id).toBe(7);
  });

  it.each(["pimlico_getUserOperationGasPrice", "eth_getUserOperationReceipt", "eth_supportedEntryPoints", "eth_chainId"])(
    "passes %s through",
    (method) => {
      expect(screenAaRequest(rpc(method, method === "eth_getUserOperationReceipt" ? [USEROP_HASH] : []), POLICY).ok).toBe(true);
    },
  );

  it("refuses batches, junk and oversized bodies", () => {
    const one = JSON.parse(rpc("eth_chainId", []));
    expect(refusal(screenAaRequest(JSON.stringify([one, one]), POLICY)).status).toBe(400);
    expect(refusal(screenAaRequest("{not json", POLICY)).error.code).toBe(-32700);
    expect(refusal(screenAaRequest(" ".repeat(64 * 1024 + 1), POLICY)).status).toBe(413);
  });

  it("forwards what it checked, not the caller's text", () => {
    const smuggled = rpc("eth_sendUserOperation", [userOp([RAISE]), entryPoint08Address]).replace(
      '"method":"eth_sendUserOperation"',
      '"method":"pm_sponsorUserOperation","method":"eth_sendUserOperation"',
    );
    const screen = screenAaRequest(smuggled, POLICY);
    expect(screen.ok).toBe(true);
    expect((screen as { body: string }).body).not.toContain("pm_sponsorUserOperation");
  });
});

describe("proxyAaRequest", () => {
  const post = (body: string) => new Request("https://app.test/api/aa", { method: "POST", body });

  it("is unavailable, not pointed at localhost, when a public chain has no upstream", async () => {
    expect(aaUpstream({}, baseSepolia.id)).toBeNull();
    expect(aaUpstream({ AA_LOCAL_URL: "http://127.0.0.1:9999" }, baseSepolia.id)).toBeNull();
    expect(aaUpstream({}, 31337)).toBe("http://127.0.0.1:4339");
    expect(aaUpstream({ AA_UPSTREAM_URL: "https://pimlico.test/rpc?apikey=k" }, baseSepolia.id)).toBe("https://pimlico.test/rpc?apikey=k");

    const send = vi.fn();
    const res = await proxyAaRequest(post(rpc("eth_chainId", [])), { policy: POLICY, upstream: null, readCode: delegatedChain, fetch: send });
    expect(res.status).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });

  it("never lets a refused request reach the upstream", async () => {
    const send = vi.fn();
    const res = await proxyAaRequest(post(rpc("pm_sponsorUserOperation", [userOp([RAISE]), entryPoint08Address])), {
      policy: POLICY,
      upstream: "https://upstream.test",
      readCode: delegatedChain,
      fetch: send,
    });
    expect(res.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not echo upstream failures", async () => {
    const send = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED https://pimlico.test/rpc?apikey=secret"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await proxyAaRequest(post(rpc("eth_chainId", [])), {
      policy: POLICY,
      upstream: "https://pimlico.test",
      readCode: delegatedChain,
      fetch: send,
    });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("apikey");
  });
});

describe("proxyAaRequest: the sender must be an aHand account", () => {
  const HOLDER = privateKeyToAccount(`0x${"c3".repeat(32)}`);
  const OTHER = privateKeyToAccount(`0x${"d4".repeat(32)}`);
  const rpcAuth = async (signer = HOLDER, address = IMPL) => {
    const a = await signer.signAuthorization({ address, chainId: baseSepolia.id, nonce: 0 });
    return { address: a.address, chainId: toHex(a.chainId), nonce: toHex(a.nonce), r: a.r, s: a.s, yParity: toHex(a.yParity ?? 0) };
  };
  const upstreamOk = () => vi.fn(async () => Response.json({ jsonrpc: "2.0", id: 7, result: {} }));
  const relay = (op: unknown, readCode: ReadCode, send: typeof fetch) =>
    proxyAaRequest(
      new Request("https://app.test/api/aa", {
        method: "POST",
        body: rpc("pm_getPaymasterData", [op, entryPoint08Address, toHex(baseSepolia.id), null]),
      }),
      { policy: POLICY, upstream: "https://upstream.test", readCode, fetch: send, gasPrice: async () => 10n ** 9n },
    );
  const alreadyDelegated = { sender: HOLDER.address, factory: undefined, factoryData: undefined, eip7702Auth: undefined };

  it.each([
    ["a deployed contract", `0x6080604052${"00".repeat(40)}`],
    ["an EOA delegated to another implementation", `0xef0100${"de".repeat(20)}`],
    ["an EOA with no code", undefined],
  ])("refuses allowlisted calls from %s", async (_, code) => {
    const send = upstreamOk();
    const res = await relay(userOp([RAISE], alreadyDelegated), async () => code as Hex | undefined, send as unknown as typeof fetch);
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toMatch(/not an aHand account/);
    expect(send).not.toHaveBeenCalled();
  });

  it("forwards an EOA already delegated to the implementation", async () => {
    const send = upstreamOk();
    const res = await relay(userOp([RAISE], alreadyDelegated), async () => DELEGATED, send as unknown as typeof fetch);
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledOnce();
  });

  it("forwards a first op whose authorization the sender signed, without reading its code", async () => {
    const send = upstreamOk();
    const readCode = vi.fn(async () => undefined);
    const res = await relay(userOp([RAISE], { sender: HOLDER.address, eip7702Auth: await rpcAuth() }), readCode, send as unknown as typeof fetch);
    expect(res.status).toBe(200);
    expect(readCode).not.toHaveBeenCalled();
  });

  it("refuses an authorization someone else signed", async () => {
    const send = upstreamOk();
    const res = await relay(userOp([RAISE], { sender: HOLDER.address, eip7702Auth: await rpcAuth(OTHER) }), delegatedChain, send as unknown as typeof fetch);
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toMatch(/not signed by the sender/);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a forged authorization", async () => {
    const send = upstreamOk();
    const forged = { ...(await rpcAuth()), r: `0x${"01".repeat(32)}`, s: `0x${"01".repeat(32)}` };
    const res = await relay(userOp([RAISE], { sender: HOLDER.address, eip7702Auth: forged }), delegatedChain, send as unknown as typeof fetch);
    expect(res.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("screens bundler methods the same way", async () => {
    const send = upstreamOk();
    const res = await proxyAaRequest(
      new Request("https://app.test/api/aa", { method: "POST", body: rpc("eth_sendUserOperation", [userOp([RAISE], alreadyDelegated), entryPoint08Address]) }),
      { policy: POLICY, upstream: "https://upstream.test", readCode: async () => undefined, fetch: send as unknown as typeof fetch },
    );
    expect(res.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("fails closed when the chain cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = upstreamOk();
    const res = await relay(userOp([RAISE], alreadyDelegated), async () => {
      throw new Error("rpc down");
    }, send as unknown as typeof fetch);
    expect(res.status).toBe(502);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("proxyAaRequest: sponsored gas price", () => {
  const GWEI = 10n ** 9n;
  const post = (method: string, op: unknown) =>
    new Request("https://app.test/api/aa", {
      method: "POST",
      body: rpc(method, method.startsWith("pm_") ? [op, entryPoint08Address, toHex(baseSepolia.id), null] : [op, entryPoint08Address]),
    });
  // The already-delegated shape: the sender check passes on delegatedChain.
  const priced = (fees: Record<string, unknown>) =>
    userOp([RAISE], { factory: undefined, factoryData: undefined, eip7702Auth: undefined, ...fees });
  const relay = (method: string, op: unknown, price: bigint) => {
    const send = vi.fn(async () => Response.json({ jsonrpc: "2.0", id: 7, result: {} }));
    const res = proxyAaRequest(post(method, op), {
      policy: POLICY,
      upstream: "https://upstream.test",
      readCode: delegatedChain,
      fetch: send as unknown as typeof fetch,
      gasPrice: async () => price,
    });
    return { res, send };
  };

  it.each(["pm_getPaymasterStubData", "pm_getPaymasterData"])("%s: forwards fees up to the headroom over the fast price", async (method) => {
    const { res, send } = relay(method, priced({ maxFeePerGas: toHex(GWEI * FEE_HEADROOM), maxPriorityFeePerGas: toHex(GWEI) }), GWEI);
    expect((await res).status).toBe(200);
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([
    ["maxFeePerGas", { maxFeePerGas: toHex(GWEI * FEE_HEADROOM + 1n), maxPriorityFeePerGas: toHex(GWEI) }],
    ["maxPriorityFeePerGas", { maxFeePerGas: toHex(GWEI), maxPriorityFeePerGas: toHex(GWEI * FEE_HEADROOM + 1n) }],
    ["the review's 1000 gwei", { maxFeePerGas: toHex(1000n * GWEI), maxPriorityFeePerGas: toHex(1000n * GWEI) }],
  ])("refuses a paymaster stamp with %s over the ceiling", async (_, fees) => {
    const { res, send } = relay("pm_getPaymasterData", priced(fees), GWEI);
    const r = await res;
    expect(r.status).toBe(403);
    expect((await r.json()).error.message).toMatch(/gas price/);
    expect(send).not.toHaveBeenCalled();
  });

  it("fails closed when there is no price to hold fees to", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn();
    const res = await proxyAaRequest(post("pm_getPaymasterData", priced({})), {
      policy: POLICY,
      upstream: "https://upstream.test",
      readCode: delegatedChain,
      fetch: send as unknown as typeof fetch,
      gasPrice: async () => {
        throw new Error("upstream down");
      },
    });
    expect(res.status).toBe(502);
    expect(send).not.toHaveBeenCalled();
  });

  it("reads the price from the upstream's fast tier and reuses it briefly", async () => {
    const methods: string[] = [];
    const send = vi.fn(async (_url: string, init: RequestInit) => {
      const req = JSON.parse(init.body as string);
      methods.push(req.method);
      const price = { maxFeePerGas: toHex(GWEI), maxPriorityFeePerGas: toHex(GWEI) };
      const result = req.method === "pimlico_getUserOperationGasPrice" ? { slow: price, standard: price, fast: price } : {};
      return Response.json({ jsonrpc: "2.0", id: req.id, result });
    });
    const once = () =>
      proxyAaRequest(post("pm_getPaymasterData", priced({ maxFeePerGas: toHex(GWEI), maxPriorityFeePerGas: toHex(GWEI) })), {
        policy: POLICY,
        upstream: "https://price-cache.test",
        readCode: delegatedChain,
        fetch: send as unknown as typeof fetch,
      });
    expect((await once()).status).toBe(200);
    expect((await once()).status).toBe(200);
    expect(methods).toEqual(["pimlico_getUserOperationGasPrice", "pm_getPaymasterData", "pm_getPaymasterData"]);

    const over = await proxyAaRequest(post("pm_getPaymasterData", priced({ maxFeePerGas: toHex(3n * GWEI) })), {
      policy: POLICY,
      upstream: "https://price-cache.test",
      readCode: delegatedChain,
      fetch: send as unknown as typeof fetch,
    });
    expect(over.status).toBe(403);
  });

  it("leaves bundler methods to the paymaster's stamp", async () => {
    const { res } = relay("eth_sendUserOperation", priced({ maxFeePerGas: toHex(1000n * GWEI) }), GWEI);
    expect((await res).status).toBe(200);
  });
});

describe("the app's own sponsored sends pass the proxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // The hooks' exact call lists: lib/raise for the raise, the others as
  // written in useThankFlow, usePocket, h.$id/h.$id.thank and useClaims.
  const PARAMS = {
    token: DeployedAddresses.mockUSD,
    amount: 150_000_000n,
    expiry: 2_000_000_000,
    charityRecipient: DeployedAddresses.charity,
    charityBps: 100,
    minGiverClaimBps: 7000,
    rootCapability: STRANGER,
    visibility: 1,
    metadataCommitment: `0x${"22".repeat(32)}`,
    discoveryCommitment: `0x${"33".repeat(32)}`,
  } as const;
  const FLOWS: [string, SenderCall[]][] = [
    ["raise with approval", raiseCalls({ allowance: 0n, params: PARAMS, discoveryRef: `0x${"ab".repeat(46)}` })],
    ["RAISED receipt", [raisedReceiptCall(7n)]],
    ["thank with its THANK receipt", [core("thank"), signals("materializeThank")]],
    ["THANK receipt retry", [signals("materializeThank")]],
    ["reclaim", [core("reclaim", [7n])]],
    ["withdraw", [core("withdraw", [DeployedAddresses.mockUSD, STRANGER])]],
  ];

  async function send(calls: SenderCall[], firstOp: boolean, key: Hex) {
    const owner = privateKeyToAccount(key);
    const upstream: { method: string; params: unknown[] }[] = [];
    const answer = (method: string): unknown => {
      const gas = { paymasterVerificationGasLimit: "0xc350", paymasterPostOpGasLimit: "0x186a0" };
      const price = { maxFeePerGas: "0x3b9aca00", maxPriorityFeePerGas: "0x3b9aca00" };
      switch (method) {
        case "pimlico_getUserOperationGasPrice":
          return { slow: price, standard: price, fast: price };
        case "pm_getPaymasterStubData":
          return { paymaster: PAYMASTER, paymasterData: "0x", ...gas, isFinal: false };
        case "eth_estimateUserOperationGas":
          return { callGasLimit: toHex(2_400_000n), verificationGasLimit: toHex(160_000n), preVerificationGas: toHex(90_000n), ...gas };
        case "pm_getPaymasterData":
          return { paymaster: PAYMASTER, paymasterData: `0x${"ab".repeat(80)}` };
        case "eth_sendUserOperation":
          return USEROP_HASH;
        case "eth_getUserOperationReceipt":
          return {
            userOpHash: USEROP_HASH,
            entryPoint: entryPoint08Address,
            sender: owner.address,
            nonce: "0x0",
            paymaster: PAYMASTER,
            actualGasCost: "0x1",
            actualGasUsed: "0x1",
            success: true,
            reason: "",
            logs: [],
            receipt: {
              transactionHash: `0x${"55".repeat(32)}`,
              blockHash: `0x${"66".repeat(32)}`,
              blockNumber: "0x1",
              transactionIndex: "0x0",
              from: STRANGER,
              to: entryPoint08Address,
              gasUsed: "0x1",
              cumulativeGasUsed: "0x1",
              effectiveGasPrice: "0x1",
              status: "0x1",
              type: "0x2",
              logs: [],
              logsBloom: `0x${"00".repeat(256)}`,
              contractAddress: null,
            },
          };
      }
      throw new Error(`upstream got ${method}`);
    };
    const upstreamFetch = (async (_url: string, init: RequestInit) => {
      const req = JSON.parse(init.body as string);
      upstream.push(req);
      return Response.json({ jsonrpc: "2.0", id: req.id, result: answer(req.method) });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url !== "https://app.test/api/aa") throw new Error(`unexpected fetch ${url}`);
      return proxyAaRequest(new Request(url, { method: "POST", body: init.body as string }), {
        policy: POLICY,
        upstream: "https://upstream.test",
        readCode: async (address) => (firstOp || address.toLowerCase() !== owner.address.toLowerCase() ? undefined : DELEGATED),
        fetch: upstreamFetch,
      });
    });

    const chain = async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return toHex(baseSepolia.id);
      if (method === "eth_call") return `0x${"00".repeat(32)}`; // EntryPoint nonce
      if (method === "eth_getCode") return firstOp ? "0x" : `0xef0100${IMPL.slice(2).toLowerCase()}`;
      throw new Error(`chain got ${method}`);
    };
    const publicClient = createPublicClient({ chain: baseSepolia, transport: custom({ request: chain }) });
    const walletClient = createWalletClient({ account: owner, chain: baseSepolia, transport: custom({ request: chain }) });
    const client = await getSmartAccountClient(walletClient, publicClient as never);
    const authorization = firstOp
      ? await owner.signAuthorization({ address: IMPL, chainId: baseSepolia.id, nonce: 0 })
      : undefined;
    await sendSponsoredBatch({ client, calls: calls.map(raw), authorization, pollingInterval: 1 });
    return upstream;
  }

  it.each(FLOWS)("%s, first op with the 7702 delegation", async (_, calls) => {
    const upstream = await send(calls, true, `0x${"a1".repeat(32)}`);
    const methods = upstream.map((r) => r.method);
    expect(methods).toEqual(
      expect.arrayContaining(["pm_getPaymasterStubData", "eth_estimateUserOperationGas", "pm_getPaymasterData", "eth_sendUserOperation"]),
    );
    for (const r of upstream.filter((r) => r.method.startsWith("pm_"))) {
      expect(r.params[3]).toEqual({ sponsorshipPolicyId: "sp_server" });
    }
    const sent = upstream.find((r) => r.method === "eth_sendUserOperation")!.params[0] as Record<string, unknown>;
    expect(sent.eip7702Auth).toMatchObject({ address: IMPL });
  });

  it.each(FLOWS)("%s, already delegated", async (_, calls) => {
    const upstream = await send(calls, false, `0x${"b2".repeat(32)}`);
    expect(upstream.map((r) => r.method)).toContain("eth_sendUserOperation");
  });
});
