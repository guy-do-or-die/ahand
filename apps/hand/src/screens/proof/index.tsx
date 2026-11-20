import { collect, decodeCoreError, exportBundle, passportOf, readBetween, usdText, type BuildFacts, type Check, type HandRecord } from "@ahand/sdk";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatEther, getAddress, isAddressEqual, type Address } from "viem";

import { clientOf } from "../../chain";
import { config } from "../../config";
import { t } from "../../i18n";
import { navigate } from "../../router";
import type { ScreenProps } from "../../routes";
import { TID } from "../../testids";
import { CopyRow, Disclose, ErrorBand, Mark, QuietButton, count, day, money, shortAddress, useLang, type Lang } from "../../ui";
import { reproduceLine } from "../core/facts";
import {
  amountOfCheck,
  askerHopKeyOf,
  bundleLine,
  bundleName,
  markOf,
  notCheckableKeyOf,
  payeeOfCheck,
  positionOf,
  sectionsOf,
  sentenceKeyOf,
  sourceLine,
  tallyOf,
  verdictOf,
  verifyLine,
} from "./model";
import { bundleExtra, ethShort, feeOf, moveFor, readPageFacts, sentLines, timeChecks, withPageChecks, type PageFacts, type Sent } from "./sent";
import "./proof.css";

/**
 * The passport `/<chain>/<hand>/proof` (UX-SPEC §10.1): the SDK's `collect` reads the Hand once,
 * `passportOf` proves every fact from that record in this browser, and the checks stand as one
 * timeline in the order of §10.1. Each line: a sentence, one of the three marks from its source,
 * and the evidence (formula, inputs, expected, actual, the event or view with its block). A check
 * that cannot be made here says so in words and is never drawn as failed; a failed one is a
 * finding, in ink and words. Nothing here reads a clock or a link: the record holds no secret.
 *
 * Beside the SDK's record the page reads (sent.ts) how the closing was sent, the token's own
 * `Transfer` for each payout, and the times of the two blocks that carry the raise and the
 * closing, which give two more lines (`time.opened`, `time.closed`). The first line says that the
 * numbers it derives Core from come with this site, and its evidence carries the command that
 * rebuilds the code's hash from a clone.
 */

type Load =
  | { phase: "reading" }
  | { phase: "ready"; record: HandRecord; checks: Check[]; facts: PageFacts | undefined }
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

function amountText(record: HandRecord, amount: bigint, lang: Lang): string {
  const token = config.tokens.find((entry) => isAddressEqual(entry.address, record.view.token));
  return token ? money(amount, token.decimals, lang) : `${count(amount)}`;
}

function sentenceOf(check: Check, record: HandRecord, lang: Lang): string {
  const position = positionOf(check.id);
  const amount = amountOfCheck(check);
  const payee = payeeOfCheck(check);
  return t(sentenceKeyOf(check), {
    n: position === undefined ? "" : String(position + 1),
    amount: amount === undefined ? "" : amountText(record, amount, lang),
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

function Evidence({ check, children }: { check: Check; children?: ReactNode }) {
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
      {children}
    </dl>
  );
}

/**
 * The back of the first line: the command that rebuilds the code's hash from a clone (the same
 * line /core prints), and the two code hashes read from the chain, as information (D-10: the
 * runtime hash is recorded, it is not the proof).
 */
function CoreEvidence({ facts }: { facts: PageFacts | undefined }) {
  const command = reproduceLine(config.deployment?.commit || undefined);
  return (
    <>
      <dt>{t("proof.core.reproduce")}</dt>
      <dd data-testid={TID.proof.coreCommand}>{command}</dd>
      <dd className="grid w-full grid-cols-[minmax(0,1fr)] pt-1">
        <CopyRow value={command} />
      </dd>
      <dt>{t("proof.core.codeInfo")}</dt>
      <dd data-testid={TID.proof.codeHashes} data-runtime={facts?.runtimeHash ?? ""} data-factory={facts?.factoryCodeHash ?? ""}>
        <span className="block break-all">
          {t("proof.lens.runtimeHash")} = {facts?.runtimeHash ?? t("proof.lens.noCode")}
        </span>
        <span className="block break-all">
          {t("proof.lens.factoryHash")} = {facts?.factoryCodeHash ?? t("proof.lens.noCode")}
        </span>
      </dd>
    </>
  );
}

/* ─────────────────────────────────────────────── how the closing was sent ── */

/**
 * The closing transaction, as information beside the checks: who sent it, in which block, what
 * it cost them; its exact fields behind the disclosure. Money is read at the dated price
 * snapshot of the configuration, and says so.
 */
function SentLine({ sent, record, refunded, shown, lang }: { sent: Sent | undefined; record: HandRecord; refunded: boolean; shown: boolean; lang: Lang }) {
  if (!shown) return null;
  if (!sent) {
    return (
      <li className="proof-line proof-line--info" data-testid={TID.proof.sent} data-state="none">
        <p className="proof-nc">{t("proof.sent.none")}</p>
      </li>
    );
  }
  const fee = feeOf(sent);
  const point = (text: string) => (lang === "ru" ? text.replace(".", ",") : text);
  const usd = usdText(Number(formatEther(fee)) * config.prices.ethUsd);
  // The snapshot's date is a calendar day; noon UTC keeps it the same day in every time zone.
  const date = day(Date.parse(`${config.prices.date}T12:00:00Z`) / 1000, lang, "UTC");
  return (
    <li className="proof-line proof-line--info" data-testid={TID.proof.sent} data-state="read" data-from={sent.from} data-gas={String(sent.gasUsed)} data-fee={String(fee)} data-tx={sent.hash}>
      <p className="proof-line__sentence">
        {t(refunded ? "proof.sent.refund" : "proof.sent.thank", { who: shortAddress(sent.from), block: count(sent.blockNumber), eth: point(ethShort(fee)), usd: point(usd), date })}
      </p>
      <div className="proof-line__marks">
        <Mark kind="chain" source={`eth_getTransactionReceipt · ${t("proof.lens.block", { block: count(sent.blockNumber) })}`} />
        <span className="ah-tag">{t("proof.sent.info")}</span>
      </div>
      <Disclose label={t("proof.lens.evidence")} summary="tx">
        <span className="proof-evidence">
          {sentLines(sent, record).map((line) => (
            <span key={line} className="block break-all">
              {line}
            </span>
          ))}
        </span>
      </Disclose>
    </li>
  );
}

/* ─────────────────────────────────────────────────────────────── a line ── */

function Line({ check, record, facts, section, shown, lang }: { check: Check; record: HandRecord; facts: PageFacts | undefined; section: number; shown: boolean; lang: Lang }) {
  const verdict = verdictOf(check);
  const mark = markOf(check);
  const source = sourceLine(check.source);
  const paid = check.id.startsWith("payout.") && check.actual.startsWith("Paid");
  const move = paid ? moveFor(check, record, facts?.sent) : undefined;
  const askerHop = askerHopKeyOf(check, record.view.raiser);
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
      <p className="proof-line__sentence">{sentenceOf(check, record, lang)}</p>
      {askerHop ? (
        <p className="ah-note m-0" data-testid={TID.proof.askerHop} data-value={check.id}>
          {t(askerHop)}
        </p>
      ) : null}
      {shown && check.id === "core" && verdict !== "not-checkable" ? (
        <p className="proof-nc" data-testid={TID.proof.coreCaveat}>
          {t("proof.core.caveat")}
        </p>
      ) : null}
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
          {paid && facts?.sent ? (
            <div className="proof-move" data-testid={TID.proof.move} data-found={String(move !== undefined)} data-log={move ? move.logIndex : ""} data-to={move?.to ?? ""} data-amount={move ? String(move.amount) : ""}>
              {move ? (
                <>
                  <p className="m-0">{t("proof.move", { amount: amountText(record, move.amount, lang), who: shortAddress(move.to) })}</p>
                  <span className="ah-meta ah-meta--exact break-all">{t("proof.lens.move", { token: move.token, to: move.to, amount: String(move.amount), index: move.logIndex })}</span>
                </>
              ) : (
                <p className="m-0">{t("proof.move.none")}</p>
              )}
            </div>
          ) : null}
          <Disclose label={t("proof.lens.evidence")} summary={check.id.replace(/0x[0-9a-fA-F]{40}/, (address) => shortAddress(address))}>
            <Evidence check={check}>{check.id === "core" ? <CoreEvidence facts={facts} /> : null}</Evidence>
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
    async (record: HandRecord, facts: PageFacts | undefined) => {
      const checks = withPageChecks(await passportOf(record), timeChecks(record, facts));
      setLoad({ phase: "ready", record, checks, facts });
      tick(checks.length);
    },
    [tick],
  );

  const run = useCallback(async () => {
    if (chainId !== config.chain.id) return setLoad({ phase: "bad", what: "chain" });
    if (!core || !trusted) return setLoad({ phase: "bad", what: "core" });
    setRunning(true);
    try {
      const client = clientOf(chainId);
      const record = await collect(client, core, handId, BUILD ? { build: BUILD } : {});
      // The page's own reads never fail the passport: what could not be read is said on its line.
      const facts = await readPageFacts(client, record, BUILD?.factory).catch(() => undefined);
      await prove(record, facts);
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
    // one read per Hand address
  }, [params.chain, params.core, params.hand]);

  const between = async (record: HandRecord, facts: PageFacts | undefined) => {
    setReadingBetween(true);
    try {
      await prove(await readBetween(clientOf(chainId), record), facts);
    } catch {
      setLoad({ phase: "bad", what: "offline" });
    } finally {
      setReadingBetween(false);
    }
  };

  const download = (record: HandRecord, facts: PageFacts | undefined) => {
    // The SDK's bundle, with what this page read beside it under `extra` (readBundle ignores it).
    const blob = new Blob([exportBundle({ ...record, extra: bundleExtra(facts) } as HandRecord)], { type: "application/json" });
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
          CHAIN {chainId} · CORE {core ? shortAddress(core) : "—"} · HAND {params.hand}
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
  onBetween: (record: HandRecord, facts: PageFacts | undefined) => Promise<void>;
  onDownload: (record: HandRecord, facts: PageFacts | undefined) => void;
  handPath: string;
  core: Address;
}) {
  const { record, checks, facts } = load;
  const sections = sectionsOf(checks);
  const refunded = checks.some((check) => check.id === "refunded");
  // The line about how the closing was sent opens the part that holds the payouts.
  const sentIn = record.closingTx ? (refunded ? "back" : "payouts") : undefined;
  const tally = tallyOf(checks);
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
          <QuietButton compact data-testid={TID.proof.longRead} disabled={readingBetween} onClick={() => void onBetween(record, facts)}>
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
              {section.key === sentIn ? <SentLine sent={facts?.sent} record={record} refunded={refunded} shown={ordinal < shown} lang={lang} /> : null}
              {section.checks.map((check) => {
                ordinal += 1;
                return <Line key={check.id} check={check} record={record} facts={facts} section={section.index} shown={ordinal <= shown} lang={lang} />;
              })}
            </ul>
          </li>
        ))}
      </ol>

      <div className="proof-actions">
        <QuietButton data-testid={TID.proof.again} disabled={running || !done} onClick={onAgain}>
          {running || !done ? t("proof.again.running") : t("proof.again")}
        </QuietButton>
        <QuietButton data-testid={TID.proof.download} onClick={() => onDownload(record, facts)}>
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
          <code className="ah-meta ah-meta--exact break-all">{bundleLine(record.chainId, record.handId, rpc)}</code>
        </Disclose>
      </div>
    </>
  );
}
