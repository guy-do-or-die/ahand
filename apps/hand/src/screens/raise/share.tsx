import { useEffect, useRef, useState } from "react";

import { useNow } from "../../chain";
import { navigate } from "../../router";
import { stampSeed } from "../../store/db";
import { rememberText } from "../../store/memory";
import { t } from "../../i18n";
import { TID } from "../../testids";
import { CopyRow, Disclose, ErrorBand, GestureEmoji, Mark, Qr, QuietButton, shortAddress, TxRail, type TxReached } from "../../ui";
import { saved, type Up } from "./flow";
import { OnExplorer } from "../../shell/OnExplorer";

/**
 * After the raise (UX-SPEC §7.2 items 8–9): "Your hand is up.", the TxRail going on to Final, the
 * address in a dashed copy row (from this tab's memory), Share, Show QR (bare, everything inside,
 * digits), Print a card and Add a reminder. For an account whose confirmations differ, the band
 * and the required "I saved the link", which deletes the locked copy (D-63).
 */

export interface ShareProps {
  up: Up;
  reached: TxReached;
  local: boolean;
  chainId: number;
  txHash?: string;
  blockNumber?: bigint;
  /** For an account that repeats, after a reload: rebuild the link with one confirmation. */
  onShow?: () => void;
  showing?: boolean;
  onAgain: () => void;
}

export function Share({ up, reached, local, chainId, txHash, blockNumber, onShow, showing, onAgain }: ShareProps) {
  const { raised, written, locked } = up;
  const handId = raised.hand.handId.toString();
  const [qr, setQr] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [gone, setGone] = useState(false);
  const [dropFailed, setDropFailed] = useState(false);
  const mustSave = locked && !gone;
  const now = useNow(chainId);

  // The first time the link is on screen, by the chain's clock: the sweep deletes the locked copy
  // a day later at the latest, ticked or not (sweep.ts).
  const stamped = useRef(false);
  const shownAt = locked && written && now ? now.timestamp : undefined;
  useEffect(() => {
    if (shownAt === undefined || stamped.current) return;
    stamped.current = true;
    void stampSeed(up.record.intent, "shownAt", shownAt).catch(() => undefined);
  }, [shownAt, up.record.intent]);

  // Leaving before "I saved the link" asks first: the locked copy is the only other way back to it.
  useEffect(() => {
    if (!mustSave) return;
    const hold = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [mustSave]);

  const tick = async (on: boolean) => {
    setTicked(on);
    if (!on) return;
    try {
      await saved(up.record);
      setGone(true);
    } catch {
      setDropFailed(true);
    }
  };

  const go = (to: string) => {
    if (written) rememberText(written.address, "handover");
    navigate(to);
  };

  return (
    <section className="flex flex-col gap-6" aria-labelledby="raise-up-title">
      <div className="flex flex-col gap-3" data-testid={TID.raise.up} data-hand-id={handId} data-data-hash={raised.hand.dataHash} data-root-key={raised.hand.rootKey}>
        <h1 id="raise-up-title" className="m-0 text-[length:var(--fs-title-m-sm)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title-m)]">
          <GestureEmoji kind="raise" className="mr-2" />
          {t("raise.up")}
        </h1>
        <div data-testid={TID.raise.txRail} data-value={reached}>
          <TxRail reached={reached} local={local} />
        </div>
      </div>

      {locked && written ? (
        <div className="flex flex-col gap-2" data-testid={TID.raise.lockedCopy} data-state={gone ? "gone" : "locked"}>
          {!gone ? <ErrorBand what={t("raise.locked.band")} kept={t("raise.locked.inbox")} /> : null}
        </div>
      ) : null}

      {written ? (
        <div className="flex flex-col gap-3">
          <p className="ah-label m-0">{t("raise.share.line")}</p>
          <div data-testid={TID.raise.copy}>
            <CopyRow value={written.address} shareText={`${t("raise.share.line")}\n${written.address}`} />
          </div>
          <div className="flex flex-wrap gap-2">
            <QuietButton compact data-testid={TID.raise.qr} aria-expanded={qr} onClick={() => setQr(!qr)}>
              {qr ? t("raise.share.hideQr") : t("raise.share.qr")}
            </QuietButton>
            <QuietButton compact data-testid={TID.raise.print} disabled={mustSave} onClick={() => go("/print")}>
              {t("raise.share.print")}
            </QuietButton>
            <QuietButton compact data-testid={TID.raise.reminder} disabled={mustSave} onClick={() => go(`/care/${chainId}/${handId}`)}>
              {t("raise.share.reminder")}
            </QuietButton>
          </div>
          {qr ? (
            <div className="flex flex-col gap-2" data-testid={`${TID.raise.qr}-code`}>
              <Qr value={written.qr} />
              <p className="ah-label m-0">{t("raise.share.qrNote")}</p>
            </div>
          ) : null}
          <p className="ah-label m-0 flex flex-wrap items-center gap-2">
            <span>{t("raise.share.checked", { id: handId })}</span>
            <Mark kind="checked" source={<span className="ah-meta ah-meta--exact">{t("raise.share.lens.size", { bytes: written.linkBytes, shape: written.shape, qrBytes: written.qrBytes })}</span>} />
          </p>
          {!locked ? <p className="ah-label ah-label--dim m-0">{t("raise.share.tabOnly")}</p> : null}
        </div>
      ) : onShow ? (
        <div className="flex flex-col items-start gap-3">
          <p className="ah-label m-0">{t("raise.show.why")}</p>
          <QuietButton data-testid={`${TID.raise.copy}-show`} disabled={showing} onClick={onShow}>
            {t("raise.show")}
          </QuietButton>
        </div>
      ) : null}

      {locked && written ? (
        <div className="flex flex-col gap-2">
          <label className="ah-check">
            <input type="checkbox" data-testid={TID.raise.savedTick} checked={ticked} disabled={gone} onChange={(event) => void tick(event.target.checked)} />
            <span>{t("raise.locked.tick")}</span>
          </label>
          {gone ? (
            <p className="ah-label m-0" data-testid={TID.raise.copyGone} role="status">
              {t("raise.locked.gone")}
            </p>
          ) : (
            <p className="ah-label ah-label--dim m-0">{t("raise.locked.leave")}</p>
          )}
          {dropFailed ? <ErrorBand what={t("common.error.unknown")} /> : null}
        </div>
      ) : null}

      <Disclose label={t("raise.share.evidence")} summary={`HAND ${handId}`}>
        <span className="ah-meta ah-meta--exact">
          {t("raise.share.lens.raised", { id: handId, block: blockNumber !== undefined ? blockNumber.toString() : "—", tx: txHash ? shortAddress(txHash) : "—" })}
        </span>
        {txHash ? <OnExplorer tx={txHash} /> : null}
        <span className="ah-meta ah-meta--exact break-all">raiser {raised.hand.raiser}</span>
        <span className="ah-meta ah-meta--exact break-all">token {raised.hand.token} · reward {raised.reward.toString()}</span>
        <span className="ah-meta ah-meta--exact">expiry {raised.expiry} · payoutGasK {raised.hand.payoutGasK} · minClaimBps {raised.hand.minClaimBps}</span>
        <span className="ah-meta ah-meta--exact break-all">rootKey {raised.hand.rootKey}</span>
        <span className="ah-meta ah-meta--exact break-all">dataHash {raised.hand.dataHash}</span>
        <Mark kind="chain" />
      </Disclose>

      <div className="flex flex-wrap gap-3">
        <QuietButton disabled={mustSave} onClick={onAgain}>
          {t("raise.share.again")}
        </QuietButton>
        <QuietButton disabled={mustSave} onClick={() => navigate("/my")}>
          {t("common.word.myHands")}
        </QuietButton>
      </div>
    </section>
  );
}
