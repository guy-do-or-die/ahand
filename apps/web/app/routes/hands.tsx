import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FLAGS } from "../config/flags";
import { OpenHandCard, useOpenHands } from "../components/OpenHandCard";
import { SwipeButton } from "../components/SwipeButton";
import { t } from "../i18n";

export const Route = createFileRoute("/hands")({
  component: OpenHandsComponent,
});

/**
 * Open hands board (mock 11): live public hands, straight from the chain +
 * IPFS, each doc verified against its on-chain commitment before it
 * renders. The empty state stays honest — hands mostly travel by link.
 */
function OpenHandsComponent() {
  const navigate = useNavigate();
  const feed = useOpenHands(24);
  const hands = FLAGS.openHandsBoard ? feed : [];

  if (hands && hands.length > 0) {
    return (
      <div className="ah-page px-6 pt-8 pb-12 lg:px-10 lg:max-w-[1180px] lg:mx-auto w-full">
        <p className="ah-label ah-label--dim">{t("open hands")}</p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 items-start">
          {hands.map((hand) => (
            <OpenHandCard key={hand.id} hand={hand} />
          ))}
        </div>
        <p className="ah-label ah-label--dim mt-8 text-center">
          {t("good travels · it comes back around")}
        </p>
      </div>
    );
  }

  return (
    <div className="ah-page">
      <div className="flex flex-col flex-1 items-center justify-center text-center px-6 pb-16">
        <h1
          className="font-extrabold"
          style={{ fontSize: "var(--fs-title-m)", lineHeight: 1.06, letterSpacing: "-0.03em", textWrap: "balance", maxWidth: "16ch" }}
        >
          {hands === null ? t("Looking around…") : t("The board isn't open yet.")}
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
    </div>
  );
}
