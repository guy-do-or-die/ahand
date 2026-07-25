import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { parseUnits, decodeEventLog } from "viem";
import { AHandCoreAbi, MockERC20Abi, DeployedAddresses } from "@ahand/abi";
import { encodePayload, newCapability } from "@ahand/sdk";
import { activeChain } from "../config/web3";
import {
  buildMetadata,
  assembleLink,
  b64urlDecode,
  Envelope,
  CHARS_PER_HOP,
} from "../lib/metadata";
import { t } from "../i18n";
import { humanizeChainError } from "../lib/errors";

export type Visibility = "public" | "preview" | "dark";

export interface RaiseDraftPreview {
  /** Codec-derived title (envelope.preview.title) — exactly what the scraper gets. */
  title: string;
  /** Codec-derived teaser (envelope.preview.teaser) */
  teaser?: string;
  /** Length of the actually assembled root link for the current draft. */
  linkLength: number;
  /** floor((4096 − len(rootLink)) / CHARS_PER_HOP) */
  hops: number;
}

/**
 * Raise flow — wraps the frozen protocol sequence unchanged:
 * buildMetadata → tx raise(metadataHash) → waitForTransactionReceipt →
 * find 'Raised' event for handId → assembleLink. RPC is the only network I/O.
 *
 * Adds a debounced draft pass through the same codec (placeholder handId,
 * throwaway capability) so the OG preview + link-survival counter reflect
 * the real assembled link, not an estimate.
 */
export function useRaiseFlow() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("preview");
  const [reward, setReward] = useState("150");
  const [solverKeep, setSolverKeep] = useState(70); // % — sent as Bps ×100
  const [charityFee, setCharityFee] = useState(1); // % — sent as Bps ×100
  const [expiryDays, setExpiryDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [draft, setDraft] = useState<RaiseDraftPreview | null>(null);
  /** True when the text is past what one link can carry (codec byte cap). */
  const [draftOverflow, setDraftOverflow] = useState(false);

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: DeployedAddresses.mockUSD,
    abi: MockERC20Abi,
    functionName: "allowance",
    args: address && DeployedAddresses.AHandCore ? [address, DeployedAddresses.AHandCore] : undefined,
  });

  // One throwaway capability for draft links; never used on-chain.
  const draftCap = useRef<ReturnType<typeof newCapability> | null>(null);

  useEffect(() => {
    if (!description.trim()) {
      setDraft(null);
      setDraftOverflow(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        if (!draftCap.current) draftCap.current = newCapability();
        const cap = draftCap.current;
        const metadata = await buildMetadata({ text: description, visibility });
        const envelope = Envelope.parse(
          JSON.parse(new TextDecoder().decode(b64urlDecode(metadata.envelopeB64))),
        );
        const url = assembleLink(
          window.location.origin,
          0n,
          { envelopeB64: metadata.envelopeB64, bodyB64: metadata.bodyB64 },
          (meta) =>
            encodePayload({
              handId: 0n,
              chainId: activeChain.id,
              core: DeployedAddresses.AHandCore,
              shakes: [],
              latestPrivateKey: cap.privateKey,
              metadata: meta,
            }),
          visibility,
        );
        if (!cancelled) {
          setDraft({
            title: envelope.preview.title,
            teaser: envelope.preview.teaser,
            linkLength: url.length,
            hops: Math.max(0, Math.floor((4096 - url.length) / CHARS_PER_HOP)),
          });
          setDraftOverflow(false);
        }
      } catch (err: any) {
        // Byte-cap overflow: keep the last good preview and say so — the
        // card must never quietly revert to the generic title.
        if (!cancelled) {
          if (String(err?.message ?? "").includes("1000 bytes")) setDraftOverflow(true);
          else setDraft(null);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [description, visibility]);

  const charityAmount = useMemo(() => {
    const amount = Number(reward);
    return Number.isFinite(amount) ? (amount * charityFee) / 100 : 0;
  }, [reward, charityFee]);

  const refundAmount = useMemo(() => {
    const amount = Number(reward);
    return Number.isFinite(amount) ? amount - charityAmount : 0;
  }, [reward, charityAmount]);

  const solverKeepAmount = useMemo(() => {
    return (refundAmount * solverKeep) / 100;
  }, [refundAmount, solverKeep]);

  const pathShareAmount = useMemo(() => {
    return refundAmount - solverKeepAmount;
  }, [refundAmount, solverKeepAmount]);

  const handleRaise = async () => {
    if (!isConnected || !address || !publicClient) {
      setErrorMsg(t("Connect your pocket first."));
      return;
    }
    if (!description.trim()) {
      setErrorMsg(t("Say what you need first."));
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const parsedReward = parseUnits(reward, 6);

      // 1. Build Metadata
      const metadata = await buildMetadata({
        text: description,
        visibility,
      });

      // 2. Allowance
      if (!allowance || (allowance as bigint) < parsedReward) {
        const txHash = await writeContractAsync({
          address: DeployedAddresses.mockUSD,
          abi: MockERC20Abi,
          functionName: "approve",
          args: [DeployedAddresses.AHandCore, parsedReward],
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash, pollingInterval: 100 });
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

      const receipt = await publicClient.waitForTransactionReceipt({ hash: raiseTx, pollingInterval: 100 });

      const raiseEvent = receipt.logs
        .map((log) => {
          try {
            return decodeEventLog({
              abi: AHandCoreAbi,
              data: log.data,
              topics: log.topics,
            });
          } catch {
            return null;
          }
        })
        .find((e) => e && e.eventName === "Raised");

      if (!raiseEvent) throw new Error(t("The raise didn't go through — try again."));
      const newHandId = (raiseEvent.args as any).handId as bigint;

      // 4. Encode payload and assemble final link
      const url = assembleLink(
        window.location.origin,
        newHandId,
        { envelopeB64: metadata.envelopeB64, bodyB64: metadata.bodyB64 },
        (meta) =>
          encodePayload({
            handId: newHandId,
            chainId: activeChain.id,
            core: DeployedAddresses.AHandCore,
            shakes: [],
            latestPrivateKey: cap.privateKey,
            metadata: meta,
          }),
        visibility,
      );

      setShareUrl(url);
    } catch (err: any) {
      console.error(err);
      const human = humanizeChainError(err);
      setErrorMsg(human.detail ? `${human.message} · ${human.detail}` : human.message);
    } finally {
      setLoading(false);
    }
  };

  return {
    // form state
    description,
    setDescription,
    visibility,
    setVisibility,
    reward,
    setReward,
    solverKeep,
    setSolverKeep,
    charityFee,
    setCharityFee,
    expiryDays,
    setExpiryDays,
    // derived
    draft,
    draftOverflow,
    solverKeepAmount,
    charityAmount,
    refundAmount,
    pathShareAmount,
    // flow
    loading,
    errorMsg,
    shareUrl,
    handleRaise,
    isConnected,
  };
}
