import { useEffect, useState } from "react";
import { useConnection, useReadContract, usePublicClient } from "wagmi";
import { decodeEventLog, type Log } from "viem";
import { useSender, type SenderCall } from "./useSender";
import { AHandCoreAbi, AHandSignalsAbi, DeployedAddresses } from "@ahand/abi";
import {
  decodeTerminalProof,
  verifyTerminalProof,
  type TerminalProofPayload,
  type VerifyFailure,
} from "@ahand/sdk";
import { mapHand, isExpired, type Hand, type HandAbiOutput } from "../lib/hand";
import { handRefFor, routeContextFor } from "../lib/link";
import { activeChain } from "../config/web3";
import { t } from "../i18n";
import { humanizeChainError } from "../lib/errors";

/** One credited line from the settlement — decoded PayoutAllocated. */
export interface ThankAllocation {
  kind: "charity" | "shakerMargin" | "giverResidual" | "raiserRefund";
  beneficiary: `0x${string}`;
  routePosition: number;
  amount: bigint;
}

const ALLOCATION_KINDS = ["charity", "shakerMargin", "giverResidual", "raiserRefund"] as const;

/** Human words for a failed proof — fail closed, but say why. */
function describeFailures(failures: VerifyFailure[]): string {
  const labels: Partial<Record<VerifyFailure["reason"], string>> = {
    "wrong-hand": t("it belongs to a different hand"),
    "capability-proof": t("a signature doesn't come from the link it claims"),
    "claim-mismatch": t("the shares along the route don't line up"),
    "claim-must-not-grow": t("a share grows along the route"),
    "claim-below-floor": t("a share dips under the giver's floor"),
    "anonymous-shaker-with-margin": t("someone kept a share without a name"),
    "unexpected-acceptance": t("a consent travels where none belongs"),
    "acceptance-missing": t("a named pass is missing its consent"),
    "shaker-acceptance-invalid": t("a named pass carries the wrong consent"),
    "deadline-mismatch": t("a deadline doesn't match the hand"),
    "route-hash-mismatch": t("the give doesn't bind this route"),
    "final-claim-mismatch": t("the give claims a different share"),
    "zero-giver": t("the giver is missing"),
    "giver-acceptance-invalid": t("the giver's consent doesn't check out"),
  };
  const parts = [...new Set(failures.map((f) => labels[f.reason] ?? f.reason))];
  return parts.join(" · ");
}

/**
 * Thank/settle flow — decode the terminal proof against the on-chain hand,
 * verify it with the same walk the contract will make (fail closed, with the
 * reason on screen), then thank(handId, shakes, sigs, acceptances, give,
 * giveSig, giverAcceptanceSig). Raiser-only, atomic, strictly pre-expiry —
 * at or past expiry the reclaim path takes over. There is no top-up.
 *
 * The sponsored path batches materializeThank into the same userOp (the
 * Signals trigger pattern); the classic path leaves receipts pending —
 * anyone can materialize later, permissionlessly.
 */
export function useThankFlow(id: string) {
  const { address, isConnected } = useConnection();
  const publicClient = usePublicClient();
  const { send, mode } = useSender();

  const [proof, setProof] = useState<TerminalProofPayload | null>(null);
  const [parseError, setParseError] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [success, setSuccess] = useState(false);
  /** Credited lines decoded from the settlement receipt's PayoutAllocated. */
  const [allocations, setAllocations] = useState<ThankAllocation[] | null>(null);

  const { data: handRaw } = useReadContract({
    address: DeployedAddresses.AHandCore,
    abi: AHandCoreAbi,
    functionName: "getHand",
    args: [BigInt(id)],
  });
  const hand: Hand | null = handRaw ? mapHand(handRaw as HandAbiOutput) : null;

  const expired = hand ? isExpired(hand) : false;

  // Decode + verify once the on-chain anchor is here. The fragment cannot be
  // decoded without the hand: deadlines and parent chains reconstruct from it.
  useEffect(() => {
    if (!handRaw) return;
    const current = mapHand(handRaw as HandAbiOutput);
    if (current.status === "none") {
      setParseError(t("Check the link — it doesn't point to a raised hand."));
      return;
    }
    const fragment = window.location.hash.replace("#", "");
    if (!fragment) {
      setParseError(t("This link is missing its proof — ask the helper to resend it."));
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const handRef = handRefFor(activeChain.id, DeployedAddresses.AHandCore, BigInt(id));
        const ctx = routeContextFor(current, handRef);
        const decoded = decodeTerminalProof(fragment, ctx);

        const creditedReward = current.creditedReward;
        const charity = (creditedReward * BigInt(current.charityBps)) / 10000n;
        const verdict = await verifyTerminalProof(decoded, {
          handRef,
          rootCapability: current.rootCapability,
          expiry: ctx.expiry,
          minGiverClaimBps: current.minGiverClaimBps,
          distributablePool: creditedReward - charity,
        });
        if (cancelled) return;
        // Expiry is a lifecycle fact, not tampering — the page shows the
        // reclaim path for it. Everything else fails the proof closed.
        const failures = verdict.ok ? [] : verdict.failures.filter((f) => f.reason !== "expired");
        if (failures.length > 0) {
          setVerifyError(describeFailures(failures));
        } else {
          setVerifyError("");
        }
        setProof(decoded);
      } catch (err: any) {
        if (cancelled) return;
        console.error(err);
        setParseError(t("This proof couldn't be read: {reason}", { reason: err.message }));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handRaw]);

  const handleThank = async () => {
    if (!hand || !proof) return;

    if (!isConnected || !address || !publicClient) {
      setErrorMsg(t("Connect your pocket first."));
      return;
    }
    if (address.toLowerCase() !== hand.raiser.toLowerCase()) {
      setErrorMsg(t("Only the raiser can say thanks here."));
      return;
    }
    if (verifyError) return; // fail closed — the swipe should be disabled anyway
    if (isExpired(hand)) {
      setErrorMsg(t("This hand has expired — take the pot back instead."));
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const shakes = proof.shakes.map((s) => s.shake);
      const shakeSigs = proof.shakes.map((s) => s.signature);
      // Positional consent: explicit hops carry theirs, the rest MUST be "0x".
      const shakerAcceptances = proof.shakes.map((s) => s.acceptanceSig ?? "0x");

      const calls: SenderCall[] = [
        {
          address: DeployedAddresses.AHandCore,
          abi: AHandCoreAbi,
          functionName: "thank",
          args: [
            BigInt(id),
            shakes,
            shakeSigs,
            shakerAcceptances,
            proof.give.give,
            proof.give.signature,
            proof.giverAcceptanceSig,
          ],
        },
      ];
      if (mode === "sponsored") {
        // The Signals trigger pattern: mint the settlement receipts in the
        // same userOp — occurrences in route order, anonymous hops included.
        calls.push({
          address: DeployedAddresses.AHandSignals,
          abi: AHandSignalsAbi,
          functionName: "materializeThank",
          args: [
            BigInt(id),
            proof.give.give.giver,
            shakes.map((s) => s.shaker),
            shakes.map((s) => s.parentClaimBps - s.childClaimBps),
          ],
        });
      }

      const { logs }: { logs: Log[] } = await send(calls);

      const credited: ThankAllocation[] = [];
      for (const log of logs) {
        try {
          const decoded = decodeEventLog({
            abi: AHandCoreAbi,
            data: log.data,
            topics: log.topics,
          }) as { eventName: string; args: any };
          if (decoded.eventName === "PayoutAllocated") {
            credited.push({
              kind: ALLOCATION_KINDS[Number(decoded.args.kind)] ?? "giverResidual",
              beneficiary: decoded.args.beneficiary,
              routePosition: Number(decoded.args.routePosition),
              amount: decoded.args.amount as bigint,
            });
          }
        } catch {
          /* foreign log */
        }
      }
      setAllocations(credited);
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
    proof,
    parseError,
    verifyError,
    hand,
    expired,
    loading,
    errorMsg,
    success,
    allocations,
    handleThank,
  };
}
