import { useCallback } from "react";
import { useConnection, usePublicClient, useSwitchChain, useWalletClient, useWriteContract } from "wagmi";
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
  const { address, isConnected } = useConnection();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { mutateAsync: writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
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
      // An injected wallet transacts on whatever network it is parked on;
      // make it follow the app's chain before any write leaves the door.
      // No walletClient gate: when hydration lags, the connector still
      // answers the switch request — skipping would let the write assert.
      if (walletClient?.chain?.id !== activeChain.id) {
        await switchChainAsync({ chainId: activeChain.id });
      }
      let last: TransactionReceipt | null = null;
      const logs: Log[] = [];
      for (const c of calls) {
        // Estimate through the app's own RPC first: surfaces the real revert
        // reason on failure, and pins a sane gas limit so the wallet never
        // falls back to an estimate the RPC will refuse to broadcast.
        const gas = await publicClient.estimateContractGas({
          account: address,
          address: c.address,
          abi: c.abi,
          functionName: c.functionName,
          args: c.args as unknown[],
          ...(c.value !== undefined ? { value: c.value } : {}),
        });
        const hash = await writeContractAsync({
          chainId: activeChain.id,
          address: c.address,
          abi: c.abi,
          functionName: c.functionName,
          args: c.args as unknown[],
          gas: (gas * 12n) / 10n,
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
    [sponsored, walletClient, publicClient, writeContractAsync, switchChainAsync, signAuthorization],
  );

  return { send, mode: sponsored ? ("sponsored" as const) : ("classic" as const), isConnected, address };
}
