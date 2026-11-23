import { approveCall, KEYS_PURPOSE, raiseCall, readLimits, type Call } from "@ahand/sdk";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { erc20Abi, keccak256, stringToBytes, type Address } from "viem";

import { config, PREVIEWS, TESTNET } from "../../config";
import { clientOf, useChainStatus, useCost, useNow } from "../../chain";
import { t, useLang } from "../../i18n";
import { chainName } from "../../i18n/common/chain";
import type { Mode } from "../../store/db";
import { TID } from "../../testids";
import { CostLine, DealCard, Disclose, ErrorBand, MoneyInput, Proof, QuietButton, Sheet, SwipeButton, TxRail, count, day, money, percent, useLens, type MoneyReading, type TxReached } from "../../ui";
import { DayPick } from "../../ui/DayPick";
import { SectionStrip } from "../../ui/SectionStrip";
import { ConnectSheet, connectedWallet, useSend, useTypedSigner, useWallet } from "../../wallet";
import { exactMoney } from "./exact";
import { dropKeptRaise, keepRaise, takeKeptRaise, type RaiseForm } from "./kept";
import {
  droppedSeen,
  lastDropped,
  problemOfWeight,
  raise,
  rebuild,
  resumeRaise,
  stopWaiting,
  unfinished,
  type Draft,
  type Outcome,
  type Problem,
  type RaiseContext,
  type RaiseRecord,
  type Step,
  type Up,
} from "./flow";
import { daysForDate, expiryFor, fieldDate, MAX_BEFORE_HASH, MAX_DETAILS, MAX_TITLE, passesAt, previewDayApart, weigh } from "./link";
import { Chips, MODE_WORD, Opens, Part, Unfurl, Visibility } from "./parts";
import { Share } from "./share";
import { Faucets, OnExplorer } from "../../shell/OnExplorer";

/** This build logs in through Privy: the way in is "Log in", not "Connect a wallet". */
const LOG_IN = config.privy !== undefined;

/** The form kept across a social login, taken out of storage once per page load (React may mount the screen twice). */
let kept: Promise<(RaiseForm & { used?: boolean }) | undefined> | undefined;
const keptOnce = (): Promise<(RaiseForm & { used?: boolean }) | undefined> => (kept ??= takeKeptRaise());

/**
 * /raise: one screen from a thought to a link. The compose surface, then the swipe,
 * whose flow lives in flow.ts; then the share step. A raise found pending after a reload is followed
 * by its stored hash, or settled by its nonce and its own `Raised` log, and never sent again; the
 * pending phase always offers "Stop waiting", which only stops the screen from waiting. Every "now"
 * here is the network's (useNow).
 */

const REWARDS = ["5", "20", "50"] as const;
/** The ready terms; any other date, up to Core's cap, is picked in the system's own date field. */
const DAYS: readonly number[] = [7, 30, 90];
const DAY_SECONDS = 86_400;
const MIN_CLAIMS = [5000, 7000, 9000, 10000] as const;
const ROOMS = [200, 250, 300] as const;
const NUDGE_DAYS = 60;
/**
 * The poster field's hard stop: a whole title, a line break and a whole details text. The
 * caps themselves are counted per part (link.ts `weigh`); this only keeps a runaway paste out of the
 * page. A public Hand is held to the address limit besides, shown live.
 */
const POSTER_STOP = MAX_TITLE + 1 + MAX_DETAILS;
/** A stand-in root key and description hash, only to price and try the call before the real ones exist. */
const PREVIEW_ROOT: Address = "0x000000000000000000000000000000000000dEaD";
const PREVIEW_HASH = keccak256(stringToBytes("aHand.raise.preview"));

const CORE: Address = config.cores.canonical ?? config.cores.trusted[0]!.core;
const TOKEN = config.tokens.find((token) => token.kind === "usdc") ?? config.tokens.find((token) => token.kind === "usd") ?? config.tokens[0]!;

type Phase =
  | { kind: "looking" }
  | { kind: "compose" }
  | { kind: "working"; step: Step | "connect"; of: number }
  | { kind: "pending"; record: RaiseRecord; unknown?: boolean }
  | { kind: "up"; up: Up };

interface Facts {
  cap: number;
  decimals: number;
}

/** MAX_EXPIRY_PERIOD from Core and the decimals from the token itself, read once. */
function useFacts(): { facts?: Facts; failed: boolean } {
  const [state, setState] = useState<{ facts?: Facts; failed: boolean }>({ failed: false });
  useEffect(() => {
    let live = true;
    const client = clientOf(config.chain.id);
    Promise.all([readLimits(client, CORE), client.readContract({ address: TOKEN.address, abi: erc20Abi, functionName: "decimals" })]).then(
      ([limits, decimals]) => live && setState({ facts: { cap: limits.maxExpiryPeriod, decimals }, failed: false }),
      () => live && setState({ failed: true }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}

function splitPoster(poster: string, details: string): { title: string; content: string } {
  const [first = "", ...rest] = poster.split(/\r?\n/);
  const content = [rest.join("\n").trim(), details.trim()].filter(Boolean).join("\n\n");
  return { title: first.trim(), content };
}

export default function RaiseScreen() {
  const lang = useLang();
  const lens = useLens();
  const now = useNow();
  const wallet = useWallet();
  const tx = useSend();
  const signer = useTypedSigner();
  const { facts, failed } = useFacts();
  const chain = useChainStatus();
  const unreachable = chain.offline || chain.stale;

  const [poster, setPoster] = useState("");
  const [details, setDetails] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  // On a public test network the faucets hand out a few dollars at a time: the smallest chip first.
  const [rewardKey, setRewardKey] = useState<string>(TESTNET && !config.chain.local ? "5" : "20");
  const [custom, setCustom] = useState<MoneyReading>({ status: "empty" });
  const [days, setDays] = useState<number>(config.defaults.expiryDays || 30);
  // The calendar under the term's row, opened from the date in that row.
  const [picking, setPicking] = useState(false);
  // The date in the row, which opens the calendar: the keyboard comes back to it when the calendar closes.
  const dateChip = useRef<HTMLButtonElement>(null);
  const closeCalendar = () => {
    setPicking(false);
    requestAnimationFrame(() => dateChip.current?.focus());
  };
  // Opened, the calendar is brought whole onto the screen where it fits (clear of the pinned action).
  useEffect(() => {
    if (picking) document.getElementById("raise-expiry-days")?.scrollIntoView({ block: "nearest" });
  }, [picking]);
  const [mode, setMode] = useState<Mode>("unlisted");
  const [minClaimBps, setMinClaimBps] = useState<number>(config.defaults.minClaimBps || 7000);
  const [payoutGasK, setPayoutGasK] = useState<number>(config.defaults.payoutGasK || 250);

  const [phase, setPhase] = useState<Phase>({ kind: "looking" });
  const [problem, setProblem] = useState<Problem | undefined>();
  const [keysAsk, setKeysAsk] = useState<{ twice: boolean; answer: (yes: boolean) => void } | undefined>();
  const [connectAsk, setConnectAsk] = useState<{ answer: (address: Address | undefined) => void } | undefined>();
  const [showing, setShowing] = useState(false);
  /** The raise itself has left (its hash is on the device): the TxRail shows from "Sent" on. */
  const [raiseSent, setRaiseSent] = useState(false);
  const busy = useRef(false);

  // Back from a social login (Privy's Google, Apple or X load /raise afresh): the form written
  // before it comes back (kept.ts). Taken once as the screen opens; a form already typed into wins.
  const typed = useRef(false);
  typed.current = poster !== "" || details !== "";
  useEffect(() => {
    if (!LOG_IN) return;
    let open = true;
    void keptOnce().then((form) => {
      if (!open || !form || typed.current || form.used) return;
      form.used = true;
      setPoster(form.poster);
      setDetails(form.details);
      setShowDetails(form.showDetails);
      setRewardKey(form.rewardKey);
      if (form.custom !== undefined && /^[0-9]+$/.test(form.custom)) setCustom({ status: "ok", amount: BigInt(form.custom) });
      setDays(form.days);
      setMode(form.mode);
      setMinClaimBps(form.minClaimBps);
      setPayoutGasK(form.payoutGasK);
    });
    return () => {
      open = false;
    };
  }, []);

  const ctx = useMemo<RaiseContext>(
    () => ({
      client: clientOf(config.chain.id),
      chainId: config.chain.id,
      core: CORE,
      token: TOKEN.address,
      maxExpiryPeriod: facts?.cap ?? 0,
      site: config.site,
      options: { canonicalCore: config.cores.canonical ?? null },
    }),
    [facts?.cap],
  );

  const { title, content } = splitPoster(poster, details);
  const weighed = useMemo(
    () => weigh({ title, content, mode }, { site: ctx.site, chainId: ctx.chainId, core: ctx.core, options: ctx.options }),
    [title, content, mode, ctx],
  );
  const tooLong = problemOfWeight(weighed);
  const decimals = facts?.decimals ?? TOKEN.decimals;
  const reward: bigint | undefined =
    rewardKey === "custom" ? (custom.status === "ok" ? custom.amount : undefined) : BigInt(rewardKey) * 10n ** BigInt(decimals);
  const expiry = now && facts ? expiryFor(now.timestamp, days, facts.cap) : undefined;

  /* ── after a reload: a raise still on its way, or up and not yet saved ── */
  const live = useRef(true);
  const looking = useRef(false);
  const lookedWith = useRef<Address | undefined>(undefined);

  /**
   * Follows a raise this device kept until it lands or is dropped: by its stored hash, by its nonce
   * and its own `Raised` log, or by asking the connected account for the batch that carries it.
   * Nothing is sent. One look at a time; `unknown` says the wallet's answer was lost.
   */
  const settle = async (record: RaiseRecord, unknown: boolean, account: Address | undefined = wallet.address) => {
    if (looking.current) return;
    looking.current = true;
    lookedWith.current = account;
    setProblem(undefined);
    setPhase({ kind: "pending", record, unknown });
    try {
      const outcome = await resumeRaise(record, ctx, (intent, options) => tx.resume(intent, options), account);
      looking.current = false;
      if (live.current) finish(outcome);
    } catch {
      looking.current = false;
      if (live.current) finish({ ok: false, problem: { id: "raise.error.lostSight", pending: true } });
    }
  };

  const finish = (outcome: Outcome) => {
    if (outcome.ok) {
      setPhase({ kind: "up", up: outcome.up });
      setProblem(undefined);
      return;
    }
    setProblem(outcome.problem);
    if (outcome.record && outcome.problem.pending) {
      const record = outcome.record;
      // Still on its way, or not known: hold the swipe and keep checking, never send again.
      setPhase((before) => (before.kind === "pending" && before.record.intent === record.intent ? before : { kind: "pending", record, unknown: outcome.problem.id === "raise.error.unknown" }));
      if (outcome.problem.id === "raise.error.unknown") void settle(record, true);
      return;
    }
    setPhase((before) => (before.kind === "pending" && outcome.problem.pending ? before : { kind: "compose" }));
  };

  useEffect(() => {
    live.current = true;
    unfinished(ctx)
      .then(async (record) => {
        if (!live.current) return;
        if (!record) {
          // A raise found dropped (here or on /my) is said once more, until the next raise.
          const dropped = await lastDropped(ctx).catch(() => undefined);
          if (live.current && dropped) setProblem({ id: "raise.error.dropped" });
          return setPhase({ kind: "compose" });
        }
        await settle(record, record.status === "asked");
      })
      .catch(() => live.current && setPhase({ kind: "compose" }));
    return () => {
      live.current = false;
    };
    // Looked for once, when the screen opens.
  }, []);

  // A batch is found through the account that sent it: once one is connected, look again.
  useEffect(() => {
    if (phase.kind !== "pending" || !problem?.connect || !wallet.address || lookedWith.current === wallet.address) return;
    void settle(phase.record, phase.unknown === true, wallet.address);
    // `settle` is a new closure every render; it runs once per account connected while pending.
  }, [wallet.address, phase, problem]);

  /** "Stop waiting": the screen stops following; nothing is sent or cancelled, and the form comes back. */
  const giveUpWaiting = (record: RaiseRecord) => {
    stopWaiting(record);
    tx.reset();
    setProblem(undefined);
    setRaiseSent(false);
    setPhase({ kind: "compose" });
  };

  /* ── the ports flow.ts asks through ── */
  const confirmKeys = (twice: boolean) => new Promise<boolean>((answer) => setKeysAsk({ twice, answer }));
  const ensureWallet = async (): Promise<Address | undefined> => {
    if (wallet.status === "connected" && wallet.address) return wallet.address;
    setPhase({ kind: "working", step: "connect", of: 1 });
    return new Promise<Address | undefined>((answer) => setConnectAsk({ answer }));
  };

  const swipe = async () => {
    if (busy.current || reward === undefined || !facts || !title || tooLong) return;
    busy.current = true;
    setProblem(undefined);
    setRaiseSent(false);
    void droppedSeen(ctx).catch(() => undefined);
    try {
      // A social login leaves the page and comes back by a fresh load: the form goes with it (kept.ts).
      const carry = LOG_IN && !(wallet.status === "connected" && wallet.address);
      if (carry) {
        void keepRaise({
          poster,
          details,
          showDetails,
          rewardKey,
          ...(rewardKey === "custom" && custom.status === "ok" ? { custom: custom.amount.toString() } : {}),
          days,
          mode,
          minClaimBps,
          payoutGasK,
        });
      }
      const raiser = await ensureWallet();
      if (carry) void dropKeptRaise();
      if (!raiser) {
        setPhase({ kind: "compose" });
        return;
      }
      setPhase({ kind: "working", step: "keys", of: 1 });
      const draft: Draft = { title, content, reward, days, mode, minClaimBps, payoutGasK };
      const outcome = await raise(draft, { ...ctx, maxExpiryPeriod: facts.cap }, {
        raiser,
        account: async () => (await connectedWallet())?.account.address,
        confirmKeys,
        signKeys: (typed) => signer.sign(typed),
        send: (calls, options) => tx.send(calls, options),
        onStep: (step, of) => setPhase({ kind: "working", step, of }),
        onSent: () => setRaiseSent(true),
      });
      finish(outcome);
    } finally {
      busy.current = false;
    }
  };

  const showLink = async (up: Up) => {
    setShowing(true);
    setProblem(undefined);
    const raiser = await ensureWallet();
    if (!raiser) {
      setShowing(false);
      setPhase({ kind: "up", up });
      return;
    }
    setPhase({ kind: "up", up });
    const outcome = await rebuild(up, ctx, { raiser, confirmKeys, signKeys: (typed) => signer.sign(typed), onStep: () => undefined });
    setShowing(false);
    if (outcome.ok) setPhase({ kind: "up", up: outcome.up });
    else setProblem(outcome.problem);
  };

  /* ── what the swipe would send, tried and priced before anything is sent ── */
  const priced = usePriced(reward, expiry, minClaimBps, payoutGasK, wallet.address);

  const reached: TxReached = (tx.state.reached ?? "sent") as TxReached;
  const sentence = (p: Problem) =>
    t(p.id, { network: chainName(config.chain), ...(p.values ?? {}), ...(p.amount !== undefined ? { amount: money(p.amount, decimals, lang) } : {}) });

  /* ── the share step ── */
  // Beside the sections the examples live in a box no taller than the window; when the box does
  // not show its end, its foot fades (design/talk.css, `data-clipped`).
  useEffect(() => {
    const box = document.getElementById("raise-preview");
    if (!box || typeof ResizeObserver === "undefined") return;
    const mark = () => {
      box.toggleAttribute("data-clipped", box.scrollHeight - box.scrollTop - box.clientHeight > 6);
      // A box that scrolls must be reachable by the keyboard to be scrolled by it.
      box.tabIndex = box.scrollHeight - box.clientHeight > 6 ? 0 : -1;
    };
    // Marked on the next frame: the mark changes nothing the observer measures in the same pass.
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(mark);
    };
    const watch = new ResizeObserver(later);
    watch.observe(box);
    for (const child of box.children) watch.observe(child);
    box.addEventListener("scroll", mark, { passive: true });
    mark();
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
      box.removeEventListener("scroll", mark);
    };
    // the compose view is drawn again after a raise ends or fails
  }, [phase.kind]);

  if (phase.kind === "up") {
    return (
      <Frame>
        <Share
          up={phase.up}
          reached={tx.state.reached ? reached : "in-block"}
          local={!config.chain.hasL1}
          chainId={config.chain.id}
          {...(tx.state.hash ? { txHash: tx.state.hash } : phase.up.record.txHash ? { txHash: phase.up.record.txHash } : {})}
          {...(tx.state.result?.ok ? { blockNumber: tx.state.result.receipt.blockNumber } : {})}
          {...(!phase.up.written && !phase.up.locked ? { onShow: () => void showLink(phase.up), showing } : {})}
          onAgain={() => {
            tx.reset();
            setPoster("");
            setDetails("");
            setShowDetails(false);
            setPhase({ kind: "compose" });
          }}
        />
        {problem ? <Band problem={problem} sentence={sentence(problem)} /> : null}
        {keysAsk ? <KeysCard ask={keysAsk} onDone={() => setKeysAsk(undefined)} raiser={wallet.address} /> : null}
        {connectAsk ? <Connect ask={connectAsk} onDone={() => setConnectAsk(undefined)} /> : null}
      </Frame>
    );
  }

  if (phase.kind === "pending") {
    const { record, unknown } = phase;
    return (
      <Frame>
        <section
          className="flex flex-col gap-4"
          data-testid={TID.raise.pending}
          data-hash={record.txHash}
          data-batch={record.batchId}
          data-status={record.status}
          data-unknown={unknown ? "true" : "false"}
        >
          <h1 className="m-0 text-[length:var(--fs-title-m-sm)] font-extrabold leading-[1.06] tracking-[-0.03em]">{t(unknown ? "raise.pending.unknown" : "raise.pending")}</h1>
          {unknown ? (
            <p className="m-0 text-[length:var(--fs-body-lg)] font-bold leading-snug" role="status" data-testid={TID.raise.unknown}>
              {t("raise.error.unknown")}
            </p>
          ) : null}
          <div data-testid={TID.raise.txRail} data-value={reached} data-offline={unreachable ? "true" : "false"}>
            <TxRail reached={reached} local={!config.chain.hasL1} offline={unreachable} />
          </div>
          {unreachable ? (
            <p className="ah-label m-0" data-testid={TID.raise.offline}>
              {t("raise.pending.offline")}
            </p>
          ) : null}
          <p className="ah-label m-0">{t("raise.pending.note")}</p>
          {record.txHash ? (
            <Proof>
              <span className="ah-meta ah-meta--exact break-all">tx {record.txHash}</span>
              <OnExplorer tx={record.txHash} />
            </Proof>
          ) : record.batchId ? (
            <>
              <p className="ah-label m-0">{t("raise.pending.batch")}</p>
              <Proof>
                <span className="ah-meta ah-meta--exact break-all">batch {record.batchId}</span>
              </Proof>
            </>
          ) : null}
          {problem && problem.id !== "raise.error.unknown" ? (
            <Band
              problem={problem}
              sentence={sentence(problem)}
              {...(problem.connect
                ? {
                    action: (
                      <QuietButton compact data-testid={TID.raise.pendingConnect} onClick={() => setConnectAsk({ answer: () => undefined })}>
                        {t(LOG_IN ? "raise.steps.logIn" : "raise.steps.connect")}
                      </QuietButton>
                    ),
                  }
                : {})}
            />
          ) : null}
          {/* Leaving the wait (to raise another hand meanwhile) sends nothing and cancels nothing. */}
          <div className="flex flex-col items-start gap-2">
            {problem?.pending ? <p className="ah-label m-0">{t("raise.pending.aside")}</p> : null}
            <QuietButton compact className="self-start" data-testid={TID.raise.stopWaiting} onClick={() => giveUpWaiting(record)}>
              {t("common.send.stopWaiting")}
            </QuietButton>
            <p className="ah-label ah-label--dim m-0">{t("common.send.stopWaitingNote")}</p>
          </div>
        </section>
        {connectAsk ? <Connect ask={connectAsk} onDone={() => setConnectAsk(undefined)} /> : null}
      </Frame>
    );
  }

  const working = phase.kind === "working";
  const noTitle = title === "";
  // One meter for one limit: a public Hand's address before `#`, as weigh() counts it against MAX_BEFORE_HASH.
  const addressOver = weighed.over === "address";
  const canSwipe = phase.kind === "compose" && !noTitle && !tooLong && reward !== undefined && expiry !== undefined && !failed;
  const titleOver = weighed.over === "title";
  const detailsOver = weighed.over === "details";
  const untilDate = expiry !== undefined ? day(expiry, lang) : undefined;
  // The link's preview writes the expiry's day in UTC; where the reader's day is another, the
  // date's own section says which day the preview will show. A hidden Hand's preview has no date.
  const previewDay = PREVIEWS && mode !== "dark" && expiry !== undefined ? previewDayApart(expiry, lang) : undefined;

  return (
    <Frame wide>
      {/* The screen in sections. The strip names them with what each is set to now and moves
          between them; on a phone the one action stays within reach under them, and from 1100 px
          the example and the action stand beside them (design/talk.css). */}
      <div className="ah-sided ah-sided--paged">
      <SectionStrip
        label={t("raise.nav.label")}
        testId={TID.raise.nav}
        sections={[
          { id: "raise-ask", label: t("raise.nav.ask") },
          { id: "raise-reward", label: t("raise.reward.label"), value: reward === undefined ? undefined : reward > 0n ? money(reward, decimals, lang) : t("raise.nav.none") },
          { id: "raise-expiry", label: t("raise.expiry.label"), value: untilDate },
          { id: "raise-who", label: t("raise.who.label"), value: t(MODE_WORD[mode]) },
          { id: "raise-preview", label: t("raise.nav.preview"), beside: true },
        ]}
      />
      <div className="ah-sections">
        {/* 1. What are you looking for? */}
        <section id="raise-ask" tabIndex={-1} className="ah-section flex flex-col gap-3">
          {/* The question is this section's heading, set as every section's is: the loud thing here is
              what the asker types. The raised hand stands on the action, not here a second time. */}
          <h1 className="ah-field__label m-0">
            <label htmlFor="raise-what">{t("raise.what")}</label>
          </h1>
          <textarea
            id="raise-what"
            data-testid={TID.raise.what}
            className="ah-compose"
            rows={3}
            value={poster}
            disabled={working}
            maxLength={POSTER_STOP}
            placeholder={t("raise.what.placeholder")}
            aria-describedby="raise-what-hint raise-what-count"
            aria-invalid={titleOver || undefined}
            onChange={(event) => setPoster(event.target.value)}
          />
          <p className="ah-label m-0 flex flex-wrap justify-between gap-x-4 gap-y-1">
            <span id="raise-what-hint">{t("raise.what.hint")}</span>
            {/* The calm view counts only near the limit; the lens always counts. */}
            <span id="raise-what-count" className="ah-meta" data-testid={TID.raise.titleCount} data-value={weighed.title} data-over={titleOver} hidden={!lens && weighed.title < MAX_TITLE * 0.8}>
              {t("raise.what.count", { n: weighed.title, max: MAX_TITLE })}
            </span>
          </p>
          {titleOver && tooLong ? <TooLong sentence={sentence(tooLong)} what="title" /> : null}
          {showDetails ? (
            <div className="ah-field">
              <label htmlFor="raise-details" className="ah-field__label">
                {t("raise.details.label")}
              </label>
              <textarea
                id="raise-details"
                data-testid={TID.raise.details}
                className="ah-input"
                rows={4}
                value={details}
                disabled={working}
                maxLength={MAX_DETAILS}
                placeholder={t("raise.details.placeholder")}
                aria-describedby="raise-details-count"
                aria-invalid={detailsOver || undefined}
                onChange={(event) => setDetails(event.target.value)}
              />
            </div>
          ) : (
            <QuietButton compact variant="text" className="self-start" data-testid={TID.raise.detailsToggle} onClick={() => setShowDetails(true)}>
              + {t("raise.details.add")}
            </QuietButton>
          )}
          {showDetails || weighed.details > 0 ? (
            <p className="ah-label m-0 flex justify-end">
              <span id="raise-details-count" className="ah-meta" data-testid={TID.raise.detailsCount} data-value={weighed.details} data-over={detailsOver} hidden={!lens && weighed.details < MAX_DETAILS * 0.8}>
                {t("raise.details.count", { n: weighed.details, max: MAX_DETAILS })}
              </span>
            </p>
          ) : null}
          {detailsOver && tooLong ? <TooLong sentence={sentence(tooLong)} what="details" /> : null}
        </section>

        {/* 2. Reward */}
        <Part id="raise-reward" label={t("raise.reward.label")}>
          <Chips
            label={t("raise.reward.label")}
            testId={TID.raise.rewardChip}
            selected={rewardKey}
            onSelect={setRewardKey}
            chips={[...REWARDS.map((key) => ({ key, label: money(BigInt(key) * 10n ** BigInt(decimals), decimals, lang) })), { key: "custom", label: t("raise.reward.custom"), dashed: true }]}
          />
          {rewardKey === "custom" ? (
            <div data-testid={TID.raise.rewardCustom}>
              <MoneyInput label={t("raise.reward.customLabel")} decimals={decimals} {...(custom.status === "ok" ? { initial: custom.amount } : {})} onReading={setCustom} />
            </div>
          ) : null}
          {reward === 0n ? (
            <p className="ah-note m-0" data-testid={TID.raise.noReward}>
              {t("raise.reward.none")}
            </p>
          ) : (
            <p className="ah-label m-0" data-testid={TID.raise.later}>
              {t("raise.reward.later")}
            </p>
          )}
          {/* What holds the money and what its issuer can do is for those who check: under the lens
              here. Where test money comes from is said when it runs short (below) and in the
              reader's own sheet. */}
          <Proof>
            {reward !== 0n && untilDate ? (
              <p className="ah-label m-0" data-testid={TID.raise.lockedLine}>
                {t("raise.reward.locked", { date: untilDate })}
              </p>
            ) : null}
            <p className="ah-label m-0" data-testid={TID.raise.issuerLine}>
              {TOKEN.kind === "usdc" ? (TESTNET ? t("raise.reward.issuerTest", { network: chainName(config.chain) }) : t("raise.reward.issuer")) : t("raise.reward.issuerStand")}
            </p>
          </Proof>
          <Disclose label={TOKEN.symbol}>
            <span className="ah-meta ah-meta--exact break-all">{t("raise.reward.lens.token", { address: TOKEN.address, decimals: String(decimals) })}</span>
          </Disclose>
            {/* How the reward may be split: a setting of the reward, so it stands with it, folded. */}
          <Opens label={t("raise.fine.label")} summary={lens ? `${percent(minClaimBps, lang)} · ${payoutGasK}` : t("raise.fine.calm", { pct: percent(minClaimBps, lang) })} testId={TID.raise.fineTune}>
            <div className="flex flex-col gap-2" data-testid={TID.raise.minClaim} data-value={minClaimBps}>
              <span className="ah-field__label">{t("raise.fine.minClaim", { pct: percent(minClaimBps, lang) })}</span>
              <Chips
                label={t("raise.fine.minClaim", { pct: percent(minClaimBps, lang) })}
                testId={`${TID.raise.minClaim}-chip`}
                selected={String(minClaimBps)}
                onSelect={(key) => setMinClaimBps(Number(key))}
                chips={MIN_CLAIMS.map((bps) => ({ key: String(bps), label: percent(bps, lang) }))}
              />
              <span className="ah-label">{t("raise.fine.minClaimWhy")}</span>
            </div>
            {/* The room for each payout is counted in units of work: the lens's, like Core's names below. */}
            <Proof>
            <div className="flex flex-col gap-2" data-testid={TID.raise.payoutRoom} data-value={payoutGasK}>
              <span className="ah-field__label">{t("raise.fine.room", { k: String(payoutGasK) })}</span>
              <Chips
                label={t("raise.fine.room", { k: String(payoutGasK) })}
                testId={`${TID.raise.payoutRoom}-chip`}
                selected={String(payoutGasK)}
                onSelect={(key) => setPayoutGasK(Number(key))}
                chips={ROOMS.map((k) => ({ key: String(k), label: String(k) }))}
              />
              <span className="ah-label">{t("raise.fine.roomWhy", { passes: String(passesAt(250)), more: String(passesAt(200)) })}</span>
              {payoutGasK !== 250 ? <span className="ah-label">{t("raise.fine.roomNow", { k: String(payoutGasK), passes: String(passesAt(payoutGasK)) })}</span> : null}
            </div>
            <span className="ah-meta ah-meta--exact">{t("raise.fine.lens.terms", { bps: String(minClaimBps), k: String(payoutGasK) })}</span>
            </Proof>
          </Opens>
        </Part>

        {/* 3. How many days it stays open: a ready number, or any date in the system's own date field.
            The field always shows the date the days come to, so the date is said once, in it. */}
        <Part id="raise-expiry" label={t("raise.expiry.for")}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Chips
              label={t("raise.expiry.for")}
              testId={TID.raise.expiryChip}
              selected={DAYS.includes(days) ? String(days) : ""}
              onSelect={(key) => setDays(Number(key))}
              chips={DAYS.map((n) => ({ key: String(n), label: count(n) }))}
            />
            {/* The date the days come to, said in the row; it opens the calendar for any other date. */}
            {now && facts && untilDate ? (
              <button
                ref={dateChip}
                type="button"
                className={DAYS.includes(days) ? "ah-chip ah-chip--date" : "ah-chip ah-chip--date ah-chip--selected"}
                aria-current={DAYS.includes(days) ? undefined : "true"}
                aria-expanded={picking}
                aria-controls="raise-expiry-days"
                data-testid={TID.raise.expiryDate}
                data-value={fieldDate(expiry ?? now.timestamp + days * DAY_SECONDS)}
                onClick={() => setPicking(!picking)}
              >
                {t("raise.expiry.untilDate", { date: untilDate })}
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={picking ? "M3.5 10L8 5.5l4.5 4.5" : "M3.5 6L8 10.5 12.5 6"} />
                </svg>
              </button>
            ) : null}
          </div>
          <div id="raise-expiry-days">
            {picking && now && facts ? (
              <DayPick
                value={fieldDate(expiry ?? now.timestamp + days * DAY_SECONDS)}
                min={fieldDate(now.timestamp + DAY_SECONDS)}
                max={fieldDate(now.timestamp + facts.cap - 600)}
                lang={lang}
                label={t("raise.expiry.pick")}
                earlier={t("raise.expiry.earlier")}
                later={t("raise.expiry.later")}
                testId={TID.raise.expiryCalendar}
                onPick={(date) => {
                  setDays(daysForDate(date, now.timestamp, facts.cap));
                  closeCalendar();
                }}
                onClose={closeCalendar}
              />
            ) : null}
          </div>
          {expiry !== undefined && untilDate ? (
            <p className="ah-label m-0" data-expiry={expiry} data-testid={TID.raise.expiryLine}>
              {t(reward !== undefined && reward > 0n ? "raise.expiry.until" : "raise.expiry.untilNone")}
            </p>
          ) : (
            <p className="ah-note m-0">{t("common.time.offline")}</p>
          )}
          {previewDay ? (
            <p className="ah-label m-0" data-testid={TID.raise.expiryUtc}>
              {t("raise.expiry.utc", { date: previewDay })}
            </p>
          ) : null}
          {days > NUDGE_DAYS ? (
            <p className="ah-label m-0" data-testid={TID.raise.nudge}>
              {t("raise.expiry.nudge")}
            </p>
          ) : null}
          {now && facts && expiry !== undefined ? (
            <Disclose label={t("raise.expiry.how")}>
              <span className="ah-meta ah-meta--exact">{t("common.lens.cap")}</span>
              <span className="ah-meta ah-meta--exact">{t("raise.expiry.lens.now", { block: now.number.toString(), timestamp: String(now.timestamp), cap: String(facts.cap) })}</span>
              <span className="ah-meta ah-meta--exact">{t("raise.expiry.lens.formula", { days: String(days), expiry: String(expiry) })}</span>
            </Disclose>
          ) : null}
        </Part>

        {/* 4. Who can see it */}
        <Part id="raise-who" label={t("raise.who.label")}>
          <Visibility mode={mode} onMode={setMode} />
          <p className="ah-label m-0">{t("raise.who.shared")}</p>
          <Disclose label={t("raise.who.halves")}>
            <span className="ah-label">{t("raise.who.halvesBody")}</span>
          </Disclose>
          {mode === "public" && title && (addressOver || lens) ? (
            <p className={addressOver ? "ah-alert m-0" : "ah-label m-0"} data-testid={TID.raise.size} data-value={weighed.beforeHash} data-over={addressOver ? "true" : "false"}>
              {t("raise.size", { bytes: count(weighed.beforeHash), max: count(MAX_BEFORE_HASH) })}
            </p>
          ) : null}
          {addressOver && tooLong ? <TooLong sentence={sentence(tooLong)} what="address" /> : null}
        </Part>

      </div>

      <div className="ah-sided__side">
        {/* 5. Preview */}
        {/* The two things a person meets, in the order they meet them: the link's preview in a chat,
            then the page it opens. Both follow every choice above as it is made. */}
        <Part id="raise-preview" label={t("raise.preview.label")}>
          <Unfurl mode={mode} host={config.site.replace(/^https?:\/\//, "")} title={title} content={content} reward={reward} decimals={decimals} token={TOKEN} expiry={expiry} />
          <span className="ah-meta">{t("raise.preview.page")}</span>
          <div className="ah-example" data-testid={TID.raise.preview} data-raiser={wallet.address ? "connected" : "none"}>
            {/* Before an account is connected the card's "Asked by" row says the address comes then. */}
            {expiry !== undefined && reward !== undefined ? (
              <DealCard
                state={now ? "open" : undefined}
                description={{ status: "attached", title: title || t("raise.who.untitled"), ...(content ? { content } : {}) }}
                reward={reward}
                decimals={decimals}
                expiry={expiry}
                claimBps={10_000}
                heading="h2"
                {...(now ? { block: { number: now.number, timestamp: now.timestamp } } : {})}
                {...(wallet.address ? { raiser: wallet.address } : { raiserByLogIn: LOG_IN })}
              />
            ) : (
              <p className="ah-note m-0">{t("common.time.offline")}</p>
            )}
          </div>
        </Part>

        {/* 6. The swipe: what it is doing, then the one action, then what it will cost. */}
        <section className="ah-sided__state flex flex-col gap-4">
          {working ? <Steps phase={phase} needsConnect={wallet.status !== "connected"} amount={reward !== undefined && reward > 0n ? exactMoney(reward, decimals, lang) : undefined} /> : null}
          {working && raiseSent ? (
            <div data-testid={TID.raise.txRail} data-value={reached} data-offline={unreachable ? "true" : "false"}>
              <TxRail reached={reached} local={!config.chain.hasL1} offline={unreachable} />
            </div>
          ) : working && unreachable ? (
            <p className="ah-note m-0" data-testid={TID.raise.offline}>
              {t("common.time.offline")}
            </p>
          ) : null}
          {problem ? <Band problem={problem} sentence={sentence(problem)} /> : null}
          {problem?.id === "raise.error.short" ? <Faucets /> : null}
          {failed ? <ErrorBand what={t("raise.error.facts")} /> : null}
          {priced.status === "refused" && !working ? <ErrorBand what={t(`core.${priced.refusal.name}`)} code={priced.refusal.name} /> : null}
        </section>
        <div className="ah-go">
          <SwipeButton gesture="raise" variant="amber" data-testid={TID.raise.swipe} disabled={!canSwipe} aria-describedby="raise-swipe-note" onClick={() => void swipe()} className="w-full">
            {reward !== undefined && reward > 0n ? t("raise.swipe.amount", { amount: exactMoney(reward, decimals, lang) }) : t("raise.swipe")}
          </SwipeButton>
        </div>
        <section className="flex flex-col gap-4">
          <p id="raise-swipe-note" className="ah-label m-0">
            {noTitle ? t("raise.swipe.needTitle") : tooLong ? sentence(tooLong) : !now ? t("raise.swipe.noClock") : t("raise.steps.tried")}
          </p>
          {priced.status === "ok" ? (
            <div data-testid={TID.raise.cost}>
              <CostLine cost={priced.cost} prices={config.prices} gas={priced.gas} />
            </div>
          ) : null}
        </section>
      </div>
      </div>
      {keysAsk ? <KeysCard ask={keysAsk} onDone={() => setKeysAsk(undefined)} raiser={wallet.address} /> : null}
      {connectAsk ? <Connect ask={connectAsk} onDone={() => setConnectAsk(undefined)} /> : null}
    </Frame>
  );
}

/** The calls the swipe would send now, as the connected account: tried and priced by useCost. */
function usePriced(reward: bigint | undefined, expiry: number | undefined, minClaimBps: number, payoutGasK: number, from: Address | undefined) {
  const calls = useMemo<Call[] | undefined>(() => {
    if (reward === undefined || expiry === undefined || !from) return undefined;
    const list: Call[] = [];
    if (reward > 0n) list.push(approveCallOf(reward));
    list.push(raiseCallOf({ reward, expiry, minClaimBps, payoutGasK }));
    return list;
    // The expiry moves with every block; a minute's step is enough for a price.
  }, [reward, expiry === undefined ? undefined : Math.floor(expiry / 60), minClaimBps, payoutGasK, from]);
  return useCost(calls, from);
}

function approveCallOf(reward: bigint): Call {
  return approveCall(TOKEN.address, CORE, reward);
}

function raiseCallOf(terms: { reward: bigint; expiry: number; minClaimBps: number; payoutGasK: number }): Call {
  return raiseCall(CORE, { token: TOKEN.address, rootKey: PREVIEW_ROOT, dataHash: PREVIEW_HASH, ...terms });
}

/** `wide`: the compose surface, which from 1100 px stands in two columns (design/talk.css). */
function Frame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <section className={`mx-auto w-full px-6 py-10 md:px-10 ${wide ? "ah-raise max-w-[720px]" : "max-w-[720px]"}`} data-screen="raise">
      {children}
    </section>
  );
}

function Band({ problem, sentence, action }: { problem: Problem; sentence: string; action?: ReactNode }) {
  // The account a raise was sent from is what the person must connect, so it stands in both
  // views; any other code is the lens's (ErrorBand).
  const account = problem.id === "raise.error.otherAccount" ? problem.code : undefined;
  return (
    <div data-testid={TID.raise.error} data-value={problem.id} className="flex flex-col gap-2">
      <ErrorBand
        what={sentence}
        {...(problem.nothingSent ? { kept: t("common.error.nothingSent") } : {})}
        {...(problem.code && !account ? { code: problem.code } : {})}
        {...(action ? { action } : {})}
      />
      {account ? <p className="ah-meta ah-meta--exact m-0 break-all">{account}</p> : null}
    </div>
  );
}

/** Words that do not fit, said where they are typed; the swipe waits until they do. */
function TooLong({ sentence, what }: { sentence: string; what: "title" | "details" | "address" }) {
  return (
    <p className="ah-note m-0" role="status" data-testid={TID.raise.tooLong} data-value={what}>
      {sentence}
    </p>
  );
}

function Steps({ phase, needsConnect, amount }: { phase: Extract<Phase, { kind: "working" }>; needsConnect: boolean; amount: string | undefined }) {
  const lock = phase.step === "allow" ? (amount ? t("raise.steps.allowAmount", { amount }) : t("raise.steps.allow")) : phase.step === "raise" && phase.of > 1 ? t("raise.steps.raise2") : phase.step === "raise" ? t("raise.steps.raise") : t("raise.steps.lock");
  const items: { key: string; label: string }[] = [
    ...(needsConnect || phase.step === "connect" ? [{ key: "connect", label: t(LOG_IN ? "raise.steps.logIn" : "raise.steps.connect") }] : []),
    { key: "keys", label: t("raise.steps.keys") },
    { key: "lock", label: lock },
  ];
  const at = phase.step === "connect" ? "connect" : phase.step === "keys" ? "keys" : "lock";
  const index = items.findIndex((item) => item.key === at);
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t("raise.steps.label")} data-testid={TID.raise.steps} data-step={phase.step}>
      {items.map((item, i) => (
        <li key={item.key} className="flex items-center gap-3" aria-current={i === index ? "step" : undefined}>
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[length:var(--bw-emph)] border-[var(--ink)] font-[family-name:var(--font-meta)] text-[length:var(--fs-mono-md)]"
            style={{ background: i < index ? "var(--ink)" : i === index ? "var(--amber)" : "transparent", color: i < index ? "var(--paper)" : "var(--ink)" }}
          >
            {i < index ? "✓" : i + 1}
          </span>
          <span className={i === index ? "font-bold" : "ah-label"}>{item.label}</span>
        </li>
      ))}
    </ol>
  );
}

function KeysCard({ ask, onDone, raiser }: { ask: { twice: boolean; answer: (yes: boolean) => void }; onDone: () => void; raiser: Address | undefined }) {
  const answer = (yes: boolean) => {
    onDone();
    ask.answer(yes);
  };
  return (
    <Sheet label={t("raise.keys.title")} onClose={() => answer(false)}>
      <div className="flex flex-col gap-4" data-testid={TID.raise.keysCard} data-twice={ask.twice}>
        <p className="m-0 text-[length:var(--fs-body-lg)] leading-[1.5]">{t("raise.keys.body")}</p>
        {/* The warning stays in both views: it is what keeps the confirmation from being phished. */}
        <p className="ah-label m-0">{t("raise.keys.warn")}</p>
        {ask.twice ? <p className="ah-note m-0">{t("raise.keys.twice")}</p> : null}
        <Disclose label={t("raise.keys.what")}>
          <span className="ah-meta ah-meta--exact" data-testid={TID.raise.keysWhat}>
            {t("raise.keys.lens.message")}
          </span>
          <span className="ah-meta ah-meta--exact normal-case">purpose: {KEYS_PURPOSE}</span>
          {raiser ? <span className="ah-meta ah-meta--exact break-all">raiser: {raiser}</span> : null}
          <span className="ah-meta ah-meta--exact">chainId: {config.chain.id} · verifyingContract: {CORE}</span>
        </Disclose>
        <div className="flex flex-wrap items-center gap-3">
          <SwipeButton gesture="raise" data-testid={TID.raise.keysConfirm} onClick={() => answer(true)}>
            {t("raise.keys.confirm")}
          </SwipeButton>
          <QuietButton compact onClick={() => answer(false)}>
            {t("raise.keys.back")}
          </QuietButton>
        </div>
      </div>
    </Sheet>
  );
}

function Connect({ ask, onDone }: { ask: { answer: (address: Address | undefined) => void }; onDone: () => void }) {
  const answered = useRef(false);
  const answer = (address: Address | undefined) => {
    if (answered.current) return;
    answered.current = true;
    onDone();
    ask.answer(address);
  };
  return <ConnectSheet onClose={() => answer(undefined)} onConnected={(address) => answer(address)} />;
}
