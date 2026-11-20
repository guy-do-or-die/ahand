import { castLine, messageIdOf, refundCall } from "@ahand/sdk";
import { useMemo, useState } from "react";
import type { Address } from "viem";

import { useChainStatus, useCost } from "../../chain";
import { config } from "../../config";
import { t } from "../../i18n";
import { chainName } from "../../i18n/common/chain";
import { handKey } from "../../store/db";
import { TID } from "../../testids";
import { CostLine, Disclose, ErrorBand, Mark, SwipeButton, TxRail } from "../../ui";
import { ConnectButton, refundedProbe, useKeptSend, useWallet, type SendResult } from "../../wallet";
import { OnExplorer } from "../../shell/OnExplorer";

/**
 * After the end, still open (UX-SPEC §8.3): "Time's up. Anyone can send the reward back to the
 * asker now." Core's `refund` passes from the second the Hand ends, for any caller, and always
 * pays the asker. Any connected account can press it; the call is tried against the network
 * first, so a refusal arrives as its sentence and nothing is sent. Whether the Hand is past its
 * end is the network's clock (the caller decides from `stateAt(useNow())`), never this device's.
 *
 * The send is one kept intent (`useKeptSend`): after a reload it is followed again, its button
 * held, and a lost answer is settled by the account's nonce and the Hand's `Refunded`; it is never
 * offered a second time while the first may still land (FINDINGS W-6).
 */
export function SendBack({ core, handId, funded }: { core: Address; handId: bigint; funded: boolean }) {
  const wallet = useWallet();
  const { offline, stale } = useChainStatus();
  const [result, setResult] = useState<SendResult>();
  const probe = useMemo(() => refundedProbe(core, handId), [core, handId]);
  const kept = useKeptSend(`refund:${handKey(config.chain.id, core, handId)}`, { refund: probe }, (resumed) => {
    if (resumed.ok || resumed.reason !== "stopped") setResult(resumed);
  });
  const tx = kept.tx;
  const call = useMemo(() => refundCall(core, handId), [core, handId]);
  const ready = wallet.status === "connected" && wallet.canSend && wallet.address !== undefined;
  const busy = kept.holding || (tx.state.phase !== "idle" && tx.state.phase !== "done" && tx.state.phase !== "failed");
  const cost = useCost(ready && !busy ? [call] : undefined, wallet.address);

  async function go() {
    if (busy) return;
    setResult(undefined);
    const sent = await kept.send([call], { steps: [{ action: "refund", probe }] });
    if (sent.ok || sent.reason !== "stopped") setResult(sent);
  }

  return (
    <div className="flex flex-col gap-4" data-testid={TID.hand.timesUp}>
      <p className="m-0 text-[length:var(--fs-body-lg)] font-bold leading-snug">{t(funded ? "hand.sendBack.title" : "hand.sendBack.title.noReward")}</p>
      {result?.ok ? (
        <p className="m-0 flex flex-wrap items-center gap-2 font-bold" data-testid={TID.hand.wentBack}>
          {t(funded ? "hand.sendBack.done" : "hand.sendBack.doneNoReward")}
          <Mark kind="chain" source={<span className="ah-meta ah-meta--exact">{`block ${result.receipt.blockNumber} · tx ${result.receipt.transactionHash}`}</span>} />
          <OnExplorer tx={result.receipt.transactionHash} />
        </p>
      ) : (
        <>
          <ConnectButton />
          {kept.unknown ? (
            <p className="ah-note m-0" role="status" data-testid={TID.hand.sendBackInFlight} data-value="unknown">
              {t("common.send.unknown")}
            </p>
          ) : kept.resumed && busy ? (
            <p className="ah-note m-0" role="status" data-testid={TID.hand.sendBackInFlight} data-value="resumed">
              {t("common.send.inFlight")}
            </p>
          ) : null}
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
        <div data-testid={TID.hand.sendBackRail} data-value={tx.state.reached} data-phase={tx.state.phase}>
          <div data-testid={TID.kit.txRail} data-value={tx.state.reached}>
            <TxRail reached={tx.state.reached} local={!config.chain.hasL1} offline={(offline || stale) && tx.state.phase === "watching"} />
          </div>
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
    case "dropped":
      return t("common.send.dropped");
    case "unknown":
      return t("common.send.unknown");
    case "wrong-network":
      return t("common.error.wrongNetwork", { network: chainName(config.chain) });
    default:
      return t("common.error.unknown");
  }
}
