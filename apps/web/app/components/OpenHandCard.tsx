import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PotBar } from "./PotBar";
import { SwipeButton } from "./SwipeButton";
import { listOpenHands, type OpenHand } from "../lib/openHands";
import { formatUsd } from "../lib/format";
import { t } from "../i18n";

/**
 * A live public hand as a card — the landing illustration, made real. The
 * whole card is the link; the gesture buttons only preview what the hand
 * page offers (the real ones need the route key or the reply path).
 */
export function OpenHandCard({ hand, className = "" }: { hand: OpenHand; className?: string }) {
  // No raise timestamp on-chain, so the bar can't honestly mean "time
  // left" — a stable per-hand value keeps the board lively instead of
  // uniformly full.
  const progress = 0.35 + ((Number(hand.id) * 37) % 50) / 100;
  return (
    <Link
      to="/h/$id"
      params={{ id: hand.id }}
      className={`ah-card ah-card--lg block p-[26px] pb-[22px] no-underline text-inherit ${className}`}
    >
      <p
        className="mt-1 font-extrabold"
        style={{
          fontSize: "var(--fs-card-title-lg)",
          lineHeight: 1.12,
          letterSpacing: "-0.02em",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          minHeight: "2.24em",
        }}
      >
        {hand.title}
      </p>
      <div className="mt-4 flex items-baseline justify-between">
        <span
          className="font-extrabold"
          style={{ fontSize: 32, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}
        >
          {formatUsd(hand.potUsd)}
        </span>
        <span
          className="ah-meta"
          style={{ fontSize: "var(--fs-mono-xs)", letterSpacing: "0.06em", color: "var(--ink-a55)" }}
        >
          {t("in the pot")}
        </span>
      </div>
      <PotBar className="mt-2.5" size="md" progress={progress} />
      {hand.open ? (
        <div className="mt-6 flex gap-2 pointer-events-none" aria-hidden="true">
          <SwipeButton gesture="shake" variant="ink" compact still className="flex-1 ah-swipe--card" tabIndex={-1}>
            {t("I can ask")}
          </SwipeButton>
          <SwipeButton gesture="cheer" variant="amber" compact still className="flex-1 ah-swipe--card" tabIndex={-1}>
            {t("I can help")}
          </SwipeButton>
        </div>
      ) : (
        <p className="ah-label ah-label--dim mt-6" aria-hidden="true">
          {t("travels by link — ask whoever holds it")}
        </p>
      )}
    </Link>
  );
}

/**
 * Client-side feed: the landing and the board must never block first paint
 * on a chain scan plus gateway round-trips — render a fallback, fill in
 * when the feed lands. null = still looking, [] = nothing to show.
 */
export function useOpenHands(limit: number): OpenHand[] | null {
  const [hands, setHands] = useState<OpenHand[] | null>(null);
  useEffect(() => {
    let live = true;
    listOpenHands(limit)
      .then((found) => {
        if (live) setHands(found);
      })
      .catch(() => {
        if (live) setHands([]);
      });
    return () => {
      live = false;
    };
  }, [limit]);
  return hands;
}
