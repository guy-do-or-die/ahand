/**
 * A test wallet for a public build (chain.local false: no dev wallet in it) driven on a local fork:
 * an EIP-1193 provider injected into every page of a context and announced through EIP-6963 as
 * "Fork test wallet", which forwards every request to this test process. Here one of anvil's public
 * test keys signs (typed data, transactions sent raw to the fork); reads go to the fork's RPC.
 * Like the dev wallet it says "atomic: unsupported", so the app sends one call at a time.
 *
 * It refuses any RPC that is not on this machine: it exists for an anvil fork only, and anvil's
 * test keys must never sign for a public network.
 */
import type { BrowserContext } from "@playwright/test";
import { createPublicClient, createWalletClient, defineChain, http, numberToHex, type Address, type Hex, type TypedDataDefinition } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const FORK_WALLET_NAME = "Fork test wallet";

export interface ForkWallet {
  address: Address;
  /** How often each method was asked. */
  asked(method: string): number;
}

interface Answer {
  result?: unknown;
  error?: { message: string; code: number };
}

export async function injectForkWallet(context: BrowserContext, rpcUrl: string, chainId: number, key: Hex): Promise<ForkWallet> {
  const host = new URL(rpcUrl).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`the fork test wallet signs for a local fork only, not ${rpcUrl}`);
  const chain = defineChain({ id: chainId, name: `fork of ${chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const account = privateKeyToAccount(key);
  const reader = createPublicClient({ chain, transport: http(rpcUrl) });
  const signer = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const answered = await reader.getChainId();
  if (answered !== chainId) throw new Error(`the RPC at ${rpcUrl} answers chain ${answered}, not ${chainId}`);
  const chainHex = numberToHex(chainId);
  const asked = new Map<string, number>();

  const answer = async (method: string, params: unknown[]): Promise<unknown> => {
    asked.set(method, (asked.get(method) ?? 0) + 1);
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_chainId":
        return chainHex;
      case "wallet_switchEthereumChain": {
        const wanted = (params[0] as { chainId?: string } | undefined)?.chainId;
        if (wanted && BigInt(wanted) !== BigInt(chainId)) throw Object.assign(new Error(`this wallet is on chain ${chainId} only`), { code: 4902 });
        return null;
      }
      case "wallet_getCapabilities":
        return { [chainHex]: { atomic: { status: "unsupported" } } };
      case "eth_signTypedData_v4": {
        const [from, json] = params as [string, string];
        if (from.toLowerCase() !== account.address.toLowerCase()) throw Object.assign(new Error("not this account"), { code: 4100 });
        return account.signTypedData(JSON.parse(json) as TypedDataDefinition);
      }
      case "eth_sendTransaction": {
        const [tx] = params as [{ to: Address; data?: Hex; value?: Hex; gas?: Hex }];
        return signer.sendTransaction({
          to: tx.to,
          ...(tx.data ? { data: tx.data } : {}),
          value: tx.value ? BigInt(tx.value) : 0n,
          ...(tx.gas ? { gas: BigInt(tx.gas) } : {}),
        });
      }
      case "personal_sign":
      case "eth_sign":
      case "wallet_sendCalls":
        throw Object.assign(new Error(`the fork test wallet does not do ${method}`), { code: 4200 });
      default:
        return (reader.request as (args: { method: string; params: unknown[] }) => Promise<unknown>)({ method, params });
    }
  };

  await context.exposeFunction("__forkTestWallet", async (method: string, params: unknown[]): Promise<Answer> => {
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
        const reply = await (window as unknown as { __forkTestWallet: Forward }).__forkTestWallet(method, params ?? []);
        if (reply.error) throw Object.assign(new Error(reply.error.message), { code: reply.error.code });
        return reply.result;
      },
      // The account and the chain never change: there is nothing to tell a listener.
      on() {},
      removeListener() {},
    };
    const detail = Object.freeze({
      info: { uuid: "3f6a9c2e-fork-test-wallet", name, icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "test.ahand.fork" },
      provider,
    });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }, FORK_WALLET_NAME);

  return { address: account.address, asked: (method) => asked.get(method) ?? 0 };
}
