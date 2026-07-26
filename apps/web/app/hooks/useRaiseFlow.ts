import { useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useReadContract, usePublicClient } from "wagmi";
import { parseUnits, stringToHex, decodeEventLog, type Log } from "viem";
import { useSender, type SenderCall } from "./useSender";
import { AHandCoreAbi, AHandSignalsAbi, MockUSDAbi, DeployedAddresses } from "@ahand/abi";
import {
  buildLiveRoute,
  newCapability,
  PayloadCodecError,
  Visibility as VisibilityOrdinal,
} from "@ahand/sdk";
import { activeChain } from "../config/web3";
import { buildMetadata, assembleLink, CHARS_PER_HOP, MAX_LINK_CHARS } from "../lib/metadata";
import { pinDiscoveryViaApp } from "../lib/discovery";
import { bearerCapability, handRefFor, packLinkMetadata } from "../lib/link";
import { t } from "../i18n";
import { humanizeChainError } from "../lib/errors";

export type Visibility = "public" | "preview" | "dark";

const VISIBILITY_ORDINAL: Record<Visibility, number> = {
  public: VisibilityOrdinal.Public,
  preview: VisibilityOrdinal.Preview,
  dark: VisibilityOrdinal.Dark,
};

export interface RaiseDraftPreview {
  /** Codec-derived title (discovery doc) — exactly what the scraper gets. */
  title: string;
  /** Codec-derived teaser (discovery doc). */
  teaser?: string;
  /** The draft discovery doc — feeds /api/og for a pixel-exact card preview. */
  discoveryB64: string;
  /** Length of the actually assembled root link for the current draft. */
  linkLength: number;
  /** floor((MAX_LINK_CHARS − len(rootLink)) / CHARS_PER_HOP) */
  hops: number;
}

/**
 * Raise flow — protocol sequence:
 * buildMetadata → publish discovery doc (CID locator; pinned when a backend
 * key exists, honestly unpinned otherwise) → raise(RaiseParams, discoveryRef,
 * publicTags) → find 'Raised' event for handId → assembleLink.
 *
 * The sponsored path batches materializeRaised into the same userOp (the
 * Signals trigger pattern); the classic path skips it silently — anyone can
 * materialize later, permissionlessly.
 *
 * A debounced draft pass runs the same codec (placeholder handId, throwaway
 * capability) so the OG preview + link-survival counter reflect the real
 * assembled link, not an estimate.
 */
export function useRaiseFlow() {
  const { address, isConnected } = useConnection();
  const publicClient = usePublicClient();
  const { send, mode } = useSender();

  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("preview");
  const [reward, setReward] = useState("150");
  const [giverKeep, setGiverKeep] = useState(70); // % — sent as minGiverClaimBps ×100
  const [charityBps, setCharityBps] = useState(100); // [100, 3000] — CharityBpsPicker
  const [expiryDays, setExpiryDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [draft, setDraft] = useState<RaiseDraftPreview | null>(null);
  /** True when the text is past what one link can carry (codec byte cap). */
  const [draftOverflow, setDraftOverflow] = useState(false);

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: DeployedAddresses.mockUSD,
    abi: MockUSDAbi,
    functionName: "allowance",
    args: address && DeployedAddresses.AHandCore ? [address, DeployedAddresses.AHandCore] : undefined,
  });

  // One throwaway capability for draft links; never used on-chain.
  const draftCap = useRef<ReturnType<typeof newCapability> | null>(null);

  const assembleFor = (
    handId: bigint,
    metadata: Awaited<ReturnType<typeof buildMetadata>>,
    capability: { privateKey: `0x${string}`; address: `0x${string}` },
    expiry: bigint,
  ) =>
    assembleLink(
      window.location.origin,
      handId,
      {
        envelopeB64: metadata.envelopeB64,
        discoveryB64: metadata.discoveryB64,
        bodyB64: metadata.bodyB64,
      },
      (meta) =>
        buildLiveRoute({
          handRef: handRefFor(activeChain.id, DeployedAddresses.AHandCore, handId),
          expiry,
          rootCapability: capability.address,
          shakes: [],
          capability: bearerCapability(capability.privateKey),
          metadata: packLinkMetadata(meta),
        }),
      visibility,
    );

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
        const expiry = BigInt(Math.floor(Date.now() / 1000) + expiryDays * 24 * 60 * 60);
        const url = assembleFor(0n, metadata, cap, expiry);
        if (!cancelled) {
          setDraft({
            title: metadata.discovery.title,
            teaser: metadata.discovery.teaser,
            discoveryB64: metadata.discoveryB64,
            linkLength: url.length,
            hops: Math.max(0, Math.floor((MAX_LINK_CHARS - url.length) / CHARS_PER_HOP)),
          });
          setDraftOverflow(false);
        }
      } catch (err: any) {
        // Byte-cap overflow: keep the last good preview and say so — the
        // card must never quietly revert to the generic title.
        if (!cancelled) {
          if (isOverflow(err)) setDraftOverflow(true);
          else setDraft(null);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description, visibility, expiryDays]);

  const charityAmount = useMemo(() => {
    const amount = Number(reward);
    // Success-only charity: this share moves only when the hand settles.
    return Number.isFinite(amount) ? (amount * charityBps) / 10000 : 0;
  }, [reward, charityBps]);

  /** Reclaim refunds the FULL pot — charity is success-only. */
  const refundAmount = useMemo(() => {
    const amount = Number(reward);
    return Number.isFinite(amount) ? amount : 0;
  }, [reward]);

  const distributableAmount = useMemo(() => {
    return Math.max(0, refundAmount - charityAmount);
  }, [refundAmount, charityAmount]);

  const giverKeepAmount = useMemo(() => {
    return (distributableAmount * giverKeep) / 100;
  }, [distributableAmount, giverKeep]);

  const pathShareAmount = useMemo(() => {
    return distributableAmount - giverKeepAmount;
  }, [distributableAmount, giverKeepAmount]);

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

      // 1. Build metadata layers.
      const metadata = await buildMetadata({ text: description, visibility });

      // 2. Generate the root capability, prove the link fits BEFORE any money
      // moves (probe with a placeholder id — the payload is fixed-width in
      // handId, so the probe length IS the real length).
      const cap = newCapability();
      const expiryTimestamp = BigInt(Math.floor(Date.now() / 1000) + expiryDays * 24 * 60 * 60);
      try {
        assembleFor(0n, metadata, cap, expiryTimestamp);
      } catch (err: any) {
        if (isOverflow(err)) {
          setErrorMsg(t("Too long for one link — trim it a little."));
          return;
        }
        throw err;
      }

      // 3. Publish the discovery doc (dark hands publish nothing). The
      // server holds the pinning key, so this rides /api/pin; if the pipe
      // is down the locator is still valid — computed locally, honestly
      // unpinned; the link itself keeps carrying the content.
      const discoveryRef =
        visibility === "dark"
          ? "0x"
          : stringToHex((await pinDiscoveryViaApp(metadata.discoveryBytes)).uri);

      // 4. Assemble calls: approve (only if the allowance is short) + raise.
      // One sponsored userOp for embedded pockets (with materializeRaised
      // batched in); the same sequential txs as before for external wallets.
      const calls: SenderCall[] = [];
      if (!allowance || (allowance as bigint) < parsedReward) {
        calls.push({
          address: DeployedAddresses.mockUSD,
          abi: MockUSDAbi,
          functionName: "approve",
          args: [DeployedAddresses.AHandCore, parsedReward],
        });
      }
      calls.push({
        address: DeployedAddresses.AHandCore,
        abi: AHandCoreAbi,
        functionName: "raise",
        args: [
          {
            token: DeployedAddresses.mockUSD,
            amount: parsedReward,
            expiry: Number(expiryTimestamp),
            charityRecipient: DeployedAddresses.charity,
            charityBps,
            minGiverClaimBps: giverKeep * 100,
            rootCapability: cap.address,
            visibility: VISIBILITY_ORDINAL[visibility],
            metadataCommitment: metadata.metadataCommitment,
            discoveryCommitment: metadata.discoveryCommitment,
          },
          discoveryRef,
          [], // publicTags — none yet
        ],
      });
      if (mode === "sponsored") {
        // The Signals trigger pattern: mint the RAISED receipt in the same
        // userOp. handId is deterministic (handsCount + 1) at send time.
        const count = (await publicClient.readContract({
          address: DeployedAddresses.AHandCore,
          abi: AHandCoreAbi,
          functionName: "handsCount",
        })) as bigint;
        calls.push({
          address: DeployedAddresses.AHandSignals,
          abi: AHandSignalsAbi,
          functionName: "materializeRaised",
          args: [count + 1n],
        });
      }

      // 5. Send & wait — logs cover every call that was sent.
      const { logs }: { logs: Log[] } = await send(calls);
      await refetchAllowance();

      const raiseEvent = logs
        .map((log: Log): { eventName: string; args: unknown } | null => {
          try {
            return decodeEventLog({
              abi: AHandCoreAbi,
              data: log.data,
              topics: log.topics,
            }) as { eventName: string; args: unknown };
          } catch {
            return null;
          }
        })
        .find((e) => e && e.eventName === "Raised");

      if (!raiseEvent) throw new Error(t("The raise didn't go through — try again."));
      const newHandId = (raiseEvent.args as any).handId as bigint;

      // 6. Assemble the final link for the real hand id.
      const url = assembleFor(newHandId, metadata, cap, expiryTimestamp);

      // Presentation-only: carry the raiser's theme so the OG card matches
      // (?th=d before the fragment; scrapers have no theme of their own).
      const theme =
        document.documentElement.dataset.theme ??
        (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const themedUrl =
        theme === "dark" ? url.replace("#", url.includes("?") ? "&th=d#" : "?th=d#") : url;

      setShareUrl(themedUrl);
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
    giverKeep,
    setGiverKeep,
    charityBps,
    setCharityBps,
    expiryDays,
    setExpiryDays,
    // derived
    draft,
    draftOverflow,
    giverKeepAmount,
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

function isOverflow(err: any): boolean {
  if (err instanceof PayloadCodecError)
    return err.code === "link-too-long" || err.code === "inline-body-too-large";
  return String(err?.message ?? "").includes("1000 bytes");
}
