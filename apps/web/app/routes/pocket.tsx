import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useDisconnect } from "wagmi";
import { usePocket, type PocketReceipt } from "../hooks/usePocket";
import { DirectDeliveryCard } from "../components/DirectDeliveryCard";
import { GiveInbox } from "../components/GiveInbox";
import { OnboardingSheet } from "../components/OnboardingSheet";
import { DevFaucet } from "../components/DevFaucet";
import { SwipeButton } from "../components/SwipeButton";
import { QuietButton } from "../components/QuietButton";
import { Logo } from "../components/Logo";
import { Emoji } from "../components/Emoji";
import { POCKET_EMOJI } from "../styles/tokens";
import { formatUsd, formatUsdCents } from "../lib/format";
import { t } from "../i18n";

export const Route = createFileRoute("/pocket")({
  component: PocketComponent,
});

const KIND_EMOJI: Record<PocketReceipt["kind"], string> = {
  solved: "🙌",
  passed: "🤝",
  raised: "✋",
  thanked: "🙏",
};

function kindLabel(r: PocketReceipt): string {
  switch (r.kind) {
    case "solved":
      return t("Accepted hand #{id}", { id: r.handId });
    case "passed":
      return t("Shaked hand #{id} on", { id: r.handId });
    case "raised":
      return t("Raised hand #{id}", { id: r.handId });
    case "thanked":
      return t("Thanked the chain — hand #{id}", { id: r.handId });
  }
}

/** Held (an open raise, comes back if unsolved) vs paid out vs received —
 *  the minus sign is reserved for money that has truly left (#13). */
function receiptNote(r: PocketReceipt): string {
  switch (r.kind) {
    case "raised":
      return t("held · returns if no Give is accepted");
    case "thanked":
      return t("paid out to everyone");
    case "solved":
      return t("your thanks for giving");
    case "passed":
      return t("your thanks for shaking");
  }
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function PocketComponent() {
  const navigate = useNavigate();
  const pocket = usePocket();
  const { login, logout, authenticated } = usePrivy();
  const { mutate: disconnect } = useDisconnect();

  // A wallet can be connected in wagmi without a live Privy session (e.g. an
  // injected wallet auto-reconnected after the session expired). Disconnect
  // must clear BOTH; calling Privy's logout without a session just 400s.
  const handleDisconnect = () => {
    disconnect();
    if (authenticated) void logout().catch(() => {});
  };

  // Same mounted-guard as AccountButton: the server always renders the
  // disconnected shell, but a restored Privy session can connect wagmi on
  // the FIRST client render — a structural mismatch here aborts hydration
  // and leaves the whole page with dead event handlers.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="ah-page">
      {!mounted || !pocket.isConnected ? (
        /* A welcome, not a redacted ledger. */
        <div className="flex flex-col flex-1 items-center justify-center text-center px-6 pb-16">
          <Emoji size={64}>{POCKET_EMOJI}</Emoji>
          <h1
            className="mt-4 font-extrabold"
            style={{ fontSize: "var(--fs-title-m-sm)", lineHeight: 1.06, letterSpacing: "-0.025em", textWrap: "balance", maxWidth: "16ch" }}
          >
            {t("Your pocket isn't connected yet.")}
          </h1>
          <p className="mt-3 text-[15px] leading-[1.5] text-ink/60 max-w-[34ch]">
            {t("You'll need a pocket — a safe place to hold the thanks you give and get.")}
          </p>
          <QuietButton className="mt-7 min-w-[200px]" onClick={() => login()}>
            {t("Connect")}
          </QuietButton>
        </div>
      ) : (
        <div className="flex flex-col flex-1 w-full px-6 pt-6 pb-6 lg:grid lg:grid-cols-[400px_1fr] lg:gap-14 lg:items-start lg:px-10 lg:pt-11 lg:pb-16 lg:max-w-[1280px] lg:mx-auto">
          {/* Balance card */}
          <div className="ah-pocket-card">
            <div className="flex justify-between items-baseline mb-3">
              <p className="ah-label ah-label--dim">
                {t("your pocket")}
              </p>
              <button
                type="button"
                className="text-[12px] font-bold text-ink/40 hover:text-ink cursor-pointer bg-transparent border-0 p-0"
                onClick={handleDisconnect}
              >
                {t("Disconnect")}
              </button>
            </div>
            <div className="flex items-end justify-between gap-3">
              <span
                className="font-extrabold break-all"
                style={{ fontSize: "clamp(30px, 3.5vw, 44px)", lineHeight: 1, letterSpacing: "-0.035em", fontVariantNumeric: "tabular-nums" }}
              >
                {pocket.balance !== null ? formatUsd(pocket.balance) : "—"}
              </span>
              <span
                className="flex items-center gap-1.5"
                style={{
                  fontFamily: "var(--font-meta)",
                  fontSize: "var(--fs-body-sm)",
                  fontWeight: "var(--fw-medium)" as any,
                  border: "var(--bw-emph) solid var(--ink)",
                  background: "var(--card)",
                  borderRadius: "var(--r-chip-lg)",
                  padding: "6px 12px",
                }}
              >
                <Emoji size={15}>👍</Emoji>
                {pocket.thanksCount}
              </span>
            </div>
            <p className="ah-label ah-label--dim mt-2">
              {t("yours to keep · {n} good turns so far", { n: pocket.thanksCount })}
            </p>
            <DevFaucet />

            {/* CTA row (desktop keeps it in the card; mobile pins to bottom) */}
            <div className="hidden lg:flex mt-6 gap-2.5 items-center">
              <QuietButton disabled className="ah-quiet--soon">
                {t("Take out")}
                <span className="ah-soon__chip">{t("soon")}</span>
              </QuietButton>
              <SwipeButton
                gesture="raise"
                variant="ink"
                className="flex-1 whitespace-nowrap"
                style={{ padding: "0 80px 0 20px", fontSize: 15.5 }}
                onClick={() => navigate({ to: "/raise" })}
              >
                {t("Raise a hand")}
              </SwipeButton>
            </div>
          </div>

          {/* Receipts — a paper receipt is narrow */}
          <div className="mt-5 lg:mt-0 flex flex-col flex-1 lg:max-w-[600px]">
            <DirectDeliveryCard className="mb-5" />
            <GiveInbox className="mb-5" />
            <div style={{ borderTop: "var(--bw-emph) solid var(--ink)" }}>
              {pocket.receipts === null ? (
                <p className="ah-label py-4">{t("reading your receipts…")}</p>
              ) : pocket.receipts.length === 0 ? (
                <p className="ah-label py-4">{t("nothing here yet — pass a hand on or raise one")}</p>
              ) : (
                pocket.receipts.map((r) => (
                  <div
                    key={r.key}
                    className="flex items-center justify-between py-[13px]"
                    style={{ borderBottom: "var(--bw-hair) solid var(--ink-a10)" }}
                  >
                    <div>
                      <p className="font-bold" style={{ fontSize: 14.5 }}>
                        <Emoji>{KIND_EMOJI[r.kind]}</Emoji> {kindLabel(r)}
                      </p>
                      <p className="ah-label ah-label--dim mt-[3px]" style={{ fontSize: 12 }}>
                        <span className="ah-meta" style={{ fontSize: "var(--fs-mono-xs)" }}>
                          {r.timestamp ? dateFmt.format(r.timestamp) : "—"}
                        </span>
                        {" · "}
                        {receiptNote(r)}
                      </p>
                    </div>
                    <span
                      className="font-extrabold shrink-0 pl-3"
                      style={{
                        fontSize: 15,
                        fontVariantNumeric: "tabular-nums",
                        color:
                          r.kind === "raised"
                            ? "var(--ink-a45)"
                            : r.kind === "thanked"
                              ? "var(--ink-a60)"
                              : "var(--ink)",
                      }}
                    >
                      {r.kind === "raised" ? "" : r.kind === "thanked" ? "−" : "+"}
                      {formatUsdCents(Math.abs(r.amount))}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Mobile CTA row */}
            <div aria-hidden="true" className="lg:hidden flex-1 min-h-5 max-h-24" />
            <div className="lg:hidden pt-2 flex gap-2.5 items-center">
              <QuietButton disabled className="ah-quiet--soon">
                {t("Take out")}
                <span className="ah-soon__chip">{t("soon")}</span>
              </QuietButton>
              <SwipeButton
                gesture="raise"
                variant="ink"
                className="flex-1 whitespace-nowrap"
                style={{ padding: "0 80px 0 20px", fontSize: 15.5 }}
                onClick={() => navigate({ to: "/raise" })}
              >
                {t("Raise a hand")}
              </SwipeButton>
            </div>
            <p className="ah-label ah-label--dim mt-3.5 pb-4 text-center lg:text-left">
              {t("thanks looks best paid forward")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
