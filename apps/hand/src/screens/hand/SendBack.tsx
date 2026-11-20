import { castLine, messageIdOf, refundCall } from "@ahand/sdk";
import { useMemo, useState } from "react";
import type { Address } from "viem";

import { useCost } from "../../chain";
import { config } from "../../config";
import { t } from "../../i18n";
import { TID } from "../../testids";
import { CostLine, Disclose, ErrorBand, Mark, SwipeButton, TxRail } from "../../ui";
import { ConnectButton, useSend, useWallet, type SendResult } from "../../wallet";

/**
 * After the end, still open (UX-SPEC §8.3): "Time's up. Anyone can send the reward back to the
 * asker now." Core's `refund` passes from the second the Hand ends, for any caller, and always
 * pays the asker. Any connected account can press it; the call is tried against the network
 * first, so a refusal arrives as its sentence and nothing is sent. Whether the Hand is past its
 * end is the network's clock (the caller decides from `stateAt(useNow())`), never this device's.
 */
export function SendBack({ core, handId, funded }: { core: Address; handId: bigint; funded: boolean }) {
  const wallet = useWallet();
  const tx = useSend();
  const [result, setResult] = useState<SendResult>();
  const call = useMemo(() => refundCall(core, handId), [core, handId]);
  const ready = wallet.status === "connected" && wallet.canSend && wallet.address !== undefined;
  const cost = useCost(ready ? [call] : undefined, wallet.address);
  const busy = tx.state.phase !== "idle" && tx.state.phase !== "done" && tx.state.phase !== "failed";

  async function go() {
    setResult(undefined);
    setResult(await tx.send([call]));
  }

  return (
    <div className="flex flex-col gap-4" data-testid={TID.hand.timesUp}>
      <p className="m-0 text-[length:var(--fs-body-lg)] font-bold leading-snug">{t(funded ? "hand.timesUp" : "hand.timesUp.noReward")}</p>
      {result?.ok ? (
        <p className="m-0 flex flex-wrap items-center gap-2 font-bold" data-testid={TID.hand.wentBack}>
          {t(funded ? "hand.sendBack.done" : "hand.sendBack.doneNoReward")}
          <Mark kind="chain" source={<span className="ah-meta ah-meta--exact">{`block ${result.receipt.blockNumber} · tx ${result.receipt.transactionHash}`}</span>} />
        </p>
      ) : (
        <>
          <ConnectButton />
          {wallet.status === "connected" && !wallet.canSend ? <p className="ah-label m-0">{t("hand.sendBack.cannot")}</p> : null}
          {wallet.status !== "connected" ? <p className="ah-label m-0">{t("hand.sendBack.needs")}</p> : null}
          <SwipeButton gesture="raise" still data-testid={TID.hand.sendBack} disabled={!ready || busy} onClick={() => void go()} className="w-full">
            {funded ? t("common.word.sendBack") : t("hand.sendBack.noReward")}
          </SwipeButton>
          {ready && cost.status === "checking" ? <p className="ah-meta m-0">{t("hand.sendBack.checking")}</p> : null}
          {ready && cost.status === "ok" ? <CostLine cost={cost.cost} prices={config.prices} gas={cost.gas} /> : null}
          {ready && cost.status === "refused" ? <ErrorBand what={t(messageIdOf(cost.refusal))} code={`CORE · ${cost.refusal.name}`} /> : null}
          {ready && cost.status === "offline" ? <ErrorBand what={t("common.error.offline")} /> : null}
        </>
      )}
      {tx.state.reached ? (
        <div data-testid={TID.kit.txRail} data-value={tx.state.reached}>
          <TxRail reached={tx.state.reached} local={!config.chain.hasL1} />
        </div>
      ) : null}
      {result && !result.ok ? <ErrorBand what={failureSentence(result)} {...(result.reason === "refused" ? { code: `CORE · ${result.refusal.name}` } : {})} /> : null}
      <Disclose label={t("common.footer.withoutUs")}>
        <span className="ah-meta ah-meta--exact break-all normal-case">{castLine(call, { rpc: "$RPC" })}</span>
        <span className="ah-meta ah-meta--exact break-all normal-case">{`refund(${handId}) · to ${core} · data ${call.data}`}</span>
      </Disclose>
    </div>
  );
}

/** What a failed send says: Core's own sentence for a refusal, then what was not lost. */
function failureSentence(result: Exclude<SendResult, { ok: true }>): string {
  switch (result.reason) {
    case "refused":
      return t(messageIdOf(result.refusal));
    case "reverted":
      return result.refusal ? t(messageIdOf(result.refusal)) : t("common.error.unknown");
    case "rejected":
      return t("common.error.refused");
    case "offline":
      return t("common.error.offline");
    case "cannot-send":
      return t("hand.sendBack.cannot");
    default:
      return t("common.error.unknown");
  }
}
