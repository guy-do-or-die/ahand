import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MockUSDAbi, DeployedAddresses } from "@ahand/abi";
import { useSender } from "../hooks/useSender";
import { activeChain } from "../config/web3";
import { QuietButton } from "./QuietButton";
import { t } from "../i18n";

/**
 * Dev-only (anvil): mints test mockUSD to the connected pocket. For an
 * embedded pocket this is itself a sponsored userOp — the first one also
 * sets the EIP-7702 delegation, so it doubles as the AA smoke test.
 */
export function DevFaucet() {
  const { send, isConnected, address, mode } = useSender();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (activeChain.id !== 31337 || !isConnected || !address) return null;

  const grab = async () => {
    setBusy(true);
    setErr("");
    try {
      await send([
        {
          address: DeployedAddresses.mockUSD,
          abi: MockUSDAbi,
          functionName: "mint",
          args: [address, 1_000_000_000n], // 1000 mockUSD (6 decimals)
        },
      ]);
      await queryClient.invalidateQueries();
    } catch (e: any) {
      setErr(String(e?.shortMessage ?? e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <QuietButton onClick={grab} disabled={busy}>
        {busy
          ? mode === "sponsored"
            ? t("minting (gas on the house)…")
            : t("minting…")
          : t("Get test funds")}
      </QuietButton>
      {err && (
        <p className="ah-label ah-label--dim mt-1.5" style={{ fontSize: 12 }}>
          {err}
        </p>
      )}
    </div>
  );
}
