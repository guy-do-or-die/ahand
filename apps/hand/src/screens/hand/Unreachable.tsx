import { useEffect } from "react";

import { t } from "../../i18n";
import { TID } from "../../testids";
import { ErrorBand, QuietButton } from "../../ui";
import { retryWhileVisible } from "./held";

/**
 * The network can't be reached (UX-SPEC §15, §10 "RPC off"): the place of the Deal card stays as
 * its outline, and a band says what happened and what was not lost. Nothing here is a verdict on
 * the link. With a link held in this tab, the band says it is still here, and the line under it
 * says why not to reload: the address bar no longer carries it.
 *
 * `retry` reads again without asking for the link: on the button, and (as `auto`, the same
 * unless another is given) every few seconds on its own while the tab is visible, and at once
 * when the tab is looked at again.
 */
export function Unreachable({ retry, auto = retry, held, heading }: { retry: () => void; auto?: () => void; held: boolean; heading?: string }) {
  useEffect(() => retryWhileVisible(auto, document), [auto]);
  return (
    <div className="mx-auto flex w-full max-w-[620px] flex-col gap-4" data-testid={TID.hand.unreachable} data-held={held}>
      <h1 className={heading ? "m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em]" : "sr-only"}>{heading ?? t("hand.title")}</h1>
      <div className="ah-card ah-card--lg flex flex-col gap-4 p-6" aria-hidden="true">
        <span className="text-[44px] leading-none opacity-30">✋</span>
        <span className="h-7 w-4/5 rounded-[var(--r-bar)] bg-[var(--ink-a10)]" />
        <span className="h-7 w-3/5 rounded-[var(--r-bar)] bg-[var(--ink-a10)]" />
        <span className="h-4 w-2/5 rounded-[var(--r-bar)] bg-[var(--ink-a10)]" />
      </div>
      <ErrorBand
        what={t("common.time.offline")}
        {...(held ? { kept: t("hand.offline.kept") } : {})}
        code="NETWORK"
        action={
          <QuietButton compact data-testid={TID.hand.retry} onClick={retry}>
            {t("hand.offline.retry")}
          </QuietButton>
        }
      />
      <p className="ah-label m-0" role="status">
        {t("hand.offline.auto")}
      </p>
      {held ? <p className="ah-label ah-label--dim m-0">{t("common.tabOnly")}</p> : null}
    </div>
  );
}
