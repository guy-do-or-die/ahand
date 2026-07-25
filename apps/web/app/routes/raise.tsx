import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAccount, useWriteContract, useReadContract, usePublicClient } from "wagmi";
import { parseUnits } from "viem";
import { AHandCoreAbi, MockERC20Abi, DeployedAddresses } from "@ahand/abi";
import { encodePayload, newCapability } from "@ahand/sdk";
import { activeChain } from "../config/web3";

export const Route = createFileRoute("/raise")({
  component: RaiseComponent,
});

function RaiseComponent() {
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  // Form state
  const [description, setDescription] = useState("");
  const [reward, setReward] = useState("150");
  const [solverKeep, setSolverKeep] = useState(70); // in Bps = 7000
  const [charityFee, setCharityFee] = useState(1);  // in Bps = 100
  const [expiryDays, setExpiryDays] = useState(30);
  const [fineTune, setFineTune] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [shareUrl, setShareUrl] = useState("");

  // Read allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: DeployedAddresses.mockUSD,
    abi: MockERC20Abi,
    functionName: "allowance",
    args: address && DeployedAddresses.AHandCore ? [address, DeployedAddresses.AHandCore] : undefined,
  });

  const handleRaise = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !address || !publicClient) {
      setErrorMsg("Please connect your wallet first.");
      return;
    }
    if (!description.trim()) {
      setErrorMsg("Please enter a description.");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const parsedReward = parseUnits(reward, 6); // mockUSD is 6 decimals

      // 1. Check & Approve allowance if needed
      console.log("[Raise Flow] Starting allowance check. Reward:", reward, "Parsed:", parsedReward.toString());
      console.log("[Raise Flow] Current mockUSD allowance:", allowance?.toString());
      
      if (!allowance || (allowance as bigint) < parsedReward) {
        console.log("[Raise Flow] Allowance insufficient. Requesting approve transaction...");
        console.log("[Raise Flow] Approve target (mockUSD):", DeployedAddresses.mockUSD);
        console.log("[Raise Flow] Approve spender (AHandCore):", DeployedAddresses.AHandCore);
        
        try {
          const txHash = await writeContractAsync({
            address: DeployedAddresses.mockUSD,
            abi: MockERC20Abi,
            functionName: "approve",
            args: [DeployedAddresses.AHandCore, parsedReward],
          });
          console.log("[Raise Flow] Approve Tx submitted! Hash:", txHash);
          console.log("[Raise Flow] Waiting for block confirmation...");
          const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
          console.log("[Raise Flow] Approve Tx confirmed! Receipt:", receipt);
          await refetchAllowance();
        } catch (approveErr) {
          console.error("[Raise Flow] ❌ Approve Tx Failed!", approveErr);
          throw approveErr;
        }
      } else {
        console.log("[Raise Flow] Allowance is sufficient. Skipping approve.");
      }

      // 2. Generate first ephemeral capability
      const cap = newCapability();

      // 3. Call raise on AHandCore
      const expiryTimestamp = BigInt(Math.floor(Date.now() / 1000) + expiryDays * 24 * 60 * 60);
      const minSolverClaimBps = solverKeep * 100;
      const charityFeeBps = charityFee * 100;
      const metadataHash = "0x0000000000000000000000000000000000000000000000000000000000000000"; // Blank metadata for now

      console.log("Raising hand on core...", {
        token: DeployedAddresses.mockUSD,
        amount: parsedReward,
        expiry: uint40(expiryTimestamp),
        charityFee: uint16(charityFeeBps),
        maintFee: uint16(0),
        minSolver: uint16(minSolverClaimBps),
        charity: DeployedAddresses.charity,
        cap: cap.address,
        metadataHash
      });
      
      const raiseTx = await writeContractAsync({
        address: DeployedAddresses.AHandCore,
        abi: AHandCoreAbi,
        functionName: "raise",
        args: [
          DeployedAddresses.mockUSD,
          parsedReward,
          uint40(expiryTimestamp),
          uint16(charityFeeBps),
          uint16(0), // maintFeeBps
          uint16(minSolverClaimBps),
          DeployedAddresses.charity,
          cap.address,
          metadataHash,
        ],
      });

      console.log("Tx submitted! Hash:", raiseTx);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: raiseTx });
      console.log("Tx confirmed! Receipt:", receipt);
      
      // Read new handId from handsCount
      const count = await publicClient.readContract({
        address: DeployedAddresses.AHandCore,
        abi: AHandCoreAbi,
        functionName: "handsCount",
      });
      const newHandId = count as bigint;

      // 4. Encode payload
      const payload = encodePayload({
        handId: newHandId,
        chainId: activeChain.id,
        core: DeployedAddresses.AHandCore,
        shakes: [],
        latestPrivateKey: cap.privateKey,
        metadata: { title: description },
      });

      const url = `${window.location.origin}/h/${newHandId}#${payload}`;
      setShareUrl(url);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An error occurred during transaction execution.");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shareUrl);
    alert("Share link copied to clipboard!");
  };

  // Safe cast helpers
  function uint40(n: bigint) {
    return Number(n);
  }
  function uint16(n: number) {
    return n;
  }

  if (shareUrl) {
    return (
      <div className="py-8 px-4 text-center space-y-6 animate-fade-in">
        <h1 className="text-3xl font-extrabold">🙌 Hand Raised!</h1>
        <p className="text-ink/60 text-sm leading-relaxed">
          Your hand has been successfully raised. Share the link below with your network to start the positive-sum chain.
        </p>

        <div className="bg-ink/5 p-4 rounded-lg border border-ink/10 text-left font-mono text-xs break-all">
          {shareUrl}
        </div>

        <div className="flex flex-col space-y-3 w-full">
          <button
            onClick={copyToClipboard}
            className="w-full bg-ink text-paper py-3 rounded-lg font-bold hover:bg-ink/90 transition"
          >
            Copy link
          </button>
          <button
            onClick={() => navigate({ to: "/" })}
            className="w-full border border-ink/20 text-ink py-2 rounded-lg font-medium hover:bg-ink/5 transition text-sm"
          >
            Back to home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-6 px-4 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Raise a hand 🙌</h1>
        <p className="text-ink/60 text-sm leading-relaxed">
          State your need and pledge a reward.
        </p>
      </div>

      <form onSubmit={handleRaise} className="space-y-4">
        <div className="flex flex-col space-y-1">
          <label className="text-xs font-bold uppercase tracking-wider text-ink/60">
            What do you need?
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Looking for a sublet in Yerevan, June..."
            className="w-full border border-ink/20 rounded-lg p-3 text-sm focus:border-ink focus:outline-none bg-transparent resize-none h-24"
          />
        </div>

        <div className="flex flex-col space-y-1">
          <label className="text-xs font-bold uppercase tracking-wider text-ink/60">
            Reward (USDC)
          </label>
          <input
            type="number"
            value={reward}
            onChange={(e) => setReward(e.target.value)}
            className="w-full border border-ink/20 rounded-lg p-3 text-sm focus:border-ink focus:outline-none bg-transparent"
          />
        </div>

        <div className="border-t border-ink/10 pt-4">
          <button
            type="button"
            onClick={() => setFineTune(!fineTune)}
            className="text-xs font-bold text-ink/60 hover:text-ink flex items-center focus:outline-none"
          >
            {fineTune ? "▾ Hide fine-tuning" : "▸ Fine-tune configuration"}
          </button>

          {fineTune && (
            <div className="mt-4 space-y-3 bg-ink/5 p-4 rounded-lg border border-ink/10 text-xs animate-slide-down">
              <div className="flex justify-between items-center">
                <span>Solver keeps at least</span>
                <input
                  type="number"
                  value={solverKeep}
                  onChange={(e) => setSolverKeep(Number(e.target.value))}
                  className="w-16 border border-ink/20 rounded p-1 text-center bg-transparent"
                />
                <span>%</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Charity donation fee</span>
                <input
                  type="number"
                  value={charityFee}
                  onChange={(e) => setCharityFee(Number(e.target.value))}
                  className="w-16 border border-ink/20 rounded p-1 text-center bg-transparent"
                />
                <span>%</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Expiry duration</span>
                <input
                  type="number"
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(Number(e.target.value))}
                  className="w-16 border border-ink/20 rounded p-1 text-center bg-transparent"
                />
                <span>days</span>
              </div>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 p-3 rounded-lg">
            {errorMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-ink text-paper py-3 rounded-lg font-bold hover:bg-ink/90 transition disabled:opacity-50"
        >
          {loading ? "Confirming..." : "🙌 Raise it"}
        </button>
      </form>
    </div>
  );
}
