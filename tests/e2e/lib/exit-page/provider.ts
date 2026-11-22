/**
 * A test wallet for exit.html opened from disk: an EIP-1193 provider injected before the page's
 * own script, announced through EIP-6963 and set as window.ethereum, that forwards every request
 * to anvil's JSON-RPC from the test process. anvil holds its test accounts unlocked, so
 * eth_sendTransaction is signed by anvil itself; the page never sees a key.
 */
import type { Page } from "@playwright/test";
import type { Address } from "viem";

let id = 0;

/** One JSON-RPC call to anvil; throws an EIP-1193-shaped error on a JSON-RPC error. */
export async function rpcCall(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { code: number; message: string; data?: unknown } };
  if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code, data: body.error.data });
  return body.result;
}

/** Injects the test wallet into `page` as `account`. Call before `page.goto`. */
export async function injectWallet(page: Page, rpcUrl: string, account: Address): Promise<void> {
  await page.exposeFunction("__exitTestRpc", async (method: string, params: unknown[]) => {
    try {
      return { result: await rpcCall(rpcUrl, method, params ?? []) };
    } catch (error) {
      const e = error as { message: string; code?: number; data?: unknown };
      return { error: { message: e.message, code: e.code ?? -32603, data: e.data } };
    }
  });
  await page.addInitScript((from: string) => {
    type Forward = (method: string, params: unknown[]) => Promise<{ result?: unknown; error?: { message: string; code: number; data?: unknown } }>;
    const forward = (window as unknown as { __exitTestRpc: Forward }).__exitTestRpc;
    const provider = {
      async request({ method, params }: { method: string; params?: unknown[] }) {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [from];
        const answer = await forward(method, params ?? []);
        if (answer.error) throw Object.assign(new Error(answer.error.message), answer.error);
        return answer.result;
      },
    };
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: Object.freeze({ info: { uuid: "0b5e1c6e-test-wallet-anvil", name: "Test wallet (anvil)", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "test.anvil" }, provider }),
        }),
      );
    window.addEventListener("eip6963:requestProvider", announce);
    (window as unknown as { ethereum: typeof provider }).ethereum = provider;
  }, account);
}
