import { refusalOfData, simulate, type Call, type CoreRefusal } from "@ahand/sdk";
import { MethodNotFoundRpcError, MethodNotSupportedRpcError, type Address, type Hex, type PublicClient } from "viem";

/**
 * Asks the chain what a list of calls would do if `from` sent them now, one after another, before
 * anything is sent (ARCHITECTURE §6 step 3, D-61). A refusal comes back as data, never as a failed
 * send: Core's own error decoded by the SDK, or, for anything else the chain refused (a token's
 * own error), its message.
 *
 * One call: the SDK's `simulate` (an `eth_call`, then a gas estimate). Several calls: later calls
 * often depend on earlier ones (an approve before a raise; an account's setup before a thank), so
 * they are run as one sequence with `eth_simulateV1`, each seeing the state the earlier left.
 * Where the RPC does not know `eth_simulateV1`, the first call alone is checked with the SDK here,
 * and each later one is checked just before it is sent (`useSend` does that).
 */

export type Simulation =
  | { ok: true; gas: bigint[]; /** False when only the first call could be checked ahead. */ complete: boolean }
  | { ok: false; step: number; refusal: CoreRefusal }
  | { ok: false; step: number; failure: string };

function messageOf(error: unknown): string {
  if (error && typeof error === "object") {
    const short = (error as { shortMessage?: unknown }).shortMessage;
    if (typeof short === "string" && short) return short;
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message.split("\n")[0]!;
  }
  return String(error);
}

function unsupported(error: unknown): boolean {
  let node: unknown = error;
  const seen = new Set<unknown>();
  while (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    if (node instanceof MethodNotFoundRpcError || node instanceof MethodNotSupportedRpcError) return true;
    const code = (node as { code?: unknown }).code;
    if (code === -32601 || code === -32004) return true;
    node = (node as { cause?: unknown }).cause;
  }
  return false;
}

/** One call through the SDK, as a `Simulation` for step `step`. Network errors are thrown. */
export async function simulateOne(client: PublicClient, call: Call, from: Address, step = 0): Promise<Simulation> {
  try {
    const result = await simulate(client, call, from);
    return result.ok ? { ok: true, gas: [result.gas], complete: true } : { ok: false, step, refusal: result.refusal };
  } catch (error) {
    // `simulate` throws what is not Core's: a token's own error or a dead network.
    if (isRevert(error)) return { ok: false, step, failure: messageOf(error) };
    throw error;
  }
}

/** Whether an error is the chain refusing the call (it reverted), not the network failing. */
function isRevert(error: unknown): boolean {
  let node: unknown = error;
  const seen = new Set<unknown>();
  let reverted = false;
  while (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    const { name, code } = node as { name?: unknown; code?: unknown };
    if (name === "HttpRequestError" || name === "TimeoutError" || name === "WebSocketRequestError") return false;
    if (name === "ExecutionRevertedError" || name === "ContractFunctionRevertedError" || code === 3) reverted = true;
    node = (node as { cause?: unknown }).cause;
  }
  return reverted;
}

/** Every call, in order, as `from` would send them now. Network errors are thrown. */
export async function simulateAll(client: PublicClient, calls: readonly Call[], from: Address): Promise<Simulation> {
  if (calls.length === 0) throw new Error("nothing to simulate");
  if (calls.length === 1) return simulateOne(client, calls[0]!, from);
  let results: { status: string; gasUsed: bigint; data: Hex; error?: unknown }[];
  try {
    const answer = await client.simulateCalls({
      account: from,
      calls: calls.map((call) => ({ to: call.to, data: call.data, ...(call.value ? { value: call.value } : {}) })),
    });
    results = answer.results as typeof results;
  } catch (error) {
    if (!unsupported(error)) throw error;
    const first = await simulateOne(client, calls[0]!, from);
    return first.ok ? { ok: true, gas: first.gas, complete: false } : first;
  }
  const gas: bigint[] = [];
  for (const [step, result] of results.entries()) {
    if (result.status !== "success") {
      const refusal = result.data && result.data.length >= 10 ? refusalOfData(result.data) : undefined;
      return refusal ? { ok: false, step, refusal } : { ok: false, step, failure: result.error ? messageOf(result.error) : "the call reverted" };
    }
    gas.push(result.gasUsed);
  }
  return { ok: true, gas, complete: true };
}
