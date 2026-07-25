import { useCallback, useEffect, useState } from "react";
import { useConnection, useWalletClient } from "wagmi";
import {
  buildLiveRoute,
  newCapability,
  PayloadCodecError,
  shakeStructHash,
  signShake,
  signShakerAcceptance,
  ZERO_ADDRESS,
  ZERO_BYTES32,
  BPS_DENOMINATOR,
  type Shake,
  type SignedShake,
  type TypedSigner,
} from "@ahand/sdk";
import type { AttributionMode } from "../components/AttributionChoice";
import { assembleLink } from "../lib/metadata";
import { bearerCapability, packLinkMetadata } from "../lib/link";
import type { Hand } from "../lib/hand";
import type { HandRoute } from "./useHandView";
import { t } from "../i18n";

/**
 * Pass-on flow — signs a Shake with the route's bearer capability and
 * assembles the next link (parent key stripped by construction: the codec
 * carries only the fresh child key).
 *
 * Attribution is a mode, not an address field:
 *   anonymous  — shaker = 0, zero margin only; the link builds silently.
 *   attributed — required whenever margin > 0; the connected wallet is the
 *     shaker and must co-sign a ShakerAcceptance over the exact shakeHash,
 *     so building the link is an explicit prepare() step (one wallet prompt),
 *     never a side effect of a slider drag.
 *
 * Deadline is not chosen — every Shake deadline IS the Hand expiry.
 */
export function usePassOnFlow(args: {
  active: boolean;
  id: string;
  route: HandRoute | null;
  hand: Hand | null;
  tampered: boolean;
}) {
  const { active, id, route, hand, tampered } = args;
  const { address } = useConnection();
  const { data: walletClient } = useWalletClient();

  const [marginPct, setMarginPct] = useState(0); // 0 = pass it all on
  const [mode, setMode] = useState<AttributionMode>("anonymous");
  const [newShareUrl, setNewShareUrl] = useState("");
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState("");
  const [childCap, setChildCap] = useState<{ privateKey: `0x${string}`; address: `0x${string}` } | null>(null);

  useEffect(() => {
    if (active && !childCap) {
      setChildCap(newCapability());
    }
  }, [active, childCap]);

  const parentClaim =
    !route || route.payload.shakes.length === 0
      ? BPS_DENOMINATOR
      : route.payload.shakes[route.payload.shakes.length - 1]!.shake.childClaimBps;
  const minGiverClaimBps = hand?.minGiverClaimBps ?? 0;
  /** The slider ceiling: the child claim can never dip below the giver floor. */
  const maxMarginPct = Math.max(0, Math.floor((parentClaim - minGiverClaimBps) / 100));

  // The protocol gate both ways: margin > 0 cannot stay anonymous, and
  // attribution without a margin has nothing to attribute.
  const chooseMargin = useCallback((pct: number) => {
    setMarginPct(pct);
    setMode(pct > 0 ? "attributed" : "anonymous");
  }, []);
  const chooseMode = useCallback((next: AttributionMode) => {
    setMode(next);
    if (next === "anonymous") setMarginPct(0);
  }, []);

  const marginBps = marginPct * 100;
  const attributed = mode === "attributed" && marginBps > 0;
  /** Attribution needs a wallet on this device to sign the acceptance. */
  const needsWallet = attributed && !address;

  const build = useCallback(
    async (opts: { interactive: boolean }) => {
      if (!route || !hand || !childCap) return;
      setError("");

      if (route.payload.capability.mode !== "bearer") {
        setError(t("This link is addressed to a specific pocket — it can't be passed on from here."));
        return;
      }
      const childClaim = parentClaim - marginBps;
      if (childClaim < minGiverClaimBps) {
        setError(t("That share is more than what's left to pass."));
        return;
      }
      if (attributed && (!address || !walletClient)) {
        // Not an error mid-flow — the sheet gates the CTA on connection.
        return;
      }

      try {
        const { handRef, expiry } = route.ctx;
        const shake: Shake = {
          handId: handRef.handId,
          childCapability: childCap.address,
          shaker: attributed ? (address as `0x${string}`) : ZERO_ADDRESS,
          parentClaimBps: parentClaim,
          childClaimBps: childClaim,
          hopDataHash: ZERO_BYTES32,
          deadline: expiry, // never chosen — always the Hand expiry
        };

        const signature = await signShake(
          shake,
          route.payload.capability.secret,
          handRef.chainId,
          handRef.core as `0x${string}`,
        );

        let acceptanceSig: `0x${string}` | undefined;
        if (attributed) {
          if (!opts.interactive) return; // wallet prompts only on explicit ask
          setSigning(true);
          acceptanceSig = await signShakerAcceptance(
            shakeStructHash(shake),
            walletClient as unknown as TypedSigner,
            handRef.chainId,
            handRef.core as `0x${string}`,
          );
        }

        const newSignedShake: SignedShake = { shake, signature, acceptanceSig };

        const url = assembleLink(
          window.location.origin,
          id,
          route.metaParts,
          (meta) =>
            buildLiveRoute({
              handRef,
              expiry,
              rootCapability: route.ctx.rootCapability,
              shakes: [...route.payload.shakes, newSignedShake],
              capability: bearerCapability(childCap.privateKey),
              metadata: packLinkMetadata(meta),
            }),
          hand.visibility,
        );

        setNewShareUrl(url);
      } catch (err: any) {
        if (err instanceof PayloadCodecError && err.code === "link-too-long") {
          setError(t("The route is full — this link can't stretch any further."));
        } else {
          setError(t("Couldn't build the new link: {reason}", { reason: err.shortMessage || err.message }));
        }
      } finally {
        setSigning(false);
      }
    },
    [route, hand, childCap, parentClaim, marginBps, minGiverClaimBps, attributed, address, walletClient, id],
  );

  // Anonymous links build silently — no wallet is involved, only the
  // bearer capability key signs. Attributed links wait for prepare().
  useEffect(() => {
    setNewShareUrl("");
    if (!active || !route || !childCap || tampered) return;
    if (attributed) return;
    void build({ interactive: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, route, tampered, marginBps, attributed, childCap]);

  /** Explicit signing step for attributed passes — one wallet prompt. */
  const prepare = useCallback(async () => {
    await build({ interactive: true });
  }, [build]);

  return {
    marginPct,
    setMarginPct: chooseMargin,
    maxMarginPct,
    mode,
    setMode: chooseMode,
    attributed,
    needsWallet,
    signing,
    newShareUrl,
    prepare,
    error,
  };
}
