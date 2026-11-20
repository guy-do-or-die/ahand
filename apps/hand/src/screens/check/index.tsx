import {
  CoreRefused,
  LinkError,
  UntrustedCore,
  chainNow,
  checkGiveOnChain,
  checkRouteOnChain,
  decodeCoreError,
  fromText,
  getHandFor,
  giveHash,
  isKeySignature,
  messageIdOf,
  openAddress,
  openLink,
  peekLink,
  readHand,
  readThank,
  runSteps,
  unwrap6492,
  type AccountSetup,
  type LinkHead,
  type OpenedLink,
  type StepResult,
} from "@ahand/sdk";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { isAddressEqual, type PublicClient } from "viem";

import { CLIENTS, clientOf, isNetworkError } from "../../chain";
import { config } from "../../config";
import { t } from "../../i18n";
import { TID } from "../../testids";
import { ccipReadIsHere } from "../../chain/ccip";
import { addressOf, openedLink } from "../../store/memory";
import { ErrorBand, Mark, QuietButton, count, day, minute, percent, shortAddress, useLang, type Lang } from "../../ui";
import { agree, answerName, canStillThank, coreSentences, handNow, hereAnswer, standingOf, stepKey, type CoreAnswer, type HandNow, type HereAnswer, type Standing } from "./model";
import { readOffline, type OfflineReading, type OfflineWords } from "./offline";
import { outsideLength, rulerOf, splitPasted, type Ruler } from "./ruler";
import "./check.css";

/**
 * /check (UX-SPEC §10.2): paste any address or link.
 *
 * 1. With no network: a ruler of the link's bytes (the secret part hatched, never printed).
 * 2. With the Hand's terms (one `hands(id)` read): Core's checks in Core's own order, run here by
 *    the SDK's `runSteps`. Confirmations are made over those terms, so with no network none of
 *    them can be checked; the column then shows what the bytes alone say (`offline.ts`), marked
 *    as not compared with the contract.
 * 3. Core's own answer by `eth_call` (`checkRoute`, or `checkGive` for an answer), and, read at
 *    the same block, what the Hand itself is: `checkGive` does not look at whether the Hand is
 *    closed or past its time, so "the contract accepts this" alone never means "this can still be
 *    thanked". A thanked Hand's own answer is named as the one that was thanked.
 * A disagreement between columns 2 and 3 is a finding.
 *
 * Core's two checks look at neither the expiry nor `closedAt`, so column 3 first says where the
 * Hand stands at the latest block's time (thanked, refunded, time's up), and an accepted route on
 * a Hand that is no longer open is called valid, never a payout.
 *
 * Secret hygiene: the box is uncontrolled and is emptied the moment it is read, so the link is
 * never in the page's markup; the text is held in this component's memory only (for "Try again"
 * when the network was away), and nothing of it is rendered but lengths, what the link names
 * (chain, Hand number, passes) and, with no network, the parts the format keeps public. Reached
 * with a link in this tab's memory (store/memory.ts, from a Hand view), the page checks that link
 * at once, read from memory the same way: nothing is pasted, written to the address or stored.
 */

const CANONICAL = config.cores.canonical ?? undefined;
const OPTIONS = CANONICAL ? { canonicalCore: CANONICAL } : {};
const TRUSTED = config.cores.trusted;
const TICK_MS = 140;
const OFFLINE = "common.error.offline";
const UNKNOWN = "check.error.unknown";

type Measured = { ruler?: Ruler; head?: LinkHead; outside: number };

type Here =
  | { state: "reading" }
  | { state: "done"; steps: StepResult[]; answer: HereAnswer; opened: OpenedLink }
  | { state: "failed"; messageId: string }
  /** The Hand's terms could not be read: only what the bytes say is shown. */
  | { state: "offline"; reading?: OfflineReading };

type Core =
  | { state: "waiting" }
  | { state: "reading" }
  /**
   * `now` is what the Hand is for what was pasted (the answer that was thanked, or another);
   * `standing` is its state as column 3 says it first (none for a Hand that is not raised).
   */
  | { state: "done"; answer: CoreAnswer; block: bigint; time: number; share?: number; now: HandNow; standing?: { state: Standing; at?: number }; proofPath: string }
  /** The network could not be reached: Core was not asked. */
  | { state: "offline" }
  /** The read failed for another reason than the network or Core's own refusal. */
  | { state: "failed" }
  /** The link did not open here, so there is nothing to ask Core about. */
  | { state: "skipped" };

/**
 * The same client with every `eth_call` pinned to one block, so that the Hand's state and Core's
 * answer are of one moment. The SDK's reads take a client and no block; this hands them one that
 * adds it.
 */
function pinnedTo(client: PublicClient, blockNumber: bigint): PublicClient {
  return {
    ...client,
    readContract: ((args: Parameters<PublicClient["readContract"]>[0]) => client.readContract({ ...args, blockNumber } as never)) as PublicClient["readContract"],
    call: ((args: Parameters<PublicClient["call"]>[0]) => client.call({ ...args, blockNumber } as never)) as PublicClient["call"],
  } as PublicClient;
}

/** The browser itself says there is no network: no request is tried. (Its "online" is not trusted: that is found out by asking.) */
function knownOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The sentence id of a failure: the link's own refusal, Core's, or the network not answering (the
 * app's one test of that, `isNetworkError`). Anything else is a fault of the check itself and is
 * said as such, never as "offline".
 */
function messageOf(error: unknown): string {
  if (error instanceof UntrustedCore || error instanceof LinkError) return messageIdOf(error);
  const refusal = error instanceof CoreRefused ? error : decodeCoreError(error);
  if (refusal) return messageIdOf(refusal);
  return isNetworkError(error) ? OFFLINE : UNKNOWN;
}

/** "Nothing was sent.", unless the sentence before it already ends with those words. */
function keptAfter(sentence: string): string | undefined {
  const kept = t("check.error.kept");
  return sentence.trimEnd().endsWith(kept) ? undefined : kept;
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
              {t("check.ruler.span", { from: segment.start, to: segment.start + segment.length - 1, n: segment.length })}
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

/* ───────────────────────────────────────────────── with no network ── */

function WordsView({ label, words }: { label: string; words: OfflineWords }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="ah-label ah-label--dim normal-case">{label}</span>
      {words.texts.map((text, index) => (
        <p key={index} className="check-words m-0">
          {text}
        </p>
      ))}
      {words.names.length > 0 ? <span className="ah-meta ah-meta--exact break-all">{words.names.join(" · ")}</span> : null}
    </div>
  );
}

/** What the bytes alone say (offline.ts): shares, payees, the answer's helper, the words. Nothing is called checked. */
function OfflineView({ reading, lang }: { reading: OfflineReading; lang: Lang }) {
  const { passes, give, inside, outside } = reading;
  return (
    <div className="flex flex-col gap-3" data-testid={TID.check.offline} data-passes={passes.length} data-left={reading.leftBps}>
      {passes.length === 0 ? <p className="m-0">{t("check.offline.none")}</p> : null}
      {passes.length > 0 ? (
        <ol className="check-steps">
          {passes.map((pass) => {
            const kept = pass.claimBps - pass.nextClaimBps;
            return (
              <li key={pass.position} className="check-step check-step--unchecked" data-testid={TID.check.offlinePass} data-index={pass.position} data-kept={kept} data-next={pass.nextClaimBps}>
                <span className="check-step__mark" aria-hidden="true">
                  ?
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span>
                    {pass.payee
                      ? t("check.offline.pass.keeps", { n: pass.position + 1, kept: percent(kept, lang), who: shortAddress(pass.payee), next: percent(pass.nextClaimBps, lang) })
                      : t("check.offline.pass.free", { n: pass.position + 1, next: percent(pass.nextClaimBps, lang) })}
                    {pass.ownWords ? ` ${t("check.offline.ownWords")}` : ""}
                  </span>
                  <span className="ah-meta ah-meta--exact break-all">
                    claimBps {pass.claimBps} → {pass.nextClaimBps}
                    {pass.payee ? ` · payee ${pass.payee}` : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {passes.length > 0 || give ? <p className="m-0 font-bold">{t("check.offline.left", { share: percent(reading.leftBps, lang) })}</p> : null}
      {give ? (
        <div className="flex flex-col gap-1">
          <p className="m-0">
            {t("check.offline.give", { who: shortAddress(give.signer), payee: shortAddress(give.payee) })}{" "}
            {give.byKey ? t("check.offline.give.key") : t("check.offline.give.account", { n: give.confirmationBytes })}
          </p>
          <span className="ah-meta ah-meta--exact break-all">
            signer {give.signer} · payee {give.payee}
          </span>
        </div>
      ) : null}
      <p className="check-unchecked m-0">{t("check.offline.unchecked")}</p>
      {inside || outside ? (
        <div className="flex flex-col gap-2">
          <h3 className="check-part__title">{t("check.offline.words")}</h3>
          {outside ? <WordsView label={t("check.offline.words.outside")} words={outside} /> : null}
          {inside ? <WordsView label={t("check.offline.words.inside")} words={inside} /> : null}
          <p className="ah-label ah-label--dim m-0 normal-case">{t("check.offline.words.note")}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────── column 3's sentences ── */

/**
 * The first sentence of the Hand itself: an open Hand's date and what this paste can still get
 * (with no answer, the share the route leaves); a closed or ended Hand's state with its date, and
 * on a closed one that the route is valid but pays nobody (coreSentences).
 */
function stateSentence(core: Extract<Core, { state: "done" }>, said: ReturnType<typeof coreSentences>, lang: Lang): string {
  const { now } = core;
  if (now.state === "open") {
    const date = minute(now.expiry, lang);
    if (core.answer.kind !== "accepted") return t("check.now.open.refused", { date });
    return core.share !== undefined ? t("check.now.open.route", { date, share: percent(core.share, lang) }) : t("check.now.open.give", { date });
  }
  const date = core.standing?.at !== undefined ? day(core.standing.at, lang) : "";
  return said.state ? `${t(said.state, { date })}${said.valid ? ` ${t(said.valid)}` : ""}` : "";
}

/**
 * Column 3 once Core has answered: first where the Hand stands at that block (hands(id) and
 * thanks(id), whether the pasted answer is the one thanked, the passport of a closed Hand), then
 * Core's own sentence, which on a Hand that is no longer open calls a route valid and nothing more.
 * A Hand that is not raised has no standing: Core's own refusal says it.
 */
function CoreSaid({ core, give, lang }: { core: Extract<Core, { state: "done" }>; give: boolean; lang: Lang }) {
  const said = coreSentences(core.standing?.state, core.answer, give);
  const { now } = core;
  const coreText = core.answer.kind === "refused" ? `${t(said.core)} ${t(`core.${core.answer.name}`)}` : t(said.core);
  return (
    <>
      {core.standing ? (
        <div className={`check-now ${canStillThank(now) ? "" : "check-now--over"}`} role="note" data-testid={TID.check.handNow} data-state={now.state} data-block={String(core.block)}>
          <h3 className="check-part__title">{t("check.now.title")}</h3>
          <p className="check-said__state m-0" data-testid={TID.check.handState} data-value={core.standing.state}>
            {stateSentence(core, said, lang)}
          </p>
          {now.state === "thanked-this" || now.state === "thanked-other" ? <p className="m-0 font-bold">{t(`check.now.${now.state}`)}</p> : null}
          {now.state === "open" || now.state === "expired" ? null : (
            <a href={core.proofPath} className="ah-label inline-flex min-h-[44px] items-center self-start underline decoration-dashed underline-offset-4" data-testid={TID.check.passport}>
              {t("check.now.passport")}
            </a>
          )}
          <Mark kind="chain" source={t("check.lens.now", { block: count(core.block), time: minute(core.time, lang) })} />
        </div>
      ) : null}
      <div className="flex flex-col items-start gap-2">
        <p className="m-0 font-bold">{coreText}</p>
        <span className="ah-meta ah-meta--exact">{answerName(core.answer, "accepted")}</span>
        <Mark kind="chain" source={`${give ? "checkGive" : "checkRoute"} · eth_call · BLOCK ${count(core.block)}`} />
        {core.answer.kind === "accepted" && !said.state ? <p className="ah-label ah-label--dim m-0 normal-case">{t("check.core.scope")}</p> : null}
      </div>
    </>
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
  const [fromMemory, setFromMemory] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const run = useRef(0);
  /** The last text checked, kept in memory only, so "Try again" works once the network is back. */
  const last = useRef<string | undefined>(undefined);

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
      // No network was asked yet: text that does not read as a link is a damaged link.
      setMeasured(undefined);
      setFailure(error instanceof LinkError ? messageIdOf(error) : "link.malformed");
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

    // With no network, what the bytes alone say stands in column 2 and Core is not asked.
    const offline = () => {
      let reading: OfflineReading | undefined;
      try {
        reading = ruler ? readOffline(bytes, ruler, before) : undefined;
      } catch {
        reading = undefined;
      }
      setHere({ state: "offline", ...(reading ? { reading } : {}) });
      setCore({ state: "offline" });
    };
    if (knownOffline()) return offline();

    // 2. Here: open against the Hand's terms (one read of hands(id)), then Core's order.
    setHere({ state: "reading" });
    let opened: OpenedLink;
    try {
      const getHand = getHandFor(CLIENTS, TRUSTED);
      opened = before ? await openAddress(`${before}#${fragment}`, getHand, OPTIONS) : await openLink(bytes, getHand, OPTIONS);
    } catch (error) {
      if (!current()) return;
      const messageId = messageOf(error);
      if (messageId === OFFLINE) return offline();
      setHere({ state: "failed", messageId });
      setCore({ state: "skipped" });
      return;
    }
    const steps = await runSteps(opened.domain, opened.hand, opened.signedShakes, opened.signedGive);
    const giverIsKey = opened.signedGive ? isKeySignature(opened.signedGive.giverSig) : true;
    if (!current()) return;
    setHere({ state: "done", steps, answer: hereAnswer(steps, giverIsKey), opened });
    tick(steps.length);

    // 3. Core's own answer by eth_call, and the Hand itself, all at one block: the latest, whose
    //    timestamp is the network's clock, never this device's. checkRoute and checkGive do not
    //    look at whether the Hand is closed or past its time; hands(id) and thanks(id) say that,
    //    and the screen says it before Core's sentence.
    setCore({ state: "reading" });
    const { chainId, core: address, handId } = opened.head;
    try {
      const tip = await chainNow(clientOf(chainId));
      const at = pinnedTo(clientOf(chainId), tip.number);
      const asked = async (): Promise<{ answer: CoreAnswer; share?: number }> => {
        try {
          if (opened.signedGive) {
            const wrapped = unwrap6492(opened.signedGive.giverSig);
            const setup: AccountSetup | undefined = wrapped && config.forwarder ? { forwarder: config.forwarder, factory: wrapped.factory, factoryData: wrapped.factoryData } : undefined;
            await checkGiveOnChain(at, address, handId, opened.signedShakes, opened.signedGive, setup);
            return { answer: { kind: "accepted" } };
          }
          const end = await checkRouteOnChain(at, address, handId, opened.signedShakes);
          return { answer: { kind: "accepted" }, share: end.claimBps };
        } catch (error) {
          const refusal = error instanceof CoreRefused ? error : decodeCoreError(error);
          if (!refusal) throw error;
          return { answer: { kind: "refused", name: refusal.name, ...(refusal.position === undefined ? {} : { position: refusal.position }) } };
        }
      };
      const [read, thank, { answer, share }] = await Promise.all([readHand(at, address, handId), readThank(at, address, handId), asked()]);
      const { view } = read;
      if (!current()) return;
      const now = handNow({
        closedAt: view.closedAt,
        expiry: view.expiry,
        thankedGiveHash: thank.giveHash,
        now: tip.timestamp,
        ...(opened.signedGive ? { pastedGiveHash: giveHash(opened.hand, opened.signedGive.give) } : {}),
      });
      const standing = standingOf(read.stateAt(tip.timestamp), view);
      const canonical = CANONICAL !== undefined && isAddressEqual(CANONICAL, address);
      const proofPath = canonical ? `/${chainId}/${handId}/proof` : `/${chainId}/${address.toLowerCase()}/${handId}/proof`;
      setCore({ state: "done", answer, block: tip.number, time: tip.timestamp, ...(share === undefined ? {} : { share }), now, ...(standing ? { standing } : {}), proofPath });
    } catch (error) {
      if (current()) setCore({ state: isNetworkError(error) ? "offline" : "failed" });
    }
  }

  // Reached with a link in this tab's memory (a Hand view's "Check this link in detail"): check it
  // at once, without a paste. The text goes from memory to `check` and nowhere else.
  useEffect(() => {
    const held = openedLink();
    const text = held ? addressOf(held) : undefined;
    if (!text) return;
    setFromMemory(true);
    last.current = text; // "Try again" reads it from memory too
    void check(text);
    // once, on arrival
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const field = box.current;
    if (!field) return;
    const text = field.value;
    field.value = ""; // the link leaves the box at once: it lives in this component's memory only
    if (text.trim() === "") return;
    last.current = text;
    setFromMemory(false);
    void check(text);
  };

  const accepted = t("check.finding.accepted");
  const doneHere = here?.state === "done" ? here : undefined;
  const ticked = doneHere ? shown >= doneHere.steps.length : false;
  const compared = doneHere && core.state === "done" && ticked ? { same: agree(doneHere.answer, core.answer), here: doneHere.answer, core: core.answer } : undefined;
  const offline = here?.state === "offline" || core.state === "offline";

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
          {measured || failure ? <span className="ah-label ah-label--dim normal-case">{fromMemory ? t("check.fromMemory") : t("check.cleared")}</span> : null}
        </div>
        <p className="ah-label m-0 normal-case">{t("check.privacy")}</p>
      </form>

      {failure ? <ErrorBand what={`${t("check.error.title")} ${t(failure)}`} kept={keptAfter(t(failure))} code={failure} /> : null}

      {measured ? (
        <section className="check-part">
          <h2 className="check-part__title">{t("check.ruler.title")}</h2>
          <RulerView measured={measured} />
        </section>
      ) : null}

      {offline ? (
        <div data-testid={TID.check.offlineBand} data-ccip={String(ccipReadIsHere)}>
          <ErrorBand
            what={t(OFFLINE)}
            action={
              <QuietButton compact data-testid={TID.check.retry} onClick={() => (last.current ? void check(last.current) : undefined)}>
                {t("check.offline.retry")}
              </QuietButton>
            }
          />
        </div>
      ) : null}

      {here ? (
        <div className="check-columns">
          <section className="check-part" data-state={here.state}>
            <h2 className="check-part__title">{here.state === "offline" ? t("check.offline.title") : t("check.here.title")}</h2>
            <p className="m-0">{here.state === "offline" ? t("check.offline.body") : t("check.here.body")}</p>
            {here.state === "offline" && here.reading ? <OfflineView reading={here.reading} lang={lang} /> : null}
            {here.state === "offline" && !here.reading ? <p className="check-unchecked m-0">{t("check.offline.unchecked")}</p> : null}
            {here.state === "reading" ? <p className="ah-meta m-0">{t("check.core.asking")}</p> : null}
            {here.state === "failed" ? <ErrorBand what={`${t("check.error.title")} ${t(here.messageId)}`} kept={keptAfter(t(here.messageId))} code={here.messageId} /> : null}
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
            {core.state === "offline" ? <p className="check-unchecked m-0">{t("check.core.notAsked")}</p> : null}
            {core.state === "skipped" ? <p className="check-unchecked m-0">{t("check.core.skipped")}</p> : null}
            {core.state === "failed" ? <ErrorBand what={t(UNKNOWN)} kept={t("check.error.kept")} /> : null}
            {core.state === "done" ? (
              <div className="flex flex-col items-start gap-2">
                <CoreSaid core={core} give={Boolean(doneHere?.opened.signedGive)} lang={lang} />
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
