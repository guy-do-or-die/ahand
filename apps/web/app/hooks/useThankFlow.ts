import { useEffect, useState } from "react";
import { useConnection, useReadContract, usePublicClient } from "wagmi";
import { parseUnits } from "viem";
import { useSender, type SenderCall } from "./useSender";
import { AHandCoreAbi, MockERC20Abi, DeployedAddresses } from "@ahand/abi";
import { t } from "../i18n";
import { humanizeChainError } from "../lib/errors";

/**
 * Thank/settle flow — unchanged PoC sequence: parse the proof fragment,
 * (approve top-up if needed) → thank(handId, shakes, sigs, give, giveSig,
 * topUp) → waitForTransactionReceipt. Raiser-only, atomic on-chain.
 */
export function useThankFlow(id: string) {
  const { address, isConnected } = useConnection();
  const publicClient = usePublicClient();
  const { send } = useSender();

  const [thankData, setThankData] = useState<any>(null);
  const [parseError, setParseError] = useState("");
  const [topUp, setTopUp] = useState("0");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [success, setSuccess] = useState(false);
  /** Pot size captured at settlement time, for the receipt after the tx. */
  const [settledPot, setSettledPot] = useState<bigint | null>(null);

  const { data: handRaw } = useReadContract({
    address: DeployedAddresses.AHandCore,
    abi: AHandCoreAbi,
    functionName: "hands",
    args: [BigInt(id)],
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: DeployedAddresses.mockUSD,
    abi: MockERC20Abi,
    functionName: "allowance",
    args: address && DeployedAddresses.AHandCore ? [address, DeployedAddresses.AHandCore] : undefined,
  });

  // Parse location.hash on client side
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (!hash) {
      setParseError(t("This link is missing its proof — ask the helper to resend it."));
      return;
    }
    try {
      const jsonStr = atob(hash.replace(/-/g, "+").replace(/_/g, "/"));
      const parsed = JSON.parse(jsonStr);
      setThankData(parsed);
    } catch (err: any) {
      console.error(err);
      setParseError(t("This proof couldn't be read: {reason}", { reason: err.message }));
    }
  }, []);

  const handleThank = async () => {
    if (!handRaw) return;
    const [raiser] = handRaw as any[];

    if (!isConnected || !address || !publicClient) {
      setErrorMsg(t("Connect your pocket first."));
      return;
    }
    if (address.toLowerCase() !== raiser.toLowerCase()) {
      setErrorMsg(t("Only the raiser can say thanks here."));
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const parsedTopUp = parseUnits(topUp || "0", 6); // mockUSD is 6 decimals

      // 1. Format shakes & sigs
      const shakes = thankData.shakes.map((s: any) => ({
        handId: BigInt(s.shake.handId),
        childCapability: s.shake.childCapability as `0x${string}`,
        payout: s.shake.payout as `0x${string}`,
        parentClaimBps: Number(s.shake.parentClaimBps),
        childClaimBps: Number(s.shake.childClaimBps),
        deadline: BigInt(s.shake.deadline),
      }));

      const sigs = thankData.shakes.map((s: any) => s.signature as `0x${string}`);

      const give = {
        handId: BigInt(thankData.give.handId),
        solver: thankData.give.solver as `0x${string}`,
        solutionHash: thankData.give.solutionHash as `0x${string}`,
        finalClaimBps: Number(thankData.give.finalClaimBps),
      };

      const giveSig = thankData.giveSig as `0x${string}`;

      // 2. Approve top-up (only if short) + thank — one sponsored userOp for
      // embedded pockets, the same sequential txs as before for external wallets.
      const calls: SenderCall[] = [];
      if (parsedTopUp > 0n && (!allowance || (allowance as bigint) < parsedTopUp)) {
        calls.push({
          address: DeployedAddresses.mockUSD,
          abi: MockERC20Abi,
          functionName: "approve",
          args: [DeployedAddresses.AHandCore, parsedTopUp],
        });
      }
      calls.push({
        address: DeployedAddresses.AHandCore,
        abi: AHandCoreAbi,
        functionName: "thank",
        args: [
          BigInt(id),
          shakes,
          sigs,
          give,
          giveSig,
          parsedTopUp,
        ],
      });

      await send(calls);
      await refetchAllowance();
      setSettledPot(((handRaw as any[])[2] as bigint) + parsedTopUp);
      setSuccess(true);
    } catch (err: any) {
      console.error(err);
      const human = humanizeChainError(err);
      setErrorMsg(human.detail ? `${human.message} · ${human.detail}` : human.message);
    } finally {
      setLoading(false);
    }
  };

  return {
    thankData,
    parseError,
    handRaw,
    topUp,
    setTopUp,
    loading,
    errorMsg,
    success,
    settledPot,
    handleThank,
  };
}
