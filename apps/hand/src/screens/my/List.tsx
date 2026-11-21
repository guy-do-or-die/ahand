import { MATCH_ROOT_MAX_N, matchRoot, openAddress, readDescription, readHand, rootSeed } from "@ahand/sdk";
import { useEffect, useState } from "react";
import { isAddressEqual, type Address, type Hex } from "viem";

import { clientOf, useHand, useNow, watcherOf } from "../../chain";
import { config } from "../../config";
import { t } from "../../i18n";
import { chainName } from "../../i18n/common/chain";
import { navigate } from "../../router";
import { bookOf, forHand, handKey, put, type HandRecord, type PassedRecord } from "../../store/db";
import { TID } from "../../testids";
import { CopyRow, Mark, Proof, QuietButton, RewardBar, SwipeButton, day, money, useLang, useLens } from "../../ui";
import { ConnectButton, resume, useWallet } from "../../wallet";
import { onItsWay, resumeRaise, type RaiseContext } from "../raise/flow";
import { listChanged, useAnswers, useInboxSight, useMyHands, usePassed, useSecrets } from "./hooks";
import { countLine, daysLeft, formatCode, parseCode, parseHandNumber, secondsLeft, wantsCare } from "./logic";
import { GET_HAND, OPTIONS, SITE, coreOn, decimalsOf, domainOn } from "./place";
import { rebuildBare } from "./rebuild";
import { hasBook, unlock, unlockedFor } from "./session";
import { Line, Section, Title, UnlockBar, keysPlace } from "./parts";
import { useTypedSigner } from "../../wallet";

/** /my: the Hands raised on this device (UX-SPEC §7.3). The one source of the list is the device's store. */
export default function MyList() {
  const wallet = useWallet();
  const account = wallet.status === "connected" ? wallet.address : undefined;
  const hands = useMyHands();
  const passed = usePassed();
  const lens = useLens();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Title>{t("my.title")}</Title>
        <ConnectButton />
        <UnlockBar account={account} />
      </div>

      {hands.status === "ok" && hands.value.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-4 p-0" data-testid={TID.my.list}>
          {hands.value.map((record) => (
            <ListItem key={record.intent} record={record} account={account} />
          ))}
        </ul>
      ) : hands.status === "loading" ? (
        <Line>{t("common.loading")}</Line>
      ) : (
        <div className="flex flex-col items-start gap-3" data-testid={TID.my.empty}>
          <p className="m-0 text-[length:var(--fs-card-title-lg)] font-extrabold tracking-[-0.02em]">{t("my.empty")}</p>
          <SwipeButton gesture="raise" data-testid={TID.my.raise} onClick={() => navigate("/raise")} className="w-full">
            {t("my.raise")}
          </SwipeButton>
        </div>
      )}
      <Line testId={TID.my.deviceOnly} dim>
        {t("my.deviceOnly")}
      </Line>

      <AddByNumber account={account} />

      {passed.status === "ok" && passed.value.length > 0 ? (
        <Section title={t("my.passed.title")}>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {passed.value.map((record) => (
              <PassedItem key={record.id} record={record} />
            ))}
          </ul>
        </Section>
      ) : null}

      {lens ? (
        <Section title={t("my.lens.title")}>
          <DeviceCode account={account} />
          <RebuildFromCode account={account} />
        </Section>
      ) : null}
    </div>
  );
}

/**
 * A raise of this device stuck in "sent" (or asked, its answer lost) is read again from the chain
 * with the same check /raise uses (FINDINGS E-2): its hash, or its nonce and its own `Raised` log.
 * Found: the record becomes the Hand. Dropped: the record says nothing left the account. Nothing
 * is ever sent from here; the check stops when the list is left.
 */
function useSettleStuck(record: HandRecord): "checking" | undefined {
  const stuck = onItsWay(record) && record.chainId === config.chain.id;
  const [checking, setChecking] = useState(stuck);
  useEffect(() => {
    if (!stuck) return;
    const stop = new AbortController();
    const client = clientOf(record.chainId);
    const ctx = {
      client,
      chainId: record.chainId,
      core: record.core as Address,
      token: record.core as Address,
      maxExpiryPeriod: 0,
      site: config.site,
      options: config.cores.canonical ? { canonicalCore: config.cores.canonical } : {},
    } as RaiseContext;
    const env = { client, chainId: record.chainId, signal: stop.signal, tick: () => watcherOf(record.chainId).nextTip().then(() => undefined) };
    setChecking(true);
    resumeRaise(record, ctx, (intent, options) => resume(env, intent, options))
      .then((outcome) => {
        if (stop.signal.aborted) return;
        setChecking(false);
        if (outcome.ok || outcome.problem.id !== "raise.error.lostSight") listChanged();
      })
      .catch(() => setChecking(false));
    return () => stop.abort(new Error("the list was left"));
  }, [stuck, record.intent]);
  return stuck && checking ? "checking" : undefined;
}

/** The state line of a Hand by the network's clock: time left, time's up, or how it closed. */
function StateLine({ state, expiry, closedAt, funded }: { state: string | undefined; expiry: number; closedAt: number; funded: boolean }) {
  const lang = useLang();
  const now = useNow();
  if (state === "open") {
    const left = secondsLeft(expiry, now?.timestamp);
    if (left === undefined) return null;
    const days = daysLeft(left);
    return <span>{days === 0 ? t("my.left.underDay") : t("my.left.days", { n: days })}</span>;
  }
  if (state === "expired") return <span>{t("common.state.expired")}</span>;
  if (state === "thanked") return <span>{t("common.state.thanked", { date: day(closedAt, lang) })}</span>;
  if (state === "refunded") return <span>{funded ? t("common.state.refunded", { date: day(closedAt, lang) }) : t("common.state.closed")}</span>;
  return <span>{t("common.time.offline")}</span>;
}

function ListItem({ record, account }: { record: HandRecord; account: Address | undefined }) {
  const lang = useLang();
  const now = useNow();
  const core = record.core as Address;
  const handId = record.handId ? BigInt(record.handId) : undefined;
  const read = useHand(handId !== undefined ? core : undefined, handId, record.chainId);
  const secrets = useSecrets(record, account); // starts listening on the inbox once unlocked
  const key = record.hand ?? (handId !== undefined ? handKey(record.chainId, core, handId) : undefined);
  const answers = useAnswers(key, handId !== undefined ? { chainId: record.chainId, core, handId } : undefined, read.data?.state);
  const answered = answers.reads.filter((answer) => answer.judged?.verdict === "answer").length;
  // "No answers yet" only after an unlocked read of the inbox; locked, the line says locked.
  const sight = useInboxSight(record, account, secrets, answers.settled);
  const count = countLine(sight, answered);
  const settling = useSettleStuck(record);

  if (handId === undefined || !key) {
    return (
      <li className="ah-card flex flex-col gap-2 border-dashed p-4" data-testid={TID.my.item} data-value={record.intent} data-status={record.status ?? ""}>
        <p className="m-0 font-extrabold">{record.title}</p>
        {record.status === "dropped" ? (
          <p className="ah-label m-0" data-testid={TID.my.raiseDropped}>
            {t("raise.my.dropped")}
          </p>
        ) : (
          <Line>{record.status === "reverted" ? t("my.reverted") : settling ? t("raise.my.checking") : t("my.notUp")}</Line>
        )}
      </li>
    );
  }

  const view = read.data?.view;
  const state = read.data?.state;
  const decimals = view ? decimalsOf(view.token) : 18;
  const left = view ? secondsLeft(view.expiry, now?.timestamp) : undefined;
  const href = `/my/${record.chainId}/${handId}`;
  const other = account && record.raiser.toLowerCase() !== account.toLowerCase();
  // A closed Hand has nothing left to do: its card says only how it ended, not the floor a
  // helper would get or that answers wait to be checked.
  const closed = state === "thanked" || state === "refunded";

  return (
    <li className="ah-card flex flex-col gap-3 p-4 md:p-5" data-testid={TID.my.item} data-value={key} data-state={state ?? "unknown"}>
      <a href={href} className="flex flex-col gap-1 text-[var(--ink)] no-underline">
        <Proof>
          <span className="ah-meta ah-exact">#{handId.toString()}</span>
        </Proof>
        <span className="text-[length:var(--fs-card-title-lg)] font-extrabold leading-tight tracking-[-0.02em]">{record.title || t("my.added", { id: handId.toString() })}</span>
      </a>
      {!record.title ? <Line dim>{t("my.addedWhy")}</Line> : null}
      {view && closed ? (
        state === "thanked" && view.reward > 0n ? (
          <span className="ah-label">{t("my.paidOut", { reward: money(view.reward, decimals, lang) })}</span>
        ) : null
      ) : view ? (
        view.reward > 0n ? (
          <div className="flex flex-col gap-2">
            <RewardBar
              progress={view.minClaimBps / 10_000}
              label={t("my.floor", { floor: money((view.reward * BigInt(view.minClaimBps)) / 10_000n, decimals, lang), reward: money(view.reward, decimals, lang) })}
            />
            <span className="ah-label">
              {t("my.floor", { floor: money((view.reward * BigInt(view.minClaimBps)) / 10_000n, decimals, lang), reward: money(view.reward, decimals, lang) })}
            </span>
          </div>
        ) : (
          <span className="ah-label">{t("my.noReward")}</span>
        )
      ) : null}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[length:var(--fs-body-sm)] font-semibold">
        {view ? <StateLine state={state} expiry={view.expiry} closedAt={view.closedAt} funded={view.reward > 0n} /> : null}
        <span data-testid={TID.my.answerCount} data-value={answered} data-state={sight} hidden={closed}>
          {t(count.id, count.values)}
        </span>
      </div>
      {other ? <Line dim>{t("my.otherAccount")}</Line> : null}
      {view && wantsCare(state, left) ? (
        <a href={`/care/${record.chainId}/${handId}`} className="ah-alert no-underline" data-testid={TID.my.careBand}>
          {t("my.careBand", { n: daysLeft(left!) })}
        </a>
      ) : null}
      <a href={href} className="ah-quiet ah-quiet--compact self-start">
        {t("my.open")}
      </a>
    </li>
  );
}

function PassedItem({ record }: { record: PassedRecord }) {
  const read = useHand(record.core as Address, BigInt(record.handId), record.chainId);
  const view = read.data?.view;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--ink-a10)] py-2" data-testid={TID.my.passedItem} data-value={record.hand} data-state={read.data?.state ?? "unknown"}>
      <span className="text-[length:var(--fs-body-sm)] font-semibold">{t("my.passed.item", { id: record.handId, place: record.position + 1 })}</span>
      <span className="ah-label">{view ? <StateLine state={read.data?.state} expiry={view.expiry} closedAt={view.closedAt} funded={view.reward > 0n} /> : null}</span>
    </li>
  );
}

/**
 * "Add a hand by its number": reads `hands(id)` and keeps it only if the connected account raised
 * it. If this device's own code for the account holds its root key (found by `matchRoot` among the
 * numbers this device handed out), the record gets its place, so its link can be shown again.
 */
function AddByNumber({ account }: { account: Address | undefined }) {
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ id: string; error: boolean; values?: Record<string, string> } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setMessage(undefined);
    const handId = parseHandNumber(text);
    if (handId === undefined) return setMessage({ id: "my.add.bad", error: true });
    if (!account) return setMessage({ id: "my.add.connect", error: true });
    const place = keysPlace();
    const core = coreOn(place?.chainId ?? 0);
    if (!place || !core) return;
    setBusy(true);
    try {
      const { view } = await readHand(clientOf(place.chainId), core, handId);
      if (view.openedAt === 0) return setMessage({ id: "core.NotRaised", error: true });
      if (!isAddressEqual(view.raiser, account)) return setMessage({ id: "my.add.notYours", error: true });
      const key = handKey(place.chainId, core, handId);
      if ((await forHand("hands", key)).length > 0) return setMessage({ id: "my.add.already", error: true });
      let book: Hex = "0x";
      let n = -1;
      const session = unlockedFor(place.chainId, core, account);
      const mine = await bookOf(account);
      if (session?.master && mine) {
        const found = await matchRoot(session.master, mine.book, view.rootKey, Math.max(0, mine.next - 1));
        if (found !== undefined) {
          book = mine.book;
          n = found;
        }
      }
      await put("hands", { intent: `added:${key}`, raiser: account.toLowerCase(), chainId: place.chainId, core, book, n, mode: "dark", title: "", hand: key, handId: handId.toString(), status: "up" });
      listChanged();
      setText("");
      setMessage({ id: "my.add.done", error: false, values: { id: handId.toString() } });
    } catch {
      setMessage({ id: "my.add.offline", error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t("my.add.title")}>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <label className="ah-field min-w-0 flex-1">
          <span className="ah-field__label">{t("my.add.label")}</span>
          <input className="ah-input ah-input--exact" inputMode="numeric" autoComplete="off" data-testid={TID.my.addByNumberInput} value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <QuietButton type="submit" data-testid={TID.my.addByNumberSubmit} disabled={busy}>
          {t("my.add.go")}
        </QuietButton>
      </form>
      {message ? (
        <p className="ah-label m-0" role="status" data-testid={message.error ? TID.my.addByNumberError : undefined} data-value={message.id}>
          {t(message.id, message.values)}
        </p>
      ) : null}
    </Section>
  );
}

/** Under the lens: this device's code for the connected account (its book, not a secret). */
function DeviceCode({ account }: { account: Address | undefined }) {
  const [book, setBook] = useState<Hex | undefined | null>(undefined);
  useEffect(() => {
    if (!account) return setBook(undefined);
    let live = true;
    bookOf(account).then(
      (record) => live && setBook(record?.book ?? null),
      () => live && setBook(null),
    );
    return () => {
      live = false;
    };
  }, [account]);
  if (!account || book === undefined) return null;
  return (
    <div className="flex flex-col gap-2" data-testid={TID.my.deviceCode} data-value={book ?? ""}>
      <p className="ah-meta m-0">{t("my.lens.code")}</p>
      {book ? <CopyRow value={formatCode(book)} dashed={false} /> : <Line>{t("my.lens.noCode")}</Line>}
      <Line dim>{t("my.lens.codeWhy")}</Line>
    </div>
  );
}

type RebuildState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "error"; id: string; values?: Record<string, string> }
  | { status: "done"; address: string; handId: bigint; n: number; kept: boolean };

/**
 * "Rebuild a link from another device's code" (ARCHITECTURE §5, D-17): with the same keys
 * confirmation and the other device's code, `matchRoot` finds the Hand's number in that code by
 * the root key Core keeps; the link is written bare, and its words did not arrive: they are never
 * on the chain. The link is opened here before it is shown.
 */
function RebuildFromCode({ account }: { account: Address | undefined }) {
  const { sign } = useTypedSigner();
  const [code, setCode] = useState("");
  const [number, setNumber] = useState("");
  const [state, setState] = useState<RebuildState>({ status: "idle" });
  const run = async () => {
    const book = parseCode(code);
    if (!book) return setState({ status: "error", id: "my.lens.rebuildBadCode" });
    const handId = parseHandNumber(number);
    if (handId === undefined) return setState({ status: "error", id: "my.add.bad" });
    const place = keysPlace();
    if (!account || !place) return setState({ status: "error", id: "my.add.connect" });
    const core = place.core;
    let session = unlockedFor(place.chainId, core, account);
    if (!session) {
      const outcome = await unlock(place.chainId, core, account, sign);
      if (!outcome.ok) {
        if (outcome.reason === "wrong-network") return setState({ status: "error", id: "common.error.wrongNetwork", values: { network: chainName(config.chain) } });
        return setState({ status: "error", id: outcome.reason === "rejected" ? "my.unlock.refused" : "my.add.offline" });
      }
      session = outcome.unlocked;
    }
    if (!session.master) return setState({ status: "error", id: "my.unlock.differs" });
    setState({ status: "searching" });
    try {
      const client = clientOf(place.chainId);
      const { view, hand } = await readHand(client, core, handId);
      if (view.openedAt === 0) return setState({ status: "error", id: "core.NotRaised" });
      if (!isAddressEqual(view.raiser, account)) return setState({ status: "error", id: "my.add.notYours" });
      const n = await matchRoot(session.master, book, view.rootKey, MATCH_ROOT_MAX_N);
      if (n === undefined) return setState({ status: "error", id: "my.lens.rebuildNotFound", values: { max: String(MATCH_ROOT_MAX_N) } });
      const seed = await rootSeed(session.master, book, n);
      const address = await rebuildBare({ domain: domainOn(place.chainId, core), hand, seed, site: SITE, options: OPTIONS });
      // Opened here as any reader would open it, before it is shown.
      const opened = await openAddress(address, GET_HAND, OPTIONS);
      if (opened.hand.handId !== handId || readDescription(opened).status === "attached") throw new Error("the rebuilt link did not open as expected");
      // Keep its place in the list, so its link and its answers are there next time.
      const key = handKey(place.chainId, core, handId);
      const existing = (await forHand("hands", key))[0];
      let kept = false;
      if (!existing || !hasBook(existing)) {
        await put("hands", existing ? { ...existing, book, n } : { intent: `rebuilt:${key}`, raiser: account.toLowerCase(), chainId: place.chainId, core, book, n, mode: "dark", title: "", hand: key, handId: handId.toString(), status: "up" });
        listChanged();
        kept = true;
      }
      setState({ status: "done", address, handId, n, kept });
    } catch {
      setState({ status: "error", id: "my.add.offline" });
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="ah-meta m-0">{t("my.lens.rebuild")}</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <label className="ah-field">
          <span className="ah-field__label">{t("my.lens.rebuildCode")}</span>
          <input className="ah-input ah-input--exact" autoComplete="off" spellCheck={false} data-testid={TID.my.rebuildInput} value={code} onChange={(event) => setCode(event.target.value)} placeholder="0000 0000 0000 0000" />
        </label>
        <label className="ah-field">
          <span className="ah-field__label">{t("my.lens.rebuildHand")}</span>
          <input className="ah-input ah-input--exact" inputMode="numeric" autoComplete="off" data-testid={TID.my.rebuildHand} value={number} onChange={(event) => setNumber(event.target.value)} />
        </label>
        <QuietButton type="submit" className="self-start" data-testid={TID.my.rebuildSubmit} disabled={state.status === "searching"}>
          {t("my.lens.rebuildGo")}
        </QuietButton>
      </form>
      {state.status === "searching" ? <Line>{t("my.lens.rebuildSearching", { max: String(MATCH_ROOT_MAX_N) })}</Line> : null}
      {state.status === "error" ? (
        <p className="ah-label m-0" role="status" data-testid={TID.my.rebuildError} data-value={state.id}>
          {t(state.id, state.values)}
        </p>
      ) : null}
      {state.status === "done" ? (
        <div className="flex flex-col gap-2" data-testid={TID.my.rebuildResult} data-value={state.address}>
          <p className="m-0 font-semibold">{t("my.lens.rebuildDone", { id: state.handId.toString(), n: String(state.n) })}</p>
          <Mark kind="checked" />
          <CopyRow value={state.address} />
          <Line>{t("my.lens.rebuildWhy")}</Line>
          {state.kept ? <Line dim>{t("my.lens.rebuildKept")}</Line> : null}
          <a href={state.address} className="ah-quiet ah-quiet--compact self-start" data-testid={TID.my.rebuildOpen}>
            {t("my.lens.rebuildOpen")}
          </a>
        </div>
      ) : null}
    </div>
  );
}
