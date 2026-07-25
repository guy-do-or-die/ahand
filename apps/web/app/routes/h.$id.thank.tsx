import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAccount, useWriteContract, useReadContract, usePublicClient } from "wagmi";
import { parseUnits } from "viem";
import { AHandCoreAbi, MockERC20Abi, DeployedAddresses } from "@ahand/abi";

export const Route = createFileRoute("/h/$id/thank")({
  component: ThankComponent,
});

function ThankComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [thankData, setThankData] = useState<any>(null);
  const [topUp, setTopUp] = useState("0");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [success, setSuccess] = useState(false);

  // Read hand status from chain
  const { data: handRaw } = useReadContract({
    address: DeployedAddresses.AHandCore,
    abi: AHandCoreAbi,
    functionName: "hands",
    args: [BigInt(id)],
  });

  // Read allowance for top-up
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
      setErrorMsg("Missing thank payload fragment in URL hash.");
      return;
    }
    try {
      const jsonStr = atob(hash.replace(/-/g, "+").replace(/_/g, "/"));
      const parsed = JSON.parse(jsonStr);
      setThankData(parsed);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to parse thank payload: " + err.message);
    }
  }, []);

  if (!thankData) {
    return <div className="py-12 text-center text-ink/60">Parsing settlement proof...</div>;
  }

  const [raiser, token, remainingReward, expiry, charityFeeBps, maintFeeBps, minSolverClaimBps, status] = handRaw as any[] || [];

  const handleThank = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !address || !publicClient) {
      setErrorMsg("Please connect your wallet first.");
      return;
    }
    if (address.toLowerCase() !== raiser.toLowerCase()) {
      setErrorMsg("Only the hand raiser can execute the thank settlement.");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const parsedTopUp = parseUnits(topUp, 6); // mockUSD is 6 decimals

      // 1. Approve topUp if necessary
      if (parsedTopUp > 0n && (!allowance || (allowance as bigint) < parsedTopUp)) {
        console.log("Approving mockUSD top-up...");
        const approveTx = await writeContractAsync({
          address: DeployedAddresses.mockUSD,
          abi: MockERC20Abi,
          functionName: "approve",
          args: [DeployedAddresses.AHandCore, parsedTopUp],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
        await refetchAllowance();
      }

      // 2. Format shakes & sigs
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
      };

      const giveSig = thankData.giveSig as `0x${string}`;

      console.log("Settling hand thank...");
      const thankTx = await writeContractAsync({
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

      await publicClient.waitForTransactionReceipt({ hash: thankTx });
      setSuccess(true);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Failed to execute thank transaction.");
    } finally {
      setLoading(false);
    }
  };

  if (success || status === 2) {
    return (
      <div className="py-12 px-4 text-center space-y-6">
        <h1 className="text-4xl">🙏</h1>
        <h2 className="text-2xl font-bold">Thanked!</h2>
        <p className="text-ink/60 text-sm leading-relaxed max-w-xs mx-auto">
          The positive-sum chain has been successfully resolved and settled. Reward distributed to helpers.
        </p>
        <button
          onClick={() => navigate({ to: "/" })}
          className="w-full bg-ink text-paper py-3 rounded-lg font-bold hover:bg-ink/90 transition text-sm"
        >
          Back to home
        </button>
      </div>
    );
  }

  return (
    <div className="py-6 px-4 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Settle Hand 🙏</h1>
        <p className="text-ink/60 text-sm leading-relaxed">
          Verify helpers route and reward distribution before final thank execution.
        </p>
      </div>

      {errorMsg && (
        <div className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 p-3 rounded-lg">
          {errorMsg}
        </div>
      )}

      {/* Settlement Route Summary */}
      <div className="space-y-4 bg-ink/5 p-4 rounded-lg border border-ink/10 text-xs">
        <h3 className="font-bold">Solver Address</h3>
        <p className="font-mono break-all">{thankData.give.solver}</p>

        <h3 className="font-bold mt-3">Route Hop Shakes</h3>
        {thankData.shakes.length === 0 ? (
          <p className="text-ink/60 italic">Direct solver (0 hops)</p>
        ) : (
          <div className="space-y-2 font-mono">
            {thankData.shakes.map((s: any, idx: number) => (
              <div key={idx} className="border-l-2 border-ink/20 pl-2">
                <p>Hop #{idx + 1}</p>
                <p className="text-[10px] text-ink/60">Payout: {s.shake.payout}</p>
                <p className="text-[10px] text-ink/60">Margin Share: {((s.shake.parentClaimBps - s.shake.childClaimBps) / 100).toFixed(0)}%</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleThank} className="space-y-4">
        <div className="flex flex-col space-y-1">
          <label className="text-xs font-bold uppercase tracking-wider text-ink/60">
            Top-up Reward (Optional USDC)
          </label>
          <input
            type="number"
            value={topUp}
            onChange={(e) => setTopUp(e.target.value)}
            className="w-full border border-ink/20 rounded-lg p-3 text-sm focus:border-ink focus:outline-none bg-transparent"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-ink text-paper py-3 rounded-lg font-bold hover:bg-ink/90 transition disabled:opacity-50"
        >
          {loading ? "Settling..." : "🙏 Settle & Thank"}
        </button>
      </form>
    </div>
  );
}
