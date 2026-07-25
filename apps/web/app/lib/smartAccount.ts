import {
  concat,
  http,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
  type Account,
  type Chain,
  type Transport,
  type SignedAuthorization,
} from "viem";
import { toSimple7702SmartAccount } from "viem/account-abstraction";
import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { toOwner } from "permissionless/utils";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { AA, SIMPLE_7702_IMPLEMENTATION } from "../config/aa";
import { activeChain } from "../config/web3";

/**
 * The ONLY module that touches permissionless / viem account-abstraction
 * (mirrors how xmtpClient.ts isolates the XMTP SDK).
 *
 * Same-address EIP-7702: the embedded EOA delegates to Simple7702Account,
 * so the smart account IS the EOA address — XMTP identity, pocket history,
 * and contract msg.sender all stay put.
 */

export type AaCall = { to: Address; data: Hex; value?: bigint };

type ConnectedWalletClient = WalletClient<Transport, Chain | undefined, Account>;

let cached: { key: string; client: Promise<SmartAccountClient> } | null = null;

/** Memoized per address+chain — building the account does on-chain reads. */
export function getSmartAccountClient(
  walletClient: ConnectedWalletClient,
  publicClient: PublicClient,
): Promise<SmartAccountClient> {
  const key = `${walletClient.account.address.toLowerCase()}:${activeChain.id}`;
  if (cached?.key === key) return cached.client;

  const client = (async () => {
    // Wrap the EIP-1193 wallet into a viem local-account shape; the 7702
    // account only calls address / signMessage / signTypedData on it.
    // Local accounts (tests, probes) are used directly: toOwner would ask
    // the TRANSPORT for accounts, and an http transport to anvil answers
    // with anvil's unlocked key #0 — the wrong sender.
    const owner =
      walletClient.account.type === "local"
        ? walletClient.account
        : await toOwner({ owner: walletClient });
    const account = await toSimple7702SmartAccount({
      client: publicClient,
      owner: owner as never,
      implementation: SIMPLE_7702_IMPLEMENTATION,
    });
    const pimlico = createPimlicoClient({ transport: http(AA.paymasterUrl) });
    return createSmartAccountClient({
      account,
      chain: activeChain,
      bundlerTransport: http(AA.bundlerUrl),
      paymaster: pimlico,
      userOperation: {
        estimateFeesPerGas: async () => (await pimlico.getUserOperationGasPrice()).fast,
      },
    });
  })();

  cached = { key, client };
  client.catch(() => {
    if (cached?.key === key) cached = null; // don't memoize failures
  });
  return client;
}

/** True until the EOA's code is exactly 0xef0100 ‖ implementation. */
export async function needsDelegation(
  publicClient: PublicClient,
  address: Address,
): Promise<boolean> {
  const code = await publicClient.getCode({ address });
  return (
    (code ?? "0x").toLowerCase() !==
    concat(["0xef0100", SIMPLE_7702_IMPLEMENTATION]).toLowerCase()
  );
}

/**
 * One sponsored, batched userOp. `authorization` is only needed on the first
 * (undelegated) op — viem turns it into factory "0x7702" + eip7702Auth.
 * Returns the userOp-SCOPED logs (never the whole bundle's: another sender's
 * events could hide in there on a shared bundler).
 */
export async function sendSponsoredBatch({
  client,
  calls,
  authorization,
  pollingInterval,
}: {
  client: SmartAccountClient;
  calls: AaCall[];
  authorization?: SignedAuthorization;
  pollingInterval: number;
}): Promise<{ receipt: TransactionReceipt; logs: Log[] }> {
  const hash = await client.sendUserOperation({
    calls,
    ...(authorization ? { authorization } : {}),
    ...(AA.sponsorshipPolicyId
      ? { paymasterContext: { sponsorshipPolicyId: AA.sponsorshipPolicyId } }
      : {}),
  });
  const uo = await client.waitForUserOperationReceipt({
    hash,
    pollingInterval,
    timeout: 60_000,
  });
  if (!uo.success) {
    // Mined but reverted inside handleOps — surface like a classic revert.
    throw new Error(`Transaction reverted on-chain (userOp ${hash})`);
  }
  return { receipt: uo.receipt, logs: uo.logs as Log[] };
}
