import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRaiseFlow, type Visibility } from "../hooks/useRaiseFlow";
import { SwipeButton } from "../components/SwipeButton";
import { QuietButton } from "../components/QuietButton";
import { ChipRow } from "../components/ChipRow";
import { CharityBpsPicker } from "../components/CharityBpsPicker";
import { DirectDeliveryCard } from "../components/DirectDeliveryCard";
import { Emoji } from "../components/Emoji";
import { QrCode } from "../components/QrCode";
import { MetaLine } from "../components/MetaLine";
import { formatUsd, formatDateHuman, truncateMiddle } from "../lib/format";
import { t } from "../i18n";

export const Route = createFileRoute("/raise")({
  component: RaiseComponent,
});

const PRESETS = ["25", "50", "150"];
const HOPS_WARNING_THRESHOLD = 8;
const SLIDER_MIN = 20;
const SLIDER_MAX = 90;

function RaiseComponent() {
  const navigate = useNavigate();
  const flow = useRaiseFlow();
  const { login } = usePrivy();
  const [customAmount, setCustomAmount] = useState(!PRESETS.includes(flow.reward));
  const composeRef = useRef<HTMLTextAreaElement>(null);

  // Current theme, kept live across ThemeToggle flips — the OG preview (and
  // the share link) follow the raiser's theme.
  const [darkTheme, setDarkTheme] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () =>
      setDarkTheme(
        (root.dataset.theme ??
          (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) ===
          "dark",
      );
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  // esc leaves only when there's nothing to lose: an untouched compose, and
  // never from the success screen (that link is the hand).
  const escSafe = !flow.description.trim() && !flow.shareUrl;
  useEffect(() => {
    if (!escSafe) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate({ to: "/" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, escSafe]);

  // auto-grow the compose surface
  const autoGrow = () => {
    const el = composeRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(autoGrow, [flow.description]);

  if (flow.shareUrl) {
    return <RaiseSuccess shareUrl={flow.shareUrl} hops={flow.draft?.hops} />;
  }

  const rewardNum = Number(flow.reward);
  const rewardDisplay = Number.isFinite(rewardNum) && rewardNum > 0 ? rewardNum : 0;
  const humanExpiry = formatDateHuman(Date.now() + flow.expiryDays * 24 * 60 * 60 * 1000);

  const ogMeta = t("aHand · {amount} secured", { amount: formatUsd(rewardDisplay) });

  const ogTitle =
    flow.visibility === "dark" || !flow.draft
      ? t("What are you looking for?")
      : flow.draft.title;

  const ogDesc =
    flow.visibility === "dark" || !flow.draft
      ? t("Paid when accepted · open until {date}", { date: humanExpiry })
      : t("{giverKeep}+ to the final helper · successful Shakes share the rest · open until {date}", {
          giverKeep: formatUsd(flow.giverKeepAmount),
          date: humanExpiry,
        });

  const visibilityCaption: Record<Visibility, string> = {
    public: t("Listed in Open Hands. Anyone can open and share it. The title goes out for good — indexers keep copies."),
    preview: t("Not listed. Anyone with the link can open and share it. The title still travels publicly — indexers keep copies."),
    dark: t("Not listed. Link-only, no preview."),
  };

  const hops = flow.draft?.hops;
  const hopsWarning = hops !== undefined && hops < HOPS_WARNING_THRESHOLD;
  const descriptionBytes = new TextEncoder().encode(flow.description).length;

  // Lives inside fine-tune, next to the "who can see it" control. Framed in
  // plain words + styled like a real chat unfurl. Link-length hint only when
  // it matters.
  const previewBlock = (
    <div aria-live="polite">
      <p className="ah-label ah-label--dim">{t("what your people see when they get the link")}</p>
      <div className="ah-ogcard mt-2">
        {/* The REAL card image — same renderer scrapers hit, fed the draft
            discovery doc. Dark mode naturally yields the generic card. */}
        {flow.draft && flow.visibility !== "dark" && (
          <img
            src={`/api/og/draft.png?e=${encodeURIComponent(flow.draft.discoveryB64)}${darkTheme ? "&th=d" : ""}`}
            alt={t("link preview card")}
            width={1200}
            height={630}
            style={{
              width: "100%",
              height: "auto",
              borderRadius: "8px",
              border: "var(--bw-hair) solid var(--ink-a10)",
              marginBottom: "10px",
            }}
          />
        )}
        <p className="ah-meta" style={{ fontSize: "var(--fs-mono-xs)", color: "var(--ink-a45)" }}>
          {ogMeta}
        </p>
        <p className="ah-ogcard__title mt-1">{ogTitle}</p>
        {flow.visibility !== "dark" && flow.draft?.teaser && (
          <p className="ah-ogcard__desc mt-1.5" style={{ color: "var(--ink-a75)" }}>
            {flow.draft.teaser}
          </p>
        )}
        <p className="ah-ogcard__desc mt-1" style={{ fontSize: "12.5px", color: "var(--ink-a45)" }}>
          {ogDesc}
        </p>
      </div>
      {(flow.draftOverflow || hopsWarning) && (
        <p
          className="mt-2 text-[13px] leading-[1.4]"
          style={{ color: "var(--ink)", fontWeight: "var(--fw-semibold)" as any }}
        >
          <Emoji>⚠️</Emoji>{" "}
          {flow.draftOverflow
            ? t("too long for one link — trim it a little")
            : t("the link's getting long — room for about {hops} more shares", { hops })}
        </p>
      )}
    </div>
  );

  return (
    <div className="ah-page">
      {/* Focus column */}
      <form
        className="flex flex-col flex-1 w-full px-6 pt-6 pb-6 lg:max-w-[640px] lg:mx-auto lg:pt-11 lg:pb-16"
        onSubmit={(e) => {
          e.preventDefault();
          if (!flow.isConnected && flow.description.trim()) {
            login();
            return;
          }
          flow.handleRaise();
        }}
      >
        <span className="ah-label">{t("raise a hand")}</span>

        <textarea
          ref={composeRef}
          className="ah-compose mt-4"
          rows={2}
          value={flow.description}
          onChange={(e) => flow.setDescription(e.target.value)}
          placeholder={t("What are you looking for?")}
          autoFocus
        />
        <div className="flex flex-col gap-1 mt-2">
          {!flow.description && (
            <p className="text-[13.5px] leading-relaxed text-ink/40 italic">
              {t("e.g. A Portuguese-speaking Solidity reviewer in Lisbon…")}
            </p>
          )}
          {descriptionBytes > 800 ? (
            <p
              className="ah-meta"
              style={
                flow.draftOverflow
                  ? { color: "var(--ink)", fontWeight: "var(--fw-bold)" as any }
                  : { color: "var(--ink-a45)", letterSpacing: "var(--track-mono-sm)" }
              }
              aria-live="polite"
            >
              {t("{n} / 1000", { n: descriptionBytes })}
            </p>
          ) : (
            <p className="ah-label ah-label--dim">{t("First line becomes the title. Add details below.")}</p>
          )}
        </div>

        {/* Pot amount */}
        <p className="ah-label mt-6.5 lg:mt-9">{t("thanks in the pot")}</p>
        <div className="flex gap-2 lg:gap-2.5 mt-2.5 lg:mt-3 items-center">
          <ChipRow
            options={PRESETS.map((p) => ({ key: p, label: formatUsd(Number(p)) }))}
            selectedKey={customAmount ? undefined : flow.reward}
            onSelect={(key) => {
              setCustomAmount(false);
              flow.setReward(key);
            }}
          />
          {customAmount ? (
            <label className="ah-chip ah-chip--selected ah-chip-field">
              <span aria-hidden="true">$</span>
              <input
                type="number"
                min="1"
                inputMode="decimal"
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                value={flow.reward}
                onChange={(e) => flow.setReward(e.target.value)}
                aria-label={t("your call")}
              />
            </label>
          ) : (
            <button type="button" className="ah-chip ah-chip--dashed" onClick={() => setCustomAmount(true)}>
              {t("your call")}
            </button>
          )}
        </div>

        {/* Fine-tune (holds solver share, timing, visibility + live preview) */}
        <FineTune flow={flow} visibilityCaption={visibilityCaption} preview={previewBlock} />

        {/* CTA */}
        <div className="mt-8 lg:mt-11 flex flex-col gap-3.5 lg:flex-row lg:items-center lg:justify-between lg:gap-5">
          <MetaLine
            dim
            className="order-2 lg:order-1 text-center lg:text-left"
            text={t("{amount} secured · all {refund} back if it expires · {charity} to charity when accepted", {
              amount: formatUsd(rewardDisplay),
              refund: formatUsd(flow.refundAmount),
              charity: formatUsd(flow.charityAmount),
            })}
          />
          <SwipeButton
            gesture="raise"
            variant="ink"
            type="submit"
            disabled={flow.loading}
            aria-busy={flow.loading}
            className="order-1 lg:order-2 lg:min-w-[300px]"
          >
            {flow.loading ? t("Raising…") : t("Raise it")}
          </SwipeButton>
        </div>

        {/* Errors below the CTA so the button never jumps mid-press */}
        {flow.errorMsg && (
          <div className="ah-alert mt-4" role="alert">
            <p className="ah-alert__label">
              <Emoji>⚠️</Emoji> {t("something to fix")}
            </p>
            <p className="ah-alert__text">{flow.errorMsg}</p>
          </div>
        )}
      </form>
    </div>
  );
}

function FineTune({
  flow,
  visibilityCaption,
  preview,
}: {
  flow: ReturnType<typeof useRaiseFlow>;
  visibilityCaption: Record<Visibility, string>;
  preview: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-5">
      <button type="button" className="ah-disclose" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="ah-disclose__toggle">
          {open ? "▾" : "▸"} {t("fine-tune")}
        </span>
        {!open && (
          <span className="ah-disclose__summary">
            {t("most goes to the final helper · open {days} days · {pct2}% to charity", {
              days: flow.expiryDays,
              pct2: flow.charityBps / 100,
            })}
          </span>
        )}
      </button>
      {open && (
        <div className="ah-panel mt-3 flex flex-col gap-6">
          {/* Solver share — the sum is primary (anchored left), % secondary (right) */}
          <div>
            <p className="ah-label">{t("the final helper keeps at least")}</p>
            <div className="flex items-baseline justify-between gap-3 mt-1.5">
              <span
                className="font-extrabold"
                style={{ fontSize: "var(--fs-title-m-sm)", lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}
              >
                {formatUsd(flow.giverKeepAmount)}
              </span>
              <span
                style={{ fontFamily: "var(--font-meta)", fontSize: "var(--fs-mono-md)", color: "var(--ink-a55)", fontVariantNumeric: "tabular-nums" }}
              >
                {flow.giverKeep}%
              </span>
            </div>
            <input
              type="range"
              min={SLIDER_MIN}
              max={SLIDER_MAX}
              step={1}
              value={flow.giverKeep}
              onChange={(e) => flow.setGiverKeep(Number(e.target.value))}
              className="ah-slider mt-2"
              style={
                {
                  "--slider-fill": `calc(${(
                    (flow.giverKeep - SLIDER_MIN) /
                    (SLIDER_MAX - SLIDER_MIN)
                  ).toFixed(4)} * (100% - 24px) + 12px)`,
                } as React.CSSProperties
              }
              aria-label={t("the final helper keeps at least")}
            />
            <p className="text-[13.5px] leading-[1.4] text-ink/50 mt-1.5">
              {t("Up to {amount} can be shared across successful Shakes.", { amount: formatUsd(flow.pathShareAmount) })}
            </p>
          </div>

          {/* Charity share + expiry */}
          <div className="flex flex-col gap-4">
            <div>
              <span className="ah-label">{t("share with charity")}</span>
              <CharityBpsPicker
                className="mt-2"
                valueBps={flow.charityBps}
                onChange={flow.setCharityBps}
              />
            </div>
            <label className="flex items-center gap-2.5">
              <span className="ah-label">{t("keep it open for")}</span>
              <input
                type="number"
                min="1"
                max="180"
                className="ah-chip w-14 text-center"
                value={flow.expiryDays}
                onChange={(e) => flow.setExpiryDays(Number(e.target.value))}
              />
              <span className="ah-label">{t("days")}</span>
            </label>
            <p className="ah-label ah-label--dim w-full" style={{ fontSize: "13.5px" }}>
              {t("If no Give is accepted within {days} days, the whole {refund} returns to you. Charity's {charity} moves only when it works out.", {
                days: flow.expiryDays,
                refund: formatUsd(flow.refundAmount),
                charity: formatUsd(flow.charityAmount),
              })}
            </p>
          </div>

          {/* Visibility + its live preview, grouped */}
          <div>
            <span className="ah-label">{t("who can see it")}</span>
            <ChipRow
              className="mt-2"
              options={[
                { key: "public", label: t("public") },
                { key: "preview", label: t("unlisted") },
                { key: "dark", label: t("private") },
              ]}
              selectedKey={flow.visibility}
              onSelect={(key) => flow.setVisibility(key as Visibility)}
            />
            <p className="text-[13.5px] leading-[1.4] text-ink/50 mt-1.5">
              {visibilityCaption[flow.visibility]}
            </p>
            <div className="mt-4">{preview}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function RaiseSuccess({ shareUrl, hops }: { shareUrl: string; hops?: number }) {
  const navigate = useNavigate();
  const [rowCopied, setRowCopied] = useState(false);
  const [ctaCopied, setCtaCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copyTo = async (setter: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setter(true);
      setTimeout(() => setter(false), 2000);
    } catch {
      /* no false "copied" */
    }
  };

  const send = async () => {
    if (canShare) {
      try {
        await navigator.share({ url: shareUrl });
      } catch {
        /* dismissed */
      }
      return;
    }
    copyTo(setCtaCopied);
  };

  return (
    <div className="ah-page px-6 pt-16 pb-6 lg:max-w-[640px] lg:mx-auto lg:pt-24 w-full">
      <span className="ah-hero ah-hero--raise text-[64px]" aria-hidden="true">
        ✋
      </span>
      <h1
        className="mt-3 font-extrabold"
        style={{ fontSize: "var(--fs-title-m)", lineHeight: 1.05, letterSpacing: "-0.03em" }}
      >
        {t("Your hand is up.")}
      </h1>
      <p className="mt-3 text-[15px] leading-[1.5] text-ink/65">
        {t("Send this link to someone who'd know. Every Shake is remembered.")}
      </p>

      <button type="button" className="ah-linkrow mt-6" onClick={() => copyTo(setRowCopied)}>
        <span className="ah-linkrow__value">{truncateMiddle(shareUrl, 28, 10)}</span>
        <span className="ah-linkrow__action">{rowCopied ? t("copied") : t("copy")}</span>
      </button>

      {/* Same link as a QR — for the friend standing right there. */}
      <QrCode value={shareUrl} className="mt-4 mx-auto w-[176px]" />
      <p className="ah-label ah-label--dim mt-2 text-center">{t("or let them scan it")}</p>

      <DirectDeliveryCard className="mt-4" />

      <div aria-hidden="true" className="flex-1 min-h-5 max-h-24" />
      <div className="flex flex-col gap-3.5 pt-8">
        <SwipeButton gesture="shake" variant="amber" onClick={send}>
          {ctaCopied ? t("Copied") : canShare ? t("Send it on") : t("Copy the link")}
        </SwipeButton>
        <QuietButton onClick={() => navigate({ to: "/" })}>{t("Back home")}</QuietButton>
      </div>
      <p className="ah-label ah-label--dim mt-3.5 pb-4 text-center">
        {t("good travels · it comes back around")}
      </p>
    </div>
  );
}
