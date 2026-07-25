import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import { AHandCoreAbi, DeployedAddresses } from "@ahand/abi";
import { decodePayload } from "@ahand/sdk";
import { parseLink, verifyMetadata } from "../lib/metadata";
import { t } from "../i18n";

export interface VerifiedMetadata {
  title: string;
  description: string;
}

/**
 * Hand view state — wraps the frozen client contract unchanged:
 * chain read → parseLink(fragment) → MANDATORY verifyMetadata against the
 * on-chain hash. Verification failure ⇒ tampered=true, content withheld;
 * the UI must show the failure state and disable Pass-on / Help.
 * A link with no fragment is not tampering — it renders on-chain facts only.
 */
export function useHandView(id: string, options?: { disabled?: boolean }) {
  const disabled = !!options?.disabled;
  const { data: handRaw, isError, isLoading } = useReadContract({
    address: DeployedAddresses.AHandCore,
    abi: AHandCoreAbi,
    functionName: "hands",
    args: disabled ? undefined : [BigInt(id)],
  });

  const [payload, setPayload] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [tampered, setTampered] = useState(false);
  const [fullMetadata, setFullMetadata] = useState<VerifiedMetadata | null>(null);
  const [hasFragment, setHasFragment] = useState<boolean | null>(null);

  useEffect(() => {
    if (disabled) return;
    async function load() {
      if (!handRaw) return; // Wait for on-chain anchor

      const onchainHash = (handRaw as any[])[10];
      setHasFragment(window.location.hash.length > 2);

      try {
        const parsed = parseLink(window.location.href, decodePayload);
        setPayload(parsed.decodedPayload);

        const verify = await verifyMetadata(parsed.envelopeB64, parsed.bodyB64, onchainHash);

        if (!verify.ok) {
          setTampered(true);
          setErrorMsg(t("This content doesn't match what was raised: {reason}", { reason: verify.reason }));
          setFullMetadata(null); // Hide text
        } else {
          setTampered(false);
          setErrorMsg("");
          setFullMetadata({
            title: verify.envelope.preview.title,
            description: verify.body.description,
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
          setErrorMsg(t("This link couldn't be read: {reason}", { reason: err.message }));
        }
      }
    }
    load();
  }, [handRaw]);

  return {
    handRaw,
    isError,
    isLoading,
    payload,
    tampered,
    errorMsg,
    fullMetadata,
    hasFragment,
  };
}
