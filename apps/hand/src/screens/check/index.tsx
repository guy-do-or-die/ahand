import {
  CoreRefused,
  LinkError,
  UntrustedCore,
  checkGiveOnChain,
  checkRouteOnChain,
  decodeCoreError,
  fromText,
  getHandFor,
  isKeySignature,
  messageIdOf,
  openAddress,
  openLink,
  peekLink,
  runSteps,
  unwrap6492,
  type AccountSetup,
  type LinkHead,
  type OpenedLink,
  type StepResult,
} from "@ahand/sdk";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { CLIENTS, clientOf } from "../../chain";
import { config } from "../../config";
import { t } from "../../i18n";
import { TID } from "../../testids";
import { ErrorBand, Mark, QuietButton, count, percent, useLang } from "../../ui";
import { agree, answerName, hereAnswer, stepKey, type CoreAnswer, type HereAnswer } from "./model";
import { outsideLength, rulerOf, splitPasted, type Ruler } from "./ruler";
import "./check.css";

/**
 * /check (UX-SPEC §10.2): paste any address or link. First, with no network, a ruler of the
 * link's bytes (the secret part hatched, never printed); then Core's checks in Core's own order,
 * run here by the SDK's `runSteps` over the Hand's terms (one `hands(id)` read); then Core's own
 * answer by `eth_call` (`checkRoute`, or `checkGive` for an answer), beside it. A disagreement
 * between the columns is a finding.
 *
 * Secret hygiene: the box is uncontrolled and is emptied the moment it is read, so the link is
 * never in the page's markup; the text is held in this component's memory only, and nothing of
 * it is rendered but lengths and what the link names (chain, Hand number, passes).
 */

const CANONICAL = config.cores.canonical ?? undefined;
const OPTIONS = CANONICAL ? { canonicalCore: CANONICAL } : {};
const TRUSTED = config.cores.trusted;
const TICK_MS = 140;

type Measured = { ruler?: Ruler; head?: LinkHead; outside: number };

type Here = { state: "reading" } | { state: "done"; steps: StepResult[]; answer: HereAnswer; opened: OpenedLink } | { state: "failed"; messageId: string };

type Core = { state: "waiting" } | { state: "reading" } | { state: "done"; answer: CoreAnswer; block: bigint; share?: number } | { state: "offline" };

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function messageOf(error: unknown): string {
  if (error instanceof UntrustedCore || error instanceof LinkError) return messageIdOf(error);
  const refusal = error instanceof CoreRefused ? error : decodeCoreError(error);
  if (refusal) return messageIdOf(refusal);
  return "common.error.offline";
}

/* ─────────────────────────────────────────────────────────────── ruler ── */

function RulerView({ measured }: { measured: Measured }) {
  const { ruler, head, outside } = measured;
  if (!ruler) return <p className="m-0">{t("check.ruler.none")}</p>;
  return (
    <div className="flex flex-col gap-3" data-testid={TID.check.ruler} data-total={ruler.total}>
      <p className="m-0 font-semibold">{t(`check.kind.${ruler.kind}`)}</p>
      {head ? <p className="m-0">{t("check.names", { hand: head.handId.toString(), chain: head.chainId, n: head.shakes })}</p> : null}
      <div className="check-ruler" role="img" aria-label={t("check.ruler.total", { n: ruler.total })}>
        {ruler.segments.map((segment) => (
          <span
            key={`${segment.kind}-${segment.start}`}
            className={`check-ruler__seg check-ruler__seg--${segment.kind}`}
            style={{ flexGrow: segment.length }}
            data-kind={segment.kind}
            data-length={segment.length}
          />
        ))}
      </div>
      <ol className="check-legend">
        {ruler.segments.map((segment) => (
          <li key={`${segment.kind}-${segment.start}`} className="check-legend__item">
            <span className={`check-legend__swatch check-ruler__seg--${segment.kind}`} aria-hidden="true" />
            <span>{segment.kind === "shake" ? t("check.ruler.shake", { n: (segment.position ?? 0) + 1 }) : t(`check.ruler.${segment.kind}`)}</span>
            <span className="ah-meta ah-meta--exact">
              {segment.start}–{segment.start + segment.length - 1} · {segment.length} B
            </span>
          </li>
        ))}
      </ol>
      <p className="ah-meta m-0">{t("check.ruler.total", { n: ruler.total })}</p>
      {outside > 0 ? <p className="ah-meta m-0">{t("check.ruler.outside", { n: outside })}</p> : null}
      {ruler.segments.some((segment) => segment.kind === "secret") ? <p className="ah-label ah-label--dim m-0 normal-case">{t("check.ruler.secretNote")}</p> : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── steps ── */

function StepsView({ here, shown }: { here: Extract<Here, { state: "done" }>; shown: number }) {
  const giverIsKey = here.opened.signedGive ? isKeySignature(here.opened.signedGive.giverSig) : true;
  return (
    <ol className="check-steps">
      {here.steps.map((step, index) => {
        const visible = index < shown;
        const account = step.of === "give" && step.check === "InvalidGiverSig" && step.status === "fail" && !giverIsKey;
        const status = !visible ? "pending" : account ? "account" : step.status;
        return (
          <li key={index} className={`check-step check-step--${status}`} data-testid={TID.check.step} data-index={index} data-check={step.check} data-status={status}>
            <span className="check-step__mark" aria-hidden="true">
              {status === "pass" ? "✓" : status === "fail" ? "✕" : status === "pending" ? "·" : "–"}
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span>{t(stepKey(step), { n: (step.position ?? 0) + 1 })}</span>
              <span className="ah-meta ah-meta--exact">
                {step.check}
                {step.position === undefined ? "" : `(${step.position})`}
                {visible ? ` · ${account ? t("check.status.not-reached") : t(`check.status.${step.status}`)}` : ""}
              </span>
              {visible && account ? <span className="ah-label ah-label--dim normal-case">{t("check.status.account")}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ──────────────────────────────────────────────────────────── the screen ── */

export default function CheckScreen() {
  const lang = useLang();
  const box = useRef<HTMLTextAreaElement>(null);
  const [measured, setMeasured] = useState<Measured | undefined>();
  const [here, setHere] = useState<Here | undefined>();
  const [core, setCore] = useState<Core>({ state: "waiting" });
  const [shown, setShown] = useState(0);
  const [failure, setFailure] = useState<string | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const run = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const tick = (total: number) => {
    if (timer.current) clearTimeout(timer.current);
    if (reducedMotion()) return setShown(total);
    setShown(0);
    let at = 0;
    const next = () => {
      at += 1;
      setShown(at);
      if (at < total) timer.current = setTimeout(next, TICK_MS);
    };
    timer.current = setTimeout(next, TICK_MS);
  };

  async function check(text: string) {
    const mine = ++run.current;
    const current = () => mine === run.current;
    setFailure(undefined);
    setHere(undefined);
    setCore({ state: "waiting" });
    setShown(0);

    // 1. With no network: the bytes.
    const { before, fragment } = splitPasted(text);
    let bytes: Uint8Array;
    try {
      bytes = fromText(fragment);
    } catch (error) {
      setMeasured(undefined);
      setFailure(messageOf(error));
      return;
    }
    let ruler: Ruler | undefined;
    let head: LinkHead | undefined;
    try {
      ruler = rulerOf(bytes);
    } catch {
      ruler = undefined;
    }
    try {
      head = peekLink(bytes, OPTIONS);
    } catch {
      head = undefined;
    }
    setMeasured({ ...(ruler ? { ruler } : {}), ...(head ? { head } : {}), outside: outsideLength(before) });

    // 2. Here: open against the Hand's terms (one read of hands(id)), then Core's order.
    setHere({ state: "reading" });
    let opened: OpenedLink;
    try {
      const getHand = getHandFor(CLIENTS, TRUSTED);
      opened = before ? await openAddress(`${before}#${fragment}`, getHand, OPTIONS) : await openLink(bytes, getHand, OPTIONS);
    } catch (error) {
      if (current()) setHere({ state: "failed", messageId: messageOf(error) });
      return;
    }
    const steps = await runSteps(opened.domain, opened.hand, opened.signedShakes, opened.signedGive);
    const giverIsKey = opened.signedGive ? isKeySignature(opened.signedGive.giverSig) : true;
    if (!current()) return;
    setHere({ state: "done", steps, answer: hereAnswer(steps, giverIsKey), opened });
    tick(steps.length);

    // 3. Core's own answer, by eth_call.
    setCore({ state: "reading" });
    const client = clientOf(opened.head.chainId);
    const { core: address, handId } = opened.head;
    try {
      const block = await client.getBlockNumber({ cacheTime: 0 });
      if (opened.signedGive) {
        const wrapped = unwrap6492(opened.signedGive.giverSig);
        const setup: AccountSetup | undefined = wrapped && config.forwarder ? { forwarder: config.forwarder, factory: wrapped.factory, factoryData: wrapped.factoryData } : undefined;
        await checkGiveOnChain(client, address, handId, opened.signedShakes, opened.signedGive, setup);
        if (current()) setCore({ state: "done", answer: { kind: "accepted" }, block });
      } else {
        const end = await checkRouteOnChain(client, address, handId, opened.signedShakes);
        if (current()) setCore({ state: "done", answer: { kind: "accepted" }, block, share: end.claimBps });
      }
    } catch (error) {
      const refusal = error instanceof CoreRefused ? error : decodeCoreError(error);
      if (!current()) return;
      if (refusal) {
        const block = await client.getBlockNumber({ cacheTime: 0 }).catch(() => 0n);
        setCore({ state: "done", answer: { kind: "refused", name: refusal.name, ...(refusal.position === undefined ? {} : { position: refusal.position }) }, block });
      } else setCore({ state: "offline" });
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const field = box.current;
    if (!field) return;
    const text = field.value;
    field.value = ""; // the link leaves the box at once: it lives in this function's memory only
    if (text.trim() === "") return;
    void check(text);
  };

  const accepted = t("check.finding.accepted");
  const doneHere = here?.state === "done" ? here : undefined;
  const ticked = doneHere ? shown >= doneHere.steps.length : false;
  const compared = doneHere && core.state === "done" && ticked ? { same: agree(doneHere.answer, core.answer), here: doneHere.answer, core: core.answer } : undefined;

  return (
    <section className="check mx-auto flex w-full max-w-[960px] flex-col gap-7 px-6 py-10 md:px-10" data-screen="check">
      <header className="flex max-w-[680px] flex-col gap-3">
        <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("check.title")}</h1>
        <p className="m-0 text-[length:var(--fs-body-lg)] leading-snug">{t("check.intro")}</p>
      </header>

      <form className="flex max-w-[680px] flex-col gap-2" onSubmit={submit}>
        <label htmlFor="check-box" className="ah-field__label">
          {t("check.label")}
        </label>
        <textarea
          id="check-box"
          ref={box}
          data-testid={TID.check.input}
          className="ah-input ah-input--exact check-box"
          placeholder={t("check.placeholder")}
          rows={3}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <QuietButton type="submit" data-testid={TID.check.run}>
            {measured || failure ? t("check.another") : t("check.run")}
          </QuietButton>
          {measured || failure ? <span className="ah-label ah-label--dim normal-case">{t("check.cleared")}</span> : null}
        </div>
        <p className="ah-label m-0 normal-case">{t("check.privacy")}</p>
      </form>

      {failure ? <ErrorBand what={`${t("check.error.title")} ${t(failure)}`} kept={t("check.error.kept")} code={failure} /> : null}

      {measured ? (
        <section className="check-part">
          <h2 className="check-part__title">{t("check.ruler.title")}</h2>
          <RulerView measured={measured} />
        </section>
      ) : null}

      {here ? (
        <div className="check-columns">
          <section className="check-part">
            <h2 className="check-part__title">{t("check.here.title")}</h2>
            <p className="m-0">{t("check.here.body")}</p>
            {here.state === "reading" ? <p className="ah-meta m-0">{t("check.core.asking")}</p> : null}
            {here.state === "failed" ? <ErrorBand what={`${t("check.error.title")} ${t(here.messageId)}`} kept={t("check.error.kept")} code={here.messageId} /> : null}
            {doneHere ? (
              <>
                <p className="ah-label ah-label--dim m-0 normal-case">{t("check.here.chainOnly")}</p>
                <StepsView here={doneHere} shown={shown} />
                {ticked ? (
                  <div className="check-claim">
                    <p className="m-0 font-bold">{doneHere.answer.kind === "accepted" ? t("check.here.verdict.pass") : t("check.here.verdict.fail", { name: answerName(doneHere.answer, accepted) })}</p>
                    <Mark kind="checked" source="runSteps · checkOrder" />
                  </div>
                ) : null}
              </>
            ) : null}
          </section>

          <section className="check-part" data-testid={TID.check.coreAnswer} data-state={core.state} data-value={core.state === "done" ? answerName(core.answer, "accepted") : ""}>
            <h2 className="check-part__title">{t("check.core.title")}</h2>
            <p className="m-0">{t("check.core.body")}</p>
            {core.state === "reading" || core.state === "waiting" ? <p className="ah-meta m-0">{t("check.core.asking")}</p> : null}
            {core.state === "offline" ? <ErrorBand what={t("check.core.offline")} /> : null}
            {core.state === "done" ? (
              <div className="flex flex-col items-start gap-2">
                <p className="m-0 font-bold">
                  {core.answer.kind === "accepted"
                    ? core.share !== undefined
                      ? t("check.core.accepted.route", { share: percent(core.share, lang) })
                      : t("check.core.accepted.give")
                    : `${t("check.core.refused")} ${t(`core.${core.answer.name}`)}`}
                </p>
                <span className="ah-meta ah-meta--exact">{answerName(core.answer, "accepted")}</span>
                <Mark kind="chain" source={`${doneHere?.opened.signedGive ? "checkGive" : "checkRoute"} · eth_call · BLOCK ${count(core.block)}`} />
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {compared ? (
        compared.same ? (
          <p className="check-agree" data-testid={TID.check.agree}>
            {t("check.agree")}
          </p>
        ) : (
          <div className="check-finding" role="note" data-testid={TID.check.finding}>
            {t("check.finding", { here: answerName(compared.here, accepted), core: answerName(compared.core, accepted) })}
          </div>
        )
      ) : null}
    </section>
  );
}
