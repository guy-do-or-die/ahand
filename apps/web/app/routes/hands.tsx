import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FLAGS } from "../config/flags";
import { SwipeButton } from "../components/SwipeButton";
import { Logo } from "../components/Logo";
import { t } from "../i18n";

export const Route = createFileRoute("/hands")({
  component: OpenHandsComponent,
});

/**
 * Open hands board (mock 11). The grid needs the public metadata board
 * (IPFS replication) — no server-side hand list may exist before
 * that. Until the flag flips, this is an honest empty state.
 */
function OpenHandsComponent() {
  const navigate = useNavigate();

  return (
    <div className="ah-page">
      {FLAGS.openHandsBoard ? (
        /* Later: 3-col card grid over replicated public metadata. */
        <div className="flex-1 grid place-items-center">
          <p className="ah-meta">{t("open hands")}</p>
        </div>
      ) : (
        <div className="flex flex-col flex-1 items-center justify-center text-center px-6 pb-16">
          <h1
            className="font-extrabold"
            style={{ fontSize: "var(--fs-title-m)", lineHeight: 1.06, letterSpacing: "-0.03em", textWrap: "balance", maxWidth: "16ch" }}
          >
            {t("The board isn't open yet.")}
          </h1>
          <p className="mt-3.5 text-[15.5px] leading-[1.5] text-ink/65 max-w-[38ch]">
            {t("For now, hands travel hand to hand — by link only. Raise one and start a chain.")}
          </p>
          <SwipeButton
            gesture="raise"
            variant="ink"
            still
            className="mt-8 min-w-[260px]"
            onClick={() => navigate({ to: "/raise" })}
          >
            {t("Raise a hand")}
          </SwipeButton>
          <p className="ah-label ah-label--dim mt-5">{t("public board · on its way")}</p>
        </div>
      )}
    </div>
  );
}
