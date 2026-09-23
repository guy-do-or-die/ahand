import { useCallback, useEffect, useState } from "react";
import { useConnection, useWalletClient } from "wagmi";
import {
  buildTerminalProof,
  giveHash,
  routeHashOf,
  signGive,
  signGiverAcceptance,
  solutionCommitment,
  solutionSaltRef,
  SOLUTION_SALT_BYTES,
  BPS_DENOMINATOR,
  type Give,
  type TypedSigner,
} from "@ahand/sdk";
import type { HandRoute } from "./useHandView";
import { t } from "../i18n";

/**
 * Help/Give flow — the giver IS the connected wallet. Two signatures seal
 * the give: the terminal bearer capability signs the Give (invisible, key
 * work), and the wallet signs a GiverAcceptance over the exact giveHash —
 * consent to attribution and the residual payout. Both land in a compact
 * terminal proof (`/h/:id/thank#…`) that holds no capability secret at all.
 *
 * The words are sealed under a fresh salt (the Give's solutionHash goes
 * public at Thank). The salt opens the seal, so it rides only in `noteUrl`,
 * the link delivered beside the words; `solveUrl`, which is copied or shared
 * on its own, leaves it out.
 *
 * Give binds the full route (routeHash), the terminal claim, and a deadline
 * equal to the Hand expiry. Building the proof is an explicit prepare() step
 * (one wallet prompt), never a keystroke side effect.
 */
export function useSolveFlow(args: {
  active: boolean;
  id: string;
  route: HandRoute | null;
  tampered: boolean;
}) {
  const { active, id, route, tampered } = args;
  const { address } = useConnection();
  const { data: walletClient } = useWalletClient();

  const [solutionText, setSolutionText] = useState("");
  const [solveUrl, setSolveUrl] = useState("");
  const [noteUrl, setNoteUrl] = useState("");
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState("");

  // Every edit voids the previous proof — the words are sealed by hash.
  useEffect(() => {
    setSolveUrl("");
    setNoteUrl("");
    setError("");
  }, [solutionText, active, route, tampered]);

  const canPrepare =
    active &&
    !tampered &&
    !!route &&
    route.payload.capability.mode === "bearer" &&
    !!solutionText.trim() &&
    !!address &&
    !!walletClient;

  /** Sign the Give + GiverAcceptance and mint the terminal-proof link. */
  const prepare = useCallback(async (): Promise<string | null> => {
    if (!route || !solutionText.trim() || tampered) return null;
    setError("");

    if (route.payload.capability.mode !== "bearer") {
      setError(t("This link is addressed to a specific pocket — it can't give from here."));
      return null;
    }
    if (!address || !walletClient) return null;

    setSigning(true);
    try {
      const { handRef, expiry } = route.ctx;
      const shakes = route.payload.shakes;
      const finalClaimBps =
        shakes.length === 0
          ? BPS_DENOMINATOR
          : shakes[shakes.length - 1]!.shake.childClaimBps;
      const salt = crypto.getRandomValues(new Uint8Array(SOLUTION_SALT_BYTES));

      const give: Give = {
        handId: handRef.handId,
        routeHash: routeHashOf(handRef, shakes.map((s) => s.shake)),
        giver: address as `0x${string}`,
        solutionHash: solutionCommitment(solutionText, salt),
        finalClaimBps,
        deadline: expiry, // never chosen — always the Hand expiry
      };

      // Bearer key work — invisible to the user.
      const giveSig = await signGive(
        give,
        route.payload.capability.secret,
        handRef.chainId,
        handRef.core as `0x${string}`,
      );
      // Wallet consent — the one visible signature.
      const giverAcceptanceSig = await signGiverAcceptance(
        giveHash(give),
        walletClient as unknown as TypedSigner,
        handRef.chainId,
        handRef.core as `0x${string}`,
      );

      const proof = {
        handRef,
        expiry,
        rootCapability: route.ctx.rootCapability,
        shakes,
        give: { give, signature: giveSig },
        giverAcceptanceSig,
      };

      const base = `${window.location.origin}/h/${id}/thank#`;
      const url = base + buildTerminalProof(proof);
      setSolveUrl(url);
      setNoteUrl(base + buildTerminalProof({ ...proof, evidence: [solutionSaltRef(salt)] }));
      return url;
    } catch (err: any) {
      setError(t("Couldn't build the proof: {reason}", { reason: err.shortMessage || err.message }));
      return null;
    } finally {
      setSigning(false);
    }
  }, [route, solutionText, tampered, address, walletClient, id]);

  return {
    solutionText,
    setSolutionText,
    solveUrl,
    noteUrl,
    canPrepare,
    prepare,
    signing,
    error,
  };
}
