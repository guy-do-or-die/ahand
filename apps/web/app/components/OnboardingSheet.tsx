import { useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Link } from "@tanstack/react-router";
import { Sheet } from "./Sheet";
import { SwipeButton } from "./SwipeButton";
import { POCKET_EMOJI } from "../styles/tokens";
import { t } from "../i18n";

/**
 * Onboarding (mock 02) — pocket connect. The single allowed use of the word
 * "wallet" in the app ("Connect a wallet"). Shown as a detour whenever an
 * action needs a pocket; closes itself once connected.
 */
export function OnboardingSheet({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected?: () => void;
}) {
  const { login, authenticated } = usePrivy();

  useEffect(() => {
    if (authenticated) {
      onConnected?.();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  return (
    <Sheet label={t("get a pocket")} onClose={onClose}>
      <div className="flex flex-col flex-1 max-h-[540px] justify-center py-8">
        <span className="ah-hero ah-hero--cheer text-[92px]" aria-hidden="true">
          🙌
        </span>
        <h2
          className="mt-4.5 font-extrabold"
          style={{ fontSize: "var(--fs-title-m-lg)", lineHeight: 1.05, letterSpacing: "-0.03em", textWrap: "balance" }}
        >
          {t("Good hands, welcome.")}
        </h2>
        <p className="mt-3.5 text-[15.5px] leading-[1.5] text-ink/65 max-w-[30ch]">
          {t("You'll need a pocket — a safe place to hold the thanks you give and get.")}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <SwipeButton gesture="raise" emoji={POCKET_EMOJI} still variant="ink" onClick={() => login()}>
          {t("Connect a wallet — that's your pocket")}
        </SwipeButton>
        <p className="ah-label ah-label--dim text-center" style={{ fontSize: 12.5, marginTop: -4 }}>
          {t("No app or crypto know-how needed — it takes a few seconds.")}
        </p>
        <div
          className="flex items-center justify-center gap-2.5"
          style={{
            height: 48,
            borderRadius: "var(--r-btn)",
            border: "var(--bw-hair) dashed var(--ink-a20)",
            fontSize: "var(--fs-body-sm)",
            fontWeight: "var(--fw-medium)" as any,
            color: "var(--ink-a40)",
          }}
          aria-disabled="true"
        >
          {t("Email & socials")}
          <span className="ah-meta" style={{ fontSize: 10, letterSpacing: "0.07em" }}>
            {t("coming")}
          </span>
        </div>
      </div>
      <p className="ah-label ah-label--dim mt-4 text-center">
        {t("your pocket stays yours · we never touch it")}
      </p>
      <p className="mt-3 pb-2 text-center text-[14px] font-semibold underline underline-offset-[3px]">
        <Link to="/hands" onClick={onClose}>
          {t("Just looking? Browse open hands")}
        </Link>
      </p>
    </Sheet>
  );
}
