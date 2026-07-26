import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useDisconnect } from "wagmi";
import { formatUnits } from "viem";
import { usePocket, type PocketReceipt } from "../hooks/usePocket";
import { DirectDeliveryCard } from "../components/DirectDeliveryCard";
import { GiveInbox } from "../components/GiveInbox";
import { DevFaucet } from "../components/DevFaucet";
import { ClaimsCard } from "../components/ClaimsCard";
import { SwipeButton } from "../components/SwipeButton";
import { QuietButton } from "../components/QuietButton";
import { Emoji } from "../components/Emoji";
import { POCKET_EMOJI } from "../styles/tokens";
import { formatUsd, formatUsdCents } from "../lib/format";
import { t } from "../i18n";

export const Route = createFileRoute("/pocket")({
  component: PocketComponent,
});

const KIND_EMOJI: Record<PocketReceipt["kind"], string> = {
  gave: "🙌",
  passed: "🤝",
  charity: "💛",
  refund: "🫳",
  raised: "✋",
  thanked: "🙏",
  tookOut: "👜",
};

function kindLabel(r: PocketReceipt): string {
  switch (r.kind) {
    case "gave":
      return t("Gave on hand #{id}", { id: r.handId });
    case "passed":
      return t("Passed hand #{id} on", { id: r.handId });
    case "charity":
      return t("Charity share — hand #{id}", { id: r.handId });
    case "refund":
      return t("Pot came back — hand #{id}", { id: r.handId });
    case "raised":
      return t("Raised hand #{id}", { id: r.handId });
    case "thanked":
      return t("Thanked the chain — hand #{id}", { id: r.handId });
    case "tookOut":
      return t("Took thanks out");
  }
}

/** Held (an open raise, comes back if unsolved) vs credited vs paid out —
 *  the minus sign is reserved for money that has truly left. */
function receiptNote(r: PocketReceipt): string {
  switch (r.kind) {
    case "raised":
      return t("held · returns if no Give is accepted");
    case "thanked":
      return t("paid out to everyone");
    case "gave":
      return t("your thanks for giving · claimable");
    case "passed":
      return t("your thanks for passing it on · claimable");
    case "charity":
      return t("set aside for charity · claimable");
    case "refund":
      return t("came back unsolved · claimable");
    case "tookOut":
      return t("moved into your pocket");
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

  const claimable = pocket.claims.claimable;
  const claimableUsd = claimable !== null ? Number(formatUnits(claimable, 6)) : null;

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
          {/* Balance + claims column */}
          <div className="flex flex-col gap-5">
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
              <div className="hidden lg:flex mt-6">
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

            {/* Claimable — what PayoutAllocated set aside for this pocket.
                Nothing waiting → no card; thanks normally lands straight
                in the wallet, so an empty ledger line would only worry. */}
            {claimableUsd !== null && claimableUsd > 0 && (
              <ClaimsCard
                amount={formatUsdCents(claimableUsd)}
                tokenSymbol="USDC"
                loading={pocket.claims.takingOut}
                onTakeOut={() => void pocket.claims.takeOut()}
              />
            )}
            {pocket.claims.error && (
              <div className="ah-alert" role="alert">
                <p className="ah-alert__text">{pocket.claims.error}</p>
              </div>
            )}
          </div>

          {/* Receipts — a paper receipt is narrow */}
          <div className="mt-5 lg:mt-0 flex flex-col flex-1 lg:max-w-[600px]">
            <DirectDeliveryCard className="mb-5" />
            <GiveInbox className="mb-5" />

            {/* Settled hands still owing their Signals receipts — anyone can
                materialize them; this is the polite retry button. */}
            {pocket.unreceipted.length > 0 && (
              <div className="ah-card mb-5 p-4">
                <p className="ah-label">{t("receipts pending")}</p>
                <p className="ah-label ah-label--dim mt-1" style={{ fontSize: 12.5 }}>
                  {t("these settled hands haven't minted their memory yet — one tap does it, for everyone")}
                </p>
                <div className="mt-2.5 flex flex-col gap-2">
                  {pocket.unreceipted.map((hid) => (
                    <div key={hid} className="flex items-center justify-between gap-3">
                      <span className="ah-meta" style={{ fontSize: "var(--fs-mono-xs)" }}>
                        {t("aHand #{id}", { id: hid })}
                      </span>
                      <QuietButton
                        compact
                        disabled={pocket.materializing !== null}
                        onClick={() => void pocket.materialize(hid)}
                      >
                        {pocket.materializing === hid ? t("minting…") : t("materialize receipts")}
                      </QuietButton>
                    </div>
                  ))}
                </div>
                {pocket.materializeError && (
                  <p className="ah-label ah-label--dim mt-2" style={{ fontSize: 12 }}>
                    {pocket.materializeError}
                  </p>
                )}
              </div>
            )}

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
                          r.kind === "raised" || r.kind === "tookOut"
                            ? "var(--ink-a45)"
                            : r.kind === "thanked"
                              ? "var(--ink-a60)"
                              : "var(--ink)",
                      }}
                    >
                      {r.kind === "raised" || r.kind === "tookOut" ? "" : r.kind === "thanked" ? "−" : "+"}
                      {formatUsdCents(Math.abs(r.amount))}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Mobile CTA row */}
            <div aria-hidden="true" className="lg:hidden flex-1 min-h-5 max-h-24" />
            <div className="lg:hidden pt-2 flex">
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
