import { collect, decodeCoreError, exportBundle, passportOf, readBetween, type BuildFacts, type Check, type HandRecord } from "@ahand/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAddress, isAddressEqual, type Address } from "viem";

import { clientOf } from "../../chain";
import { config } from "../../config";
import { t } from "../../i18n";
import { navigate } from "../../router";
import type { ScreenProps } from "../../routes";
import { TID } from "../../testids";
import { CopyRow, Disclose, ErrorBand, Mark, QuietButton, count, money, moneyExact, receiptAmounts, shortAddress, useLang, type Lang } from "../../ui";
import {
  amountOfCheck,
  bundleLine,
  bundleName,
  markOf,
  notCheckableKeyOf,
  payeeOfCheck,
  payoutRowsOf,
  positionOf,
  sectionsOf,
  sentenceKeyOf,
  sourceLine,
  tallyOf,
  verdictOf,
  verifyLine,
} from "./model";
import "./proof.css";

/**
 * The passport `/<chain>/<hand>/proof` (UX-SPEC §10.1): the SDK's `collect` reads the Hand once,
 * `passportOf` proves every fact from that record in this browser, and the checks stand as one
 * timeline in the order of §10.1. Each line: a sentence, one of the three marks from its source,
 * and the evidence (formula, inputs, expected, actual, the event or view with its block). A check
 * that cannot be made here says so in words and is never drawn as failed; a failed one is a
 * finding, in ink and words. Nothing here reads a clock or a link: the record holds no secret.
 */

type Load =
  | { phase: "reading" }
  | { phase: "ready"; record: HandRecord; checks: Check[] }
  | { phase: "bad"; what: "chain" | "core" | "missing" | "offline" };

const BUILD: BuildFacts | undefined = config.deployment
  ? {
      factory: config.deployment.factory,
      salt: config.deployment.salt,
      initcodeHash: config.deployment.initcodeHash,
      commit: config.deployment.commit,
      dirty: config.deployment.dirty,
    }
  : undefined;

/** The pause between two lines while they tick in; none under reduced motion. */
const TICK_MS = 110;

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function coreOf(params: ScreenProps["params"]): Address | undefined {
  if (params.core) return getAddress(params.core);
  return config.cores.canonical ?? undefined;
}

function decimalsOf(record: HandRecord): number | undefined {
  return config.tokens.find((entry) => isAddressEqual(entry.address, record.view.token))?.decimals;
}

/**
 * Whether the passport writes every digit: when the payout rows cut to cents would not add up
 * to their total, or a row is below a cent, as the receipt decides it (M-4).
 */
function exactOf(checks: readonly Check[], record: HandRecord, lang: Lang): boolean {
  const decimals = decimalsOf(record);
  if (decimals === undefined) return false;
  const rows = payoutRowsOf(checks);
  return receiptAmounts(rows, rows.reduce((sum, amount) => sum + amount, 0n), decimals, lang).exact;
}

function amountText(record: HandRecord, amount: bigint, lang: Lang, exact: boolean): string {
  const decimals = decimalsOf(record);
  if (decimals === undefined) return `${count(amount)}`;
  return exact ? moneyExact(amount, decimals, lang) : money(amount, decimals, lang);
}

function sentenceOf(check: Check, record: HandRecord, lang: Lang, exact: boolean): string {
  const position = positionOf(check.id);
  const amount = amountOfCheck(check);
  const payee = payeeOfCheck(check);
  return t(sentenceKeyOf(check), {
    n: position === undefined ? "" : String(position + 1),
    amount: amount === undefined ? "" : amountText(record, amount, lang, exact),
    who: payee ? shortAddress(payee) : "",
  });
}

/* ───────────────────────────────────────────────────────────── evidence ── */

function SourceText({ check }: { check: Check }) {
  const source = sourceLine(check.source);
  if (source.block === undefined) return <span className="ah-meta ah-meta--exact">{t("proof.lens.computed")}</span>;
  return (
    <span className="ah-meta ah-meta--exact break-all">
      {source.what} · {t("proof.lens.block", { block: count(source.block) })}
      {source.tx ? ` · ${source.tx}` : ""}
      {source.logIndex !== undefined ? ` · ${t("proof.lens.log", { index: source.logIndex })}` : ""}
    </span>
  );
}

function Evidence({ check }: { check: Check }) {
  const inputs = Object.entries(check.inputs);
  return (
    <dl className="proof-evidence">
      {check.formula ? (
        <>
          <dt>{t("proof.lens.formula")}</dt>
          <dd>{check.formula}</dd>
        </>
      ) : null}
      {inputs.length > 0 ? (
        <>
          <dt>{t("proof.lens.inputs")}</dt>
          <dd>
            {inputs.map(([name, value]) => (
              <span key={name} className="block break-all">
                {name} = {value}
              </span>
            ))}
          </dd>
        </>
      ) : null}
      <dt>{t("proof.lens.expected")}</dt>
      <dd className="break-all">{check.expected}</dd>
      <dt>{t("proof.lens.actual")}</dt>
      <dd className="break-all">{check.actual}</dd>
      <dt>{t("proof.lens.source")}</dt>
      <dd>
        <SourceText check={check} />
      </dd>
    </dl>
  );
}

/* ─────────────────────────────────────────────────────────────── a line ── */

function Line({ check, record, section, shown, lang, exact }: { check: Check; record: HandRecord; section: number; shown: boolean; lang: Lang; exact: boolean }) {
  const verdict = verdictOf(check);
  const mark = markOf(check);
  const source = sourceLine(check.source);
  return (
    <li
      className={`proof-line proof-line--${shown ? verdict : "pending"}`}
      data-testid={TID.proof.check}
      data-index={section}
      data-value={check.id}
      data-verdict={shown ? verdict : "pending"}
      data-mark={mark}
      aria-busy={!shown}
    >
      <p className="proof-line__sentence">{sentenceOf(check, record, lang, exact)}</p>
      {shown ? (
        <>
          <div className="proof-line__marks">
            <Mark
              kind={mark}
              source={
                source.block === undefined ? (
                  t("proof.lens.computed")
                ) : (
                  <>
                    {source.what} · {t("proof.lens.block", { block: count(source.block) })}
                  </>
                )
              }
            />
            {verdict === "ok" ? (
              <span className="ah-tag ah-tag--outline" data-verdict-tag="ok">
                ✓ {t("proof.verdict.ok")}
              </span>
            ) : null}
            {check.id === "give-hash" && verdict === "ok" ? (
              <span className="ah-tag ah-tag--ink" data-testid={TID.proof.givehashMatches}>
                {t("proof.giveHashMatches")}
              </span>
            ) : null}
          </div>
          {verdict === "not-checkable" ? (
            <p className="proof-nc">
              <span className="ah-tag">{t("proof.nc")}</span> {t(notCheckableKeyOf(check))}
            </p>
          ) : null}
          {verdict === "fail" ? (
            <div className="proof-finding" role="note">
              <span className="ah-tag ah-tag--ink">{t("proof.verdict.finding")}</span>
              <p className="m-0">{t("proof.finding", { expected: check.expected, actual: check.actual })}</p>
            </div>
          ) : null}
          <Disclose label={t("proof.lens.evidence")} summary={check.id.replace(/0x[0-9a-fA-F]{40}/, (address) => shortAddress(address))}>
            <Evidence check={check} />
          </Disclose>
        </>
      ) : (
        <span className="proof-line__wait ah-meta" aria-hidden="true">
          · · ·
        </span>
      )}
    </li>
  );
}

/* ──────────────────────────────────────────────────────────── the screen ── */

export default function ProofScreen({ params }: ScreenProps) {
  const lang = useLang();
  const chainId = Number(params.chain);
  const handId = BigInt(params.hand ?? "0");
  const core = coreOf(params);
  const [load, setLoad] = useState<Load>({ phase: "reading" });
  const [shown, setShown] = useState(0);
  const [running, setRunning] = useState(false);
  const [readingBetween, setReadingBetween] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const trusted = core !== undefined && config.cores.trusted.some((entry) => entry.chainId === chainId && isAddressEqual(entry.core, core));

  /** Shows the lines one after another, in order; at once under reduced motion. */
  const tick = useCallback((total: number) => {
    if (timer.current) clearTimeout(timer.current);
    if (reducedMotion()) {
      setShown(total);
      return;
    }
    setShown(0);
    let at = 0;
    const next = () => {
      at += 1;
      setShown(at);
      if (at < total) timer.current = setTimeout(next, TICK_MS);
    };
    timer.current = setTimeout(next, TICK_MS);
  }, []);

  const prove = useCallback(
    async (record: HandRecord) => {
      const checks = await passportOf(record);
      setLoad({ phase: "ready", record, checks });
      tick(checks.length);
    },
    [tick],
  );

  const run = useCallback(async () => {
    if (chainId !== config.chain.id) return setLoad({ phase: "bad", what: "chain" });
    if (!core || !trusted) return setLoad({ phase: "bad", what: "core" });
    setRunning(true);
    try {
      const record = await collect(clientOf(chainId), core, handId, BUILD ? { build: BUILD } : {});
      await prove(record);
    } catch (error) {
      setLoad({ phase: "bad", what: decodeCoreError(error)?.name === "NotRaised" ? "missing" : "offline" });
    } finally {
      setRunning(false);
    }
  }, [chainId, core, trusted, handId, prove]);

  useEffect(() => {
    void run();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one read per Hand address
  }, [params.chain, params.core, params.hand]);

  const between = async (record: HandRecord) => {
    setReadingBetween(true);
    try {
      await prove(await readBetween(clientOf(chainId), record));
    } catch {
      setLoad({ phase: "bad", what: "offline" });
    } finally {
      setReadingBetween(false);
    }
  };

  const download = (record: HandRecord) => {
    const blob = new Blob([exportBundle(record)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = bundleName(record.chainId, record.handId);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handPath = params.core ? `/${params.chain}/${params.core}/${params.hand}` : `/${params.chain}/${params.hand}`;

  return (
    <section className="proof mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 py-10 md:px-10" data-screen="proof">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("proof.title")}</h1>
        <p className="m-0 text-[length:var(--fs-body-lg)] leading-snug">{t("proof.intro", { hand: params.hand ?? "" })}</p>
        <p className="ah-meta m-0 break-all">
          {t("proof.meta", { chain: chainId, core: core ? shortAddress(core) : "—", hand: params.hand ?? "" })}
          {load.phase === "ready" ? ` · ${t("proof.readAt", { block: count(load.record.block) })}` : ""}
        </p>
      </header>

      {load.phase === "reading" ? (
        <p className="ah-meta" role="status">
          {t("proof.loading")}
        </p>
      ) : null}

      {load.phase === "bad" ? (
        <ErrorBand
          what={t(`proof.bad.${load.what}`)}
          {...(load.what === "offline" ? { kept: t("proof.bad.kept") } : {})}
          action={
            load.what === "offline" ? (
              <QuietButton compact onClick={() => void run()}>
                {t("proof.retry")}
              </QuietButton>
            ) : undefined
          }
        />
      ) : null}

      {load.phase === "ready" ? <Passport load={load} shown={shown} lang={lang} running={running} readingBetween={readingBetween} onAgain={() => void run()} onBetween={between} onDownload={download} handPath={handPath} core={core!} /> : null}
    </section>
  );
}

function Passport({
  load,
  shown,
  lang,
  running,
  readingBetween,
  onAgain,
  onBetween,
  onDownload,
  handPath,
  core,
}: {
  load: Extract<Load, { phase: "ready" }>;
  shown: number;
  lang: Lang;
  running: boolean;
  readingBetween: boolean;
  onAgain: () => void;
  onBetween: (record: HandRecord) => Promise<void>;
  onDownload: (record: HandRecord) => void;
  handPath: string;
  core: Address;
}) {
  const { record, checks } = load;
  const sections = sectionsOf(checks);
  const tally = tallyOf(checks);
  const exact = exactOf(checks, record, lang);
  const done = shown >= checks.length;
  const commit = config.deployment?.commit || undefined;
  const rpc = config.chain.rpcUrls[0];
  let ordinal = 0;

  return (
    <>
      <p className="proof-tally" role="status" aria-live="polite" data-testid={TID.proof.tally} data-done={done}>
        {done ? t("proof.tally", { ok: tally.ok, nc: tally.notCheckable, fail: tally.fail }) : t("proof.again.running")}
      </p>

      {record.between && !record.between.read ? (
        <div className="ah-note flex flex-col items-start gap-3">
          <span>{t("proof.between", { n: record.between.requests })}</span>
          <QuietButton compact data-testid={TID.proof.longRead} disabled={readingBetween} onClick={() => void onBetween(record)}>
            {t("proof.between.go")}
          </QuietButton>
        </div>
      ) : null}

      <ol className="proof-timeline" aria-label={t("proof.title")}>
        {sections.map((section) => (
          <li key={section.key} className="proof-section" data-section={section.key}>
            <div className="proof-section__node" aria-hidden="true">
              {section.index}
            </div>
            <h2 className="proof-section__title">{t(`proof.section.${section.key}`)}</h2>
            <ul className="proof-lines">
              {section.checks.map((check) => {
                ordinal += 1;
                return <Line key={check.id} check={check} record={record} section={section.index} shown={ordinal <= shown} lang={lang} exact={exact} />;
              })}
            </ul>
          </li>
        ))}
      </ol>

      <div className="proof-actions">
        <QuietButton data-testid={TID.proof.again} disabled={running || !done} onClick={onAgain}>
          {running || !done ? t("proof.again.running") : t("proof.again")}
        </QuietButton>
        <QuietButton data-testid={TID.proof.download} onClick={() => onDownload(record)}>
          {t("proof.download")}
        </QuietButton>
        <QuietButton data-testid={TID.proof.print} onClick={() => navigate(`/print?receipt=${record.chainId}/${record.handId}`)}>
          {t("proof.print")}
        </QuietButton>
        <a href={handPath} className="ah-quiet">
          {t("proof.openHand")}
        </a>
      </div>
      <p className="ah-label ah-label--dim m-0">{t("proof.download.note")}</p>

      <div data-testid={TID.proof.withoutSite} className="flex flex-col gap-3">
        <Disclose label={t("proof.withoutSite")}>
          <span className="ah-label m-0 normal-case">{t("proof.withoutSite.body")}</span>
          {commit ? null : <span className="ah-label m-0 normal-case">{t("proof.withoutSite.noCommit")}</span>}
          <div className="grid w-full grid-cols-[minmax(0,1fr)]">
            <CopyRow value={verifyLine({ ...(commit ? { commit } : {}), ...(rpc ? { rpc } : {}), core, handId: record.handId })} />
          </div>
          <code className="ah-meta ah-meta--exact break-all" data-testid={TID.proof.verifyLine}>
            {verifyLine({ ...(commit ? { commit } : {}), ...(rpc ? { rpc } : {}), core, handId: record.handId })}
          </code>
          <span className="ah-label m-0 normal-case">{t("proof.withoutSite.bundle")}</span>
          <code className="ah-meta ah-meta--exact break-all">{bundleLine(record.chainId, record.handId)}</code>
        </Disclose>
      </div>
    </>
  );
}
