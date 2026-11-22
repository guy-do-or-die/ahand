/**
 * A test wallet that takes several calls as one batch (EIP-5792 with atomic support), for the raise
 * smoke. The app's dev wallet answers "atomic: unsupported", so without this no browser test reaches
 * the batch path of `useSend`.
 *
 * It is a test double, not a wallet: an EIP-1193 provider injected into the page and announced
 * through EIP-6963 ("Batching test wallet"), which forwards every request to this test process.
 * Here one of anvil's public test keys signs: `wallet_sendCalls` sends the calls one after another
 * (in order, by the account's own nonces) and remembers their hashes under a batch id;
 * `wallet_getCallsStatus` answers as the test tells it to: still pending, landed (the receipts
 * read from the chain), or failed. Its memory lives in the test process, so it survives the page's
 * reloads the way a real wallet's does. `differs` makes its typed-data confirmations differ each
 * time, as a smart account's do.
 */
import type { BrowserContext } from "@playwright/test";
import { createPublicClient, createWalletClient, http, numberToHex, type Address, type Hex, type TypedDataDefinition } from "viem";
import { privateKeyToAccount, setSignEntropy } from "viem/accounts";
import { foundry } from "viem/chains";

export const BATCH_WALLET_NAME = "Batching test wallet";

export type BatchReport = "pending" | "landed" | "failed";

export interface BatchWallet {
  address: Address;
  /** What `wallet_getCallsStatus` answers from now on. */
  report(as: BatchReport): void;
  /** The batches taken so far, with the hashes of their calls. */
  batches(): { id: string; hashes: Hex[] }[];
  /** How often each method was asked. */
  asked(method: string): number;
}

interface Answer {
  result?: unknown;
  error?: { message: string; code: number };
}

/** Injects the wallet into every page of `context`. Call before the first `page.goto`. */
export async function injectBatchWallet(context: BrowserContext, rpcUrl: string, key: Hex, opts: { differs?: boolean } = {}): Promise<BatchWallet> {
  const account = privateKeyToAccount(key);
  const signer = createWalletClient({ account, chain: foundry, transport: http(rpcUrl) });
  const reader = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
  const chainHex = numberToHex(foundry.id);
  const sent = new Map<string, Hex[]>();
  const asked = new Map<string, number>();
  let reporting: BatchReport = "pending";

  const forward = (method: string, params: unknown[]) =>
    (reader.request as (args: { method: string; params: unknown[] }) => Promise<unknown>)({ method, params });

  const answer = async (method: string, params: unknown[]): Promise<unknown> => {
    asked.set(method, (asked.get(method) ?? 0) + 1);
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_chainId":
        return chainHex;
      case "wallet_switchEthereumChain":
        return null;
      case "wallet_getCapabilities":
        return { [chainHex]: { atomic: { status: "supported" } } };
      case "eth_signTypedData_v4": {
        const typed = JSON.parse(params[1] as string) as TypedDataDefinition;
        if (!opts.differs) return account.signTypedData(typed);
        setSignEntropy(true);
        try {
          return await account.signTypedData(typed);
        } finally {
          setSignEntropy("0x");
        }
      }
      case "eth_sendTransaction": {
        const [tx] = params as [{ to: Address; data?: Hex; value?: Hex }];
        return signer.sendTransaction({ to: tx.to, ...(tx.data ? { data: tx.data } : {}), value: tx.value ? BigInt(tx.value) : 0n, gas: 3_000_000n });
      }
      case "wallet_sendCalls": {
        const [{ calls, atomicRequired }] = params as [{ calls: { to: Address; data?: Hex; value?: Hex }[]; atomicRequired?: boolean }];
        if (!atomicRequired) throw new Error("the app must ask for a batch that runs whole");
        const hashes: Hex[] = [];
        for (const call of calls) {
          hashes.push(await signer.sendTransaction({ to: call.to, ...(call.data ? { data: call.data } : {}), value: call.value ? BigInt(call.value) : 0n, gas: 3_000_000n }));
        }
        const id = numberToHex(BigInt(sent.size + 1), { size: 32 });
        sent.set(id, hashes);
        return { id };
      }
      case "wallet_getCallsStatus": {
        const id = params[0] as string;
        const base = { version: "2.0.0", id, chainId: chainHex, atomic: true };
        const hashes = sent.get(id);
        if (!hashes) throw Object.assign(new Error("this wallet holds no such batch"), { code: 5730 });
        if (reporting === "failed") return { ...base, status: 400 };
        if (reporting === "pending") return { ...base, status: 100 };
        const receipts = await Promise.all(hashes.map((hash) => reader.getTransactionReceipt({ hash }).catch(() => undefined)));
        if (receipts.some((receipt) => !receipt)) return { ...base, status: 100 };
        return {
          ...base,
          status: receipts.every((receipt) => receipt!.status === "success") ? 200 : 500,
          receipts: receipts.map((receipt) => ({
            logs: [],
            status: receipt!.status === "success" ? "0x1" : "0x0",
            blockHash: receipt!.blockHash,
            blockNumber: numberToHex(receipt!.blockNumber),
            gasUsed: numberToHex(receipt!.gasUsed),
            transactionHash: receipt!.transactionHash,
          })),
        };
      }
      default:
        return forward(method, params);
    }
  };

  await context.exposeFunction("__batchTestWallet", async (method: string, params: unknown[]): Promise<Answer> => {
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
        const reply = await (window as unknown as { __batchTestWallet: Forward }).__batchTestWallet(method, params ?? []);
        if (reply.error) throw Object.assign(new Error(reply.error.message), { code: reply.error.code });
        return reply.result;
      },
      // The account and the chain never change: there is nothing to tell a listener.
      on() {},
      removeListener() {},
    };
    const detail = Object.freeze({
      info: { uuid: "7c1d2f0a-batch-test-wallet", name, icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "test.ahand.batch" },
      provider,
    });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }, BATCH_WALLET_NAME);

  return {
    address: account.address,
    report: (as) => {
      reporting = as;
    },
    batches: () => [...sent].map(([id, hashes]) => ({ id, hashes })),
    asked: (method) => asked.get(method) ?? 0,
  };
}
