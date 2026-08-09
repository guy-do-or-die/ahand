import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import { AHandCoreAbi, DeployedAddresses } from "@ahand/abi";
import {
  buildLiveRoute,
  decodeLiveRoute,
  verifyLiveRoute,
  type LiveRoutePayload,
  type RouteContext,
} from "@ahand/sdk";
import { b64urlDecode, parseLink, reopenFromDiscovery, verifyMetadata } from "../lib/metadata";
import { fetchDiscoveryByCommitment } from "../lib/discovery";
import { mapHand, type Hand, type HandAbiOutput } from "../lib/hand";
import {
  bearerCapability,
  handRefFor,
  packLinkMetadata,
  routeContextFor,
  unpackLinkMetadata,
  type LinkMetadataParts,
} from "../lib/link";
import { activeChain } from "../config/web3";
import { t } from "../i18n";

export interface VerifiedMetadata {
  /** Discovery title; null when the link travelled without its ?e= doc. */
  title: string | null;
  description: string;
}

/** Everything a downstream flow needs to extend or terminate the route. */
export interface HandRoute {
  payload: LiveRoutePayload;
  ctx: RouteContext;
  metaParts: LinkMetadataParts;
}

/**
 * Hand view state — chain read (getHand → mapHand, named fields only) →
 * parseLink(fragment) → MANDATORY verification: metadata layers against the
 * on-chain commitments AND the route walk (signatures, claims, modes) via
 * the sdk verifier. Any failure ⇒ tampered=true, content withheld; the UI
 * must show the failure state and disable Pass-on / Help.
 * A link with no fragment is not tampering — it renders on-chain facts only.
 */
export function useHandView(id: string, options?: { disabled?: boolean }) {
  const disabled = !!options?.disabled;
  const {
    data: handRaw,
    isError,
    isLoading,
    refetch,
  } = useReadContract({
    address: DeployedAddresses.AHandCore,
    abi: AHandCoreAbi,
    functionName: "getHand",
    args: disabled ? undefined : [BigInt(id)],
  });

  const hand: Hand | null = handRaw ? mapHand(handRaw as HandAbiOutput) : null;

  const [route, setRoute] = useState<HandRoute | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [tampered, setTampered] = useState(false);
  const [fullMetadata, setFullMetadata] = useState<VerifiedMetadata | null>(null);
  const [hasFragment, setHasFragment] = useState<boolean | null>(null);

  useEffect(() => {
    if (disabled || !handRaw) return;
    const mapped = mapHand(handRaw as HandAbiOutput);
    if (mapped.status === "none") return;

    let cancelled = false;
    async function load(current: Hand) {
      const fragmentPresent = window.location.hash.length > 2;
      // null = still resolving (an open public hand may recover a payload
      // from its pinned doc) — the "missing key" card waits for a verdict.
      setHasFragment(fragmentPresent ? true : null);

      const ctx = routeContextFor(
        current,
        handRefFor(activeChain.id, DeployedAddresses.AHandCore, BigInt(id)),
      );

      // Open-hand recovery: a public hand's pinned doc may carry the root
      // bearer secret + route body; rebuild the same payload a share link
      // would carry, then verify it through the identical fail-closed path.
      // Board routes start with aHand's own attributed first hop when the
      // app-hop endpoint answers; a bare root branch is the quiet fallback.
      async function recoverOpenHref(): Promise<string | null> {
        if (current.visibility !== "public") return null;
        try {
          const docBytes = await fetchDiscoveryByCommitment(current.discoveryCommitment);
          if (!docBytes) return null;
          const reopened = await reopenFromDiscovery(docBytes);
          if (!reopened) return null;

          let shakes: Parameters<typeof buildLiveRoute>[0]["shakes"] = [];
          let capability = bearerCapability(reopened.secret);
          try {
            const res = await fetch("/api/app-hop", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ handId: id }),
            });
            if (res.ok) {
              const hop = await res.json();
              shakes = [
                {
                  shake: {
                    handId: BigInt(hop.shake.handId),
                    childCapability: hop.shake.childCapability,
                    shaker: hop.shake.shaker,
                    parentClaimBps: hop.shake.parentClaimBps,
                    childClaimBps: hop.shake.childClaimBps,
                    hopDataHash: hop.shake.hopDataHash,
                    deadline: BigInt(hop.shake.deadline),
                  },
                  signature: hop.signature,
                  acceptanceSig: hop.acceptanceSig,
                },
              ];
              capability = bearerCapability(hop.childSecret);
            }
          } catch {
            /* endpoint down — the bare root branch still works */
          }

          const payloadStr = buildLiveRoute({
            handRef: ctx.handRef,
            expiry: ctx.expiry,
            rootCapability: ctx.rootCapability,
            shakes,
            capability,
            metadata: packLinkMetadata(reopened.metaParts),
          });
          return `${window.location.origin}/h/${id}#${payloadStr}`;
        } catch {
          return null; // a malformed doc reads as "no key", never as tampering
        }
      }

      try {
        let href = window.location.href;
        let recoveredFragment: string | null = null;
        if (!fragmentPresent) {
          const recovered = await recoverOpenHref();
          if (cancelled) return;
          if (!recovered) {
            setHasFragment(false);
            setTampered(false);
            setErrorMsg("");
            setFullMetadata(null);
            setRoute(null);
            return;
          }
          href = recovered;
          recoveredFragment = recovered.split("#")[1] ?? null;
          setHasFragment(true);
        }
        const parsed = parseLink(href, (fragment: string) => {
          const payload = decodeLiveRoute(fragment, ctx);
          return { ...payload, metadata: unpackLinkMetadata(payload.metadata) };
        });
        const metaParts: LinkMetadataParts = {
          envelopeB64: parsed.envelopeB64,
          ...(parsed.discoveryB64 ? { discoveryB64: parsed.discoveryB64 } : {}),
          bodyB64: parsed.bodyB64,
        };
        const payload = parsed.decodedPayload as LiveRoutePayload & {
          metadata: LinkMetadataParts;
        };

        // Layer 1: metadata against the on-chain commitments.
        const verify = await verifyMetadata(metaParts, {
          metadataCommitment: current.metadataCommitment,
          discoveryCommitment: current.discoveryCommitment,
        });
        if (!verify.ok) {
          if (cancelled) return;
          setTampered(true);
          setErrorMsg(
            t("This content doesn't match what was raised: {reason}", { reason: verify.reason }),
          );
          setFullMetadata(null);
          setRoute(null);
          return;
        }

        // Layer 2: the route itself — the same walk thank() will make.
        const routeVerdict = await verifyLiveRoute(
          { ...payload, metadata: { envelope: b64urlDecode(metaParts.envelopeB64), body: new Uint8Array(0) } },
          {
            handRef: ctx.handRef,
            rootCapability: ctx.rootCapability,
            expiry: ctx.expiry,
            minGiverClaimBps: current.minGiverClaimBps,
            metadataCommitment: current.metadataCommitment,
          },
        );
        // Expiry alone is a lifecycle fact (the reclaim path), not tampering.
        const failures = routeVerdict.ok
          ? []
          : routeVerdict.failures.filter((f) => f.reason !== "expired");
        if (failures.length > 0) {
          if (cancelled) return;
          setTampered(true);
          setErrorMsg(
            t("This content doesn't match what was raised: {reason}", {
              reason: failures.map((f) => f.reason).join(", "),
            }),
          );
          setFullMetadata(null);
          setRoute(null);
          return;
        }

        if (cancelled) return;
        setTampered(false);
        setErrorMsg("");
        setFullMetadata({
          title: verify.discovery?.title ?? null,
          description: verify.body.description,
        });
        setRoute({ payload, ctx, metaParts });
        // Make the recovered route shareable AS a link: put the verified
        // payload in the address bar, exactly what a passed link would carry.
        if (recoveredFragment) {
          try {
            window.history.replaceState(null, "", `#${recoveredFragment}`);
          } catch {
            /* display-only nicety */
          }
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error(err);
        if (String(err?.message ?? "").includes("Missing payload in URL fragment")) {
          setTampered(false);
          setErrorMsg("");
          setFullMetadata(null);
          setRoute(null);
        } else {
          setTampered(true);
          setErrorMsg(t("This link couldn't be read: {reason}", { reason: err.message }));
          setRoute(null);
        }
      }
    }
    load(mapped);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handRaw, disabled, id]);

  return {
    hand,
    isError,
    isLoading,
    refetchHand: refetch,
    route,
    tampered,
    errorMsg,
    fullMetadata,
    hasFragment,
  };
}
