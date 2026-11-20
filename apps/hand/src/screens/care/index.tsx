import { approveCall, castLine, extendCall, fundCall, getHandFor, readDescription, readLimits, type Call, type HandView } from "@ahand/sdk";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { erc20Abi, isAddressEqual, type Address } from "viem";

import { CLIENTS, clientOf, useBlockRead, useCost, useHand, useNow, type CostRead, type Now } from "../../chain";
import { config } from "../../config";
import { t, useLang } from "../../i18n";
import type { ScreenProps } from "../../routes";
import { useOpened } from "../../store/memory";
import { TID } from "../../testids";
import { CopyRow, CostLine, DealCard, Disclose, ErrorBand, MoneyInput, QuietButton, SwipeButton, TxRail, day, money, type DealDescription, type MoneyReading, type TxReached } from "../../ui";
import { ConnectButton, useSend, useWallet, type SendResult } from "../../wallet";
import { openHeldLink, peekHeld } from "../print/link";
import { reminderIcs, reminderName, alarmLead } from "./calendar";
import { DAY, capDays, extendChoices, inLastMinutes, type ChipKey } from "./extend";

/**
 * /care/<chain>/<hand> (UX-SPEC §7.4): what the asker needs after the raise. Add to the reward,
 * keep it open longer, and a reminder file. Every "now" is the network's (useNow, D-61); every
 * send is tried first by useSend, so Core's refusals arrive as sentences before anything is sent.
 * Only the account that raised the Hand is offered a send; anyone else reads NotRaiser.
 */

const CORE: Address = config.cores.canonical ?? config.cores.trusted[0]!.core;
const LINK_OPTIONS = config.cores.canonical ? { canonicalCore: config.cores.canonical } : {};
const getHand = getHandFor(CLIENTS, config.cores.trusted);
const RPC = config.chain.rpcUrls[0] ?? "$RPC";

/** Core's MAX_EXPIRY_PERIOD, read once. */
function useCap(): number | undefined {
  const [cap, setCap] = useState<number>();
  useEffect(() => {
    let live = true;
    readLimits(clientOf(config.chain.id), CORE).then((limits) => live && setCap(limits.maxExpiryPeriod), () => undefined);
    return () => {
      live = false;
    };
  }, []);
  return cap;
}

/** The token's decimals: from the build's list, or read once from the token. */
function useDecimals(token: Address | undefined): number | undefined {
  const known = token ? config.tokens.find((item) => isAddressEqual(item.address, token))?.decimals : undefined;
  const [read, setRead] = useState<{ token?: Address; decimals?: number }>({});
  useEffect(() => {
    if (!token || known !== undefined) return;
    let live = true;
    clientOf(config.chain.id)
      .readContract({ address: token, abi: erc20Abi, functionName: "decimals" })
      .then((decimals) => live && setRead({ token, decimals }), () => undefined);
    return () => {
      live = false;
    };
  }, [token, known]);
  return known ?? (read.token === token ? read.decimals : undefined);
}

/**
 * The Hand's words, when this tab holds a link of this very Hand (arriving from the raise's
 * "Add a reminder", say). Without one the card says only what the network keeps.
 */
function useWords(chainId: number, handId: bigint): DealDescription {
  const held = useOpened();
  const [description, setDescription] = useState<DealDescription>({ status: "none" });
  const head = held ? peekHeld(held.fragment, LINK_OPTIONS) : undefined;
  const ours = head !== undefined && head.chainId === chainId && head.handId === handId && isAddressEqual(head.core, CORE);
  useEffect(() => {
    if (!held || !ours) return;
    let live = true;
    openHeldLink(held, getHand, LINK_OPTIONS)
      .then((opened) => {
        const read = readDescription(opened);
        if (live && read.status === "attached" && read.title !== undefined) {
          setDescription({ status: "attached", title: read.title, ...(read.content ? { content: read.content } : {}) });
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [held, ours]);
  return ours ? description : { status: "none" };
}

/** A send's outcome as one sentence and Core's name for the lens. */
function sentenceOf(result: SendResult): { what: string; code?: string } {
  if (result.ok) return { what: "" };
  switch (result.reason) {
    case "refused":
      return { what: t(`core.${result.refusal.name}`), code: result.refusal.name };
    case "reverted":
      return { what: result.refusal ? t(`core.${result.refusal.name}`) : t("common.error.unknown"), code: result.refusal?.name ?? "REVERTED" };
    case "rejected":
      return { what: t("common.error.refused") };
    case "offline":
      return { what: t("common.error.offline") };
    case "needs-wallet":
      return { what: t("care.who") };
    default:
      return { what: t("common.error.unknown"), code: result.reason.toUpperCase() };
  }
}

export default function CareScreen({ params }: ScreenProps) {
  const chainId = Number(params.chain);
  const handId = BigInt(params.hand ?? "0");
  const known = chainId === config.chain.id;
  const lang = useLang();
  const now = useNow();
  const wallet = useWallet();
  const cap = useCap();
  const read = useHand(known ? CORE : undefined, known ? handId : undefined);
  const view = read.data?.view;
  const state = read.data?.state;
  const decimals = useDecimals(view?.token);
  const description = useWords(chainId, handId);

  if (!known) {
    return (
      <Frame>
        <Title id={handId} />
        <Band what={t("care.untrusted")} />
      </Frame>
    );
  }
  if (!view || decimals === undefined) {
    return (
      <Frame>
        <Title id={handId} />
        <p className="ah-label m-0">{read.error ? t("common.time.offline") : t("care.loading")}</p>
      </Frame>
    );
  }

  const raiser = wallet.status === "connected" && wallet.address ? wallet.address : undefined;
  const isRaiser = raiser !== undefined && isAddressEqual(raiser, view.raiser);
  const closed = state === "missing" ? "core.NotRaised" : state === "thanked" || state === "refunded" ? "core.NotOpen" : state === "expired" ? "core.Expired" : undefined;

  return (
    <Frame>
      <Title id={handId} />
      <div data-testid={TID.kit.dealCard}>
        <DealCard
          state={state === "missing" ? undefined : state}
          description={description}
          reward={view.reward}
          decimals={decimals}
          expiry={view.expiry}
          closedAt={view.closedAt}
          claimBps={view.minClaimBps}
          raiser={view.raiser}
          handId={handId}
          {...(now ? { block: { number: now.number, timestamp: now.timestamp } } : {})}
        />
      </div>
      {description.status === "none" && view.dataHash !== `0x${"0".repeat(64)}` ? <p className="ah-label ah-label--dim m-0">{t("care.words")}</p> : null}

      {closed ? (
        <Band what={t(closed)} code={closed.slice(5)} />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <p className="ah-label m-0">{t("care.who")}</p>
            <ConnectButton />
            {raiser && !isRaiser ? <Band what={t("core.NotRaiser")} code="NotRaiser" /> : null}
          </div>
          <Fund view={view} decimals={decimals} raiser={isRaiser ? raiser : undefined} handId={handId} />
          <Extend view={view} now={now} cap={cap} raiser={isRaiser ? raiser : undefined} handId={handId} />
        </>
      )}

      {!closed && now ? <Reminder view={view} now={now} chainId={chainId} handId={handId} lang={lang} /> : null}

      <a href={`/my/${chainId}/${handId}`} className="ah-quiet ah-quiet--compact self-start">
        {t("care.back")}
      </a>
    </Frame>
  );
}

/* ──────────────────────────────────────────────────── add to the reward */

function Fund({ view, decimals, raiser, handId }: { view: HandView; decimals: number; raiser: Address | undefined; handId: bigint }) {
  const lang = useLang();
  const tx = useSend();
  const [reading, setReading] = useState<MoneyReading>({ status: "empty" });
  const [problem, setProblem] = useState<{ what: string; code?: string }>();
  const [done, setDone] = useState(false);
  const amount = reading.status === "ok" && reading.amount > 0n ? reading.amount : undefined;

  // What the raiser may already let Core take, and holds: read again on every block.
  const funds = useBlockRead(raiser ? `${raiser}:${view.token}` : undefined, async () => {
    const client = clientOf(config.chain.id);
    const [allowance, balance] = await Promise.all([
      client.readContract({ address: view.token, abi: erc20Abi, functionName: "allowance", args: [raiser!, CORE] }),
      client.readContract({ address: view.token, abi: erc20Abi, functionName: "balanceOf", args: [raiser!] }),
    ]);
    return { allowance, balance };
  });
  const needsApprove = amount !== undefined && funds.data !== undefined && funds.data.allowance < amount;
  const calls = useMemo<Call[] | undefined>(() => {
    if (amount === undefined || !funds.data) return undefined;
    const fund = fundCall(CORE, handId, amount);
    return needsApprove ? [approveCall(view.token, CORE, amount), fund] : [fund];
  }, [amount, needsApprove, funds.data === undefined, view.token, handId]); // eslint-disable-line react-hooks/exhaustive-deps
  const cost = useCost(calls, raiser);
  const busy = tx.state.phase !== "idle" && tx.state.phase !== "done" && tx.state.phase !== "failed";

  const send = async () => {
    if (!calls || !raiser || busy) return;
    setProblem(undefined);
    setDone(false);
    const result = await tx.send(calls);
    if (result.ok) setDone(true);
    else setProblem(sentenceOf(result));
  };

  return (
    <Section title={t("care.fund.title")} lead={t("care.fund.stays")}>
      <div data-testid={TID.care.fundInput}>
        <MoneyInput
          label={t("care.fund.amount")}
          decimals={decimals}
          onReading={setReading}
          disabled={busy}
          {...(funds.data ? { max: funds.data.balance, hint: t("care.fund.balance", { amount: money(funds.data.balance, decimals, lang) }) } : {})}
        />
      </div>
      {amount !== undefined && funds.data ? <p className="ah-label m-0">{needsApprove ? t("care.fund.twoSteps", { amount: money(amount, decimals, lang) }) : t("care.fund.oneStep")}</p> : null}
      {raiser ? (
        <>
          <Priced cost={cost} />
          {problem ? <Band what={problem.what} {...(problem.code ? { code: problem.code } : {})} /> : null}
          <SwipeButton gesture="raise" variant="amber" data-testid={TID.care.fundSwipe} disabled={!calls || busy || cost.status === "refused"} onClick={() => void send()}>
            {amount !== undefined ? t("care.fund.swipe", { amount: money(amount, decimals, lang) }) : t("care.fund.swipeEmpty")}
          </SwipeButton>
          <p className="ah-label m-0">{t("care.steps.why")}</p>
          <Sent tx={tx.state} testId={TID.care.txRail} action="fund" />
          {done ? (
            <p className="m-0 font-semibold" role="status" data-testid={`${TID.care.txRail}-fund-done`}>
              {t("care.fund.done", { amount: money(view.reward, decimals, lang) })} {t("care.fund.stays")}
            </p>
          ) : null}
        </>
      ) : null}
      {calls ? <WithoutUs calls={calls} /> : null}
    </Section>
  );
}

/* ──────────────────────────────────────────────────── keep it open longer */

function Extend({ view, now, cap, raiser, handId }: { view: HandView; now: Now | undefined; cap: number | undefined; raiser: Address | undefined; handId: bigint }) {
  const lang = useLang();
  const tx = useSend();
  const [chosen, setChosen] = useState<ChipKey>("30");
  const [problem, setProblem] = useState<{ what: string; code?: string }>();
  const [landed, setLanded] = useState<number>();

  const choices = now && cap !== undefined ? extendChoices(now.timestamp, view.expiry, cap) : undefined;
  const choice = choices?.find((item) => item.key === chosen);
  const usable = choice && choice.moves ? choice : undefined;
  // The price moves with every block for the "today" chip; a minute's step is enough for a price.
  const minute = usable ? Math.floor(usable.target / 60) : undefined;
  const calls = useMemo<Call[] | undefined>(() => (usable ? [extendCall(CORE, handId, usable.target)] : undefined), [minute, chosen, handId]); // eslint-disable-line react-hooks/exhaustive-deps
  const cost = useCost(calls, raiser);
  const busy = tx.state.phase !== "idle" && tx.state.phase !== "done" && tx.state.phase !== "failed";
  const late = now ? inLastMinutes(now.timestamp, view.expiry) : false;

  // If the chosen chip can no longer move the end (after an extension, say), choose the first that can.
  useEffect(() => {
    if (!choices || busy) return;
    if (!choices.find((item) => item.key === chosen)?.moves) {
      const next = choices.find((item) => item.moves);
      if (next) setChosen(next.key);
    }
  }, [choices?.map((item) => item.moves).join(","), busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!raiser || busy || !now || cap === undefined) return;
    // The target is taken again at the moment of pressing, from the latest block.
    const fresh = extendChoices(now.timestamp, view.expiry, cap).find((item) => item.key === chosen);
    if (!fresh?.moves) return;
    setProblem(undefined);
    setLanded(undefined);
    const result = await tx.send([extendCall(CORE, handId, fresh.target)]);
    if (result.ok) setLanded(fresh.target);
    else setProblem(sentenceOf(result));
  };

  const label = (key: ChipKey) => (key === "max" ? t("care.extend.max", { n: cap !== undefined ? capDays(cap) : 180 }) : t("care.extend.plus", { n: Number(key) }));

  return (
    <Section title={t("care.extend.title")} lead={t("care.extend.later")}>
      {choices ? (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("care.extend.chips")}>
          {choices.map((item) => {
            const selected = item.key === chosen && item.moves;
            return (
              <button
                key={item.key}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!item.moves || busy}
                title={item.moves ? undefined : t("care.extend.off")}
                data-testid={TID.care.extendChip}
                data-value={item.key}
                data-target={item.target}
                className={`ah-chip${selected ? " ah-chip--selected" : ""}${item.key === "max" && !selected ? " ah-chip--dashed" : ""}`}
                onClick={() => setChosen(item.key)}
              >
                {label(item.key)}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="ah-note m-0">{t("common.time.offline")}</p>
      )}
      {usable ? (
        <p className="ah-label m-0" data-expiry={usable.target}>
          {t("care.extend.until", { date: day(usable.target, lang) })} {usable.capped ? t("care.extend.capped") : null}
        </p>
      ) : choices ? (
        <p className="ah-label m-0">{t("care.extend.off")}</p>
      ) : null}
      {late ? (
        <div data-testid={TID.care.lastMinutes} className="ah-alert" role="status">
          <p className="ah-alert__text m-0">
            {t("care.extend.lastMinutes")}
            <span className="ah-alert__kept">{t("care.extend.lastMinutesWhose")}</span>
          </p>
        </div>
      ) : null}
      {now && cap !== undefined && usable ? (
        <Disclose label={t("care.extend.how")}>
          <span className="ah-meta ah-meta--exact">{t("common.lens.cap")}</span>
          <span className="ah-meta ah-meta--exact">{t("care.extend.lens.now", { block: now.number.toString(), timestamp: String(now.timestamp), cap: String(cap) })}</span>
          <span className="ah-meta ah-meta--exact">
            {usable.key === "max"
              ? t("care.extend.lens.max", { target: String(usable.target) })
              : t("care.extend.lens.formula", { from: String(view.expiry), days: usable.key, target: String(usable.target) })}
          </span>
        </Disclose>
      ) : null}
      {raiser ? (
        <>
          <Priced cost={cost} />
          {problem ? <Band what={problem.what} {...(problem.code ? { code: problem.code } : {})} /> : null}
          <SwipeButton gesture="raise" data-testid={TID.care.extendSwipe} disabled={!usable || busy || cost.status === "refused"} onClick={() => void send()}>
            {usable ? t("care.extend.swipe", { date: day(usable.target, lang) }) : t("care.extend.swipeEmpty")}
          </SwipeButton>
          <Sent tx={tx.state} testId={TID.care.txRail} action="extend" />
          {landed !== undefined ? (
            <p className="m-0 font-semibold" role="status" data-testid={`${TID.care.txRail}-extend-done`} data-expiry={landed}>
              {t("care.extend.done", { date: day(landed, lang) })}
            </p>
          ) : null}
        </>
      ) : null}
      {calls ? <WithoutUs calls={calls} /> : null}
    </Section>
  );
}

/* ──────────────────────────────────────────────────── reminder */

function Reminder({ view, now, chainId, handId, lang }: { view: HandView; now: Now; chainId: number; handId: bigint; lang: string }) {
  const lead = alarmLead(view.openedAt, view.expiry) / DAY;
  const download = () => {
    const url = `${config.site}/care/${chainId}/${handId}`;
    const ics = reminderIcs({
      chainId,
      core: CORE,
      handId,
      openedAt: view.openedAt,
      expiry: view.expiry,
      stamp: now.timestamp,
      url,
      summary: t("care.reminder.summary", { id: handId.toString() }),
      description: t("care.reminder.description", { date: day(view.expiry, lang as "en" | "ru"), url }),
      alarm: t("care.reminder.alarm", { id: handId.toString(), n: lead }),
    });
    const href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = reminderName(handId, view.expiry);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1_000);
  };
  return (
    <Section title={t("care.reminder.title")} lead={t("care.reminder.when", { n: lead })}>
      <QuietButton className="self-start" data-testid={TID.care.reminder} onClick={download}>
        {t("care.reminder.button")}
      </QuietButton>
      <p className="ah-label ah-label--dim m-0">{t("care.reminder.local")}</p>
    </Section>
  );
}

/* ──────────────────────────────────────────────────── shared pieces */

function Priced({ cost }: { cost: CostRead }) {
  if (cost.status === "ok") {
    return (
      <div data-testid={TID.kit.costLine}>
        <CostLine cost={cost.cost} prices={config.prices} gas={cost.gas} />
      </div>
    );
  }
  if (cost.status === "refused") {
    return <Band what={t(`core.${cost.refusal.name}`)} code={cost.refusal.name} />;
  }
  if (cost.status === "offline") return <p className="ah-note m-0">{t("common.time.offline")}</p>;
  return null;
}

function Sent({ tx, testId, action }: { tx: ReturnType<typeof useSend>["state"]; testId: string; action: string }) {
  if (tx.phase === "idle" || tx.phase === "checking") return null;
  const reached = (tx.reached ?? "sent") as TxReached;
  return (
    <div data-testid={testId} data-action={action} data-value={reached} data-phase={tx.phase}>
      <TxRail reached={reached} local={!config.chain.hasL1} />
    </div>
  );
}

function WithoutUs({ calls }: { calls: Call[] }) {
  return (
    <div data-testid={TID.kit.withoutUs}>
      <Disclose label={t("common.footer.withoutUs")}>
        <span className="ah-label">{t("care.lens.callsLead")}</span>
        {calls.map((call, index) => (
          <CopyRow key={index} value={castLine(call, { rpc: RPC })} display={castLine(call, { rpc: "$RPC" })} />
        ))}
      </Disclose>
    </div>
  );
}

function Band({ what, code }: { what: string; code?: string }) {
  return (
    <div data-testid={TID.care.error} data-value={code ?? ""}>
      <ErrorBand what={what} {...(code ? { code } : {})} />
    </div>
  );
}

function Section({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t-[length:var(--bw-emph)] border-[var(--ink)] pt-5">
      <h2 className="m-0 text-[length:var(--fs-title-m-sm)] font-extrabold leading-[1.06] tracking-[-0.03em]">{title}</h2>
      <p className="ah-label m-0">{lead}</p>
      {children}
    </section>
  );
}

function Title({ id }: { id: bigint }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="ah-meta">✋ {t("care.kicker", { id: id.toString() })}</span>
      <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("care.title")}</h1>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 py-10 md:px-10" data-screen="care">
      {children}
    </section>
  );
}
