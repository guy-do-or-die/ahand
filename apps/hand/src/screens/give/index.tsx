import { newKey, readDescription, toCoreSignature, type OpenedAddress } from "@ahand/sdk";
import type { Hex } from "@ahand/deliver";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isAddressEqual, type Address, type TypedDataDefinition } from "viem";

import { clientOf, useChainStatus, useHand, useNow } from "../../chain";
import { config } from "../../config";
import { t, useLang } from "../../i18n";
import { navigate } from "../../router";
import { useOpened } from "../../store/memory";
import { TID } from "../../testids";
import {
  CopyRow,
  DealCard,
  Disclose,
  ErrorBand,
  Identity,
  LandPicker,
  Mark,
  money,
  percent,
  Qr,
  QuietButton,
  shortAddress,
  SwipeButton,
  type DealDescription,
  type Landing,
} from "../../ui";
import { ConnectSheet, switchToAppChain, useTypedSigner, useWallet } from "../../wallet";
import { answerLink, confirmWithAccount, confirmWithKey, type AnswerOutcome, type AnswerStep, type Confirm } from "./answer";
import { relayCount, retryNow, sendToInbox, useEntry, useReplies, useThreadSent } from "./deliver";
import { claimAmount, deliveryState, keyFileOf, MAX_WORDS, shareText, signatureKind, wordsOf } from "./flow";
import { LINK_OPTIONS, useOpening } from "./open";

/**
 * /give (UX-SPEC §8.5): answer the link this tab holds. What you can do (words that travel by
 * message, never into the Give), where the money lands (the kit's three choices, §8.6), a card
 * that repeats exactly what will be confirmed, then one swipe: the link key and the giver confirm
 * the Give, it is checked here and by Core, written as a bare give address, and delivered to the
 * Hand's inbox through the outbox, or handed back to the giver to pass along the route.
 *
 * No key that can confirm a Give is ever kept: the one-time key lives in the swipe's handler and
 * the twelve words' account in the picker's memory, both gone once the answer is written.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "busy"; step: AnswerStep }
  | { kind: "failed"; outcome: Exclude<AnswerOutcome, { ok: true }> }
  | { kind: "no-forwarder" }
  | { kind: "done"; result: Extract<AnswerOutcome, { ok: true }>; words: string; payee: Address; entryKey?: string; chatKey?: Hex; keyFile: boolean };

function Frame({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto flex w-full max-w-[680px] flex-col gap-7 px-6 pb-16 pt-8 md:px-10" data-screen="give">
      {children}
    </section>
  );
}

function Title() {
  return <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("give.title")}</h1>;
}

function Step({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-4 border-t-[length:var(--bw-emph)] border-[var(--ink)] pt-4" data-testid={testId}>
      <h2 className="ah-meta ah-meta--ink m-0">{title}</h2>
      {children}
    </section>
  );
}

export default function GiveScreen() {
  useLang();
  const link = useOpened();
  const opening = useOpening(link);

  // With no link in this tab there is nothing to answer: back to the Hand view, which says so.
  useEffect(() => {
    if (!link) navigate("/", { replace: true, state: { view: "hand" } });
  }, [link]);

  if (!link || opening.status === "none") {
    return (
      <Frame>
        <Title />
        <p className="m-0">{t("give.noLink")}</p>
      </Frame>
    );
  }
  if (opening.status === "opening") {
    return (
      <Frame>
        <Title />
        <p className="ah-meta m-0" data-testid={TID.give.checking}>
          {t("give.opening")}
        </p>
      </Frame>
    );
  }
  if (opening.status === "error") {
    return (
      <Frame>
        <Title />
        <div data-testid={TID.give.error} data-value={opening.messageId}>
          <ErrorBand what={t(opening.messageId)} kept={t("common.error.nothingSent")} />
        </div>
      </Frame>
    );
  }
  if (!opening.opened.linkKey) {
    return (
      <Frame>
        <Title />
        <div data-testid={TID.give.error} data-value="not-live">
          <ErrorBand what={t("give.notLive")} action={<QuietButton compact onClick={() => navigate("/", { state: { view: "hand" } })}>{t("common.word.back")}</QuietButton>} />
        </div>
      </Frame>
    );
  }
  return <Answer opened={opening.opened} />;
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function Answer({ opened }: { opened: OpenedAddress }) {
  const lang = useLang();
  const now = useNow();
  const { offline } = useChainStatus();
  const core = opened.domain.verifyingContract;
  const handId = opened.hand.handId;
  const read = useHand(core, handId);
  const view = read.data?.view;
  const state = read.data?.state;
  const token = config.tokens.find((entry) => isAddressEqual(entry.address, opened.hand.token));
  const decimals = token?.decimals ?? 18;
  const said = useMemo(() => readDescription(opened), [opened]);
  const description: DealDescription = said.status === "attached" ? { status: "attached", title: said.title ?? "", ...(said.content ? { content: said.content } : {}) } : { status: said.status };
  const inbox = said.inbox as Hex | undefined;
  const claimBps = opened.end.claimBps;
  const reward = view?.reward ?? 0n;
  const noReward = view !== undefined && reward === 0n;
  const claim = claimAmount(reward, claimBps);

  const wallet = useWallet();
  const typed = useTypedSigner();
  const [text, setText] = useState("");
  const [landing, setLanding] = useState<Landing>();
  const [picker, setPicker] = useState({ key: 0, initial: "", hideAccount: false });
  const [connecting, setConnecting] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const account = wallet.status === "connected" && !picker.hideAccount ? wallet.address : undefined;
  const ctx = { core, raiser: opened.hand.raiser, token: opened.hand.token };
  const busy = phase.kind === "busy";
  const canSwipe = landing !== undefined && state === "open" && !busy;

  async function send() {
    if (!landing || !canSwipe) return;
    const words = wordsOf(text);
    let confirm: Confirm;
    let signer: Address;
    let keyFile = false;
    if (landing.signing.kind === "account") {
      signer = landing.signing.address;
      confirm = async (typedData) => {
        if (wallet.chainId !== config.chain.id) await switchToAppChain();
        const answer = await typed.sign(typedData as unknown as TypedDataDefinition);
        if (!answer.ok) return answer.reason === "rejected" ? { ok: false, reason: "rejected" } : { ok: false, reason: "failed", ...(answer.message ? { message: answer.message } : {}) };
        let signature = answer.signature;
        // A key's answer goes to Core in its one 65-byte form; a wrapper or an account's own format as it came.
        if (!answer.wrapped && answer.kind !== "code") {
          try {
            signature = toCoreSignature(signature);
          } catch {
            // 64 or 65 bytes that are not a key's: the account's code judges them.
          }
        }
        return { ok: true, signature };
      };
    } else if (landing.signing.kind === "one-time") {
      // Made here, used once below, dropped with this function. Its file is offered now, inside the press.
      const key = newKey();
      signer = key.address;
      confirm = confirmWithKey(key.privateKey);
      if (landing.signing.keep) {
        download(`ahand-answer-key-${handId}.json`, keyFileOf({ address: key.address, privateKey: key.privateKey, chainId: opened.domain.chainId, core, handId }));
        keyFile = true;
      }
    } else {
      signer = landing.signing.account.address;
      confirm = confirmWithAccount(landing.signing.account);
    }

    setPhase({ kind: "busy", step: "confirm" });
    const outcome = await answerLink({
      opened,
      signer,
      payee: landing.payee,
      confirm,
      client: clientOf(opened.domain.chainId),
      forwarder: config.forwarder,
      site: config.site,
      options: LINK_OPTIONS,
      onStep: (step) => setPhase({ kind: "busy", step }),
    });
    if (!outcome.ok) {
      setPhase(outcome.reason === "no-forwarder" ? { kind: "no-forwarder" } : { kind: "failed", outcome });
      return;
    }
    const payee = landing.payee;
    // The answer is written: the choice (and with it the twelve words' account) is let go.
    setLanding(undefined);
    setPhase({ kind: "done", result: outcome, words, payee, keyFile });
    if (!inbox || relayCount() === 0) return;
    try {
      const entry = await sendToInbox(inbox, {
        v: 1,
        kind: "give",
        hand: { chainId: opened.domain.chainId, core, handId: handId.toString() },
        giveLink: outcome.address,
        ...(words ? { text: words } : {}),
      });
      setPhase({ kind: "done", result: outcome, words, payee, keyFile, entryKey: entry.key, chatKey: entry.chatKey });
    } catch {
      // Not even written down (storage refused and memory failed): the fallback below still holds the link.
    }
  }

  const dealCard = view ? (
    <DealCard
      state={state === "missing" ? undefined : state}
      description={description}
      reward={view.reward}
      decimals={decimals}
      expiry={view.expiry}
      {...(view.closedAt ? { closedAt: view.closedAt } : {})}
      claimBps={claimBps}
      raiser={opened.hand.raiser}
      handId={handId}
      {...(now ? { block: { number: now.number, timestamp: now.timestamp } } : {})}
      lang={lang}
      heading="h2"
    />
  ) : (
    <p className="ah-meta m-0">{offline ? t("common.time.offline") : t("give.opening")}</p>
  );

  if (phase.kind === "done") {
    return (
      <Frame>
        <Title />
        <Done phase={phase} opened={opened} inbox={inbox} />
      </Frame>
    );
  }

  return (
    <Frame>
      <Title />
      {dealCard}
      {state && state !== "open" ? (
        <div data-testid={TID.give.error} data-value={`state-${state}`}>
          <ErrorBand what={t("give.closed")} kept={t(state === "expired" ? "core.Expired" : "core.NotOpen")} />
        </div>
      ) : null}

      <Step title={t("give.step.words")}>
        <label className="ah-field">
          <span className="ah-field__label">{noReward ? t("give.words.askNoReward") : t("give.words.ask", { amount: money(claim, decimals, lang) })}</span>
          <textarea
            className="ah-input min-h-[120px] resize-y"
            data-testid={TID.give.words}
            value={text}
            maxLength={MAX_WORDS}
            rows={4}
            placeholder={t("give.words.placeholder")}
            onChange={(event) => setText(event.target.value)}
            disabled={busy}
          />
        </label>
        <p className="ah-label m-0 flex flex-wrap justify-between gap-2">
          <span>{t("give.words.meta")}</span>
          <span className="ah-meta">{t("give.words.count", { n: Array.from(text).length, max: MAX_WORDS })}</span>
        </p>
      </Step>

      <Step title={t("give.step.land")}>
        {noReward ? <p className="ah-note m-0">{t("give.land.noReward")}</p> : null}
        <LandPicker
          key={picker.key}
          purpose="give"
          {...(account ? { account } : {})}
          onConnect={() => setConnecting(true)}
          ctx={ctx}
          initialAddress={picker.initial}
          onChange={setLanding}
        />
        {phase.kind === "no-forwarder" ? (
          <div className="ah-note flex flex-col gap-3" data-testid={TID.give.noForwarder} role="status">
            <p className="m-0">{t("give.noForwarder")}</p>
            <QuietButton
              compact
              className="self-start"
              onClick={() => {
                setPicker((before) => ({ key: before.key + 1, initial: wallet.address ?? "", hideAccount: true }));
                setPhase({ kind: "idle" });
              }}
            >
              {t("give.noForwarder.go")}
            </QuietButton>
          </div>
        ) : null}
      </Step>

      <Step title={t("give.step.agree")} testId={TID.give.agree}>
        {landing ? (
          <AgreeCard opened={opened} landing={landing} claim={claim} decimals={decimals} noReward={noReward} lang={lang} />
        ) : (
          <p className="ah-label ah-label--dim m-0">{t("give.agree.pick")}</p>
        )}
      </Step>

      <div className="flex flex-col gap-4 pt-6">
        <SwipeButton gesture="cheer" variant="amber" className="w-full" data-testid={TID.give.swipe} disabled={!canSwipe} aria-busy={busy} onClick={() => void send()}>
          {busy ? t("give.swipe.busy") : t("give.swipe")}
        </SwipeButton>
        {busy ? <Progress step={phase.step} /> : null}
        {phase.kind === "failed" ? <Failure outcome={phase.outcome} /> : null}
        {offline ? <p className="ah-label m-0">{t("common.time.offline")}</p> : null}
      </div>

      {connecting ? <ConnectSheet onClose={() => setConnecting(false)} /> : null}
    </Frame>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--ink-a10)] py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="ah-label shrink-0">{label}</dt>
      <dd className="m-0 min-w-0 text-[length:var(--fs-body-md)] font-semibold sm:text-right">{children}</dd>
    </div>
  );
}

function AgreeCard({ opened, landing, claim, decimals, noReward, lang }: { opened: OpenedAddress; landing: Landing; claim: bigint; decimals: number; noReward: boolean; lang: "en" | "ru" }) {
  const core = opened.domain.verifyingContract;
  const claimText = noReward
    ? t("give.agree.claimNoReward", { percent: percent(opened.end.claimBps, lang) })
    : t("give.agree.claimMoney", { percent: percent(opened.end.claimBps, lang), amount: money(claim, decimals, lang) });
  const by = landing.signing.kind === "account" ? "give.agree.byAccount" : landing.signing.kind === "one-time" ? "give.agree.byOneTime" : "give.agree.byWords";
  return (
    <div className="ah-card flex flex-col gap-1 px-4 py-3" data-payee={landing.payee} data-claim={String(opened.end.claimBps)}>
      <p className="ah-label m-0 py-2">{t("give.agree.intro")}</p>
      <dl className="m-0">
        <Row label={t("give.agree.network")}>
          {config.chain.name} <span className="ah-meta ah-meta--exact">· {opened.domain.chainId}</span>
        </Row>
        <Row label={t("give.agree.contract")}>
          <span className="ah-meta ah-meta--exact" title={core}>
            {shortAddress(core)}
          </span>
        </Row>
        <Row label={t("give.agree.hand")}>{t("give.agree.handNumber", { n: opened.hand.handId.toString() })}</Row>
        <Row label={t("give.agree.claim")}>{claimText}</Row>
        <Row label={t("give.agree.lands")}>
          <Identity address={landing.payee} full />
        </Row>
        <Row label={t("give.agree.confirms")}>{t(by)}</Row>
      </dl>
      {landing.flagged ? <p className="ah-note m-0 mb-2">{t(`give.agree.flagged.${landing.flagged}`)}</p> : null}
    </div>
  );
}

const STEPS: AnswerStep[] = ["confirm", "here", "core", "write"];
const STEP_WORDS: Record<AnswerStep, string> = { confirm: "give.check.confirm", here: "give.check.here", core: "give.check.core", write: "give.check.write" };

function Progress({ step }: { step: AnswerStep }) {
  const at = STEPS.indexOf(step);
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0" data-testid={TID.give.checking} data-value={step} aria-live="polite">
      {STEPS.map((name, index) => (
        <li key={name} className={index > at ? "ah-label ah-label--dim" : "ah-label"}>
          <span aria-hidden="true" className="ah-meta mr-2 inline-block w-4">
            {index < at ? "✓" : index === at ? "…" : "·"}
          </span>
          {t(STEP_WORDS[name])}
        </li>
      ))}
    </ol>
  );
}

function Failure({ outcome }: { outcome: Exclude<AnswerOutcome, { ok: true }> }) {
  const what =
    outcome.reason === "rejected"
      ? t("give.error.refused")
      : outcome.reason === "offline"
        ? t("common.error.offline")
        : outcome.reason === "refused" && outcome.messageId
          ? t(outcome.messageId)
          : t("give.error.failed");
  return (
    <div data-testid={TID.give.error} data-value={outcome.messageId ?? outcome.reason}>
      <ErrorBand what={what} kept={t("give.error.kept")} {...(outcome.message ? { code: outcome.message } : {})} />
    </div>
  );
}

function Done({ phase, opened, inbox }: { phase: Extract<Phase, { kind: "done" }>; opened: OpenedAddress; inbox: Hex | undefined }) {
  const { result } = phase;
  const entry = useEntry(phase.entryKey);
  const delivery = deliveryState(inbox, relayCount(), entry);
  const [showQr, setShowQr] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const give = result.signedGive.give;
  const sig = signatureKind(result.signedGive.giverSig);
  const lensLines = [
    t("give.lens.offline"),
    result.setup ? t("give.lens.coreSetup", { forwarder: result.setup.forwarder, block: result.block.toString() }) : t("give.lens.core", { block: result.block.toString() }),
    t("give.lens.giveHash", { hash: result.giveHash }),
    t("give.lens.dataHash"),
    t("give.lens.signer", { address: give.signer }),
    t("give.lens.payee", { address: give.payee }),
    t("give.lens.claim", { bps: String(give.claimBps), hash: give.routeHash }),
    t("give.lens.keySig", { key: opened.end.lastKey }),
    sig.kind === "key" ? t("give.lens.sigKey") : sig.kind === "wrapped" ? t("give.lens.sigWrapped", { bytes: String(sig.bytes), factory: sig.factory }) : t("give.lens.sigCode", { bytes: String(sig.bytes) }),
    inbox ? t("give.lens.delivery", { inbox }) : t("give.lens.noInbox"),
  ];

  return (
    <div className="flex flex-col gap-7" data-signer={give.signer} data-payee={give.payee}>
      <div className="flex flex-col gap-3">
        <h2 className="m-0 text-[length:var(--fs-card-title-lg)] font-extrabold leading-tight tracking-[-0.02em]">{t("give.done.title")}</h2>
        <p className="ah-label m-0 flex flex-wrap items-center gap-2">
          {t("give.done.checked")} <Mark kind="checked" source={<span className="ah-meta ah-meta--exact">{lensLines[1]}</span>} />
        </p>
        {result.setup ? (
          <p className="ah-note m-0" data-testid={TID.give.setupBand}>
            {t("give.setup")}
          </p>
        ) : null}
      </div>

      {delivery === "delivered" && entry ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[length:var(--fs-body-lg)] font-bold" data-testid={TID.give.delivered} data-value={`${entry.acks}/${entry.of}`} role="status">
            {t(entry.of === 1 ? "give.delivered.one" : "give.delivered.many", { acks: entry.acks, of: entry.of })}
          </p>
          <Disclose label={t("give.relay.what")}>
            <p className="ah-label m-0">{t("give.relay.body")}</p>
          </Disclose>
        </div>
      ) : delivery === "sending" ? (
        <p className="ah-label m-0" role="status">
          {t("give.delivering")}
        </p>
      ) : (
        <div className="flex flex-col gap-3" data-testid={TID.give.fallback} role="status">
          <p className="m-0 text-[length:var(--fs-body-lg)] font-bold leading-snug">{t("give.fallback")}</p>
          {inbox && relayCount() > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="ah-label">{t("give.retrying")}</span>
              <QuietButton compact variant="text" onClick={() => void retryNow()}>
                {t("give.retry")}
              </QuietButton>
            </div>
          ) : null}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <span className="ah-field__label">{t("give.answer.label")}</span>
        <div data-testid={TID.give.copy} data-value={result.address}>
          <CopyRow value={result.address} />
        </div>
        <p className="ah-label ah-label--dim m-0">{t("give.answer.copyHint")}</p>
        <div className="flex flex-wrap gap-3">
          {canShare ? (
            <QuietButton compact data-testid={TID.give.share} onClick={() => void navigator.share({ text: shareText(phase.words, result.address) }).catch(() => undefined)}>
              {t("common.word.share")}
            </QuietButton>
          ) : null}
          <QuietButton compact data-testid={TID.give.qr} aria-expanded={showQr} onClick={() => setShowQr((open) => !open)}>
            {t("common.word.showQr")}
          </QuietButton>
        </div>
        {showQr ? <Qr value={result.digits} /> : null}
        {phase.keyFile ? <p className="ah-note m-0">{t("give.keyFile")}</p> : null}
      </div>

      <Thread phase={phase} opened={opened} inbox={inbox} />

      <div className="flex flex-col gap-2 border-t-[length:var(--bw-emph)] border-[var(--ink)] pt-4">
        <p className="m-0 flex flex-wrap items-baseline gap-2">
          {t("give.waiting", { payee: shortAddress(phase.payee) })}
        </p>
        <Identity address={phase.payee} full />
        <QuietButton compact className="self-start" data-testid={TID.give.toWaiting} onClick={() => navigate("/waiting")}>
          {t("give.waiting.go")}
        </QuietButton>
      </div>

      <Disclose label={t("give.lens.heading")}>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {lensLines.map((line) => (
            <li key={line} className="ah-meta ah-meta--exact break-all normal-case">
              {line}
            </li>
          ))}
        </ul>
      </Disclose>
    </div>
  );
}

function Thread({ phase, opened, inbox }: { phase: Extract<Phase, { kind: "done" }>; opened: OpenedAddress; inbox: Hex | undefined }) {
  const hand = useMemo(() => ({ chainId: opened.domain.chainId, core: opened.domain.verifyingContract, handId: opened.hand.handId.toString() }), [opened]);
  const first = useEntry(phase.entryKey);
  const sent = useThreadSent(phase.chatKey);
  const replies = useReplies(phase.chatKey, inbox, hand, first?.at);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  if (!inbox || relayCount() === 0) {
    return <p className="ah-label ah-label--dim m-0">{t("give.thread.noInbox")}</p>;
  }

  const lines = [
    ...sent.filter((entry) => entry.envelope.text).map((entry) => ({ id: entry.key, at: entry.at, mine: true, text: entry.envelope.text!, first: entry.envelope.kind === "give", queued: entry.acks === 0 })),
    ...replies.map((reply) => ({ id: reply.id, at: reply.at, mine: false, text: reply.text, first: false, queued: false })),
  ].sort((a, b) => a.at - b.at);

  async function answer() {
    const words = wordsOf(draft);
    if (!words || !phase.chatKey || !inbox) return;
    setSending(true);
    try {
      // Answers go to the Hand's inbox, the key the asker writes from.
      await sendToInbox(inbox, { v: 1, kind: "note", hand, text: words }, phase.chatKey);
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="give-thread-title">
      <h2 id="give-thread-title" className="ah-meta ah-meta--ink m-0">
        {t("give.thread.title")}
      </h2>
      <ol className="m-0 flex list-none flex-col gap-3 p-0" data-testid={TID.give.thread} data-count={String(lines.length)}>
        {lines.map((line) => (
          <li key={line.id} className={line.mine ? "ah-panel self-end" : "ah-card self-start px-4 py-3"} data-from={line.mine ? "you" : "asker"} style={{ maxWidth: "88%" }}>
            <span className="ah-meta block pb-1">
              {line.mine ? (line.first ? t("give.thread.yourWords") : t("give.thread.you")) : t("give.thread.asker")}
              {line.queued ? ` · ${t("give.thread.queued")}` : ""}
            </span>
            <span className="whitespace-pre-wrap break-words">{line.text}</span>
          </li>
        ))}
      </ol>
      {replies.length === 0 ? <p className="ah-label ah-label--dim m-0">{t("give.thread.empty")}</p> : null}
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void answer();
        }}
      >
        <input
          className="ah-chatline min-h-[44px] flex-1"
          data-testid={TID.give.replyInput}
          aria-label={t("give.thread.reply")}
          placeholder={t("give.thread.reply")}
          value={draft}
          maxLength={MAX_WORDS}
          onChange={(event) => setDraft(event.target.value)}
        />
        <QuietButton type="submit" compact data-testid={TID.give.replySend} disabled={sending || wordsOf(draft) === ""}>
          {t("give.thread.send")}
        </QuietButton>
      </form>
    </section>
  );
}
