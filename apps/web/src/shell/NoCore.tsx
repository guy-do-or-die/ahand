import { useState, type ReactNode } from "react";

import { CANONICAL_CORE, corePresence, useCorePresence } from "../chain";
import { config } from "../config";
import { t } from "../i18n";
import { chainName } from "../i18n/common/chain";
import { TID } from "../testids";
import { QuietButton } from "../ui/QuietButton";

/**
 * "This contract is not on <network> yet" (chain/presence.ts): the build names a Core whose
 * address holds no code on the build's chain, so nothing on this screen could work. Said instead
 * of the screen, never as "Can't reach the network": the network answered, and answered empty.
 * The address, its derivation and the command that rebuilds it stay one tap away on /core.
 */
export function NoCore({ heading = true }: { heading?: boolean }) {
  const title = t("common.noCore.title", { chain: chainName(config.chain) });
  const [checking, setChecking] = useState(false);
  const again = () => {
    setChecking(true);
    void corePresence()
      .recheck()
      .finally(() => setChecking(false));
  };
  return (
    <section data-screen="no-core" data-testid={TID.shell.noCore} data-value={CANONICAL_CORE ?? ""} className="mx-auto flex w-full max-w-[680px] flex-col gap-4 px-6 py-12 md:px-10">
      {heading ? (
        <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{title}</h1>
      ) : (
        <p className="m-0 font-bold">{title}</p>
      )}
      <p className="m-0 max-w-[52ch] text-[length:var(--fs-body-lg)] leading-[1.5]">{t("common.noCore.body")}</p>
      <code className="ah-meta ah-meta--exact break-all">{CANONICAL_CORE}</code>
      <div className="flex flex-wrap items-center gap-3">
        {heading ? (
          <a href="/core" className="ah-quiet no-underline">
            {t("common.noCore.more")}
          </a>
        ) : null}
        <QuietButton compact data-testid={TID.shell.noCoreRetry} disabled={checking} onClick={again}>
          {t("common.noCore.retry")}
        </QuietButton>
      </div>
    </section>
  );
}

/** Routes whose screens read Core. A Hand address naming another Core is that Core's business. */
const READS_CORE = new Set(["hand", "proof", "pass", "give", "raise", "my", "thank", "waiting", "care", "print", "check"]);

/**
 * Draws `children`, or `NoCore` once `eth_getCode` has said the build's Core is not on its chain.
 * While the answer is on its way the screen draws as usual; a network that does not answer leaves
 * the screen to say so in its own words.
 */
export function CoreGate({ route, params, children }: { route: string; params: Record<string, string | undefined>; children: ReactNode }) {
  const otherCore = params.core !== undefined && CANONICAL_CORE !== undefined && params.core.toLowerCase() !== CANONICAL_CORE.toLowerCase();
  const gated = READS_CORE.has(route) && !otherCore;
  const presence = useCorePresence(gated);
  return gated && presence === "absent" ? <NoCore /> : <>{children}</>;
}
