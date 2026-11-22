/**
 * An EIP-1193 wallet for a burner key on Base Sepolia, injected into every page of a context and
 * announced through EIP-6963 as "Demo burner wallet". Like tests/e2e/lib/fork/key-wallet.ts, every
 * request goes to this test process, which signs; the key never enters the page. Unlike it, the RPC
 * may be public (a branch site on Base Sepolia), so the guard is the chain: it signs for chain
 * 84532 only, checked against the RPC before the first answer, and its keys come only from the
 * engine's burner file.
 */
import type { BrowserContext } from "@playwright/test";
import { createPublicClient, createWalletClient, defineChain, http, numberToHex, type Address, type Hex, type TypedDataDefinition } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { BURNER_CHAIN_ID, burnerKey } from "./burners";

export const BURNER_WALLET_NAME = "Demo burner wallet";

export async function injectBurner(context: BrowserContext, rpcUrl: string, n: number): Promise<Address> {
  const chain = defineChain({ id: BURNER_CHAIN_ID, name: "Base Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const reader = createPublicClient({ chain, transport: http(rpcUrl) });
  const answered = await reader.getChainId();
  if (answered !== BURNER_CHAIN_ID) throw new Error(`the burner wallet signs for Base Sepolia only; ${rpcUrl} answers chain ${answered}`);
  const account = privateKeyToAccount(burnerKey(n));
  const signer = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const chainHex = numberToHex(BURNER_CHAIN_ID);

  const answer = async (method: string, params: unknown[]): Promise<unknown> => {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_chainId":
        return chainHex;
      case "wallet_switchEthereumChain": {
        const wanted = (params[0] as { chainId?: string } | undefined)?.chainId;
        if (wanted && BigInt(wanted) !== BigInt(BURNER_CHAIN_ID)) throw Object.assign(new Error("this wallet is on Base Sepolia only"), { code: 4902 });
        return null;
      }
      case "wallet_getCapabilities":
        return { [chainHex]: { atomic: { status: "unsupported" } } };
      case "eth_signTypedData_v4": {
        const [from, json] = params as [string, string];
        if (from.toLowerCase() !== account.address.toLowerCase()) throw Object.assign(new Error("not this account"), { code: 4100 });
        const typed = JSON.parse(json) as TypedDataDefinition & { domain?: { chainId?: number | string } };
        // Typed data with no chain in its domain could be replayed on any chain: refused, as a careful wallet does.
        if (typed.domain?.chainId === undefined || Number(typed.domain.chainId) !== BURNER_CHAIN_ID) throw Object.assign(new Error("a burner signs typed data for Base Sepolia only"), { code: 4100 });
        return account.signTypedData(typed);
      }
      case "eth_sendTransaction": {
        const [tx] = params as [{ from?: string; to: Address; data?: Hex; value?: Hex; gas?: Hex }];
        // A page asking to send from another account gets an error, as from a real wallet, not this account's transaction.
        if (tx.from !== undefined && tx.from.toLowerCase() !== account.address.toLowerCase()) throw Object.assign(new Error("not this account"), { code: 4100 });
        return signer.sendTransaction({ to: tx.to, ...(tx.data ? { data: tx.data } : {}), value: tx.value ? BigInt(tx.value) : 0n, ...(tx.gas ? { gas: BigInt(tx.gas) } : {}) });
      }
      case "personal_sign":
      case "eth_sign":
      case "wallet_sendCalls":
        throw Object.assign(new Error(`the burner wallet does not do ${method}`), { code: 4200 });
      default:
        return (reader.request as (args: { method: string; params: unknown[] }) => Promise<unknown>)({ method, params });
    }
  };

  await context.exposeFunction("__demoBurner", async (method: string, params: unknown[]) => {
    try {
      return { result: await answer(method, params ?? []) };
    } catch (error) {
      const e = error as { shortMessage?: string; message: string; code?: number };
      return { error: { message: e.shortMessage ?? e.message, code: typeof e.code === "number" ? e.code : -32603 } };
    }
  });
  await context.addInitScript((name: string) => {
    type Forward = (method: string, params: unknown[]) => Promise<{ result?: unknown; error?: { message: string; code: number } }>;
    const provider = {
      async request({ method, params }: { method: string; params?: unknown[] }) {
        const reply = await (window as unknown as { __demoBurner: Forward }).__demoBurner(method, params ?? []);
        if (reply.error) throw Object.assign(new Error(reply.error.message), { code: reply.error.code });
        return reply.result;
      },
      on() {},
      removeListener() {},
    };
    const detail = Object.freeze({ info: { uuid: "5d1f0b8e-demo-burner-wallet", name, icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "test.ahand.demo-burner" }, provider });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }, BURNER_WALLET_NAME);
  return account.address;
}
