/**
 * /api/aa sits in front of the server-held bundler/paymaster key (Pimlico
 * in production), and that key pays for gas. So the proxy relays only what
 * the app's own sponsored sends use: the methods viem/permissionless call,
 * for user operations whose calls are aHand's own (Core and Signals entry
 * points, the reward-token approval to Core, the faucet mint on anvil).
 * The sponsorship policy is the server's; a caller's paymaster context is
 * never forwarded.
 */
import { decodeFunctionData, parseAbi, type Abi, type Address, type Hex } from "viem";
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
// receipt mint). preVerificationGas has no ceiling here: on Base it carries
// the L1 data fee and moves with L1 prices, so the sponsorship policy's
// per-op spend cap is what bounds it.
export const GAS_CEILINGS = {
  callGasLimit: 6_000_000n,
  verificationGasLimit: 1_000_000n,
  paymasterVerificationGasLimit: 500_000n,
  paymasterPostOpGasLimit: 500_000n,
} as const;

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

type Refusal = { ok: false; status: number; body: string };
export type AaScreen = { ok: true; id: RpcId; body: string } | Refusal;

const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
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

function screenUserOp(op: unknown, p: AaPolicy): string | null {
  if (!isRecord(op)) return "missing user operation";
  if (!isEmpty(op.initCode)) return "initCode is not sponsored";
  if (!isEmpty(op.factory) && !(typeof op.factory === "string" && DELEGATION_MARKERS.has(op.factory.toLowerCase()))) {
    return "only the EIP-7702 marker may stand in for a factory";
  }
  if (!isEmpty(op.factoryData)) return "factoryData is not sponsored";
  if (op.eip7702Auth !== undefined && op.eip7702Auth !== null) {
    const auth = op.eip7702Auth;
    if (!isRecord(auth) || !sameAddress(auth.address, p.implementation) || quantity(auth.chainId) !== BigInt(p.chainId)) {
      return "delegation must name the aHand account implementation on this chain";
    }
  }
  for (const [field, ceiling] of Object.entries(GAS_CEILINGS)) {
    if (op[field] === undefined || op[field] === null) continue;
    const gas = quantity(op[field]);
    if (gas === null || gas > ceiling) return `${field} is over the sponsored ceiling`;
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
  return null;
}

/**
 * Decide whether one JSON-RPC request may reach the upstream. The forwarded
 * body is re-serialized from what was checked, never the caller's raw text.
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
  const forward = (out: unknown[]): AaScreen => ({
    ok: true,
    id,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: out }),
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
  const refused = screenUserOp(params[0], p);
  if (refused) return rpcError(403, id, -32602, refused);

  if (!sponsored) return forward(params);
  const context = p.sponsorshipPolicyId ? { sponsorshipPolicyId: p.sponsorshipPolicyId } : null;
  return forward([params[0], params[1], params[2], context]);
}

/** The bundler/paymaster upstream; only the local stand has a default. */
export function aaUpstream(env: Record<string, string | undefined>, chainId: number): string | null {
  if (env.AA_UPSTREAM_URL) return env.AA_UPSTREAM_URL;
  if (chainId !== ANVIL_CHAIN_ID) return null;
  return env.AA_LOCAL_URL || "http://127.0.0.1:4339";
}

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-cache, no-store, must-revalidate",
};

const refuse = (r: Refusal) => new Response(r.body, { status: r.status, headers: JSON_HEADERS });

export async function proxyAaRequest(
  request: Request,
  { policy, upstream, fetch: send = fetch }: { policy: AaPolicy; upstream: string | null; fetch?: typeof fetch },
): Promise<Response> {
  if (!upstream) return refuse(rpcError(503, null, -32603, "sponsored transactions are not configured"));
  const screened = screenAaRequest(await request.text(), policy);
  if (!screened.ok) return refuse(screened);
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
