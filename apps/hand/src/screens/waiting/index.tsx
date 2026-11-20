import { castLine, handLogsAt, readHand, readPending, withdrawCall, type HandLog } from "@ahand/sdk";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isAddress, isAddressEqual, zeroAddress, type Address } from "viem";

import { clientOf, useBlockRead, useChainStatus, useCost } from "../../chain";
import { config, TESTNET, type TokenConfig } from "../../config";
import { t } from "../../i18n";
import { chainName } from "../../i18n/common/chain";
import { navigate, usePlace } from "../../router";
import { all } from "../../store/db";
import { TID } from "../../testids";
import {
  AddressInput,
  ChipRow,
  CopyRow,
  CostLine,
  Disclose,
  ErrorBand,
  Identity,
  Mark,
  QuietButton,
  SwipeButton,
  TxRail,
  count,
  money,
  payeeOf,
  shortAddress,
  useLang,
  useLens,
  type AddressReading,
  type Lang,
} from "../../ui";
import { ConnectButton, ConnectSheet, useKeptSend, useWallet, withdrawnProbe, type KeptSend, type SendResult } from "../../wallet";
import {
  addressFromSearch,
  failureOf,
  knownHands,
  offerOf,
  pathFor,
  payeeOfPage,
  refusalFailure,
  tokenSaid,
  withdrawnIn,
  type Failure,
  type Offer,
  type WithdrawnEvent,
} from "./logic";
import { OnExplorer } from "../../shell/OnExplorer";

/**
 * /waiting (UX-SPEC §9): what waits in Core for one address, per token (`pending(token, payee)`),
 * and the two ways out of Core's `withdraw`: "Take it out" for the payee (to this address or
 * another) and "Deliver" for anyone (always to the payee's own address). Deliver is on the row for
 * a visitor too: with no account that can send, the press opens "Connect a wallet" and the row
 * goes on to what it costs. Every send goes through `useSend`, which simulates first; a token that
 * still refuses the payee is said in a sentence before anything is pressed, and the token's own
 * answer stands one tap below it, never in the sentence's place. History comes only from Hands
 * this device knows, read in each Hand's closing block by its number; nothing here scans the
 * chain by payee.
 *
 * Each token's withdraw is one kept intent (`useKeptSend`): stored before the wallet is asked,
 * followed again after a reload with the button held, and settled by the account's nonce and a
 * `Withdrawn` for this payee when the wallet's answer is lost, never offered twice (W-6, U-2).
 * The title and labels speak of "this address", since anyone may paste one (F11).
 */

const CORE: Address = config.cores.canonical ?? config.cores.trusted[0]!.core;
const TRUSTED: Address[] = config.cores.trusted.filter((c) => c.chainId === config.chain.id).map((c) => c.core);
const RPC = config.chain.rpcUrls[0];

function amountOf(token: TokenConfig, amount: bigint, lang: Lang): string {
  return money(amount, token.decimals, lang);
}

function tokenOf(address: Address): TokenConfig | undefined {
  return config.tokens.find((token) => isAddressEqual(token.address, address));
}

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="ah-meta ah-meta--ink m-0 border-t-[length:var(--bw-emph)] border-[var(--ink)] pt-4">{children}</h2>;
}

/* ─────────────────────────────────────────────────────────── whose money ── */

function Look() {
  const [text, setText] = useState("");
  const value = text.trim();
  const valid = isAddress(value, { strict: false }) && addressFromSearch(`?for=${value}`) !== undefined;
  const look = () => {
    if (valid) navigate(pathFor(addressFromSearch(`?for=${value}`)!));
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        look();
      }}
    >
      <label htmlFor="waiting-look" className="ah-field__label">
        {t("waiting.look.label")}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="waiting-look"
          data-testid={TID.waiting.addressInput}
          className="ah-input ah-input--exact min-w-0 flex-1"
          placeholder="0x…"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value.replace(/\s+/g, ""))}
        />
        <QuietButton type="submit" data-testid={TID.waiting.look} disabled={!valid}>
          {t("waiting.look.go")}
        </QuietButton>
      </div>
      <p className="ah-label ah-label--dim m-0" role="status">
        {value !== "" && !valid ? t("waiting.look.bad") : t("waiting.look.readOnly")}
      </p>
    </form>
  );
}

/* ──────────────────────────────────────────────────────────── one token ── */

interface Done {
  token: Address;
  events: WithdrawnEvent[];
}

/**
 * A withdraw that did not go, or would not: the plain sentence and what was not lost. Core's own
 * name for a refusal rides in the band. What a token answered (`said`, the engine's line about the
 * failed check) is exact data: it waits under "What the token said" and stands open under the lens.
 */
function FailureBand({ failure, said }: { failure: Failure; said?: string }) {
  let what: string;
  let kept = t("waiting.kept");
  if (failure.kind === "token") what = t("waiting.stuck");
  else if (failure.kind === "core") what = t(failure.id);
  else if (failure.kind === "rejected") {
    what = t("common.error.refused");
    kept = "";
  } else if (failure.kind === "dropped") {
    what = t("common.send.dropped");
    kept = t("waiting.kept");
  } else if (failure.kind === "wrong-network") {
    what = t("common.error.wrongNetwork", { network: chainName(config.chain) });
  } else if (failure.kind === "unknown") {
    what = t("common.send.unknown");
    kept = "";
  } else if (failure.kind === "offline") what = t("waiting.offline");
  else what = t("waiting.failed");
  const exact = failure.kind === "token" ? tokenSaid(said) : undefined;
  return (
    <div className="flex flex-col gap-2" data-testid={TID.waiting.error} data-value={failure.kind === "core" ? failure.refusal.name : failure.kind}>
      <ErrorBand what={what} {...(kept ? { kept } : {})} {...(failure.kind === "core" ? { code: failure.refusal.name } : {})} />
      {exact ? (
        <Disclose label={t("waiting.stuck.said")}>
          <code className="ah-meta ah-meta--exact">{exact}</code>
        </Disclose>
      ) : null}
      {failure.kind === "token" ? <IssuerLine /> : null}
    </div>
  );
}

function IssuerLine() {
  return (
    <a href="/limits" className="ah-label ah-label--dim underline decoration-dashed underline-offset-4" data-testid={TID.waiting.issuer}>
      {t("waiting.issuer")}
    </a>
  );
}

function WithoutUs({ call }: { call: ReturnType<typeof withdrawCall> }) {
  return (
    <div data-testid={TID.kit.withoutUs}>
      <Disclose label={t("waiting.withoutUs")}>
        <span className="ah-label m-0 normal-case">{t("waiting.withoutUs.body")}</span>
        {/* The whole line is copied; on screen it is shortened so it never pushes the page sideways (the calldata stands in full below). */}
        <div className="grid w-full grid-cols-[minmax(0,1fr)]">
          <CopyRow value={castLine(call, RPC ? { rpc: RPC } : {})} display={`cast send ${shortAddress(call.to)} ${call.data.slice(0, 10)}…`} />
        </div>
        <span className="ah-meta">{t("waiting.lens.calldata")}</span>
        <code className="ah-meta ah-meta--exact break-all">
          {call.to} · {call.data}
        </code>
        <a href="/without-us" className="ah-label underline decoration-dashed underline-offset-4">
          {t("waiting.withoutUs.more")}
        </a>
      </Disclose>
    </div>
  );
}

function Actions({ token, payee, offer, from, kept, onDone }: { token: TokenConfig; payee: Address; offer: Offer; from: Address | undefined; kept: KeptSend; onDone: (done: Done) => void }) {
  const [where, setWhere] = useState<"here" | "elsewhere">("here");
  const [reading, setReading] = useState<AddressReading>({ status: "empty" });
  const [failure, setFailure] = useState<{ failure: Failure; said?: string } | undefined>();
  // A visitor pressed Deliver: "Connect a wallet" is open over the row.
  const [asking, setAsking] = useState(false);
  const visitor = offer.connectFirst;
  const group = useRef<HTMLDivElement>(null);
  const pressed = useRef<HTMLButtonElement | null>(null);
  // When that sheet goes, the person is put back where they were: on the button they pressed, or,
  // while it can't be pressed yet (the cost is being worked out, or the token refuses), on the
  // row's actions, so the next thing a keyboard or a screen reader meets is the cost and the button.
  useEffect(() => {
    if (asking || !pressed.current) return;
    if (pressed.current.isConnected && !pressed.current.disabled) pressed.current.focus();
    else group.current?.focus();
    pressed.current = null;
  }, [asking]);
  const tx = kept.tx;
  const busy = kept.holding || (tx.state.phase !== "idle" && tx.state.phase !== "done" && tx.state.phase !== "failed");

  const to: Address | undefined = offer.takeOut ? (where === "here" ? payee : payeeOf(reading)) : payee;
  const call = useMemo(() => (to ? withdrawCall(CORE, token.address, payee, to) : undefined), [to, token.address, payee]);
  // Nothing is priced for a visitor (there is no account yet to ask the chain as), nor while a send is on its way.
  const cost = useCost(call && !visitor && !busy ? [call] : undefined, from);
  const ahead: Failure | undefined =
    cost.status === "refused" ? refusalFailure(cost.refusal) : cost.status === "failed" ? { kind: "token" } : cost.status === "offline" ? { kind: "offline" } : undefined;

  async function go() {
    if (!call || busy) return;
    setFailure(undefined);
    const result = await kept.send([call], { steps: [{ action: "withdraw", probe: withdrawnProbe(CORE, token.address, payee) }] });
    if (result.ok) onDone({ token: token.address, events: withdrawnIn(result.receipt, CORE) });
    else if (result.reason !== "stopped") setFailure({ failure: failureOf(result), ...("message" in result && result.reason === "failed-check" ? { said: result.message } : {}) });
  }

  if (!offer.takeOut && !offer.deliver) return null;
  const takeOut = offer.takeOut;
  const action = t(takeOut ? "waiting.takeOut" : "waiting.deliver");
  return (
    <div ref={group} tabIndex={-1} role="group" aria-label={`${action} · ${tokenName(token)}`} className="flex flex-col gap-3 rounded-[var(--r-control)]">
      {takeOut ? (
        <>
          <span className="ah-meta">{t("waiting.takeOut.where")}</span>
          <ChipRow
            label={t("waiting.takeOut.where")}
            options={[
              { key: "here", label: t("waiting.takeOut.here") },
              { key: "elsewhere", label: t("waiting.takeOut.elsewhere"), dashed: true },
            ]}
            selectedKey={where}
            onSelect={(key) => setWhere(key as "here" | "elsewhere")}
          />
          {where === "elsewhere" ? (
            <div data-testid={TID.waiting.takeOutTo}>
              <AddressInput label={t("waiting.takeOut.toLabel")} ctx={{ core: CORE, raiser: zeroAddress, token: token.address }} onReading={setReading} />
            </div>
          ) : null}
        </>
      ) : (
        <p className="ah-label m-0">{t(visitor ? "waiting.deliver.visitor" : "waiting.deliver.note")}</p>
      )}
      {visitor ? null : ahead && !busy ? (
        <FailureBand failure={ahead} {...(cost.status === "failed" ? { said: cost.message } : {})} />
      ) : cost.status === "ok" ? (
        <div data-testid={TID.kit.costLine}>
          <CostLine cost={cost.cost} prices={config.prices} gas={cost.gas} />
        </div>
      ) : call && !busy ? (
        <p className="ah-label ah-label--dim m-0">{t("waiting.cost.checking")}</p>
      ) : null}
      <SwipeButton
        gesture={takeOut ? "cheer" : "shake"}
        emoji={takeOut ? "🫴" : "🫱"}
        variant={takeOut ? "amber" : "ink"}
        data-testid={takeOut ? TID.waiting.takeOut : TID.waiting.deliver}
        data-token={token.address}
        // A send kept from before a reload holds the button for a visitor too, until it lands or is dropped (W-6).
        disabled={busy || (!visitor && (!call || cost.status !== "ok"))}
        data-held={busy ? "true" : "false"}
        onClick={(event) => {
          if (!visitor) return void go();
          pressed.current = event.currentTarget;
          setAsking(true);
        }}
      >
        {action}
      </SwipeButton>
      {failure ? <FailureBand failure={failure.failure} {...(failure.said ? { said: failure.said } : {})} /> : null}
      {call ? <WithoutUs call={call} /> : null}
      {/* Once an account is connected the row prices the same call for it; the press itself sent nothing. */}
      {asking ? <ConnectSheet onClose={() => setAsking(false)} /> : null}
    </div>
  );
}

/** A test token's name in the reader's language (the configuration's label is one language only). */
function tokenName(token: TokenConfig): string {
  if (token.kind === "usd" || token.kind === "blacklist") return t(`common.token.${token.kind}`);
  if (token.kind === "usdc" && TESTNET) return t("common.token.usdc.test");
  return token.label;
}

function Row({ token, amount, payee, atBlock, children }: { token: TokenConfig; amount: bigint; payee: Address; atBlock?: bigint; children?: ReactNode }) {
  const lang = useLang();
  return (
    <li className="ah-card flex flex-col gap-4 p-5" data-testid={TID.waiting.row} data-value={token.address} data-amount={amount.toString()}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="ah-label">{tokenName(token)}</span>
          <span className="text-[length:var(--fs-title-m)] font-extrabold leading-none tracking-[-0.03em] tabular-nums">{amountOf(token, amount, lang)}</span>
        </div>
        <Mark
          kind="waiting"
          source={
            <span className="ah-meta ah-meta--exact">
              {t("waiting.lens.view", { token: token.address, payee, amount: amount.toString(), block: atBlock !== undefined ? count(atBlock) : "—" })}
            </span>
          }
        />
      </div>
      {children}
    </li>
  );
}

/** A send of this token's withdraw from before a reload, or one whose answer is unknown: said in words. */
function InFlight({ kept }: { kept: KeptSend }) {
  if (kept.unknown) {
    return (
      <p className="ah-note m-0" role="status" data-testid={TID.waiting.unknown}>
        {t("common.send.unknown")}
      </p>
    );
  }
  const phase = kept.tx.state.phase;
  if (!kept.resumed || !(kept.holding || (phase !== "done" && phase !== "failed" && phase !== "idle"))) return null;
  return (
    <p className="ah-note m-0" role="status" data-testid={TID.waiting.inFlight}>
      {t("common.send.inFlight")}
    </p>
  );
}

/** One token's row: what waits, the way out, and its send kept across a reload. */
function TokenRow({
  token,
  amount,
  payee,
  atBlock,
  offer,
  connected,
  onDone,
}: {
  token: TokenConfig;
  amount: bigint;
  payee: Address;
  atBlock: bigint | undefined;
  offer: Offer | undefined;
  connected: Address | undefined;
  onDone: (done: Done) => void;
}) {
  const [resumedFailure, setResumedFailure] = useState<Failure | undefined>();
  const kept = useKeptSend(`withdraw:${config.chain.id}:${payee.toLowerCase()}:${token.address.toLowerCase()}`, { withdraw: withdrawnProbe(CORE, token.address, payee) }, (result: SendResult) => {
    if (result.ok) onDone({ token: token.address, events: withdrawnIn(result.receipt, CORE) });
    else if (result.reason !== "stopped") setResumedFailure(failureOf(result));
  });
  const reached = kept.tx.state.reached;
  const { offline, stale } = useChainStatus();
  const phase = kept.tx.state.phase;
  const inFlight = kept.holding || kept.unknown || phase === "asking" || phase === "watching" || phase === "between" || phase === "checking";
  // Nothing waits and nothing of ours is on its way: no row (the screen says "nothing").
  if (amount === 0n && !inFlight) return null;
  return (
    <Row token={token} amount={amount} payee={payee} {...(atBlock !== undefined ? { atBlock } : {})}>
      <InFlight kept={kept} />
      {reached ? (
        <div data-testid={TID.waiting.txRail} data-value={reached} data-phase={kept.tx.state.phase}>
          <TxRail reached={reached} local={!config.chain.hasL1} offline={(offline || stale) && kept.tx.state.phase === "watching"} />
        </div>
      ) : null}
      {resumedFailure ? <FailureBand failure={resumedFailure} /> : null}
      {/* A visitor's Deliver is on the row too: its press opens "Connect a wallet" first (F11). */}
      {offer ? <Actions token={token} payee={payee} offer={offer} from={connected} kept={kept} onDone={onDone} /> : null}
      {offer?.deliver && !offer.connectFirst ? <p className="ah-label ah-label--dim m-0">{t("waiting.takeOut.only")}</p> : null}
    </Row>
  );
}

/* ────────────────────────────────────────────── hands this device knows ── */

interface Seen {
  hand: bigint;
  log: HandLog;
}

function useKnownPending(payee: Address | undefined): { hands: number; seen: Seen[] } | undefined | "failed" {
  const [state, setState] = useState<{ key: string; value: { hands: number; seen: Seen[] } | "failed" } | undefined>();
  const key = payee?.toLowerCase();
  useEffect(() => {
    if (!payee || !key) return;
    let live = true;
    (async () => {
      const stores = await Promise.all([all("hands").catch(() => []), all("passed").catch(() => [])]);
      const hands = knownHands(stores, config.chain.id, TRUSTED);
      const client = clientOf(config.chain.id);
      const seen: Seen[] = [];
      for (const known of hands) {
        const { view } = await readHand(client, known.core, known.handId);
        if (view.closedAt === 0) continue; // still open: no payout yet, so nothing can wait from it
        // The closing block (by the Hand's own closedAt) holds every payout; read by its number only.
        const logs = await handLogsAt(client, known.core, known.handId, view.closedAt);
        for (const log of logs) if (log.eventName === "Pending" && isAddressEqual(log.args.payee as Address, payee)) seen.push({ hand: known.handId, log });
      }
      return { hands: hands.length, seen };
    })().then(
      (value) => live && setState({ key, value }),
      () => live && setState({ key, value: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [key]); // `key` is the payee
  return state && state.key === key ? state.value : undefined;
}

function Known({ payee, done }: { payee: Address; done: Done[] }) {
  const lang = useLang();
  const lens = useLens();
  const known = useKnownPending(payee);
  const took = done.flatMap((d) => d.events).filter((event) => isAddressEqual(event.payee, payee));
  return (
    <section className="flex flex-col gap-3" data-testid={TID.waiting.events} data-hands={known && known !== "failed" ? String(known.hands) : ""}>
      <Heading>{t("waiting.events.heading")}</Heading>
      {known === undefined ? (
        <p className="ah-label m-0">{t("waiting.events.reading")}</p>
      ) : known === "failed" ? (
        <p className="ah-label m-0">{t("common.time.offline")}</p>
      ) : known.hands === 0 ? (
        <p className="ah-label m-0">{t("waiting.events.noHands")}</p>
      ) : known.seen.length === 0 ? (
        <p className="ah-label m-0">{t("waiting.events.none")}</p>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {known && known !== "failed"
          ? known.seen.map(({ hand, log }) => {
              const token = tokenOf(log.args.token as Address);
              const amount = log.args.amount as bigint;
              return (
                <li key={`${log.transactionHash}:${log.logIndex}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ink-a15)] py-2" data-event="Pending" data-hand={hand.toString()} data-amount={amount.toString()}>
                  <span className="flex flex-col">
                    <span className="ah-meta">{t("waiting.events.hand", { hand: hand.toString() })}</span>
                    <span className="ah-label m-0">{t("waiting.events.waited", { amount: token ? amountOf(token, amount, lang) : amount.toString() })}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Mark kind="waiting" source={<span className="ah-meta ah-meta--exact">{t("waiting.lens.pending", { block: count(log.blockNumber), index: log.logIndex, tx: log.transactionHash })}</span>} />
                    <OnExplorer tx={log.transactionHash} />
                  </span>
                </li>
              );
            })
          : null}
        {took.map((event) => {
          const token = tokenOf(event.token);
          return (
            <li key={`${event.transactionHash}:${event.logIndex}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ink-a15)] py-2" data-event="Withdrawn" data-amount={event.amount.toString()}>
              <span className="ah-label m-0">{t("waiting.events.took", { amount: token ? amountOf(token, event.amount, lang) : event.amount.toString() })}</span>
              <span className="flex flex-wrap items-center gap-2">
                <Mark kind="chain" source={<span className="ah-meta ah-meta--exact">{t("waiting.lens.withdrawn", { block: count(event.blockNumber), index: event.logIndex, tx: event.transactionHash })}</span>} />
                <OnExplorer tx={event.transactionHash} />
              </span>
            </li>
          );
        })}
      </ul>
      {lens ? <p className="ah-meta m-0">{t("waiting.lens.bounded")}</p> : null}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────── the screen ── */

export default function WaitingScreen() {
  const lang = useLang();
  const lens = useLens();
  const place = usePlace();
  const wallet = useWallet();
  const { offline } = useChainStatus();
  const [done, setDone] = useState<Done[]>([]);

  const connected = wallet.status === "connected" ? wallet.address : undefined;
  const fromLink = addressFromSearch(place.search);
  const payee = payeeOfPage(fromLink, connected);

  // What waits, per token of this build, read again on every block.
  const waiting = useBlockRead(payee ? `${payee}` : undefined, async () => {
    const client = clientOf(config.chain.id);
    return Promise.all(config.tokens.map(async (token) => ({ token, amount: await readPending(client, CORE, token.address, payee!) })));
  });
  // Whether the connected account has anything to pay the cost with.
  const balance = useBlockRead(connected, () => clientOf(config.chain.id).getBalance({ address: connected! }));
  const offer = payee ? offerOf(payee, { ...(connected ? { address: connected } : {}), canSend: wallet.canSend, ...(balance.data !== undefined ? { balance: balance.data } : {}) }) : undefined;

  const rows = waiting.data?.filter((row) => row.amount > 0n) ?? [];
  const last = done[done.length - 1];
  const friendLink = payee && typeof window !== "undefined" ? `${window.location.origin}${pathFor(payee)}` : undefined;

  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 py-10 md:px-10" data-screen="waiting" data-payee={payee ?? ""}>
      <div className="flex flex-col gap-3">
        <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("waiting.title")}</h1>
        <p className="m-0 text-[length:var(--fs-body-md)] leading-snug">{t("waiting.intro")}</p>
      </div>

      <div className="flex flex-col gap-4">
        <div data-testid={TID.waiting.connect}>
          <ConnectButton />
        </div>
        <Look />
        {fromLink && connected && !isAddressEqual(fromLink, connected) ? (
          <a href="/waiting" className="ah-label self-start underline decoration-dashed underline-offset-4">
            {t("waiting.look.mine")}
          </a>
        ) : null}
      </div>

      {!payee ? (
        <p className="ah-label m-0">{t("waiting.start")}</p>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <span className="ah-meta">{t("waiting.for")}</span>
            <Identity address={payee} full />
          </div>

          <section className="flex flex-col gap-3">
            <Heading>{t("waiting.heading")}</Heading>
            {waiting.data === undefined ? (
              <p className="ah-label m-0">{waiting.error || offline ? t("common.time.offline") : t("waiting.reading")}</p>
            ) : (
              <>
                {rows.length === 0 ? (
                  <p className="m-0 text-[length:var(--fs-body-lg)] font-bold" data-testid={TID.waiting.nothing}>
                    {t("waiting.nothing")}
                  </p>
                ) : null}
                {/* Every token keeps its row mounted, so a send in flight is followed to its end even once nothing waits. */}
                <ul className="m-0 flex list-none flex-col gap-4 p-0">
                  {waiting.data.map(({ token, amount }) => (
                    <TokenRow
                      key={`${payee}:${token.address}`}
                      token={token}
                      amount={amount}
                      payee={payee}
                      atBlock={waiting.atBlock}
                      offer={offer}
                      connected={connected}
                      onDone={(next) => setDone((before) => [...before, next])}
                    />
                  ))}
                </ul>
              </>
            )}
            {lens ? <p className="ah-meta m-0">{t("waiting.lens.perToken")}</p> : null}
          </section>

          {offer?.cannotPay && rows.length > 0 ? (
            <section className="ah-card flex flex-col gap-3 p-5" data-testid={TID.waiting.safe}>
              <p className="m-0 text-[length:var(--fs-card-title)] font-extrabold leading-[1.12] tracking-[-0.02em]">{t("waiting.safe")}</p>
              {friendLink ? (
                <div className="flex flex-col gap-2" data-testid={TID.waiting.friendLink} data-value={friendLink}>
                  <span className="ah-label">{t("waiting.friend")}</span>
                  <CopyRow value={friendLink} />
                </div>
              ) : null}
              <IssuerLine />
            </section>
          ) : null}

          {last && last.events.length > 0 ? (
            <section className="ah-card flex flex-col gap-3 p-5" data-testid={TID.waiting.withdrawn} data-amount={last.events[0]!.amount.toString()} data-to={last.events[0]!.to}>
              {last.events.map((event) => {
                const token = tokenOf(event.token);
                return (
                  <div key={`${event.transactionHash}:${event.logIndex}`} className="flex flex-col gap-2">
                    <p className="m-0 text-[length:var(--fs-card-title)] font-extrabold leading-[1.12] tracking-[-0.02em]">
                      {t("waiting.done", { amount: token ? amountOf(token, event.amount, lang) : event.amount.toString() })}
                    </p>
                    <span className="ah-meta">{t("waiting.done.to")}</span>
                    <Identity address={event.to} full />
                    <Mark kind="chain" source={<span className="ah-meta ah-meta--exact">{t("waiting.lens.withdrawn", { block: count(event.blockNumber), index: event.logIndex, tx: event.transactionHash })}</span>} />
                    <OnExplorer tx={event.transactionHash} />
                  </div>
                );
              })}
            </section>
          ) : null}

          <Known payee={payee} done={done} />
        </>
      )}
    </section>
  );
}
