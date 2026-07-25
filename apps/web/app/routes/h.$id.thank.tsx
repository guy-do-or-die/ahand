import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useConnection } from "wagmi";
import { formatUnits } from "viem";
import { AHandCoreAbi, DeployedAddresses } from "@ahand/abi";
import { useThankFlow, type ThankAllocation } from "../hooks/useThankFlow";
import { useGiveNote } from "../hooks/useGiveNote";
import { useSender } from "../hooks/useSender";
import { SwipeButton } from "../components/SwipeButton";
import { QuietButton } from "../components/QuietButton";
import { ThankReceipt } from "../components/ThankReceipt";
import { ReclaimButton } from "../components/ReclaimButton";
import { ThreadSheet } from "../components/ThreadSheet";
import { Emoji } from "../components/Emoji";
import type { ReceiptRow } from "../components/ReceiptTable";
import { formatUsd, formatUsdCents } from "../lib/format";
import { humanizeChainError } from "../lib/errors";
import { t } from "../i18n";

export const Route = createFileRoute("/h/$id/thank")({
  component: ThankComponent,
});

const asUsd = (raw: bigint) => Number(formatUnits(raw, 6));

/** PayoutAllocated lines → receipt rows: giver first, hops nearest the giver
 *  next, charity last — the same order the old deterministic preview used. */
function allocationRows(allocations: ThankAllocation[], charityBps: number): ReceiptRow[] {
  const giver = allocations.filter((a) => a.kind === "giverResidual");
  const hops = allocations
    .filter((a) => a.kind === "shakerMargin")
    .sort((a, b) => b.routePosition - a.routePosition);
  const charity = allocations.filter((a) => a.kind === "charity");
  const rows: ReceiptRow[] = [];
  for (const a of giver) {
    rows.push({
      key: `giver-${a.routePosition}`,
      label: `${t("the person who helped")} · ${t("accepted it")}`,
      amount: formatUsdCents(asUsd(a.amount)),
      highlight: true,
    });
  }
  for (const a of hops) {
    rows.push({
      key: `hop-${a.routePosition}`,
      label: `${t("a friend")} · ${t("passed it")}`,
      amount: formatUsdCents(asUsd(a.amount)),
    });
  }
  for (const a of charity) {
    rows.push({
      key: "charity",
      label: t("charity · {pct}%", { pct: (charityBps / 100).toFixed(0) }),
      amount: formatUsdCents(asUsd(a.amount)),
    });
  }
  return rows;
}

function ThankComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { address } = useConnection();
  const flow = useThankFlow(id);
  // The link carries only the sealed proof; the giver's words arrive over
  // XMTP — when this device has them, show them (verified against the seal).
  const giveNote = useGiveNote(flow.proof?.give.give.solutionHash);
  const [talking, setTalking] = useState(false);

  // Pre-commit split preview: the same floor math the contract runs, from
  // the credited pool — surfaced BEFORE release so the raiser consents to a
  // number they can see. Display only; the chain does the real settlement.
  const split = useMemo(() => {
    if (!flow.hand || !flow.proof) return null;
    const pool = flow.hand.creditedReward;
    const charity = (pool * BigInt(flow.hand.charityBps)) / 10000n;
    const distributable = pool - charity;
    let hopsTotal = 0n;
    for (const s of flow.proof.shakes) {
      const delta = BigInt(s.shake.parentClaimBps - s.shake.childClaimBps);
      hopsTotal += (distributable * delta) / 10000n;
    }
    // The giver takes the residual — dust lands with the one who gave.
    const giver = distributable - hopsTotal;
    return {
      pool: asUsd(pool),
      charity: asUsd(charity),
      hops: asUsd(hopsTotal),
      giver: asUsd(giver),
    };
  }, [flow.hand, flow.proof]);

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
  if (!flow.proof || !flow.hand) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="ah-label">{t("reading the proof…")}</p>
      </div>
    );
  }

  const hand = flow.hand;
  const settled = flow.success || hand.status === "settled";
  const shakes = flow.proof.shakes;
  const give = flow.proof.give.give;
  const giverLabel = t("the person who helped");

  if (settled) {
    const rows = flow.allocations ? allocationRows(flow.allocations, hand.charityBps) : null;
    const total =
      flow.allocations && flow.allocations.length > 0
        ? {
            label: t("{n} people better off", {
              n: new Set(flow.allocations.map((a) => a.beneficiary.toLowerCase())).size,
            }),
            amount: formatUsdCents(asUsd(flow.allocations.reduce((s, a) => s + a.amount, 0n))),
          }
        : null;
    const deferred = flow.allocations?.some((a) => a.delivered === "deferred") ?? false;
    return (
      <ThankReceipt rows={rows} total={total} deferred={deferred} onRaise={() => navigate({ to: "/raise" })} />
    );
  }

  const verifyBlocked = !!flow.verifyError;
  const expired = flow.expired && hand.status === "active";

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

        {/* The proof failed the same checks the chain would run — fail
            closed, and say exactly which byte betrayed the route. */}
        {verifyBlocked && (
          <div className="ah-alert mt-5" role="alert">
            <p className="ah-alert__label">
              <Emoji>⚠️</Emoji> {t("doesn't add up")}
            </p>
            <p className="ah-alert__text">
              {t("This proof wouldn't settle: {reason}", { reason: flow.verifyError })}
            </p>
            <p className="ah-alert__text" style={{ color: "var(--paper-a75)" }}>
              {t("Saying thanks is switched off for this link.")}
            </p>
          </div>
        )}

        {/* Giver card. The solution text never travels in the payload —
            only its hash — so the proof is shown instead. */}
        <div className="ah-card mt-5 p-[18px]">
          <div className="flex items-center gap-2.5">
            <span
              className="grid place-items-center w-[38px] h-[38px] rounded-full font-bold"
              style={{ background: "var(--amber-a30)", fontFamily: "var(--font-meta)", fontSize: 13 }}
              aria-hidden="true"
            >
              {give.giver.slice(2, 4).toUpperCase()}
            </span>
            <span>
              <span className="block font-bold" style={{ fontSize: 15.5, fontFamily: "var(--font-meta)" }}>
                {giverLabel}
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

        {split && (
          <div className="ah-card mt-4 p-[18px]">
            <div className="flex items-baseline justify-between">
              <span className="ah-label">{t("When you say yes")}</span>
              <span className="font-extrabold" style={{ fontSize: 22, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                {formatUsd(split.pool)}
              </span>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <SplitRow label={t("{name} keeps", { name: giverLabel })} amount={formatUsdCents(split.giver)} strong />
              {shakes.length > 0 && split.hops > 0 && (
                <SplitRow label={t("the {n} hands that passed it share", { n: shakes.length })} amount={formatUsdCents(split.hops)} />
              )}
              <SplitRow label={t("{pct}% to charity", { pct: (hand.charityBps / 100).toFixed(0) })} amount={formatUsdCents(split.charity)} />
            </div>
            <p className="ah-label ah-label--dim mt-3.5" style={{ fontSize: 12.5 }}>
              {t("Nothing moves until you tap yes — and it can't be undone.")}
            </p>
            <p className="ah-label ah-label--dim mt-1.5" style={{ fontSize: 12.5 }}>
              {t("everyone's share is set aside on-chain — they take it out from their own pocket")}
            </p>
          </div>
        )}

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
          {expired ? (
            /* Strictly pre-expiry: at or past expiry the thanks window is
               closed — the pot goes back through the reclaim path instead. */
            <ThankReclaim
              id={id}
              isRaiser={!!address && address.toLowerCase() === hand.raiser.toLowerCase()}
              refundAmount={formatUsd(asUsd(hand.creditedReward))}
            />
          ) : (
            <>
              <SwipeButton
                gesture="bow"
                variant="amber"
                disabled={flow.loading || verifyBlocked}
                aria-busy={flow.loading}
                onClick={flow.handleThank}
              >
                {flow.loading ? t("Thanking…") : t("Yes — accept")}
              </SwipeButton>
              <QuietButton onClick={() => navigate({ to: "/" })}>
                {t("Not quite — keep it open")}
              </QuietButton>
            </>
          )}
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

/** The thanks window has closed — permissionless reclaim takes over. */
function ThankReclaim({
  id,
  isRaiser,
  refundAmount,
}: {
  id: string;
  isRaiser: boolean;
  refundAmount: string;
}) {
  const { send } = useSender();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const reclaim = async () => {
    setLoading(true);
    setError("");
    try {
      await send([
        {
          address: DeployedAddresses.AHandCore,
          abi: AHandCoreAbi,
          functionName: "reclaim",
          args: [BigInt(id)],
        },
      ]);
      setDone(true);
    } catch (err: any) {
      console.error(err);
      setError(humanizeChainError(err).message);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col gap-2.5">
        <p className="ah-label text-center">{t("the pot went back to whoever raised it")}</p>
        <QuietButton onClick={() => navigate({ to: "/pocket" })}>{t("See your pocket")}</QuietButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="ah-label ah-label--dim text-center">
        {t("this hand has expired — saying thanks closed with it")}
      </p>
      <ReclaimButton isRaiser={isRaiser} refundAmount={refundAmount} loading={loading} onReclaim={reclaim} />
      {error && (
        <div className="ah-alert" role="alert">
          <p className="ah-alert__text">{error}</p>
        </div>
      )}
    </div>
  );
}
