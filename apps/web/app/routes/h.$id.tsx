import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { formatUnits, createPublicClient, http } from "viem";
import { AHandCoreAbi, DeployedAddresses } from "@ahand/abi";
import { activeChain } from "../config/web3";
import { Envelope, b64urlDecode, sha256hex } from "../lib/metadata";
import { useHandView } from "../hooks/useHandView";
import { usePassOnFlow } from "../hooks/usePassOnFlow";
import { useSolveFlow } from "../hooks/useSolveFlow";
import { useGiveDelivery } from "../hooks/useGiveDelivery";
import { Sheet } from "../components/Sheet";
import { ChipRow } from "../components/ChipRow";
import { QuietButton } from "../components/QuietButton";
import { SwipeButton } from "../components/SwipeButton";
import { Logo } from "../components/Logo";
import { Emoji } from "../components/Emoji";
import { PotBar } from "../components/PotBar";
import { ChainRail } from "../components/ChainRail";
import { MetaLine } from "../components/MetaLine";
import { formatUsd, truncateMiddle } from "../lib/format";
import { POCKET_EMOJI } from "../styles/tokens";
import { t } from "../i18n";

const publicClientLoader = createPublicClient({ chain: activeChain, transport: http() });

export const Route = createFileRoute("/h/$id")({
  validateSearch: (search: Record<string, unknown>): { e?: string } => {
    return { e: typeof search.e === "string" ? search.e : undefined };
  },
  loaderDeps: ({ search: { e } }) => ({ e }),
  loader: async ({ params, deps: { e } }) => {
    const id = BigInt(params.id);
    let handData;
    try {
      handData = await publicClientLoader.readContract({
        address: DeployedAddresses.AHandCore,
        abi: AHandCoreAbi,
        functionName: "hands",
        args: [id],
      });
    } catch {
      return { id: params.id, generic: true, title: `aHand #${params.id}`, desc: "" };
    }

    const [
      , , remainingReward, expiry, , , minSolverClaimBps,
      status, , , metadataHash
    ] = handData as any[];

    const amount = formatUnits(remainingReward, 6);
    const date = new Date(Number(expiry) * 1000);
    const dateStr = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    
    // Generic meta defaults — plain words, no crypto terms (owner-approved
    // copy change; loader logic unchanged). See DEVIATIONS.md.
    let title = `aHand #${params.id} · $${amount} secured`;
    let desc = `paid when accepted · open till ${dateStr}`;

    if (status === 2) desc = "Accepted — thanks went out 🙏";
    if (status === 3) desc = "Reclaimed — closed unsolved 👎";

    // Stateless SSR Verification!
    if (e && metadataHash !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
      try {
        const envelopeBytes = b64urlDecode(e);
        const calcHash = await sha256hex(envelopeBytes);
        if (calcHash === metadataHash) {
          const envStr = new TextDecoder().decode(envelopeBytes);
          const env = Envelope.parse(JSON.parse(envStr));
          if (env.visibility !== "dark") {
            title = `✋ ${env.preview.title}`;
            if (env.preview.teaser) {
              desc = `${env.preview.teaser} · ${desc}`;
            }
          }
        }
      } catch (err) {
        console.error("[SSR] Envelope validation failed, falling back to generic:", err);
      }
    }

    return { id: params.id, title, desc, e };
  },
  meta: ({ loaderData }) => {
    if (!loaderData) return [];
    
    const origin = typeof window !== "undefined" ? window.location.origin : "https://welcome-primate-specially.ngrok-free.app";
    const ogImageUrl = loaderData.e 
       ? `${origin}/api/og/${loaderData.id}.png?e=${loaderData.e}` 
       : `${origin}/api/og/${loaderData.id}.png`;

    return [
      { title: loaderData.title },
      { property: "og:title", content: loaderData.title },
      { property: "og:description", content: loaderData.desc },
      { property: "og:image", content: ogImageUrl },
    ];
  },
  component: HandComponent,
});


function HandComponent() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const { address } = useAccount();

  // /h/$id/thank is a generated child of this route; hand over to it.
  // (Pre-existing PoC bug: no Outlet meant the thank page never rendered —
  // see DEVIATIONS.md.)
  const isChildRoute = useRouterState({
    select: (s) => s.matches.some((m) => m.routeId === "/h/$id/thank"),
  });

  const { handRaw, isError, isLoading, payload, tampered, errorMsg, fullMetadata, hasFragment } =
    useHandView(id, { disabled: isChildRoute });

  const [showPassOn, setShowPassOn] = useState(false);
  const [showSolve, setShowSolve] = useState(false);

  if (isChildRoute) return <Outlet />;

  // ── Render ──

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="ah-label">{t("finding the hand…")}</p>
      </div>
    );
  }
  if (isError || !handRaw) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3">
        <h1 className="font-extrabold" style={{ fontSize: "var(--fs-title-m-sm)", letterSpacing: "-0.025em" }}>
          {t("No hand here.")}
        </h1>
        <p className="text-[15px] text-ink/60">{t("Check the link — it doesn't point to a raised hand.")}</p>
      </div>
    );
  }

  const [raiser, , remainingReward, , charityFeeBps, , minSolverClaimBps, status] = handRaw as any[];

  const isHandActive = status === 1;
  const potAmount = Number(formatUnits(remainingReward, 6));
  const charityAmount = (potAmount * Number(charityFeeBps)) / 10000;
  const netAmount = potAmount - charityAmount;
  const solverMin = (netAmount * Number(minSolverClaimBps)) / 10000;
  const charityPct = (Number(charityFeeBps) / 100).toFixed(0);
  const hops: any[] = payload?.shakes ?? [];
  // Word of mouth, not hex: people show as warm roles, never 0x… addresses.
  // No name field travels in the protocol (see DEVIATIONS.md), so the honest
  // warm label is the relationship. The real payout targets still live in
  // payload.shakes and drive every flow — this is display only.
  const railNodes = [
    t("who asked"),
    ...hops.map(() => t("a friend")),
  ];
  const actionsDisabled = tampered || !payload;
  const statusLabel = status === 2 ? t("accepted") : status === 3 ? t("reclaimed") : null;
  const statusEmoji = status === 2 ? "🙏" : status === 3 ? "👎" : null;

  const metaLine = (
    <p className="ah-label">
      {hops.length === 0
        ? t("straight from whoever raised it")
        : t("passed through {n} hands to reach you", { n: hops.length })}
    </p>
  );

  const failureBanner = tampered && (
    <div className="ah-alert" role="alert">
      <p className="ah-alert__label">
        <Emoji>⚠️</Emoji> {t("doesn't add up")}
      </p>
      <p className="ah-alert__text">{errorMsg}</p>
      <p className="ah-alert__text" style={{ color: "var(--paper-a75)" }}>
        {t("Passing on and helping are switched off for this link.")}
      </p>
    </div>
  );

  const lockedCard = !tampered && !fullMetadata && hasFragment === false && (
    <div className="ah-card p-5">
      <p className="font-extrabold flex items-center gap-2" style={{ fontSize: "var(--fs-card-title-sm)", letterSpacing: "-0.015em" }}>
        <Emoji size={20}>🔒</Emoji> {t("This link is missing its key.")}
      </p>
      <p className="mt-2 text-[13.5px] leading-[1.45] text-ink/60">
        {t("Ask for the full link — the part after # — to see the hand and I can ask.")}
      </p>
    </div>
  );

  const potBlock = (
    <>
      <div className="flex items-end justify-between">
        <span
          className="font-extrabold"
          style={{ fontSize: 46, lineHeight: 1, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}
        >
          {formatUsd(potAmount)}
        </span>
        <span
          className="ah-label text-right"
          style={{ fontSize: 13, lineHeight: 1.45, color: "var(--ink-a60)" }}
        >
          {t("in the pot")}
          <br />
          {t("final helper keeps at least {amount}", { amount: formatUsd(solverMin) })}
        </span>
      </div>
      <PotBar
        className="mt-3"
        progress={Number(minSolverClaimBps) / 10000}
        label={`${formatUsd(potAmount)} ${t("in the pot")}`}
      />
    </>
  );

  const actions = isHandActive && !showPassOn && !showSolve && (
    <div className="flex flex-col gap-3.5">
      <SwipeButton gesture="shake" variant="ink" disabled={actionsDisabled} onClick={() => setShowPassOn(true)}>
        {t("I can ask")}
      </SwipeButton>
      <SwipeButton gesture="cheer" variant="amber" disabled={actionsDisabled} onClick={() => setShowSolve(true)}>
        {t("I can help")}
      </SwipeButton>
    </div>
  );

  const statusChip = statusLabel && (
    <span
      className="ah-meta inline-flex items-center gap-1.5 self-start"
      style={{
        border: "var(--bw-emph) solid var(--ink)",
        borderRadius: "var(--r-chip-lg)",
        padding: "5px 10px",
        color: "var(--ink)",
        fontWeight: "var(--fw-bold)" as any,
      }}
    >
      {statusEmoji && <Emoji size={13}>{statusEmoji}</Emoji>}
      {statusLabel}
    </span>
  );

  const footerMeta = (
    <MetaLine
      dim
      className="text-center"
      text={t("held safe · paid when accepted · {pct}% to charity", { pct: charityPct })}
    />
  );

  return (
    <div className="ah-page">
      {/* Mobile: single column · Desktop: 1fr/400px grid (mock 12) */}
      <div className="flex flex-col flex-1 px-6 pt-6 pb-6 lg:grid lg:grid-cols-[1fr_400px] lg:gap-14 lg:items-start lg:px-10 lg:pt-11 lg:pb-13 lg:max-w-[1280px] lg:mx-auto lg:w-full">
        {/* Content column */}
        <div className="flex flex-col">
          {failureBanner}
          {statusChip && <div className="mb-4">{statusChip}</div>}
          {!tampered && fullMetadata && (
            <>
              <h1
                className="mt-1 font-extrabold lg:mt-4"
                style={{ fontSize: "clamp(29px, 4vw, 44px)", lineHeight: 1.08, letterSpacing: "-0.025em", textWrap: "balance", maxWidth: "18ch" }}
              >
                {fullMetadata.title}
              </h1>
              {fullMetadata.description && (
                <p className="mt-3 lg:mt-4 text-[15px] lg:text-[16.5px] leading-[1.55] text-ink/70 whitespace-pre-wrap max-w-[52ch]">
                  {fullMetadata.description}
                </p>
              )}
            </>
          )}
          {lockedCard}
          <div className="mt-5 lg:mt-6">{metaLine}</div>

          {/* Mobile-only: pot + actions inline */}
          <div className="lg:hidden mt-5 flex flex-col flex-1">
            {potBlock}
            <div aria-hidden="true" className="flex-1 min-h-5 max-h-24" />
            <div className="pt-4">{actions}</div>
            <div className="mt-3.5 pb-1">{footerMeta}</div>
          </div>
        </div>

        {/* Desktop action card (mock 12) */}
        <aside className="hidden lg:block ah-card ah-card--lg p-[26px] pb-[22px]">
          {potBlock}
          <div className="mt-5">{actions}</div>
          {payload && railNodes.length > 0 && (
            <ChainRail className="mt-4.5" nodes={railNodes} youLabel={t("you")} />
          )}
          <div className="mt-4 pt-3.5 border-t border-(--ink-a08)">{footerMeta}</div>
        </aside>
      </div>

      {showSolve && (
        <HelpSheet
          id={id}
          payload={payload}
          tampered={tampered}
          railNodes={railNodes}
          solverMinLabel={formatUsd(solverMin)}
          raiser={raiser}
          onClose={() => setShowSolve(false)}
        />
      )}
      {showPassOn && (
        <PassOnSheet
          id={id}
          payload={payload}
          tampered={tampered}
          handRaw={handRaw}
          searchE={(search as any).e}
          title={fullMetadata?.title ?? t("aHand #{id}", { id })}
          potLabel={formatUsd(potAmount)}
          meta={metaLine}
          onClose={() => setShowPassOn(false)}
        />
      )}
    </div>
  );
}

/** Share choice (#8): passing it all on is the default, and the whole cut is
 *  tucked behind a soft optional line — the kind act leads, economics follow. */
function ShareChoice({
  marginPct,
  setMarginPct,
  maxAvailablePct,
  rewardAmount,
}: {
  marginPct: number;
  setMarginPct: (n: number) => void;
  maxAvailablePct: number;
  rewardAmount: number;
}) {
  const [open, setOpen] = useState(marginPct > 0);
  const marginAmount = (rewardAmount * marginPct) / 100;
  
  return (
    <div className="mt-5">
      {open ? (
        <div className="ah-panel flex flex-col gap-2">
          <div>
            <p className="ah-label">{t("keep a thank-you of")}</p>
            <div className="flex items-baseline justify-between gap-3 mt-1.5">
              <span
                className="font-extrabold"
                style={{ fontSize: "var(--fs-title-m-sm)", lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}
              >
                {formatUsd(marginAmount)}
              </span>
              <span
                style={{ fontFamily: "var(--font-meta)", fontSize: "var(--fs-mono-md)", color: "var(--ink-a55)", fontVariantNumeric: "tabular-nums" }}
              >
                {marginPct}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={maxAvailablePct}
              step={1}
              value={marginPct}
              onChange={(e) => setMarginPct(Number(e.target.value))}
              className="ah-slider mt-2"
              style={
                {
                  "--slider-fill": `calc(${(
                    marginPct / (maxAvailablePct || 1)
                  ).toFixed(4)} * (100% - 24px) + 12px)`,
                } as React.CSSProperties
              }
              aria-label={t("keep a thank-you for yourself")}
            />
            <p className="text-[13px] leading-[1.4] text-ink/50 mt-1.5">
              {t("If it's accepted through you, you can keep a small thank-you — or shake it all on.")}
            </p>
          </div>
        </div>
      ) : (
        <button type="button" className="ah-disclose mt-1.5" aria-expanded={false} onClick={() => setOpen(true)}>
          ▸ {t("keep a thank-you for yourself?")}
        </button>
      )}
    </div>
  );
}

function PayoutField({ value, valid, onChange }: { value: string; valid: boolean; onChange: (v: string) => void }) {
  const [edit, setEdit] = useState(false);
  if (!edit) {
    return (
      <div
        className="ah-card mt-2 flex items-center justify-between gap-3"
        style={{ borderRadius: "var(--r-btn)", padding: "12px 14px" }}
      >
        <span className="ah-label flex items-center gap-2">
          <Emoji size={15}>{POCKET_EMOJI}</Emoji> {t("lands in your pocket")}
        </span>
        <button
          type="button"
          className="ah-label ah-label--dim underline underline-offset-2"
          onClick={() => setEdit(true)}
        >
          {t("change")}
        </button>
      </div>
    );
  }
  return (
    <input
      type="text"
      className="ah-input mt-2"
      style={{ fontFamily: "var(--font-meta)", fontSize: 14, padding: "13px 14px" }}
      value={value}
      onChange={(e) => onChange(e.target.value.trim())}
      placeholder="0x…"
      aria-label={t("where your thanks lands")}
      aria-invalid={!!value && !valid}
      autoFocus
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="none"
    />
  );
}

function PassOnSheet(props: {
  id: string;
  payload: any;
  tampered: boolean;
  handRaw: unknown;
  searchE?: string;
  title: string;
  potLabel: string;
  meta: React.ReactNode;
  onClose: () => void;
}) {
  const { address } = useAccount();
  const { login } = usePrivy();
  const flow = usePassOnFlow({
    active: true,
    id: props.id,
    payload: props.payload,
    tampered: props.tampered,
    handRaw: props.handRaw,
    searchE: props.searchE,
  });
  const [copied, setCopied] = useState(false);
  const [ctaCopied, setCtaCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const maxAvailablePct = useMemo(() => {
    if (!props.payload) return 100;
    const currentParentClaim = props.payload.shakes.length === 0
      ? 10000
      : props.payload.shakes[props.payload.shakes.length - 1].shake.childClaimBps;
    return currentParentClaim / 100;
  }, [props.payload]);

  const rewardAmount = useMemo(() => {
    if (!props.handRaw) return 0;
    const [,, remainingReward] = props.handRaw as any[];
    return Number(formatUnits(remainingReward, 6));
  }, [props.handRaw]);

  // Prefill with the connected address (PoC behavior), still editable.
  useEffect(() => {
    if (address && !flow.payoutAddr) flow.setPayoutAddr(address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const copy = async () => {
    if (!flow.newShareUrl) return;
    try {
      await navigator.clipboard.writeText(flow.newShareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* no false "copied" */
    }
  };

  const send = async () => {
    if (!flow.newShareUrl) return;
    if (canShare) {
      try {
        await navigator.share({ url: flow.newShareUrl });
      } catch {
        /* dismissed the share sheet */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(flow.newShareUrl);
      setCtaCopied(true);
      setTimeout(() => setCtaCopied(false), 2000);
    } catch {
      /* no false "copied" */
    }
  };

  return (
    <Sheet label={t("I can ask")} onClose={props.onClose}>
      {/* Hand summary card (mock 05/14) */}
      <div
        className="ah-card mt-4 flex items-center justify-between gap-3"
        style={{ borderRadius: "var(--r-btn)", padding: "14px 16px" }}
      >
        <span
          className="font-extrabold flex items-center gap-2 min-w-0"
          style={{ fontSize: 16, letterSpacing: "-0.015em" }}
        >
          <Emoji size={19}>✋</Emoji>
          <span className="truncate">{props.title}</span>
        </span>
        <span style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
          {props.potLabel}
        </span>
      </div>
      <div className="mt-2 md:hidden">{props.meta}</div>

      {/* Where the thanks lands (#6): a newcomer never faces a raw 0x field.
          Connected → the pocket fills it; the hex hides behind "change". */}
      <p className="ah-label mt-5">{t("where your thanks lands")}</p>
      {address ? (
        <PayoutField
          value={flow.payoutAddr}
          valid={flow.payoutValid}
          onChange={(v) => flow.setPayoutAddr(v)}
        />
      ) : (
        <p className="ah-label ah-label--dim mt-2">
          {t("Connect a pocket below — your thanks lands there, nothing to paste.")}
        </p>
      )}
      <p className="ah-label ah-label--dim mt-1.5">
        {t("even if you pass it all on, a thank-you would reach you here")}
      </p>

      {/* Your share (#8): lead with the act, tuck the cut. Default is pass it
          all on; the chips only appear if they want to keep a thank-you. */}
      <ShareChoice
        marginPct={flow.marginPct}
        setMarginPct={flow.setMarginPct}
        maxAvailablePct={maxAvailablePct}
        rewardAmount={rewardAmount}
      />

      {flow.error && (
        <div className="ah-alert mt-3.5" role="alert">
          <p className="ah-alert__text">{flow.error}</p>
        </div>
      )}

      {/* Copy row — full real link, middle-ellipsis display (no shortlinks) */}
      {flow.newShareUrl && (
        <button type="button" className="ah-linkrow mt-4" onClick={copy}>
          <span className="ah-linkrow__value">{truncateMiddle(flow.newShareUrl, 26, 8)}</span>
          <span className="ah-linkrow__action">{copied ? t("copied") : t("copy")}</span>
        </button>
      )}

      <div aria-hidden="true" className="flex-1 min-h-5 max-h-24" />
      <div className="md:mt-6 flex flex-col gap-3.5 md:flex-row md:items-center md:justify-between md:gap-4">
        <MetaLine
          dim
          className="order-2 md:order-1 text-center md:text-left"
          style={{ fontSize: "var(--fs-mono-xs)" }}
          text={
            !address
              ? t("your pocket is where thanks lands — connect it to send")
              : flow.newShareUrl
                ? t("every pass is remembered · thanks follows the hand")
                : t("add an address and the link appears")
          }
        />
        <SwipeButton
          gesture="shake"
          variant="ink"
          disabled={address ? !flow.newShareUrl : false}
          onClick={address ? send : () => login()}
          className="order-1 md:order-2 md:min-w-[280px] whitespace-nowrap"
        >
          {!address
            ? t("Connect a pocket & send")
            : ctaCopied
              ? t("Copied")
              : canShare
                ? t("Send the hand")
                : t("Copy the link")}
        </SwipeButton>
      </div>
    </Sheet>
  );
}

function HelpSheet(props: {
  id: string;
  payload: any;
  tampered: boolean;
  railNodes: string[];
  solverMinLabel: string;
  raiser: string;
  onClose: () => void;
}) {
  const { address } = useAccount();
  const { login } = usePrivy();
  const flow = useSolveFlow({
    active: true,
    id: props.id,
    payload: props.payload,
    tampered: props.tampered,
  });
  const delivery = useGiveDelivery({
    raiser: props.raiser,
    solveUrl: flow.solveUrl,
    solutionText: flow.solutionText,
  });
  const [copied, setCopied] = useState(false);
  const [ctaCopied, setCtaCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  /* The raiser takes replies directly — the swipe delivers, the link stays as a spare. */
  const direct = Boolean(address) && delivery.canSendDirect;

  // Prefill with the connected address (PoC behavior), still editable.
  useEffect(() => {
    if (address && !flow.solverAddr) flow.setSolverAddr(address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const copy = async () => {
    if (!flow.solveUrl) return;
    try {
      await navigator.clipboard.writeText(flow.solveUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* no false "copied" */
    }
  };

  const send = async () => {
    if (!flow.solveUrl) return;
    if (canShare) {
      try {
        await navigator.share({ url: flow.solveUrl });
      } catch {
        /* dismissed the share sheet */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(flow.solveUrl);
      setCtaCopied(true);
      setTimeout(() => setCtaCopied(false), 2000);
    } catch {
      /* no false "copied" */
    }
  };

  const hopsFromRaiser = props.railNodes.length; // raiser + passers → you

  return (
    <Sheet label={t("i can help")} onClose={props.onClose}>
      <h2
        className="mt-3 font-extrabold"
        style={{ fontSize: "var(--fs-title-m-sm)", lineHeight: 1.1, letterSpacing: "-0.025em" }}
      >
        {t("Tell them you're on it.")}
      </h2>

      <ChainRail className="mt-4.5" nodes={props.railNodes} youLabel={t("you")} />
      <p className="mt-1.5 text-[12.5px] text-ink/50">
        {hopsFromRaiser <= 1
          ? t("You came straight from the raiser.")
          : t("You're {n} hands from the raiser.", { n: hopsFromRaiser })}
      </p>

      <p className="ah-label mt-5">{t("what you can do")}</p>
      <textarea
        className="ah-input mt-2.5"
        style={{ minHeight: 110 }}
        value={flow.solutionText}
        onChange={(e) => flow.setSolutionText(e.target.value)}
        placeholder={t("What can you do for them? Plain words, links welcome.")}
        aria-label={t("what you can do")}
      />

      <p className="ah-label mt-4.5">{t("where your thanks lands")}</p>
      {address ? (
        <PayoutField
          value={flow.solverAddr}
          valid={flow.solverValid}
          onChange={(v) => flow.setSolverAddr(v)}
        />
      ) : (
        <p className="ah-label ah-label--dim mt-2">
          {t("Connect a pocket below — your thanks lands there, nothing to paste.")}
        </p>
      )}

      {flow.error && (
        <div className="ah-alert mt-3.5" role="alert">
          <p className="ah-alert__text">{flow.error}</p>
        </div>
      )}

      {flow.solveUrl && (
        <>
          <button type="button" className="ah-linkrow mt-4" onClick={copy}>
            <span className="ah-linkrow__value">{truncateMiddle(flow.solveUrl, 26, 8)}</span>
            <span className="ah-linkrow__action">{copied ? t("copied") : t("copy")}</span>
          </button>
          <p className="ah-label ah-label--dim mt-2">
            {delivery.phase === "sent"
              ? t("Delivered. The link above is your copy, just in case.")
              : delivery.phase === "failed"
                ? delivery.failure === "busy"
                  ? t("your messages are open in another tab — close it there first")
                  : t("Couldn't reach them directly — send the link yourself.")
                : direct
                  ? t("They take replies right in their pocket — swipe below and it's there.")
                  : t("Send your reply back to whoever asked — they'll say thanks if it helps.")}
          </p>
          {direct && delivery.phase !== "sent" && delivery.phase !== "sending" && (
            <QuietButton compact className="mt-2.5 self-start" onClick={send}>
              {ctaCopied ? t("Copied") : t("or send the link yourself")}
            </QuietButton>
          )}
        </>
      )}

      <div aria-hidden="true" className="flex-1 min-h-5 max-h-24" />
      <div className="md:mt-6 flex flex-col gap-3.5 md:flex-row md:items-center md:justify-between md:gap-4">
        <MetaLine
          dim
          className="order-2 md:order-1 text-center md:text-left"
          style={{ fontSize: "var(--fs-mono-xs)" }}
          text={
            !address
              ? t("your pocket is where thanks lands — connect it to reply")
              : delivery.phase === "sent"
                ? t("delivered · they'll say thanks if it helps")
                : flow.solveUrl
                  ? t("if accepted, you keep at least {amount}", { amount: props.solverMinLabel })
                  : t("Write what you can do, and it goes straight back to them.")
          }
        />
        <SwipeButton
          gesture="cheer"
          variant="amber"
          disabled={address ? !flow.solveUrl || delivery.phase === "sending" : false}
          onClick={
            !address
              ? () => login()
              : direct
                ? delivery.phase === "sent"
                  ? props.onClose
                  : () => void delivery.sendDirect()
                : send
          }
          className="order-1 md:order-2 md:min-w-[240px] whitespace-nowrap"
        >
          {!address
            ? t("Connect a pocket & reply")
            : direct
              ? delivery.phase === "sending"
                ? t("sending…")
                : delivery.phase === "sent"
                  ? t("Done")
                  : t("Send it straight to them")
              : ctaCopied
                ? t("Copied")
                : canShare
                  ? t("Tell them I'm on it")
                  : t("Copy the link")}
        </SwipeButton>
      </div>
    </Sheet>
  );
}
