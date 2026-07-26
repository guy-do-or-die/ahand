import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { SwipeButton } from "../components/SwipeButton";
import { Logo } from "../components/Logo";
import { Emoji } from "../components/Emoji";
import { PotBar } from "../components/PotBar";
import { OnboardingSheet } from "../components/OnboardingSheet";
import { OpenHandCard, useOpenHands } from "../components/OpenHandCard";
import { formatUsd } from "../lib/format";
import { t } from "../i18n";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

const STEPS: { emoji: string; label: string; text: string }[] = [
  { emoji: "✋", label: "raise", text: "Say what you need. Put thanks in the pot." },
  { emoji: "🤝", label: "shake", text: "Send it to someone who'd know. It travels." },
  { emoji: "🙌", label: "give", text: "The one who does it keeps most of the pot." },
  { emoji: "🙏", label: "thank", text: "Every hand in the chain shares the rest." },
];

function HomeComponent() {
  const navigate = useNavigate();
  const { authenticated, login, logout } = usePrivy();

  const raiseCta = () => {
    if (authenticated) navigate({ to: "/raise" });
    else login();
  };

  return (
    <div className="flex-1 flex flex-col justify-center">
      {/* Hero */}
      <div className="grid lg:grid-cols-[1fr_380px] gap-10 lg:gap-12 items-center px-6 pt-10 pb-10 lg:px-10 lg:pt-14 lg:pb-12 max-w-[1180px] mx-auto w-full">
        <div>
          <h1
            className="font-extrabold"
            style={{ fontSize: "clamp(34px, 5vw, 58px)", lineHeight: 1.02, letterSpacing: "-0.035em", maxWidth: "13ch", textWrap: "balance" }}
          >
            {t("Raise a hand.")}{" "}
            <span
              style={{
                background: "var(--amber)",
                color: "var(--on-amber)",
                padding: "0 10px",
                borderRadius: "var(--r-chip-lg)",
                WebkitBoxDecorationBreak: "clone",
                boxDecorationBreak: "clone",
              }}
            >
              {t("Your people")}
            </span>{" "}
            {t("take it from there.")}
          </h1>
          <p className="mt-5 text-[17px] leading-[1.55] text-ink/65 max-w-[46ch]">
            {t(
              "Ask for what you need. Friends pass it along, hand to hand, until someone solves it — and everyone who helped shares the thanks.",
            )}
          </p>
          <div className="mt-8 flex items-center gap-[18px] flex-wrap">
            <SwipeButton
              gesture="raise"
              variant="ink"
              onClick={raiseCta}
              className="ah-swipe--hero"
              style={{ padding: "0 110px 0 24px" }}
            >
              {t("Raise a hand")}
            </SwipeButton>
            <Link
              to="/hands"
              className="underline underline-offset-[3px] flex items-center min-h-11"
              style={{ fontFamily: "var(--font-meta)", fontSize: 13 }}
            >
              {t("see open hands")}
            </Link>
          </div>
          <p className="mt-7 ah-meta" style={{ letterSpacing: "0.07em", color: "var(--ink-a50)" }}>
            {t("no feeds · no ads · 1% to charity · positive-sum by design")}
          </p>
        </div>

        {/* Live open hands when there are any; the illustration otherwise. */}
        <OpenHandsRail />
      </div>

      {/* How it works */}
      <div id="how" className="grid grid-cols-2 lg:grid-cols-4 border-t border-(--ink-a08) mt-auto max-w-[1180px] mx-auto w-full">
        {STEPS.map((step, i) => (
          <div
            key={step.label}
            className="p-[26px_30px]"
            style={i < STEPS.length - 1 ? { borderRight: "var(--bw-hair) solid var(--ink-a08)" } : undefined}
          >
            <Emoji size={34}>{step.emoji}</Emoji>
            <p className="ah-meta mt-2.5" style={{ color: "var(--ink)" }}>
              {t(step.label)}
            </p>
            <p className="mt-1.5 text-[14px] leading-[1.45] text-ink/65">{t(step.text)}</p>
          </div>
        ))}
      </div>

    </div>
  );
}

/**
 * Hero rail: live public hands cycling where the mock's illustration card
 * sat — the protocol showing itself instead of an example. Falls back to
 * the (aria-hidden) illustration while loading or when the board is quiet,
 * so the landing never blocks on chain + gateway round-trips.
 */
function OpenHandsRail() {
  const hands = useOpenHands(6);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (!hands || hands.length < 2) return;
    const timer = setInterval(() => setCursor((c) => (c + 1) % hands.length), 5000);
    return () => clearInterval(timer);
  }, [hands]);

  if (!hands || hands.length === 0) {
    return (
      <div className="ah-card ah-card--lg p-[26px] pb-[22px]" aria-hidden="true">
        <p className="mt-1 font-extrabold" style={{ fontSize: "var(--fs-card-title-lg)", lineHeight: 1.12, letterSpacing: "-0.02em" }}>
          {t("Looking for a sublet in Yerevan, June")}
        </p>
        <div className="mt-4 flex items-baseline justify-between">
          <span className="font-extrabold" style={{ fontSize: 32, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>
            {formatUsd(148)}
          </span>
          <span className="ah-meta" style={{ fontSize: "var(--fs-mono-xs)", letterSpacing: "0.06em", color: "var(--ink-a55)" }}>
            {t("in the pot")}
          </span>
        </div>
        <PotBar className="mt-2.5" size="md" progress={0.78} />
        <div className="mt-6 flex gap-2">
          <SwipeButton gesture="shake" variant="ink" compact className="flex-1 ah-swipe--card" tabIndex={-1}>
            {t("I can ask")}
          </SwipeButton>
          <SwipeButton gesture="cheer" variant="amber" compact className="flex-1 ah-swipe--card" tabIndex={-1}>
            {t("I can help")}
          </SwipeButton>
        </div>
      </div>
    );
  }

  const hand = hands[cursor % hands.length];
  return (
    <div>
      <OpenHandCard key={hand.id} hand={hand} />
      {hands.length > 1 && (
        <div className="mt-3 flex justify-center gap-1.5" aria-hidden="true">
          {hands.map((h, i) => (
            <button
              key={h.id}
              type="button"
              tabIndex={-1}
              onClick={() => setCursor(i)}
              className="border-0 p-0 cursor-pointer"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: i === cursor % hands.length ? "var(--ink)" : "var(--ink-a25)",
                transition: "background 140ms ease",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
