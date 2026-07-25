import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useAccount, useWriteContract, useReadContract, usePublicClient } from "wagmi";
import { parseUnits, decodeEventLog } from "viem";
import { AHandCoreAbi, MockERC20Abi, DeployedAddresses } from "@ahand/abi";
import { encodePayload, newCapability } from "@ahand/sdk";
import { activeChain } from "../config/web3";
import { buildMetadata, assembleLink, CHARS_PER_HOP } from "../lib/metadata";

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
  const [visibility, setVisibility] = useState<"public" | "preview" | "dark">("preview");
  const [reward, setReward] = useState("150");
  const [solverKeep, setSolverKeep] = useState(70); // in Bps = 7000
  const [charityFee, setCharityFee] = useState(1);  // in Bps = 100
  const [expiryDays, setExpiryDays] = useState(30);
  const [fineTune, setFineTune] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [shareUrl, setShareUrl] = useState("");

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: DeployedAddresses.mockUSD,
    abi: MockERC20Abi,
    functionName: "allowance",
    args: address && DeployedAddresses.AHandCore ? [address, DeployedAddresses.AHandCore] : undefined,
  });

  // Derived logic
  const splitTitle = useMemo(() => {
    let cut = description.indexOf("\n");
    if (cut === -1 || cut > 80) {
      if (description.length <= 80) cut = description.length;
      else {
        cut = description.lastIndexOf(" ", 80);
        if (cut === -1) cut = 80;
      }
    }
    return description.slice(0, cut).trim() || "Raise a hand";
  }, [description]);

  const hops = useMemo(() => {
    // base length + payload size ~400 + b64 length of text
    const estimatedUrlLen = window.location.origin.length + 20 + 400 + (description.length * 1.5);
    return Math.max(0, Math.floor((4096 - estimatedUrlLen) / CHARS_PER_HOP));
  }, [description]);

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
      const parsedReward = parseUnits(reward, 6);

      // 1. Build Metadata
      const metadata = await buildMetadata({
        text: description,
        visibility
      });

      // 2. Allowance
      if (!allowance || (allowance as bigint) < parsedReward) {
        const txHash = await writeContractAsync({
          address: DeployedAddresses.mockUSD,
          abi: MockERC20Abi,
          functionName: "approve",
          args: [DeployedAddresses.AHandCore, parsedReward],
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
        await refetchAllowance();
      }

      // 3. Generate capability & Raise
      const cap = newCapability();
      const expiryTimestamp = BigInt(Math.floor(Date.now() / 1000) + expiryDays * 24 * 60 * 60);
      
      const raiseTx = await writeContractAsync({
        address: DeployedAddresses.AHandCore,
        abi: AHandCoreAbi,
        functionName: "raise",
        args: [
          DeployedAddresses.mockUSD,
          parsedReward,
          Number(expiryTimestamp),
          charityFee * 100,
          0,
          solverKeep * 100,
          DeployedAddresses.charity,
          cap.address,
          metadata.metadataHash,
        ],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: raiseTx });
      
      const raiseEvent = receipt.logs.map(log => {
        try {
          return decodeEventLog({
            abi: AHandCoreAbi,
            data: log.data,
            topics: log.topics,
          });
        } catch { return null; }
      }).find(e => e?.eventName === 'Raised');

      if (!raiseEvent) throw new Error("Could not find Raised event in transaction");
      const newHandId = (raiseEvent.args as any).handId as bigint;

      // 4. Encode payload and assemble final link
      const url = assembleLink(
        window.location.origin, 
        newHandId, 
        { envelopeB64: metadata.envelopeB64, bodyB64: metadata.bodyB64 },
        (meta) => encodePayload({
          handId: newHandId,
          chainId: activeChain.id,
          core: DeployedAddresses.AHandCore,
          shakes: [],
          latestPrivateKey: cap.privateKey,
          metadata: meta,
        }),
        visibility
      );
      
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

  if (shareUrl) {
    return (
      <div className="py-8 px-4 text-center space-y-6 animate-fade-in">
        <h1 className="text-3xl font-extrabold">🙌 Hand Raised!</h1>
        <p className="text-ink/60 text-sm leading-relaxed">
          Your link has been successfully generated. Share it securely with your network.
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

  const dateStr = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toLocaleDateString();

  return (
    <div className="py-6 px-4 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Raise a hand 🙌</h1>
        <p className="text-ink/60 text-sm leading-relaxed">
          State your need and pledge a reward.
        </p>
      </div>

      <form onSubmit={handleRaise} className="space-y-6">
        <div className="flex flex-col space-y-1">
          <label className="text-xs font-bold uppercase tracking-wider text-ink/60">
            What do you need? (First line becomes the title)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Looking for a sublet in Yerevan, June...\nNeed a 1-bedroom apartment under $800/mo."
            className="w-full border border-ink/20 rounded-lg p-3 text-sm focus:border-ink focus:outline-none bg-transparent resize-none h-24"
          />
        </div>

        <div className="flex flex-col space-y-1">
          <label className="text-xs font-bold uppercase tracking-wider text-ink/60">
            Visibility Mode
          </label>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as any)}
            className="w-full border border-ink/20 rounded-lg p-3 text-sm focus:border-ink focus:outline-none bg-transparent"
          >
            <option value="preview">Preview (Rich card by link only)</option>
            <option value="public">Public (Listed & Rich preview)</option>
            <option value="dark">Dark (Generic card, nothing leaves the link)</option>
          </select>
        </div>

        <div className="flex flex-col space-y-1">
          <label className="text-xs font-bold uppercase tracking-wider text-ink/60">
            Reward (mockUSD)
          </label>
          <input
            type="number"
            value={reward}
            onChange={(e) => setReward(e.target.value)}
            className="w-full border border-ink/20 rounded-lg p-3 text-sm focus:border-ink focus:outline-none bg-transparent"
          />
        </div>

        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-ink/60 flex justify-between">
            <span>Link Survival</span>
            <span className={hops < 8 ? "text-red-500" : "text-green-600"}>
              ~{hops} hops in Telegram
            </span>
          </div>
          {hops < 8 && (
            <p className="text-xs text-red-500 bg-red-50 p-2 rounded border border-red-100">
              Warning: Link is getting very long. Consider shortening the description.
            </p>
          )}
        </div>

        {/* Live OG Preview */}
        <div className="bg-ink/5 border border-ink/10 rounded-lg overflow-hidden">
          <div className="bg-ink/10 px-3 py-1 text-[10px] font-bold uppercase text-ink/50 border-b border-ink/10">
            OpenGraph Preview ({visibility})
          </div>
          <div className="p-4 space-y-1">
            <h3 className="font-bold text-sm truncate">
              {visibility === "dark" 
                ? "✋ Someone raised a hand"
                : `✋ ${splitTitle}`}
            </h3>
            <p className="text-xs text-ink/60">
              solver keeps ≥{solverKeep}% · escrow pays only on success · until {dateStr}
            </p>
          </div>
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
