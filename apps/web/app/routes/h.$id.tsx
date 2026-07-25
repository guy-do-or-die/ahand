import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAccount, useReadContract } from "wagmi";
import { formatUnits, keccak256, toBytes } from "viem";
import { AHandCoreAbi, DeployedAddresses } from "@ahand/abi";
import { decodePayload, signShake, signGive, newCapability, type Shake, type SignedShake } from "@ahand/sdk";

export const Route = createFileRoute("/h/$id")({
  component: HandComponent,
});

function HandComponent() {
  const { id } = Route.useParams();
  const { address, isConnected } = useAccount();

  const [payload, setPayload] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState("");
  
  // UI states
  const [showPassOn, setShowPassOn] = useState(false);
  const [showSolve, setShowSolve] = useState(false);
  const [payoutAddr, setPayoutAddr] = useState("");
  const [marginBps, setMarginBps] = useState("0");
  const [payoutOption, setPayoutOption] = useState("gift"); // gift or keep
  const [newShareUrl, setNewShareUrl] = useState("");
  
  // Solve state
  const [solverAddr, setSolverAddr] = useState("");
  const [solutionText, setSolutionText] = useState("");
  const [solveUrl, setSolveUrl] = useState("");
  const [isSolving, setIsSolving] = useState(false);

  // Read hand state from chain
  const { data: handRaw, isError, isLoading } = useReadContract({
    address: DeployedAddresses.AHandCore,
    abi: AHandCoreAbi,
    functionName: "hands",
    args: [BigInt(id)],
  });

  useEffect(() => {
    if (address && !payoutAddr) setPayoutAddr(address);
    if (address && !solverAddr) setSolverAddr(address);
  }, [address]);

  // Parse location.hash on client side
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (!hash) {
      setErrorMsg("Missing payload fragment in URL hash.");
      return;
    }
    try {
      const decoded = decodePayload(hash);
      setPayload(decoded);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to decode payload fragment: " + err.message);
    }
  }, []);

  if (isLoading) return <div className="py-12 text-center text-ink/60">Loading hand details...</div>;
  if (isError || !handRaw) return <div className="py-12 text-center text-red-600">Hand not found on chain.</div>;

  const [
    raiser,
    token,
    remainingReward,
    expiry,
    charityFeeBps,
    maintFeeBps,
    minSolverClaimBps,
    status,
    charity,
    rootCapability,
    metadataHash
  ] = handRaw as any[];

  // Convert status to readable text
  const statusTexts = ["None", "Active 🙌", "Settled 🙏", "Reclaimed 👎"];
  const isHandActive = status === 1;

  const handlePassOn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payload) return;

    try {
      const latestPriv = payload.latestPrivateKey;
      const chainId = payload.chainId;
      const core = payload.core;

      // Calculate claims
      const currentParentClaim = payload.shakes.length === 0 
        ? 10000 
        : payload.shakes[payload.shakes.length - 1].shake.childClaimBps;

      const chosenMargin = payoutOption === "gift" ? 0 : Number(marginBps);
      const childClaim = currentParentClaim - chosenMargin;

      if (childClaim < 0) {
        alert("Margin exceeds available claim amount.");
        return;
      }

      // Generate child capability bearer
      const childCap = newCapability();

      const shake: Shake = {
        handId: BigInt(id),
        childCapability: childCap.address,
        payout: payoutAddr as `0x${string}`,
        parentClaimBps: currentParentClaim,
        childClaimBps: childClaim,
        deadline: BigInt(expiry),
      };

      console.log("Signing shake with parent key...");
      const signature = await signShake(shake, latestPriv, chainId, core);

      const newSignedShake: SignedShake = { shake, signature };

      const newPayload = encodePayload({
        handId: BigInt(id),
        chainId,
        core,
        shakes: [...payload.shakes, newSignedShake],
        latestPrivateKey: childCap.privateKey,
        metadata: payload.metadata,
      });

      const url = `${window.location.origin}/h/${id}#${newPayload}`;
      setNewShareUrl(url);
    } catch (err: any) {
      console.error(err);
      alert("Error generating pass-on link: " + err.message);
    }
  };

  const handleSolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payload || !solutionText.trim()) return;

    setIsSolving(true);
    try {
      const latestPriv = payload.latestPrivateKey;
      const chainId = payload.chainId;
      const core = payload.core;

      const solutionHash = keccak256(toBytes(solutionText));

      const give = {
        handId: BigInt(id),
        solver: solverAddr as `0x${string}`,
        solutionHash,
      };

      console.log("Signing give assignment...");
      const giveSig = await signGive(give, latestPriv, chainId, core);

      // Serialize thank payload (JSON base64url envelope)
      const thankPayloadObj = {
        give,
        giveSig,
        shakes: payload.shakes,
      };
      
      const serialized = btoa(JSON.stringify(thankPayloadObj))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const url = `${window.location.origin}/h/${id}/thank#${serialized}`;
      setSolveUrl(url);
    } catch (err: any) {
      console.error(err);
      alert("Error generating solution proof: " + err.message);
    } finally {
      setIsSolving(false);
    }
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    alert("Copied to clipboard!");
  };

  return (
    <div className="py-6 px-4 space-y-6">
      {errorMsg && (
        <div className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 p-3 rounded-lg">
          {errorMsg}
        </div>
      )}

      {/* Main Hand Info Card */}
      <div className="space-y-4">
        <div className="flex justify-between items-center text-xs font-bold uppercase tracking-wider text-ink/40">
          <span>Hand #{id}</span>
          <span className="bg-ink/5 py-1 px-2.5 rounded-full">{statusTexts[status]}</span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight">
          🙌 {payload?.metadata?.title || "No description provided"}
        </h1>

        <div className="space-y-2">
          <div className="w-full bg-ink/10 h-3.5 rounded-full overflow-hidden">
            <div className="bg-gold h-full w-[100%]" />
          </div>
          <div className="flex justify-between text-xs font-medium">
            <span>{formatUnits(remainingReward, 6)} USDC pledged</span>
            <span>solver keeps ≥ {solverKeepPercent(minSolverClaimBps)}%</span>
          </div>
        </div>

        <div className="text-xs text-ink/60 space-y-1">
          <p>Raised by: <span className="font-mono">{raiser.slice(0, 8)}...{raiser.slice(-8)}</span></p>
          <p>Hops traversed: <span className="font-bold">{payload?.shakes?.length || 0} 🤝</span></p>
        </div>
      </div>

      {isHandActive && (
        <div className="flex flex-col space-y-4 border-t border-ink/10 pt-6">
          {!showPassOn && !showSolve && (
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setShowPassOn(true)}
                className="bg-ink text-paper py-3 rounded-lg font-bold hover:bg-ink/90 transition text-center cursor-pointer"
              >
                🤝 Pass it on
              </button>
              <button
                onClick={() => setShowSolve(true)}
                className="border border-ink text-ink py-3 rounded-lg font-bold hover:bg-ink/5 transition text-center cursor-pointer"
              >
                🙌 I can help
              </button>
            </div>
          )}

          {/* Pass On Panel */}
          {showPassOn && (
            <form onSubmit={handlePassOn} className="space-y-4 bg-ink/5 p-4 rounded-lg border border-ink/10 animate-slide-down">
              <h3 className="text-sm font-bold">Pass it on 🤝</h3>

              <div className="flex flex-col space-y-2">
                <span className="text-xs font-semibold text-ink/60">Select margin option:</span>
                <div className="flex items-center space-x-4 text-xs">
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="payout"
                      checked={payoutOption === "gift"}
                      onChange={() => setPayoutOption("gift")}
                    />
                    <span>Gift (0% share)</span>
                  </label>
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="payout"
                      checked={payoutOption === "keep"}
                      onChange={() => setPayoutOption("keep")}
                    />
                    <span>Keep a share</span>
                  </label>
                </div>
              </div>

              {payoutOption === "keep" && (
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span>Keep share (in %)</span>
                    <input
                      type="number"
                      value={marginBps}
                      onChange={(e) => setMarginBps(e.target.value)}
                      className="w-16 border border-ink/20 rounded p-1 text-center bg-transparent"
                    />
                  </div>
                  <div className="flex flex-col space-y-1">
                    <label className="font-semibold text-ink/60">Payout Address</label>
                    <input
                      type="text"
                      value={payoutAddr}
                      onChange={(e) => setPayoutAddr(e.target.value)}
                      className="w-full border border-ink/20 rounded p-2 bg-transparent"
                    />
                  </div>
                </div>
              )}

              {newShareUrl && (
                <div className="mt-3 space-y-2">
                  <div className="bg-paper p-3 rounded border border-ink/10 font-mono text-[10px] break-all">
                    {newShareUrl}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyUrl(newShareUrl)}
                    className="w-full bg-ink text-paper py-2 rounded font-bold text-xs"
                  >
                    Copy new link
                  </button>
                </div>
              )}

              <div className="flex space-x-2 pt-2 text-xs">
                {!newShareUrl && (
                  <button
                    type="submit"
                    className="flex-1 bg-ink text-paper py-2 rounded font-bold"
                  >
                    Generate Link
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowPassOn(false);
                    setNewShareUrl("");
                  }}
                  className="flex-1 border border-ink/20 py-2 rounded font-medium text-center"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Solve Panel */}
          {showSolve && (
            <form onSubmit={handleSolve} className="space-y-4 bg-ink/5 p-4 rounded-lg border border-ink/10 animate-slide-down">
              <h3 className="text-sm font-bold">Provide Help 🙌</h3>

              <div className="flex flex-col space-y-1 text-xs">
                <label className="font-semibold text-ink/60">Solution Description</label>
                <textarea
                  value={solutionText}
                  onChange={(e) => setSolutionText(e.target.value)}
                  placeholder="I have a perfect apartment available in Center Yerevan..."
                  className="w-full border border-ink/20 rounded p-2 bg-transparent h-16 resize-none"
                />
              </div>

              <div className="flex flex-col space-y-1 text-xs">
                <label className="font-semibold text-ink/60">Your Payout Address (Solver)</label>
                <input
                  type="text"
                  value={solverAddr}
                  onChange={(e) => setSolverAddr(e.target.value)}
                  className="w-full border border-ink/20 rounded p-2 bg-transparent"
                />
              </div>

              {solveUrl && (
                <div className="mt-3 space-y-2">
                  <p className="text-[10px] text-ink/60 font-semibold leading-relaxed">
                    Send this Solve proof URL back to the raiser. They will execute the Thank settlement.
                  </p>
                  <div className="bg-paper p-3 rounded border border-ink/10 font-mono text-[10px] break-all">
                    {solveUrl}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyUrl(solveUrl)}
                    className="w-full bg-ink text-paper py-2 rounded font-bold text-xs"
                  >
                    Copy Solve link
                  </button>
                </div>
              )}

              <div className="flex space-x-2 pt-2 text-xs">
                {!solveUrl && (
                  <button
                    type="submit"
                    disabled={isSolving}
                    className="flex-1 bg-ink text-paper py-2 rounded font-bold"
                  >
                    {isSolving ? "Signing..." : "Generate Solve link"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowSolve(false);
                    setSolveUrl("");
                  }}
                  className="flex-1 border border-ink/20 py-2 rounded font-medium text-center"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// Helpers
function solverKeepPercent(minBps: number) {
  return (minBps / 100).toFixed(0);
}
