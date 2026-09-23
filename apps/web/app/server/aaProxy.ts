/**
 * /api/aa sits in front of the server-held bundler/paymaster key (Pimlico
 * in production), and that key pays for gas. So the proxy relays only what
 * the app's own sponsored sends use: the methods viem/permissionless call,
 * for user operations whose calls are aHand's own (Core and Signals entry
 * points, the reward-token approval to Core, the faucet mint on anvil).
 * The sponsorship policy is the server's; a caller's paymaster context is
 * never forwarded.
 *
 * The allowlist reads the op's callData as a Simple7702Account execute, so it
 * only means something when the sender runs that code. Every op must come
 * from an aHand account: an EOA whose code is already the delegation to the
 * implementation, or one that carries its own signed authorization naming it.
 * That check reads the chain, so it runs in proxyAaRequest after the static
 * screen.
 */
import { concat, decodeFunctionData, parseAbi, type Abi, type Address, type Hex } from "viem";
import { recoverAuthorizationAddress } from "viem/utils";
import { AHandCoreAbi, AHandSignalsAbi, MockUSDAbi } from "@ahand/abi";

export type AaPolicy = {
  chainId: number;
  entryPoint: Address;
  /** The only delegation target an attached EIP-7702 authorization may name. */
  implementation: Address;
  core: Address;
  signals: Address;
  /** Reward token: approvable to Core only; mintable on anvil (the dev faucet). */
  token: Address;
  sponsorshipPolicyId?: string;
};

const ANVIL_CHAIN_ID = 31337;
export const MAX_AA_BODY_CHARS = 64 * 1024;
const MAX_CALLS = 3;

// Several times the heaviest op the app sends (a six-hop thank plus its
// receipt mint). preVerificationGas is paid in full whatever the op uses, and
// on Base it also carries the L1 data fee priced in L2 gas, which is why its
// ceiling sits well above the execution limits; the sponsorship policy's
// per-op spend cap stays the second layer.
export const GAS_CEILINGS = {
  callGasLimit: 6_000_000n,
  verificationGasLimit: 1_000_000n,
  paymasterVerificationGasLimit: 500_000n,
  paymasterPostOpGasLimit: 500_000n,
  preVerificationGas: 5_000_000n,
} as const;

// A signed paymaster stamp pays (gas used + preVerificationGas) × the op's own
// gas price to whoever bundles it, so a stamped op priced far above the market
// is a refund at the paymaster's expense. Sponsored fees stay within this
// multiple of the bundler's current fast price.
export const FEE_HEADROOM = 2n;
const PRICE_TTL_MS = 10_000;

const PLAIN_METHODS = new Set([
  "eth_chainId",
  "eth_supportedEntryPoints",
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash",
  "pimlico_getUserOperationGasPrice",
]);
const BUNDLER_METHODS = new Set(["eth_estimateUserOperationGas", "eth_sendUserOperation"]);
const PAYMASTER_METHODS = new Set(["pm_getPaymasterStubData", "pm_getPaymasterData"]);

const CORE_CALLS = new Set(["raise", "thank", "reclaim", "withdraw"]);
const SIGNALS_CALLS = new Set(["materializeRaised", "materializeThank"]);

// Simple7702Account (eth-infinitism v0.8) entry points.
const ACCOUNT_ABI = parseAbi([
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
]);

const DELEGATION_MARKERS = new Set(["0x7702", `0x7702${"0".repeat(36)}`]);

type Json = Record<string, unknown>;
type RpcId = string | number | null;

type Authorization = { address: Address; chainId: number; nonce: number; r: Hex; s: Hex; yParity: number };

/** What the chain-dependent checks need about an op that passed the static screen. */
export type ScreenedOp = {
  sender: Address;
  /** The op's EIP-7702 authorization, already known to name the implementation on this chain. */
  authorization: Authorization | null;
  /** The higher of the op's two fee fields, for a paymaster method (null: nothing to price). */
  maxFeePerGas: bigint | null;
};

type Refusal = { ok: false; status: number; body: string };
export type AaScreen = { ok: true; id: RpcId; body: string; op: ScreenedOp | null } | Refusal;

const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isAddress = (v: unknown): v is Address => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
const isWord = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(v);
const isEmpty = (v: unknown) => v === undefined || v === null || v === "0x";
const sameAddress = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

function quantity(v: unknown): bigint | null {
  if (typeof v === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  return null;
}

function rpcError(status: number, id: RpcId, code: number, message: string): Refusal {
  return { ok: false, status, body: JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) };
}

function screenCall(to: Address, value: bigint, data: Hex, p: AaPolicy): string | null {
  if (value !== 0n) return "sponsored calls carry no value";
  const decode = (abi: Abi) => {
    try {
      return decodeFunctionData({ abi, data }) as { functionName: string; args?: readonly unknown[] };
    } catch {
      return null;
    }
  };
  if (sameAddress(to, p.core)) {
    const call = decode(AHandCoreAbi as Abi);
    if (call && CORE_CALLS.has(call.functionName)) return null;
  } else if (sameAddress(to, p.signals)) {
    const call = decode(AHandSignalsAbi as Abi);
    if (call && SIGNALS_CALLS.has(call.functionName)) return null;
  } else if (sameAddress(to, p.token)) {
    const call = decode(MockUSDAbi as Abi);
    if (call?.functionName === "approve" && sameAddress(call.args?.[0], p.core)) return null;
    if (call?.functionName === "mint" && p.chainId === ANVIL_CHAIN_ID) return null;
  }
  return `call to ${to} is not sponsored`;
}

function screenAuthorization(auth: unknown, p: AaPolicy): Authorization | string {
  if (!isRecord(auth) || !sameAddress(auth.address, p.implementation) || quantity(auth.chainId) !== BigInt(p.chainId)) {
    return "delegation must name the aHand account implementation on this chain";
  }
  const nonce = quantity(auth.nonce);
  const yParity = quantity(auth.yParity);
  if (nonce === null || nonce > BigInt(Number.MAX_SAFE_INTEGER) || (yParity !== 0n && yParity !== 1n) || !isWord(auth.r) || !isWord(auth.s)) {
    return "malformed delegation";
  }
  return { address: p.implementation, chainId: p.chainId, nonce: Number(nonce), r: auth.r, s: auth.s, yParity: Number(yParity) };
}

function screenUserOp(op: unknown, p: AaPolicy): ScreenedOp | string {
  if (!isRecord(op)) return "missing user operation";
  if (!isAddress(op.sender)) return "missing sender";
  if (!isEmpty(op.initCode)) return "initCode is not sponsored";
  const marker = !isEmpty(op.factory);
  if (marker && !(typeof op.factory === "string" && DELEGATION_MARKERS.has(op.factory.toLowerCase()))) {
    return "only the EIP-7702 marker may stand in for a factory";
  }
  if (!isEmpty(op.factoryData)) return "factoryData is not sponsored";
  let authorization: Authorization | null = null;
  if (op.eip7702Auth !== undefined && op.eip7702Auth !== null) {
    const screened = screenAuthorization(op.eip7702Auth, p);
    if (typeof screened === "string") return screened;
    authorization = screened;
  } else if (marker) {
    return "the EIP-7702 marker comes only with its authorization";
  }
  for (const [field, ceiling] of Object.entries(GAS_CEILINGS)) {
    if (op[field] === undefined || op[field] === null) continue;
    const gas = quantity(op[field]);
    if (gas === null || gas > ceiling) return `${field} is over the sponsored ceiling`;
  }
  let maxFeePerGas: bigint | null = null;
  for (const field of ["maxFeePerGas", "maxPriorityFeePerGas"]) {
    if (op[field] === undefined || op[field] === null) continue;
    const fee = quantity(op[field]);
    if (fee === null) return `${field} is not a quantity`;
    if (maxFeePerGas === null || fee > maxFeePerGas) maxFeePerGas = fee;
  }

  if (typeof op.callData !== "string") return "missing callData";
  let calls: { to: Address; value: bigint; data: Hex }[];
  try {
    const decoded = decodeFunctionData({ abi: ACCOUNT_ABI, data: op.callData as Hex });
    calls =
      decoded.functionName === "execute"
        ? [{ to: decoded.args[0], value: decoded.args[1], data: decoded.args[2] }]
        : decoded.args[0].map((c) => ({ to: c.target, value: c.value, data: c.data }));
  } catch {
    return "callData must be an account execute or executeBatch";
  }
  if (calls.length === 0 || calls.length > MAX_CALLS) return `a sponsored op carries 1 to ${MAX_CALLS} calls`;
  for (const call of calls) {
    const refused = screenCall(call.to, call.value, call.data, p);
    if (refused) return refused;
  }
  return { sender: op.sender, authorization, maxFeePerGas };
}

/**
 * Decide, without the chain, whether one JSON-RPC request may reach the
 * upstream. The forwarded body is re-serialized from what was checked, never
 * the caller's raw text. An op that passes still needs checkSender.
 */
export function screenAaRequest(text: string, p: AaPolicy): AaScreen {
  if (text.length > MAX_AA_BODY_CHARS) return rpcError(413, null, -32600, "request too large");
  let req: unknown;
  try {
    req = JSON.parse(text);
  } catch {
    return rpcError(400, null, -32700, "parse error");
  }
  if (!isRecord(req) || typeof req.method !== "string") {
    return rpcError(400, null, -32600, "expected a single JSON-RPC request");
  }
  const id: RpcId = typeof req.id === "string" || typeof req.id === "number" ? req.id : null;
  const method = req.method;
  if (req.params !== undefined && !Array.isArray(req.params)) return rpcError(400, id, -32602, "params must be an array");
  const params = (req.params ?? []) as unknown[];
  const forward = (out: unknown[], op: ScreenedOp | null = null): AaScreen => ({
    ok: true,
    id,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: out }),
    op,
  });

  if (PLAIN_METHODS.has(method)) return forward(params);

  const sponsored = PAYMASTER_METHODS.has(method);
  if (!sponsored && !BUNDLER_METHODS.has(method)) {
    return rpcError(403, id, -32601, `method ${method} is not available through /api/aa`);
  }
  if (!sameAddress(params[1], p.entryPoint)) return rpcError(403, id, -32602, "unsupported entry point");
  if (!sponsored && params.length > (method === "eth_sendUserOperation" ? 2 : 3)) {
    return rpcError(403, id, -32602, "unexpected params");
  }
  if (sponsored && quantity(params[2]) !== BigInt(p.chainId)) return rpcError(403, id, -32602, "wrong chain");
  const op = screenUserOp(params[0], p);
  if (typeof op === "string") return rpcError(403, id, -32602, op);

  if (!sponsored) return forward(params, { ...op, maxFeePerGas: null });
  const context = p.sponsorshipPolicyId ? { sponsorshipPolicyId: p.sponsorshipPolicyId } : null;
  return forward([params[0], params[1], params[2], context], op);
}

/** Code at an address, read through the server's own RPC (undefined when empty). */
export type ReadCode = (address: Address) => Promise<Hex | undefined>;

/**
 * Is the sender an aHand account? Either its code is already the 7702
 * delegation to the implementation, or the op carries an authorization to it
 * that the sender itself signed (which also proves the sender is an EOA).
 */
export async function checkSender(op: ScreenedOp, p: AaPolicy, readCode: ReadCode): Promise<string | null> {
  if (op.authorization) {
    let signer: Address;
    try {
      signer = await recoverAuthorizationAddress({ authorization: op.authorization });
    } catch {
      return "delegation is not signed by the sender";
    }
    return sameAddress(signer, op.sender) ? null : "delegation is not signed by the sender";
  }
  const code = await readCode(op.sender);
  const delegation = concat(["0xef0100", p.implementation]).toLowerCase();
  return (code ?? "0x").toLowerCase() === delegation ? null : "sender is not an aHand account";
}

/** The bundler/paymaster upstream; only the local stand has a default. */
export function aaUpstream(env: Record<string, string | undefined>, chainId: number): string | null {
  if (env.AA_UPSTREAM_URL) return env.AA_UPSTREAM_URL;
  if (chainId !== ANVIL_CHAIN_ID) return null;
  return env.AA_LOCAL_URL || "http://127.0.0.1:4339";
}

const prices = new Map<string, { at: number; price: Promise<bigint> }>();

/** The bundler's current fast maxFeePerGas, briefly cached per upstream. */
function upstreamGasPrice(upstream: string, send: typeof fetch): Promise<bigint> {
  const hit = prices.get(upstream);
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.price;
  const price = (async () => {
    const res = await send(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "pimlico_getUserOperationGasPrice", params: [] }),
      cache: "no-store",
    });
    const fee = quantity(((await res.json()) as { result?: { fast?: { maxFeePerGas?: unknown } } })?.result?.fast?.maxFeePerGas);
    if (!fee) throw new Error("upstream gave no gas price");
    return fee;
  })();
  prices.set(upstream, { at: Date.now(), price });
  price.catch(() => {
    if (prices.get(upstream)?.price === price) prices.delete(upstream);
  });
  return price;
}

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-cache, no-store, must-revalidate",
};

const refuse = (r: Refusal) => new Response(r.body, { status: r.status, headers: JSON_HEADERS });

export async function proxyAaRequest(
  request: Request,
  {
    policy,
    upstream,
    readCode,
    fetch: send = fetch,
    gasPrice,
  }: {
    policy: AaPolicy;
    upstream: string | null;
    readCode: ReadCode;
    fetch?: typeof fetch;
    /** The price sponsored fees are held to; defaults to the upstream's fast price. */
    gasPrice?: () => Promise<bigint>;
  },
): Promise<Response> {
  if (!upstream) return refuse(rpcError(503, null, -32603, "sponsored transactions are not configured"));
  const screened = screenAaRequest(await request.text(), policy);
  if (!screened.ok) return refuse(screened);
  if (screened.op) {
    let refused: string | null;
    try {
      refused = await checkSender(screened.op, policy, readCode);
    } catch (err) {
      console.error("[AA Proxy Error]", err);
      return refuse(rpcError(502, screened.id, -32603, "chain unavailable"));
    }
    if (refused) return refuse(rpcError(403, screened.id, -32602, refused));
  }
  if (screened.op?.maxFeePerGas) {
    let price: bigint;
    try {
      price = await (gasPrice ?? (() => upstreamGasPrice(upstream, send)))();
    } catch (err) {
      console.error("[AA Proxy Error]", err);
      return refuse(rpcError(502, screened.id, -32603, "gas price unavailable"));
    }
    if (screened.op.maxFeePerGas > price * FEE_HEADROOM) {
      return refuse(rpcError(403, screened.id, -32602, "gas price is over the sponsored ceiling"));
    }
  }
  try {
    const res = await send(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: screened.body,
      cache: "no-store",
    });
    return new Response(await res.text(), { status: res.status, headers: JSON_HEADERS });
  } catch (err) {
    console.error("[AA Proxy Error]", err);
    return refuse(rpcError(502, screened.id, -32603, "bundler unavailable"));
  }
}
