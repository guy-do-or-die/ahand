import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { formatUnits } from "viem";
import { useThankFlow } from "../hooks/useThankFlow";
import { useGiveNote } from "../hooks/useGiveNote";
import { SwipeButton } from "../components/SwipeButton";
import { QuietButton } from "../components/QuietButton";
import { ThankReceipt } from "../components/ThankReceipt";
import { ThreadSheet } from "../components/ThreadSheet";
import { Emoji } from "../components/Emoji";
import { formatUsd, formatUsdCents } from "../lib/format";
import { t } from "../i18n";

export const Route = createFileRoute("/h/$id/thank")({
  component: ThankComponent,
});

function ThankComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const flow = useThankFlow(id);
  // The link carries only the sealed proof; the giver's words arrive over
  // XMTP — when this device has them, show them (verified against the seal).
  const giveNote = useGiveNote(flow.thankData?.give?.solutionHash);
  const [talking, setTalking] = useState(false);

  if (flow.parseError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-4">
        <div className="ah-alert max-w-md" role="alert">
          <p className="ah-alert__label">
            <Emoji>⚠️</Emoji> {t("doesn't add up")}
          </p>
          <p className="ah-alert__text">{flow.parseError}</p>
        </div>
        <QuietButton onClick={() => navigate({ to: "/" })}>{t("Back home")}</QuietButton>
      </div>
    );
  }
  if (!flow.thankData) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="ah-label">{t("reading the proof…")}</p>
      </div>
    );
  }

  const handRaw = flow.handRaw as any[] | undefined;
  const status = handRaw?.[7];
  const charityFeeBps = Number(handRaw?.[4] ?? 0);
  const maintFeeBps = Number(handRaw?.[5] ?? 0);
  const settled = flow.success || status === 2;

  const shakes: any[] = flow.thankData.shakes ?? [];
  const give = flow.thankData.give;
  const solverLabel = t("the person who helped");

  // Pre-commit split preview (#9): the same deterministic §5 math the receipt
  // shows afterward, surfaced BEFORE release so the raiser consents to a
  // number they can see. Display only — the chain does the real settlement.
  const pool =
    Number(formatUnits((handRaw?.[2] as bigint) ?? 0n, 6)) + (Number(flow.topUp) || 0);
  const charity = (pool * charityFeeBps) / 10000;
  const maint = (pool * maintFeeBps) / 10000;
  const net = pool - charity - maint;
  const solverAmount = (net * Number(give.finalClaimBps)) / 10000;
  const hopsAmount = net - solverAmount;

  if (settled) {
    return (
      <ThankReceipt
        pool={flow.settledPot}
        charityFeeBps={charityFeeBps}
        maintFeeBps={maintFeeBps}
        shakes={shakes}
        give={give}
        solverLabel={solverLabel}
        onRaise={() => navigate({ to: "/raise" })}
      />
    );
  }

  return (
    <div className="ah-page">
      <div className="flex flex-col flex-1 w-full px-6 pt-6 pb-6 lg:max-w-[620px] lg:mx-auto lg:pt-11 lg:pb-16">
        <p className="ah-label ah-label--dim flex items-center gap-1.5">
          {t("your hand")}
          <span className="ah-meta" style={{ fontSize: "var(--fs-mono-xs)" }}>#{id}</span>
        </p>
        <h1
          className="mt-2.5 font-extrabold"
          style={{ fontSize: 30, lineHeight: 1.08, letterSpacing: "-0.028em", textWrap: "balance" }}
        >
          {t("Did this accept it?")}
        </h1>

        {/* Solver card (mock 07). The solution text never travels in the
            payload — only its hash — so the proof is shown instead. */}
        <div className="ah-card mt-5 p-[18px]">
          <div className="flex items-center gap-2.5">
            <span
              className="grid place-items-center w-[38px] h-[38px] rounded-full font-bold"
              style={{ background: "var(--amber-a30)", fontFamily: "var(--font-meta)", fontSize: 13 }}
              aria-hidden="true"
            >
              {give.solver.slice(2, 4).toUpperCase()}
            </span>
            <span>
              <span className="block font-bold" style={{ fontSize: 15.5, fontFamily: "var(--font-meta)" }}>
                {solverLabel}
              </span>
              <span className="ah-label ah-label--dim block mt-0.5" style={{ fontSize: 12.5 }}>
                {shakes.length > 0
                  ? t("passed through {n} hands to reach you", { n: shakes.length })
                  : t("came straight back to you")}
              </span>
            </span>
          </div>
          {giveNote ? (
            <>
              <p className="mt-3" style={{ fontSize: 14.5, lineHeight: 1.5, overflowWrap: "anywhere" }}>
                {giveNote.note}
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="ah-meta" style={{ fontSize: "var(--fs-mono-xs)", letterSpacing: "var(--track-mono-sm)", color: "var(--ink-a55)" }}>
                  {giveNote.verified ? t("their words, sealed into the give ✓") : t("their words, as sent")}
                </p>
                <QuietButton compact onClick={() => setTalking(true)}>
                  {t("talk it over")}
                </QuietButton>
              </div>
            </>
          ) : (
            <p className="mt-3 ah-meta" style={{ fontSize: "var(--fs-mono-xs)", letterSpacing: "var(--track-mono-sm)", color: "var(--ink-a55)" }}>
              {t("their reply · {hash}", { hash: `${give.solutionHash.slice(0, 10)}…${give.solutionHash.slice(-6)}` })}
            </p>
          )}
        </div>

        {handRaw ? (
          <div className="ah-card mt-4 p-[18px]">
            <div className="flex items-baseline justify-between">
              <span className="ah-label">{t("When you say yes")}</span>
              <span className="font-extrabold" style={{ fontSize: 22, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                {formatUsd(pool)}
              </span>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <SplitRow label={t("{name} keeps", { name: solverLabel })} amount={formatUsdCents(solverAmount)} strong />
              {shakes.length > 0 && (
                <SplitRow label={t("the {n} hands that passed it share", { n: shakes.length })} amount={formatUsdCents(hopsAmount)} />
              )}
              {charityFeeBps > 0 && (
                <SplitRow label={t("{pct}% to charity", { pct: (charityFeeBps / 100).toFixed(0) })} amount={formatUsdCents(charity)} />
              )}
            </div>
            <p className="ah-label ah-label--dim mt-3.5" style={{ fontSize: 12.5 }}>
              {t("Nothing moves until you tap yes — and it can't be undone.")}
            </p>
          </div>
        ) : (
          <p className="mt-3.5 text-[13.5px] leading-[1.5] text-ink/55">
            {t("Saying yes releases the thanks to {name} and every hand between you.", { name: solverLabel })}
          </p>
        )}

        <TopUp topUp={flow.topUp} setTopUp={flow.setTopUp} />

        {flow.errorMsg && (
          <div className="ah-alert mt-4" role="alert">
            <p className="ah-alert__label">
              <Emoji>⚠️</Emoji> {t("something to fix")}
            </p>
            <p className="ah-alert__text">{flow.errorMsg}</p>
          </div>
        )}

        <div aria-hidden="true" className="flex-1 min-h-5 max-h-24" />
        <div className="pt-6 flex flex-col gap-2.5">
          <SwipeButton gesture="bow" variant="amber" disabled={flow.loading} aria-busy={flow.loading} onClick={flow.handleThank}>
            {flow.loading ? t("Thanking…") : t("Yes — accept")}
          </SwipeButton>
          <QuietButton onClick={() => navigate({ to: "/" })}>
            {t("Not quite — keep it open")}
          </QuietButton>
        </div>
      </div>
      {talking && giveNote && (
        <ThreadSheet
          conversationId={giveNote.conversationId}
          title={t("about your hand #{id}", { id })}
          onClose={() => setTalking(false)}
        />
      )}
    </div>
  );
}

function SplitRow({ label, amount, strong }: { label: string; amount: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={strong ? "ah-label" : "ah-label ah-label--dim"} style={{ fontSize: 13.5 }}>
        {label}
      </span>
      <span
        className="shrink-0"
        style={{ fontFamily: "var(--font-meta)", fontSize: 13.5, fontWeight: strong ? 700 : 500, fontVariantNumeric: "tabular-nums" }}
      >
        {amount}
      </span>
    </div>
  );
}

function TopUp({ topUp, setTopUp }: { topUp: string; setTopUp: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4">
      <button type="button" className="ah-disclose" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} {t("add to the pot")}
      </button>
      {open && (
        <label className="mt-2 flex items-center justify-between gap-4 max-w-[340px]">
          <span className="ah-label">{t("extra thanks")}</span>
          <input
            type="number"
            min="0"
            className="ah-chip w-28 text-center"
            value={topUp}
            onChange={(e) => setTopUp(e.target.value)}
          />
        </label>
      )}
    </div>
  );
}
