import { CORE_ABI } from "@ahand/sdk";
import { useEffect, useState, type ReactNode } from "react";
import { size, type Address } from "viem";

import { clientOf } from "../../chain";
import { config, PREVIEWS } from "../../config";
import { t } from "../../i18n";
import { TID } from "../../testids";
import { ProofPage, CopyRow, ErrorBand, Mark, count, useLang } from "../../ui";
import { capDays, derive, paidPassesAtWorst, readServedBuild, reproduceLine, type ServedBuild } from "./facts";
import { LIMIT_NUMBERS } from "./limits";
import "./core.css";
import { chainName } from "../../i18n/common/chain";
import { OnExplorer } from "../../shell/OnExplorer";

/**
 * /core, "This contract". What is read from
 * the contract now (its code, its EIP-712 domain, its 180-day cap) is marked on chain; the CREATE2
 * derivation from the configuration's deployment facts is computed here and compared with the
 * address in use; the build hash is fetched from /build.json at this moment and labelled "served
 * by this site" (a development server has none and says so). Then the command that rebuilds the
 * code hash from a clone, the twelve accepted limits, and the unaudited sentence.
 */

/** The accepted limit that speaks of a route's length (the fourth). */
const ROUTE_LENGTH_LIMIT = 4;

const CORE: Address | undefined = config.cores.canonical ?? config.cores.trusted.find((c) => c.chainId === config.chain.id)?.core;

interface OnChain {
  block: bigint;
  codeBytes: number;
  domain: { name: string; version: string; chainId: bigint; verifyingContract: Address };
  cap: number;
}

/** Read from the chain: Core's figures, or that its address holds no code at that block (presence.ts). */
type ChainRead = OnChain | { block: bigint; codeBytes: 0; absent: true };

type Read<T> = { state: "reading" } | { state: "done"; value: T } | { state: "failed" };

function Part({ title, children, testid, ...rest }: { title: string; children: ReactNode; testid?: string; [data: `data-${string}`]: unknown }) {
  return (
    <section className="core-part" data-testid={testid} {...rest}>
      <h2 className="core-part__title">{title}</h2>
      {children}
    </section>
  );
}

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="core-row">
      <span className="core-row__name">{name}</span>
      <span className="core-row__value">{children}</span>
    </div>
  );
}

/**
 * This page about the contract is itself the proof a person came to see, so its evidence is drawn whatever the lens
 * says (`ProofPage`): each mark and disclosure one tap away, and all of them open under the lens.
 * The calm view only keeps the way here out of ordinary screens.
 */
export default function CoreScreen() {
  return (
    <ProofPage>
      <CoreScreenBody />
    </ProofPage>
  );
}

function CoreScreenBody() {
  useLang();
  const [chain, setChain] = useState<Read<ChainRead>>({ state: "reading" });
  const [build, setBuild] = useState<Read<ServedBuild>>({ state: "reading" });

  useEffect(() => {
    let live = true;
    if (!CORE) return;
    const client = clientOf(config.chain.id);
    (async () => {
      const block = await client.getBlockNumber({ cacheTime: 0 });
      const at = { blockNumber: block };
      // The code first: an empty address is "not on this network yet", not a failed read.
      const code = await client.getCode({ address: CORE, ...at });
      if (!code || code === "0x") return { block, codeBytes: 0, absent: true } as const;
      const [domain, cap] = await Promise.all([
        client.readContract({ address: CORE, abi: CORE_ABI, functionName: "eip712Domain", ...at }),
        client.readContract({ address: CORE, abi: CORE_ABI, functionName: "MAX_EXPIRY_PERIOD", ...at }),
      ]);
      return {
        block,
        codeBytes: code ? size(code) : 0,
        domain: { name: domain[1], version: domain[2], chainId: domain[3], verifyingContract: domain[4] },
        cap: Number(cap),
      };
    })().then(
      (value: ChainRead) => live && setChain({ state: "done", value }),
      () => live && setChain({ state: "failed" }),
    );

    // Asked at this moment, past any cache: what this site serves now.
    fetch("/build.json", { cache: "no-store" })
      .then(async (response) => (response.ok ? readServedBuild(response.headers.get("content-type"), await response.text()) : ({ kind: "none" } as const)))
      .then(
        (value) => live && setBuild({ state: "done", value }),
        () => live && setBuild({ state: "done", value: { kind: "none" } }),
      );
    return () => {
      live = false;
    };
  }, []);

  const deployment = config.deployment;
  const derivation = deployment && CORE ? derive(deployment, CORE) : undefined;
  const commit = deployment?.commit || undefined;
  const reproduce = reproduceLine(commit);
  const read = chain.state === "done" ? chain.value : undefined;
  const absent = read && "absent" in read ? read : undefined;
  const onChain = read && !("absent" in read) ? read : undefined;
  const paidPasses = paidPassesAtWorst(config.defaults.payoutGasK);
  const blockSource = onChain ? `BLOCK ${count(onChain.block)}` : undefined;

  return (
    <section className="core mx-auto flex w-full max-w-[720px] flex-col gap-7 px-6 py-10 md:px-10" data-screen="core">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("core.title")}</h1>
        <p className="m-0 text-[length:var(--fs-body-lg)] leading-snug">{t("core.intro")}</p>
      </header>

      <Part title={t("core.address")}>
        <code className="core-address" data-testid={TID.core.address}>
          {CORE ?? "—"}
        </code>
        {CORE ? <OnExplorer address={CORE} /> : null}
        <Row name={t("core.chain")}>
          <span className="ah-meta ah-meta--exact">
            {chainName(config.chain)} · {t("core.chainId", { id: config.chain.id })}
          </span>
        </Row>
        {chain.state === "reading" ? <p className="ah-meta m-0">{t("core.reading")}</p> : null}
        {chain.state === "failed" ? <ErrorBand what={t("core.offline")} kept={t("core.offline.kept")} /> : null}
        {absent ? (
          <div className="core-claim" data-testid={TID.core.absent}>
            <p className="m-0 font-bold">{t("common.noCore.title", { chain: chainName(config.chain) })}</p>
            <p className="m-0">{t("core.absent.body")}</p>
            <Mark kind="chain" source={`eth_getCode = 0x · BLOCK ${count(absent.block)}`} />
          </div>
        ) : null}
        {onChain ? (
          <div className="core-claim">
            <p className="m-0">{onChain.codeBytes > 0 ? t("core.code", { bytes: onChain.codeBytes }) : t("core.code.none")}</p>
            <Mark kind="chain" source={`eth_getCode · ${blockSource}`} />
          </div>
        ) : null}
      </Part>

      {onChain ? (
        <>
          <Part title={t("core.domainTitle")} testid={TID.core.domain}>
            <p className="m-0">{t("core.domain.body")}</p>
            <div className="core-box">
              <Row name="name">{onChain.domain.name}</Row>
              <Row name="version">{onChain.domain.version}</Row>
              <Row name="chainId">{String(onChain.domain.chainId)}</Row>
              <Row name="verifyingContract">{onChain.domain.verifyingContract}</Row>
            </div>
            <Mark kind="chain" source={`${t("core.lens.domain")} · ${blockSource}`} />
          </Part>

          <Part title={t("core.capTitle")} testid={TID.core.cap} data-value={onChain.cap}>
            <p className="m-0">{t("core.cap.body", { days: capDays(onChain.cap) })}</p>
            <div className="core-box">
              <Row name="MAX_EXPIRY_PERIOD">
                {t("core.cap.row", { seconds: count(onChain.cap), days: capDays(onChain.cap) })}
              </Row>
            </div>
            <Mark kind="chain" source={`${t("core.lens.cap")} · ${blockSource}`} />
          </Part>
        </>
      ) : null}

      <Part title={t("core.deriveTitle")} testid={TID.core.derivation} data-value={derivation?.derived ?? ""} data-match={derivation ? String(derivation.matches) : "unknown"}>
        <p className="m-0">{t("core.derive.body")}</p>
        {deployment && derivation ? (
          <>
            <div className="core-box">
              <Row name="factory">{deployment.factory}</Row>
              <Row name="salt">{deployment.salt}</Row>
              <Row name="initcodeHash">{deployment.initcodeHash}</Row>
              <Row name="create2 →">{derivation.derived}</Row>
              <Row name="in use">{CORE}</Row>
            </div>
            <div className="core-claim">
              {derivation.matches ? (
                <p className="m-0 font-bold">{t("core.derive.match")}</p>
              ) : (
                <div className="core-finding" role="note">
                  {t("core.derive.mismatch")}
                </div>
              )}
              <Mark kind="checked" source="keccak256(0xff ‖ factory ‖ salt ‖ initcodeHash)[12:]" />
            </div>
          </>
        ) : (
          <p className="m-0">{t("core.derive.none")}</p>
        )}
      </Part>

      <Part title={t("core.commitTitle")} testid={TID.core.commit} data-value={commit ?? ""} data-dirty={deployment ? String(deployment.dirty) : "unknown"}>
        {commit ? (
          <>
            <p className="m-0">{t("core.commit.body", { commit: commit.slice(0, 12) })}</p>
            <code className="ah-meta ah-meta--exact break-all">{commit}</code>
            <p className="m-0">{deployment?.dirty ? t("core.commit.dirty") : t("core.commit.clean")}</p>
          </>
        ) : (
          <p className="m-0">{t("core.commit.unknown")}</p>
        )}
      </Part>

      <Part title={t("core.reproduceTitle")}>
        <p className="m-0">{t("core.reproduce.body")}</p>
        <div className="grid w-full grid-cols-[minmax(0,1fr)]" data-testid={TID.core.copyCommand}>
          <CopyRow value={reproduce} />
        </div>
        <code className="ah-meta ah-meta--exact break-all" data-testid={TID.core.command}>
          {reproduce}
        </code>
      </Part>

      <Part title={t("core.buildTitle")} testid={TID.core.buildHash} data-state={build.state === "done" ? build.value.kind : build.state}>
        {build.state !== "done" ? <p className="ah-meta m-0">{t("core.build.reading")}</p> : null}
        {build.state === "done" && build.value.kind === "none" ? <p className="m-0">{t("core.build.none")}</p> : null}
        {build.state === "done" && build.value.kind === "served" ? (
          <>
            <p className="m-0">{t(PREVIEWS ? "core.build.body" : "core.build.body.static")}</p>
            <span className="ah-tag ah-tag--outline self-start" data-testid={TID.core.buildLabel}>
              {t("core.build.served")}
            </span>
            <code className="core-address" data-testid={TID.core.buildValue}>
              {build.value.hash}
            </code>
            {build.value.files !== undefined ? <span className="ah-meta">sha256 · {t("core.build.files", { n: build.value.files })}</span> : null}
            {build.value.command ? <code className="ah-meta ah-meta--exact break-all">{build.value.command}</code> : null}
          </>
        ) : null}
      </Part>

      <p className="core-comes">{t("core.comesWith")}</p>

      <Part title={t("core.limitsTitle")}>
        <p className="m-0">{t("core.limits.body")}</p>
        <ol className="core-limits" data-testid={TID.core.limits}>
          {LIMIT_NUMBERS.map((n) => {
            const body = t(`core.lens.limit.${n}.body`);
            return (
              <li key={n} data-index={n}>
                <strong>{t(`core.lens.limit.${n}`)}</strong>
                {body.startsWith(":") ? "" : " "}
                {body}
                {n === ROUTE_LENGTH_LIMIT ? (
                  // The record's sentence stays word for word; this build's own figure stands under it, computed now.
                  <span className="core-limits__here" data-testid={TID.core.limitHere} data-value={paidPasses} data-gas-k={config.defaults.payoutGasK}>
                    {t("core.lens.limit.4.here", { k: config.defaults.payoutGasK, n: paidPasses })}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </Part>

      <p className="core-unaudited" data-testid={TID.core.unaudited}>
        {t("core.unaudited")}
      </p>
    </section>
  );
}
