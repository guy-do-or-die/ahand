import { useState, type ReactNode } from "react";
import type { Address } from "viem";

import { config } from "../../config";
import { t } from "../../i18n";
import { chainName } from "../../i18n/common/chain";
import { TID } from "../../testids";
import { QuietButton } from "../../ui";
import { useTypedSigner } from "../../wallet";
import { unlock, unlockedFor, useSessionVersion } from "./session";

/** A section of the screen: a mono heading over a 1.5px ink rule. */
export function Section({ title, children, testId, state }: { title: string; children: ReactNode; testId?: string; state?: string }) {
  return (
    <section className="flex flex-col gap-4 border-t-[length:var(--bw-emph)] border-[var(--ink)] pt-4" data-testid={testId} data-state={state}>
      <h2 className="ah-meta ah-meta--ink m-0">{title}</h2>
      {children}
    </section>
  );
}

/** The heading every screen of this pair carries. */
export function Title({ children }: { children: ReactNode }) {
  return <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{children}</h1>;
}

/** A small statement in the human voice. */
export function Line({ children, testId, dim }: { children: ReactNode; testId?: string; dim?: boolean }) {
  return (
    <p className={dim ? "ah-label ah-label--dim m-0" : "ah-label m-0"} data-testid={testId}>
      {children}
    </p>
  );
}

/** The build's chain and Core the keys confirmation is bound to. */
export function keysPlace(): { chainId: number; core: Address } | undefined {
  const core = config.cores.canonical ?? config.cores.trusted.find((entry) => entry.chainId === config.chain.id)?.core;
  return core ? { chainId: config.chain.id, core } : undefined;
}

/**
 * "Unlock links and replies": one keys confirmation per session, for the connected account.
 * Shown only to the account that raised the Hands it unlocks.
 */
export function UnlockBar({ account }: { account: Address | undefined }) {
  useSessionVersion();
  const { sign, asking } = useTypedSigner();
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const place = keysPlace();
  if (!place) return null;
  if (!account) return <Line>{t("my.unlock.connect")}</Line>;
  const unlocked = unlockedFor(place.chainId, place.core, account);
  if (unlocked) {
    return (
      <div className="flex flex-col gap-2" data-testid={TID.my.unlock} data-value="unlocked">
        <Line>{t("my.unlock.done")}</Line>
        {!unlocked.repeats ? <Line dim>{t("my.unlock.differs")}</Line> : null}
      </div>
    );
  }
  const press = async () => {
    setProblem(undefined);
    const outcome = await unlock(place.chainId, place.core, account, sign);
    if (!outcome.ok)
      setProblem(
        outcome.reason === "rejected"
          ? t("my.unlock.refused")
          : outcome.reason === "wrong-network"
            ? t("common.error.wrongNetwork", { network: chainName(config.chain) })
            : t("my.unlock.failed", { reason: outcome.message ?? outcome.reason }),
      );
  };
  return (
    <div className="ah-panel flex flex-col gap-3">
      <QuietButton data-testid={TID.my.unlock} data-value="locked" disabled={asking} onClick={() => void press()} className="self-start">
        {asking ? t("my.unlock.asking") : t("my.unlock")}
      </QuietButton>
      <Line dim>{t("my.unlock.why")}</Line>
      {problem ? (
        <p className="ah-label m-0" role="status">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
