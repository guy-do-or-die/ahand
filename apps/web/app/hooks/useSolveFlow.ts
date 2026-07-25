import { useEffect, useState } from "react";
import { isAddress, keccak256, toBytes } from "viem";
import { signGive } from "@ahand/sdk";
import { t } from "../i18n";

/**
 * Help/Solve flow — unchanged PoC logic: hash the solution text, sign a Give
 * with the payload's latest capability, and serialize the thank payload into
 * a /h/:id/thank#… proof link for the raiser. No network calls.
 */
export function useSolveFlow(args: {
  active: boolean;
  id: string;
  payload: any;
  tampered: boolean;
}) {
  const { active, id, payload, tampered } = args;

  const [solverAddr, setSolverAddr] = useState("");
  const [solutionText, setSolutionText] = useState("");
  const [solveUrl, setSolveUrl] = useState("");
  const [error, setError] = useState("");

  const solverValid = isAddress(solverAddr);

  useEffect(() => {
    if (!active || !payload || !solutionText.trim() || tampered) {
      setSolveUrl("");
      return;
    }

    async function generateSolve() {
      setError("");
      try {
        if (!isAddress(solverAddr)) {
          // Shout only at a committed wrong value, never mid-typing.
          if (solverAddr.length >= 42) setError(t("That address doesn't look right (0x…)."));
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
        setError(t("Couldn't build the proof: {reason}", { reason: err.shortMessage || err.message }));
      }
    }

    generateSolve();
  }, [active, payload, solutionText, solverAddr, tampered, id]);

  return {
    solverAddr,
    setSolverAddr,
    solverValid,
    solutionText,
    setSolutionText,
    solveUrl,
    error,
  };
}
