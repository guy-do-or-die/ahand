import { useCallback } from "react";
import { useAccount, usePublicClient, useWalletClient, useWriteContract } from "wagmi";
import { useSign7702Authorization, useWallets } from "@privy-io/react-auth";
import { encodeFunctionData, type Abi, type Address, type Log, type TransactionReceipt } from "viem";
import { AA, SIMPLE_7702_IMPLEMENTATION } from "../config/aa";
import { POLLING_INTERVAL, activeChain } from "../config/web3";
import { getSmartAccountClient, needsDelegation, sendSponsoredBatch } from "../lib/smartAccount";

export type SenderCall = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

export type SendResult = {
  /** Last (or only) transaction receipt. */
  receipt: TransactionReceipt;
  /** Logs of ALL calls — one userOp's scoped logs, or every classic receipt's, concatenated. */
  logs: Log[];
};

/**
 * The single tx-sending abstraction both flows sit on.
 *
 * - Privy embedded wallet (social login): ONE sponsored userOp batching all
 *   calls, gas paid by the paymaster, EIP-7702 delegation attached on first use.
 * - External wallet (MetaMask etc.): today's classic path, byte-for-byte —
 *   sequential writeContract + waitForTransactionReceipt, user pays gas.
 */
export function useSender() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { writeContractAsync } = useWriteContract();
  const { wallets } = useWallets();
  const { signAuthorization } = useSign7702Authorization();

  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const sponsored =
    AA.enabled && !!embedded && !!address && embedded.address.toLowerCase() === address.toLowerCase();

  const send = useCallback(
    async (calls: SenderCall[]): Promise<SendResult> => {
      if (!publicClient) throw new Error("RPC client not ready");
      if (calls.length === 0) throw new Error("Nothing to send");

      if (sponsored) {
        if (!walletClient) throw new Error("Wallet not ready");
        const client = await getSmartAccountClient(walletClient, publicClient);
        const aaCalls = calls.map((c) => ({
          to: c.address,
          data: encodeFunctionData({
            abi: c.abi,
            functionName: c.functionName,
            args: c.args as unknown[],
          }),
          ...(c.value !== undefined ? { value: c.value } : {}),
        }));
        const owner = walletClient.account.address;
        const authorization = (await needsDelegation(publicClient, owner))
          ? await signAuthorization({
              contractAddress: SIMPLE_7702_IMPLEMENTATION,
              chainId: activeChain.id,
              nonce: await publicClient.getTransactionCount({ address: owner }),
            })
          : undefined;
        return sendSponsoredBatch({
          client,
          calls: aaCalls,
          authorization,
          pollingInterval: POLLING_INTERVAL,
        });
      }

      // Classic path — unchanged semantics for external wallets.
      let last: TransactionReceipt | null = null;
      const logs: Log[] = [];
      for (const c of calls) {
        const hash = await writeContractAsync({
          address: c.address,
          abi: c.abi,
          functionName: c.functionName,
          args: c.args as unknown[],
          ...(c.value !== undefined ? { value: c.value } : {}),
        });
        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          pollingInterval: POLLING_INTERVAL,
        });
        logs.push(...receipt.logs);
        last = receipt;
      }
      return { receipt: last as TransactionReceipt, logs };
    },
    [sponsored, walletClient, publicClient, writeContractAsync, signAuthorization],
  );

  return { send, mode: sponsored ? ("sponsored" as const) : ("classic" as const), isConnected, address };
}
