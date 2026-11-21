import { newKey, raiserHops, readDescription, readThank, walletKind, type OpenedAddress } from "@ahand/sdk";
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
  dealDescriptionOf,
  Disclose,
  ErrorBand,
  GestureEmoji,
  Identity,
  LandPicker,
  Mark,
  money,
  percent,
  Proof,
  Qr,
  QuietButton,
  shortAddress,
  SwipeButton,
  type DealDescription,
  type Landing,
} from "../../ui";
import { ConnectSheet, LinkAgain, switchToAppChain, useTypedSigner, useWallet } from "../../wallet";
import { answerLink, confirmWithAccount, confirmWithKey, confirmWithWallet, type AnswerOutcome, type AnswerStep, type Confirm } from "./answer";
import { relayCount, retryNow, sendToInbox, useEntry, useMyAnswers } from "./deliver";
import { claimAmount, claimText, deliveryState, keyFileOf, MAX_WORDS, onAppChain, shareText, signatureKind, wordsOf } from "./flow";
import { LINK_OPTIONS, isOffline, useOpening } from "./open";
import { AnswerThread } from "./Thread";
import { chainName } from "../../i18n/common/chain";

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
  | { kind: "wrong-network" }
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
        <LinkAgain />
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
    // The network did not answer: the offline band, with a way to try again (U-1). The link stays in this tab.
    const offline = isOffline(opening);
    return (
      <Frame>
        <Title />
        <div data-testid={TID.give.error} data-value={opening.messageId}>
          <ErrorBand
            what={t(opening.messageId)}
            kept={offline ? t("give.offline.kept") : t("common.error.nothingSent")}
            {...(offline
              ? {
                  action: (
                    <QuietButton compact onClick={opening.retry}>
                      {t("give.offline.retry")}
                    </QuietButton>
                  ),
                }
              : {})}
          />
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
  const description: DealDescription = dealDescriptionOf(said);
  const inbox = said.inbox as Hex | undefined;
  const claimBps = opened.end.claimBps;
  const reward = view?.reward ?? 0n;
  const noReward = view !== undefined && reward === 0n;
  const claim = claimAmount(reward, claimBps);

  const wallet = useWallet();
  const typed = useTypedSigner();
  const [text, setText] = useState("");
  const [landing, setLanding] = useState<Landing>();
  const [landWaiting, setLandWaiting] = useState<"tick" | undefined>();
  const [picker, setPicker] = useState({ key: 0, initial: "", hideAccount: false });
  const [connecting, setConnecting] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const account = wallet.status === "connected" && !picker.hideAccount ? wallet.address : undefined;
  // An answer this device already sent to this Hand (a reload loses the tab's link, not the outbox):
  // say so before a second one is made, and point to where it and its thread are.
  const mine = useMyAnswers().entries;
  const answeredBefore = mine.some((entry) => entry.envelope.hand.chainId === opened.domain.chainId && entry.envelope.hand.core.toLowerCase() === core.toLowerCase() && entry.envelope.hand.handId === handId.toString());
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
      // The wallet confirms on the app's network or not at all: a switch it refuses stops here (W-4).
      setPhase({ kind: "busy", step: "confirm" });
      if (!(await onAppChain(wallet.chainId, config.chain.id, switchToAppChain))) {
        setPhase({ kind: "wrong-network" });
        return;
      }
      signer = landing.signing.address;
      const account = signer;
      // The network was switched before this (onAppChain above), so the wallet is only asked to sign.
      confirm = confirmWithWallet(
        (typedData) => typed.sign(typedData as unknown as TypedDataDefinition),
        () => walletKind(clientOf(config.chain.id), account),
      );
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
  ) : offline ? (
    <div data-testid={TID.give.error} data-value="common.time.offline">
      <ErrorBand what={t("common.time.offline")} kept={t("give.offline.kept")} />
    </div>
  ) : (
    <p className="ah-meta m-0">{t("give.opening")}</p>
  );

  if (phase.kind === "done") {
    return (
      <Frame>
        <Title />
        <Done phase={phase} opened={opened} inbox={inbox} />
      </Frame>
    );
  }

  // Until the chain has answered, no form: its first line names the amount "if they thank you",
  // and before the reward is read it would say "$0" (or promise something the Hand may not hold).
  if (!view) {
    return (
      <Frame>
        <Title />
        {dealCard}
      </Frame>
    );
  }

  // Past its end or closed: say so and stop. No form, no amount "if they thank you", no swipe:
  // nothing here could come true any more (FINDINGS O-1).
  if (state && state !== "open") {
    return (
      <Frame>
        <Title />
        {dealCard}
        <div data-testid={TID.give.error} data-value={`state-${state}`}>
          <ErrorBand
            what={t("give.closed")}
            kept={t(state === "expired" ? "core.Expired" : "core.NotOpen")}
            action={
              <QuietButton compact onClick={() => navigate("/", { state: { view: "hand" } })}>
                {t("common.word.back")}
              </QuietButton>
            }
          />
        </div>
      </Frame>
    );
  }

  // Duty 23: a pass on the route that paid or handed the link to the asker's own address is said
  // before the helper answers, as on the Hand view's rail.
  const askerHops = raiserHops(opened.hand.raiser, opened.signedShakes);

  return (
    <Frame>
      <Title />
      {dealCard}
      {askerHops.length ? (
        <p className="ah-note m-0" data-testid={TID.give.askerHop} data-value={askerHops.map((hop) => hop.position + 1).join(",")}>
          {t("give.askerHop", { passes: askerHops.map((hop) => hop.position + 1).join(", "), n: askerHops.length })}
        </p>
      ) : null}

      {answeredBefore ? (
        <div className="ah-note flex flex-col gap-2" role="status" data-value="answered-before">
          <p className="m-0">{t("give.again")}</p>
          <a href="/my" className="ah-quiet ah-quiet--compact self-start">
            {t("give.again.go")}
          </a>
        </div>
      ) : null}

      <Step title={t("give.step.words")}>
        <label className="ah-field">
          <span className="ah-field__label">{noReward ? t("give.words.askNoReward") : t("give.words.ask", { amount: claimText(claim, decimals, lang, money) })}</span>
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
          logIn={config.privy !== undefined}
          ctx={ctx}
          initialAddress={picker.initial}
          onChange={setLanding}
          onWaiting={setLandWaiting}
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
          <AgreeCard opened={opened} landing={landing} claim={claim} decimals={decimals} noReward={noReward} lang={lang} email={wallet.email === true} />
        ) : (
          <p className="ah-label ah-label--dim m-0">{t(landWaiting === "tick" ? "give.agree.tick" : "give.agree.pick")}</p>
        )}
      </Step>

      <div className="flex flex-col gap-4 pt-6">
        <SwipeButton gesture="cheer" variant="amber" className="w-full" data-testid={TID.give.swipe} disabled={!canSwipe} aria-busy={busy} onClick={() => void send()}>
          {busy ? t("give.swipe.busy") : t("give.swipe")}
        </SwipeButton>
        {busy ? <Progress step={phase.step} /> : null}
        {phase.kind === "failed" ? <Failure outcome={phase.outcome} /> : null}
        {phase.kind === "wrong-network" ? (
          <div data-testid={TID.give.wrongNetwork} data-value={String(config.chain.id)}>
            <ErrorBand what={t("common.error.wrongNetwork", { network: chainName(config.chain) })} kept={t("give.error.kept")} />
          </div>
        ) : null}
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

function AgreeCard({
  opened,
  landing,
  claim,
  decimals,
  noReward,
  lang,
  email,
}: {
  opened: OpenedAddress;
  landing: Landing;
  claim: bigint;
  decimals: number;
  noReward: boolean;
  lang: "en" | "ru";
  /** The connected account is a wallet Privy keeps (email, social, passkey), which shows no window of its own. */
  email: boolean;
}) {
  const core = opened.domain.verifyingContract;
  // An email account confirms right here with no window of its own, so the fields it confirms
  // (the contract and the hand's number) stand on this card in both views; any other account
  // shows them on its own screen, and here they are the lens's.
  const signedHere = email && landing.signing.kind === "account";
  const signed = (
    <>
      <Row label={t("give.agree.contract")}>
        <span className="ah-meta ah-meta--exact" title={core}>
          {shortAddress(core)}
        </span>
      </Row>
      <Row label={t("give.agree.hand")}>{t("give.agree.handNumber", { n: opened.hand.handId.toString() })}</Row>
    </>
  );
  const claimLine = noReward
    ? t("give.agree.claimNoReward", { percent: percent(opened.end.claimBps, lang) })
    : t("give.agree.claimMoney", { percent: percent(opened.end.claimBps, lang), amount: claimText(claim, decimals, lang, money) });
  const by = landing.signing.kind === "account" ? "give.agree.byAccount" : landing.signing.kind === "one-time" ? "give.agree.byOneTime" : "give.agree.byWords";
  return (
    <div className="ah-card flex flex-col gap-1 px-4 py-3" data-payee={landing.payee} data-claim={String(opened.end.claimBps)}>
      <p className="ah-label m-0 py-2">{t("give.agree.intro")}</p>
      <dl className="m-0">
        <Row label={t("give.agree.network")}>
          {chainName(config.chain)}{" "}
          <Proof>
            <span className="ah-meta ah-meta--exact">· {opened.domain.chainId}</span>
          </Proof>
        </Row>
        {signedHere ? signed : <Proof>{signed}</Proof>}
        <Row label={t("give.agree.claim")}>{claimLine}</Row>
        <Row label={t("give.agree.lands")}>
          <Identity address={landing.payee} full />
        </Row>
        {/* How the answer is confirmed is a matter of keys: the lens's. */}
        <Proof>
          <Row label={t("give.agree.confirms")}>{t(by)}</Row>
        </Proof>
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
  const thanked = useThankedMe(opened, result.giveHash);
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
        {/* Once delivered, the delivered line is the headline of the calm view; a second one would only repeat it. */}
        <Proof calm={delivery === "delivered" ? null : <h2 className="m-0 text-[length:var(--fs-card-title-lg)] font-extrabold leading-tight tracking-[-0.02em]">{t("give.done.title")}</h2>}>
          <h2 className="m-0 text-[length:var(--fs-card-title-lg)] font-extrabold leading-tight tracking-[-0.02em]">{t("give.done.title")}</h2>
        </Proof>
        {thanked ? (
          <p className="ah-note m-0 flex items-center gap-3 text-[length:var(--fs-body-lg)] font-bold" data-testid={TID.give.thanked} role="status">
            <GestureEmoji kind="bow" size={40} />
            {t("give.thanked")}
          </p>
        ) : null}
        <Proof>
          <p className="ah-label m-0 flex flex-wrap items-center gap-2">
            {t("give.done.checked")} <Mark kind="checked" source={<span className="ah-meta ah-meta--exact">{lensLines[1]}</span>} />
          </p>
        </Proof>
        {result.setup ? (
          <p className="ah-note m-0" data-testid={TID.give.setupBand}>
            {t("give.setup")}
          </p>
        ) : null}
      </div>

      {delivery === "delivered" && entry ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[length:var(--fs-body-lg)] font-bold" data-testid={TID.give.delivered} data-value={`${entry.acks}/${entry.of}`} role="status">
            <Proof calm={t("give.delivered.calm")}>{t(entry.of === 1 ? "give.delivered.one" : "give.delivered.many", { acks: entry.acks, of: entry.of })}</Proof>
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
        <span className="ah-field__label">
          <Proof calm={t("give.answer.label.calm")}>{t("give.answer.label")}</Proof>
        </span>
        <div data-testid={TID.give.copy} data-value={result.address}>
          <CopyRow value={result.address} shareText={shareText(phase.words, result.address)} />
        </div>
        <Proof>
          <p className="ah-label ah-label--dim m-0">{t("give.answer.copyHint")}</p>
        </Proof>
        <div className="flex flex-wrap gap-3">
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
          {thanked ? (
            t("give.waiting.thanked")
          ) : (
            <Proof calm={t("give.waiting.calm")}>{t("give.waiting", { payee: shortAddress(phase.payee) })}</Proof>
          )}
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

/**
 * Whether the asker thanked this very answer: the Hand is closed and the Give Core keeps for its
 * thanks is this one. Read again on every block while the tab is open, so a helper hears the news
 * in plain words without the lens.
 */
function useThankedMe(opened: OpenedAddress, giveHash: Hex): boolean {
  const core = opened.domain.verifyingContract;
  const chainId = opened.domain.chainId;
  const handId = opened.hand.handId;
  const read = useHand(core, handId, chainId);
  const closed = (read.data?.view.closedAt ?? 0) !== 0;
  const [mine, setMine] = useState(false);
  useEffect(() => {
    if (!closed) return;
    let live = true;
    readThank(clientOf(chainId), core, handId).then(
      (stored) => live && setMine(stored.giveHash.toLowerCase() === giveHash.toLowerCase()),
      () => undefined, // read again with the next block's close
    );
    return () => {
      live = false;
    };
  }, [closed, chainId, core, handId, giveHash]);
  return mine;
}

function Thread({ phase, opened, inbox }: { phase: Extract<Phase, { kind: "done" }>; opened: OpenedAddress; inbox: Hex | undefined }) {
  const hand = useMemo(() => ({ chainId: opened.domain.chainId, core: opened.domain.verifyingContract, handId: opened.hand.handId.toString() }), [opened]);
  const first = useEntry(phase.entryKey);
  return <AnswerThread chatKey={phase.chatKey} inbox={inbox} hand={hand} since={first?.at} testId={TID.give.thread} titleId="give-thread-title" />;
}
