import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { encodePayload, signShake, newCapability, type Shake, type SignedShake } from "@ahand/sdk";
import { assembleLink } from "../lib/metadata";
import { t } from "../i18n";

/**
 * Pass-on flow — signs a Shake with the payload's latest capability and
 * assembles the next link (parent key stripped by construction: the new
 * payload carries only the fresh child key). Logic follows the PoC with one
 * task-mandated change (§0.2): the payout address is always collected and
 * placed in the shake — the SHAKE receipt lands there even at 0% margin —
 * and the link only assembles once the address passes isAddress.
 */
export function usePassOnFlow(args: {
  active: boolean;
  id: string;
  payload: any;
  tampered: boolean;
  handRaw: unknown;
  searchE?: string;
}) {
  const { active, id, payload, tampered, handRaw, searchE } = args;

  const [marginPct, setMarginPct] = useState(0); // 0 = gift
  const [payoutAddr, setPayoutAddr] = useState("");
  const [newShareUrl, setNewShareUrl] = useState("");
  const [error, setError] = useState("");
  const [childCap, setChildCap] = useState<{ privateKey: `0x${string}`; address: `0x${string}` } | null>(null);

  useEffect(() => {
    if (active && !childCap) {
      setChildCap(newCapability());
    }
  }, [active, childCap]);

  const payoutValid = isAddress(payoutAddr);

  useEffect(() => {
    if (!active || !payload || !childCap || tampered) {
      setNewShareUrl("");
      return;
    }

    async function generate() {
      setError("");
      setNewShareUrl("");

      if (!isAddress(payoutAddr)) {
        // Shout only at a committed wrong value, never mid-typing —
        // a full-length address that still doesn't parse.
        if (payoutAddr.length >= 42) setError(t("That address doesn't look right (0x…)."));
        return;
      }

      try {
        const latestPriv = payload.latestPrivateKey;
        const chainId = payload.chainId;
        const core = payload.core;

        const currentParentClaim = payload.shakes.length === 0
          ? 10000
          : payload.shakes[payload.shakes.length - 1].shake.childClaimBps;

        const chosenMargin = marginPct * 100;
        const childClaim = currentParentClaim - chosenMargin;

        if (childClaim < 0) {
          setError(t("That share is more than what's left to pass."));
          return;
        }

        const shake: Shake = {
          handId: BigInt(id),
          childCapability: childCap.address,
          // §0.2: receipt destination always set, even for a 0% gift pass
          payout: payoutAddr as `0x${string}`,
          parentClaimBps: currentParentClaim,
          childClaimBps: childClaim,
          deadline: BigInt((handRaw as any[])[3]),
        };

        const signature = await signShake(shake, latestPriv, chainId, core);
        const newSignedShake: SignedShake = { shake, signature };

        // Visibility doesn't change on pass-on, but we need it for assembleLink
        const visibility = searchE ? (payload.metadata.envelopeB64 ? "dark" : "public") : "public";

        const url = assembleLink(
          window.location.origin,
          id,
          {
            envelopeB64: searchE || payload.metadata.envelopeB64,
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
        setError(t("Couldn't build the new link: {reason}", { reason: err.shortMessage || err.message }));
      }
    }

    generate();
  }, [active, payload, tampered, marginPct, payoutAddr, childCap, id, handRaw, searchE]);

  return {
    marginPct,
    setMarginPct,
    payoutAddr,
    setPayoutAddr,
    payoutValid,
    newShareUrl,
    error,
  };
}
