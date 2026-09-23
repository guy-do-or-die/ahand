/** Raise transaction assembly — pure, so the call shapes can be tested. */
import { decodeEventLog, type Address, type Hex, type Log } from "viem";
import { AHandCoreAbi, AHandSignalsAbi, MockUSDAbi, DeployedAddresses } from "@ahand/abi";
import type { SendResult, SenderCall } from "../hooks/useSender";

export interface RaiseParamsArg {
  token: Address;
  amount: bigint;
  expiry: number;
  charityRecipient: Address;
  charityBps: number;
  minGiverClaimBps: number;
  rootCapability: Address;
  visibility: number;
  metadataCommitment: Hex;
  discoveryCommitment: Hex;
}

/**
 * approve (only if the allowance is short) + raise, and nothing else. The
 * RAISED receipt never rides in this batch: Core assigns the hand id when
 * raise executes, so any id named before the op lands is a guess that a
 * concurrent raise can take.
 */
export function raiseCalls({
  allowance,
  params,
  discoveryRef,
}: {
  allowance: bigint | undefined;
  params: RaiseParamsArg;
  discoveryRef: Hex;
}): SenderCall[] {
  const calls: SenderCall[] = [];
  if (allowance === undefined || allowance < params.amount) {
    calls.push({
      address: DeployedAddresses.mockUSD,
      abi: MockUSDAbi,
      functionName: "approve",
      args: [DeployedAddresses.AHandCore, params.amount],
    });
  }
  calls.push({
    address: DeployedAddresses.AHandCore,
    abi: AHandCoreAbi,
    functionName: "raise",
    args: [params, discoveryRef, []], // publicTags — none yet
  });
  return calls;
}

/** The id Core assigned: the Raised log this op's own logs carry, from Core only. */
export function raisedHandId(logs: Log[], core: Address = DeployedAddresses.AHandCore): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== core.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: AHandCoreAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "Raised") return decoded.args.handId;
    } catch {
      /* not a Core event this ABI knows */
    }
  }
  return null;
}

export function raisedReceiptCall(handId: bigint): SenderCall {
  return {
    address: DeployedAddresses.AHandSignals,
    abi: AHandSignalsAbi,
    functionName: "materializeRaised",
    args: [handId],
  };
}

/**
 * Mint the RAISED receipt for a hand that already exists. Best-effort: the
 * receipt is permissionless and idempotent, so a failure (someone minted it
 * first included) only leaves it for the pocket retry. Never throws.
 */
export async function mintRaisedReceipt(
  send: (calls: SenderCall[]) => Promise<SendResult>,
  handId: bigint,
): Promise<boolean> {
  try {
    await send([raisedReceiptCall(handId)]);
    return true;
  } catch (err) {
    console.warn(`[raise] RAISED receipt for hand #${handId} left pending:`, err);
    return false;
  }
}
