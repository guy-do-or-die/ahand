import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAccount, useReadContract } from "wagmi";
import { formatUnits, keccak256, toBytes, createPublicClient, http, isAddress } from "viem";
import { AHandCoreAbi, DeployedAddresses } from "@ahand/abi";
import { decodePayload, encodePayload, signShake, signGive, newCapability, type Shake, type SignedShake } from "@ahand/sdk";
import { activeChain } from "../config/web3";
import { Envelope, b64urlDecode, sha256hex, parseLink, verifyMetadata, assembleLink } from "../lib/metadata";

const publicClientLoader = createPublicClient({ chain: activeChain, transport: http() });

export const Route = createFileRoute("/h/$id")({
  validateSearch: (search: Record<string, unknown>): { e?: string } => {
    return { e: typeof search.e === "string" ? search.e : undefined };
  },
  loaderDeps: ({ search: { e } }) => ({ e }),
  loader: async ({ params, deps: { e } }) => {
    const id = BigInt(params.id);
    let handData;
    try {
      handData = await publicClientLoader.readContract({
        address: DeployedAddresses.AHandCore,
        abi: AHandCoreAbi,
        functionName: "hands",
        args: [id],
      });
    } catch {
      return { id: params.id, generic: true, title: `aHand #${params.id}`, desc: "" };
    }

    const [
      , , remainingReward, expiry, , , minSolverClaimBps,
      status, , , metadataHash
    ] = handData as any[];

    const amount = formatUnits(remainingReward, 6);
    const date = new Date(Number(expiry) * 1000);
    const dateStr = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    
    // Generic meta defaults
    let title = `✋ aHand #${params.id} — ${amount} USDC`;
    let desc = `solver keeps ≥${(Number(minSolverClaimBps)/100).toFixed(0)}% · escrow pays only on success · until ${dateStr}`;
    
    if (status === 2) desc = "Status: Settled 🙏";
    if (status === 3) desc = "Status: Reclaimed 👎";

    // Stateless SSR Verification!
    if (e && metadataHash !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
      try {
        const envelopeBytes = b64urlDecode(e);
        const calcHash = await sha256hex(envelopeBytes);
        if (calcHash === metadataHash) {
          const envStr = new TextDecoder().decode(envelopeBytes);
          const env = Envelope.parse(JSON.parse(envStr));
          if (env.visibility !== "dark") {
            title = `✋ ${env.preview.title}`;
          }
        }
      } catch (err) {
        console.error("[SSR] Envelope validation failed, falling back to generic:", err);
      }
    }

    return { id: params.id, title, desc, e };
  },
  meta: ({ loaderData }) => {
    if (!loaderData) return [];
    
    const ogImageUrl = loaderData.e 
       ? `/api/og/${loaderData.id}.png?e=${loaderData.e}` 
       : `/api/og/${loaderData.id}.png`;

    return [
      { title: loaderData.title },
      { property: "og:title", content: loaderData.title },
      { property: "og:description", content: loaderData.desc },
      { property: "og:image", content: ogImageUrl },
    ];
  },
  component: HandComponent,
});

function HandComponent() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const loaderData = Route.useLoaderData();
  const { address } = useAccount();

  const ogImageUrl = loaderData.e 
    ? `/api/og/${loaderData.id}.png?e=${loaderData.e}` 
    : `/api/og/${loaderData.id}.png`;

  const [payload, setPayload] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [tampered, setTampered] = useState(false);
  const [fullMetadata, setFullMetadata] = useState<{ title: string, description: string } | null>(null);
  
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

  const [childCap, setChildCap] = useState<{ privateKey: `0x${string}`; address: `0x${string}` } | null>(null);

  useEffect(() => {
    if (showPassOn && !childCap) {
      setChildCap(newCapability());
    }
  }, [showPassOn, childCap]);

  useEffect(() => {
    if (!showPassOn || !payload || !childCap || tampered) {
      setNewShareUrl("");
      return;
    }

    async function generate() {
      setErrorMsg("");
      setNewShareUrl("");

      if (payoutOption === "keep" && !payoutAddr) {
        setErrorMsg("Please provide a payout address");
        return;
      }
      if (payoutOption === "keep" && !/^0x[a-fA-F0-9]{40}$/.test(payoutAddr)) {
        setErrorMsg("Please provide a valid Ethereum address (0x...)");
        return;
      }

      try {
        const latestPriv = payload.latestPrivateKey;
        const chainId = payload.chainId;
        const core = payload.core;

        const currentParentClaim = payload.shakes.length === 0 
          ? 10000 
          : payload.shakes[payload.shakes.length - 1].shake.childClaimBps;

        const chosenMargin = payoutOption === "gift" ? 0 : Number(marginBps) * 100;
        const childClaim = currentParentClaim - chosenMargin;

        if (childClaim < 0) {
          setErrorMsg("Margin exceeds available claim amount.");
          return;
        }

        const shake: Shake = {
          handId: BigInt(id),
          childCapability: childCap.address,
          payout: (payoutOption === "gift" || !payoutAddr) ? "0x0000000000000000000000000000000000000000" : (payoutAddr as `0x${string}`),
          parentClaimBps: currentParentClaim,
          childClaimBps: childClaim,
          deadline: BigInt((handRaw as any[])[3]),
        };

        const signature = await signShake(shake, latestPriv, chainId, core);
        const newSignedShake: SignedShake = { shake, signature };

        // Visibility doesn't change on pass-on, but we need it for assembleLink
        const visibility = (search as any).e ? (payload.metadata.envelopeB64 ? "dark" : "public") : "public"; 

        const url = assembleLink(
          window.location.origin, 
          id, 
          { 
            envelopeB64: (search as any).e || payload.metadata.envelopeB64, 
            bodyB64: payload.metadata.bodyB64 
          },
          (meta) => encodePayload({
            handId: BigInt(id),
            chainId,
            core,
            shakes: [...payload.shakes, newSignedShake],
            latestPrivateKey: childCap.privateKey,
            metadata: meta,
          }),
          visibility as any
        );
        
        setNewShareUrl(url);
      } catch (err: any) {
        setErrorMsg(`Error generating link: ${err.shortMessage || err.message}`);
      }
    }
    
    generate();
  }, [showPassOn, payload, tampered, payoutOption, payoutAddr, marginBps, childCap, id, handRaw, (search as any).e]);

  useEffect(() => {
    if (address && !payoutAddr) setPayoutAddr(address);
    if (address && !solverAddr) setSolverAddr(address);
  }, [address]);

  // Client-side payload and hash validation
  useEffect(() => {
    async function load() {
      if (!handRaw) return; // Wait for on-chain anchor
      
      const onchainHash = (handRaw as any[])[10];

      try {
        const parsed = parseLink(window.location.href, decodePayload);
        setPayload(parsed.decodedPayload);
        
        const verify = await verifyMetadata(parsed.envelopeB64, parsed.bodyB64, onchainHash);
        
        if (!verify.ok) {
          setTampered(true);
          setErrorMsg(`Content doesn't match on-chain anchor: ${verify.reason}`);
          setFullMetadata(null); // Hide text
        } else {
          setTampered(false);
          setErrorMsg("");
          setFullMetadata({
            title: verify.envelope.preview.title,
            description: verify.body.description
          });
        }
      } catch (err: any) {
        console.error(err);
        if (err.message.includes("Missing payload in URL fragment")) {
          setTampered(false);
          setErrorMsg("");
          setFullMetadata(null);
        } else {
          setTampered(true);
          setErrorMsg("Failed to decode payload fragment: " + err.message);
        }
      }
    }
    load();
  }, [handRaw]);

  useEffect(() => {
    if (!showSolve || !payload || !solutionText.trim() || tampered) {
      setSolveUrl("");
      return;
    }

    async function generateSolve() {
      setErrorMsg("");
      setIsSolving(true);
      try {
        if (!isAddress(solverAddr)) {
          setErrorMsg("Please provide a valid Ethereum address for the solver.");
          setIsSolving(false);
          return;
        }

        const latestPriv = payload.latestPrivateKey;
        const chainId = payload.chainId;
        const core = payload.core;

        const currentParentClaim = payload.shakes.length === 0 
          ? 10000 
          : payload.shakes[payload.shakes.length - 1].shake.childClaimBps;

        const solutionHash = keccak256(toBytes(solutionText));

        const give = {
          handId: BigInt(id),
          solver: solverAddr as `0x${string}`,
          solutionHash,
          finalClaimBps: currentParentClaim,
        };

        const giveSig = await signGive(give, latestPriv, chainId, core);

        const thankPayloadObj = {
          give,
          giveSig,
          shakes: payload.shakes,
        };
        
        const serialized = btoa(JSON.stringify(thankPayloadObj, (key, value) =>
          typeof value === 'bigint' ? value.toString() : value
        ))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        const url = `${window.location.origin}/h/${id}/thank#${serialized}`;
        setSolveUrl(url);
      } catch (err: any) {
        setErrorMsg(`Error generating solution proof: ${err.shortMessage || err.message}`);
      } finally {
        setIsSolving(false);
      }
    }

    generateSolve();
  }, [showSolve, payload, solutionText, solverAddr, tampered, id]);

  if (isLoading) return <div className="py-12 text-center text-ink/60">Loading hand details...</div>;
  if (isError || !handRaw) return <div className="py-12 text-center text-red-600">Hand not found on chain.</div>;

  const [
    raiser,
    , // token
    remainingReward,
    expiry,
    , // charityFeeBps
    , // maintFeeBps
    minSolverClaimBps,
    status,
  ] = handRaw as any[];

  // Convert status to readable text
  const statusTexts = ["None", "Active 🙌", "Settled 🙏", "Reclaimed 👎"];
  const isHandActive = status === 1;





  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
  };

  return (
    <div className="py-6 px-4 space-y-6">
      {errorMsg && (
        <div className="text-sm font-bold text-red-600 bg-red-50 border-2 border-red-200 p-4 rounded-lg shadow-sm">
          🚨 {errorMsg}
        </div>
      )}

      {/* Main Hand Info Card */}
      <div className="space-y-4">
        <div className="flex justify-between items-center text-xs font-bold uppercase tracking-wider text-ink/40">
          <span>Hand #{id}</span>
          <span className="bg-ink/5 py-1 px-2.5 rounded-full">{statusTexts[status]}</span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight">
          {fullMetadata ? `🙌 ${fullMetadata.title}` : (window.location.hash.length > 2 ? "Loading secured text..." : "🔒 Secured Hand")}
        </h1>
        {fullMetadata?.description ? (
          <p className="text-ink/80 text-sm whitespace-pre-wrap">
            {fullMetadata.description}
          </p>
        ) : (
          (!window.location.hash || window.location.hash.length < 2) && (
            <p className="text-ink/60 text-sm italic">
              This hand is encrypted. You need the full link (with the # fragment) to decrypt and view its contents.
            </p>
          )
        )}

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

      {isHandActive && !tampered && (
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
            <div className="space-y-4 bg-ink/5 p-4 rounded-lg border border-ink/10 animate-slide-down">
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
                      onChange={(e) => setMarginBps(e.target.value as unknown as number)}
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

              <div className="mt-4 space-y-2">
                <div className="bg-paper p-3 rounded border border-ink/10 font-mono text-[10px] truncate text-ink/70">
                  {newShareUrl || "Waiting for valid parameters..."}
                </div>
                <button
                  type="button"
                  disabled={!newShareUrl}
                  onClick={() => newShareUrl && copyUrl(newShareUrl)}
                  className={`w-full py-2 rounded font-bold text-xs transition-colors ${
                    newShareUrl 
                      ? "bg-ink text-paper hover:bg-ink/80" 
                      : "bg-ink/10 text-ink/30 cursor-not-allowed"
                  }`}
                >
                  Copy new link
                </button>
              </div>

              <div className="flex space-x-2 pt-2 text-xs">
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
            </div>
          )}

          {/* Solve Panel */}
          {showSolve && (
            <div className="space-y-4 bg-ink/5 p-4 rounded-lg border border-ink/10 animate-slide-down">
              <h3 className="text-sm font-bold">Provide Help 🙌</h3>

              <div className="flex flex-col space-y-1">
                <label className="text-xs font-semibold text-ink/60">Solution Description</label>
                <textarea
                  value={solutionText}
                  onChange={(e) => setSolutionText(e.target.value)}
                  className="w-full border border-ink/20 rounded p-2 text-xs bg-transparent min-h-[60px]"
                  placeholder="Describe your solution or link to PR/results..."
                />
              </div>

              <div className="flex flex-col space-y-1 mt-2">
                <label className="text-xs font-semibold text-ink/60">Your Payout Address (Solver)</label>
                <input
                  type="text"
                  value={solverAddr}
                  onChange={(e) => setSolverAddr(e.target.value)}
                  className="w-full border border-ink/20 rounded p-2 text-xs bg-transparent"
                />
              </div>

              <p className="text-[10px] text-ink/50 leading-relaxed italic">
                Send this Solve proof URL back to the raiser. They will execute the Thank settlement.
              </p>

              <div className="mt-4 space-y-2">
                <div className="bg-paper p-3 rounded border border-ink/10 font-mono text-[10px] truncate text-ink/70">
                  {solveUrl || "Waiting for valid parameters..."}
                </div>
                <button
                  type="button"
                  disabled={!solveUrl}
                  onClick={() => solveUrl && copyUrl(solveUrl)}
                  className={`w-full py-2 rounded font-bold text-xs transition-colors ${
                    solveUrl 
                      ? "bg-ink text-paper hover:bg-ink/80" 
                      : "bg-ink/10 text-ink/30 cursor-not-allowed"
                  }`}
                >
                  Copy Solve link
                </button>
              </div>

              <div className="flex space-x-2 pt-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setShowSolve(false);
                    setSolveUrl("");
                    setSolutionText("");
                  }}
                  className="flex-1 border border-ink/20 py-2 rounded font-medium text-center"
                >
                  Cancel
                </button>
              </div>
            </div>
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
