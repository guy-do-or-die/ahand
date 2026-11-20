import { faceOf, passesLeft, readDescription, type Hand, type OpenedAddress, type OpenedLink } from "@ahand/sdk";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isAddressEqual, type Address } from "viem";

import { useHand, useNow } from "../../chain";
import { config } from "../../config";
import { t, useLang } from "../../i18n";
import { navigate, unmarkHandView, usePlace } from "../../router";
import type { ScreenProps } from "../../routes";
import { addressOf, useOpened } from "../../store/memory";
import { TID } from "../../testids";
import { ChainRail, CopyRow, DealCard, Disclose, ErrorBand, Mark, QuietButton, SwipeButton, day, shortAddress, useLens, type DealDescription, type RailHand } from "../../ui";
import { ConnectButton, useWallet } from "../../wallet";
import { Closed } from "./Closed";
import { arrivalOf, failureOf, holderStatements, routeHands, type Failure, type Held } from "./held";
import { SendBack } from "./SendBack";
import { LINK_OPTIONS, cardDescription, getHand, peekHeld, useDecimals, useOpening } from "./useHeld";

/**
 * The Hand view (UX-SPEC §8.1–8.3): the screen most people will ever see. It serves every
 * arrival:
 *
 * - a link this tab holds (a bare `/#…`, or a numbered or faced address with its link): opened
 *   from memory with `openAddress` and `getHandFor`, which fail closed on any other chain or Core;
 * - a numbered or faced address with no link: the public view, with the title only once `faceOf`
 *   matched `d` against the dataHash Core keeps, and no actions;
 * - nothing at all: a plain line back to the start.
 *
 * Open, expiry and reward come from `hands(id)` on every block; the state is `stateAt` at the
 * latest block's time. Before the first block arrives the card shows the dates and claims nothing.
 */
export default function HandViewScreen({ params }: ScreenProps) {
  const place = usePlace();
  const opened = useOpened();
  useLang();
  const held: Held | undefined = opened ? { before: opened.before, fragment: opened.fragment } : undefined;
  const arrival = arrivalOf({ path: place.path, search: place.search, params }, held, peekHeld);
  // "/" marked as the Hand view, with no link left in memory (a reload, or Back to a link this tab
  // forgot): this screen says so once, and the entry loses its mark, so the next reload or the
  // site's root typed into this tab shows the start page again (FINDINGS O-2).
  const unmark = arrival.kind === "nothing" && place.path === "/";
  useEffect(() => {
    if (unmark) unmarkHandView();
  }, [unmark]);

  return (
    <section className="mx-auto w-full max-w-[1040px] px-6 pb-14 pt-8 md:px-10 md:pt-12" data-screen="hand" data-arrival={arrival.kind}>
      {arrival.kind === "link" ? <LinkView held={arrival.held} /> : null}
      {arrival.kind === "public" ? <PublicView chainId={arrival.chainId} core={arrival.core} handId={arrival.handId} path={place.path} search={arrival.search} /> : null}
      {arrival.kind === "nothing" ? (
        <div className="mx-auto flex max-w-[620px] flex-col gap-4">
          <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("hand.nothing.title")}</h1>
          <p className="m-0 text-[length:var(--fs-body-md)] leading-snug">{t("hand.nothing.body")}</p>
          <QuietButton onClick={() => navigate("/")} className="self-start">
            {t("hand.toStart")}
          </QuietButton>
        </div>
      ) : null}
    </section>
  );
}

/** The Deal card's place while the link is being checked: its outline and one mono line. */
function Checking() {
  return (
    <div className="mx-auto flex w-full max-w-[620px] flex-col gap-4" data-testid={TID.hand.checking} aria-busy="true">
      <div className="ah-card ah-card--lg flex flex-col gap-4 p-6" aria-hidden="true">
        <span className="text-[44px] leading-none opacity-30">✋</span>
        <span className="h-7 w-4/5 rounded-[var(--r-bar)] bg-[var(--ink-a10)]" />
        <span className="h-7 w-3/5 rounded-[var(--r-bar)] bg-[var(--ink-a10)]" />
        <span className="h-4 w-2/5 rounded-[var(--r-bar)] bg-[var(--ink-a10)]" />
      </div>
      <p className="ah-meta m-0" role="status">
        {t("common.state.checking")}
      </p>
    </div>
  );
}

/** A link or an address that does not open: the plain reason, and nothing opened behind it. */
function Refused({ failure }: { failure: Failure }) {
  return (
    <div className="mx-auto flex w-full max-w-[620px] flex-col gap-5" data-testid={TID.hand.error} data-value={failure.id}>
      <h1 className="sr-only">{t("hand.title")}</h1>
      <ErrorBand what={t(failure.id)} code={failure.code} />
      <QuietButton onClick={() => navigate("/")} className="self-start">
        {t("hand.toStart")}
      </QuietButton>
    </div>
  );
}

function LinkView({ held }: { held: Held }) {
  const opening = useOpening(held);
  if (!opening || opening.status === "checking") return <Checking />;
  if (opening.status === "failed") return <Refused failure={opening.failure} />;
  const { opened } = opening;
  return <HandBody core={opened.head.core} hand={opened.hand} opened={opened} description={cardDescription(opened)} />;
}

type Faced = { status: "checking" } | { status: "failed"; failure: Failure } | { status: "ok"; hand: Hand; description: DealDescription };

/**
 * A numbered or faced address with no link. The Core in the path, or the main contract when none
 * is named, must be one this build trusts. With `d`, the words shown are the ones that matched
 * the dataHash Core keeps; an unlisted Hand's details are not in `d` and are not looked for.
 */
function PublicView({ chainId, core, handId, path, search }: { chainId: number; core?: Address; handId: bigint; path: string; search: string }) {
  const [faced, setFaced] = useState<{ key: string; value: Faced }>();
  const key = `${chainId}:${core ?? ""}:${handId}:${search}`;
  useEffect(() => {
    let live = true;
    (async (): Promise<Faced> => {
      const named = core ?? config.cores.canonical ?? undefined;
      if (!named) return { status: "failed", failure: { id: "link.no-canonical", code: "NO MAIN CONTRACT" } };
      if (!/(^\?|&)d=/.test(search)) return { status: "ok", hand: await getHand({ chainId, core: named, handId }), description: { status: "none" } };
      const { hand, face } = await faceOf(`${window.location.origin}${path}${search}`, (seen) => getHand(seen), LINK_OPTIONS);
      if (!hand) return { status: "failed", failure: { id: "link.malformed", code: "LINK · MALFORMED" } };
      const read = face ? readDescription({ hand, ofHand: face } as unknown as OpenedLink) : undefined;
      const description: DealDescription = read?.title !== undefined ? { status: "attached", title: read.title, ...(read.content ? { content: read.content } : {}) } : { status: "none" };
      return { status: "ok", hand, description };
    })().then(
      (value) => live && setFaced({ key, value }),
      (error: unknown) => live && setFaced({ key, value: { status: "failed", failure: failureOf(error) } }),
    );
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- `key` carries the address
  const value = faced?.key === key ? faced.value : { status: "checking" as const };
  if (value.status === "checking") return <Checking />;
  if (value.status === "failed") return <Refused failure={value.failure} />;
  return <HandBody core={core ?? config.cores.canonical!} hand={value.hand} description={value.description} />;
}

/**
 * The Hand itself: the Deal card, the route, and what can be done from here at the network's
 * time. `opened` is the proven link; without it this is the public view.
 */
function HandBody({ core, hand, opened, description }: { core: Address; hand: Hand; opened?: OpenedAddress; description: DealDescription }) {
  const read = useHand(core, hand.handId);
  const now = useNow();
  const lang = useLang();
  const lens = useLens();
  const wallet = useWallet();
  const decimals = useDecimals(read.data?.view.token);
  const left = useMemo(() => (opened ? passesLeft(opened.hand, opened.signedShakes) : undefined), [opened]);

  if (!read.data || decimals === undefined) {
    if (read.error && !read.data) return <Refused failure={failureOf(read.error)} />;
    return <Checking />;
  }
  const { view, state } = read.data;
  if (state === "missing") return <Refused failure={{ id: "core.NotRaised", code: "CORE · NotRaised" }} />;

  const funded = view.reward > 0n;
  const until = day(view.expiry, lang);
  const kind = opened?.head.kind;
  const live = kind === "live";
  const isRaiser = wallet.address !== undefined && isAddressEqual(wallet.address, view.raiser);
  const claimBps = live ? opened!.end.claimBps : undefined;
  const block = now ? { number: now.number, timestamp: now.timestamp } : undefined;
  const closed = state === "thanked" || state === "refunded";

  const card = (
    <div data-testid={TID.hand.dealCard} data-state={state ?? "unknown"} data-description={description.status} data-reward={view.reward.toString()}>
      <DealCard
        heading="h1"
        state={state === "open" || state === "expired" || closed ? state : undefined}
        description={description}
        reward={view.reward}
        decimals={decimals}
        expiry={view.expiry}
        {...(closed ? { closedAt: view.closedAt } : {})}
        {...(claimBps !== undefined ? { claimBps } : {})}
        raiser={view.raiser}
        handId={view.handId}
        {...(block ? { block } : {})}
      />
    </div>
  );

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_380px] md:items-start md:gap-10">
      <div className="flex min-w-0 flex-col gap-6">
        {description.status === "lost" ? <div data-testid={TID.hand.lost}>{card}</div> : card}
        {opened ? <Route opened={opened} reward={view.reward} decimals={decimals} you={live && !closed} next={live && state === "open" && (left ?? 0) > 0} /> : null}
        {opened ? <Evidence opened={opened} left={left ?? 0} lens={lens} /> : null}
      </div>

      <aside className="flex min-w-0 flex-col gap-5 md:sticky md:top-6">
        {state === "open" && live ? (
          <Actions left={left ?? 0} until={until} funded={funded} />
        ) : null}
        {state === "open" && !opened ? (
          <p className="ah-note m-0" data-testid={TID.hand.noLink}>
            {t("hand.noLink")}
          </p>
        ) : null}
        {kind === "addressed" && state === "open" ? <p className="ah-note m-0">{t("hand.addressed")}</p> : null}
        {kind === "give" && !closed ? <GiveArrived raiser={isRaiser} /> : null}
        {state === "expired" ? <SendBack core={core} handId={view.handId} funded={funded} /> : null}
        {closed ? <Closed core={core} handId={view.handId} raiser={view.raiser} closedAt={view.closedAt} state={state} decimals={decimals} /> : null}
        {opened ? (
          <p className="ah-label ah-label--dim m-0" data-testid={TID.hand.tabOnly}>
            {t("common.tabOnly")}
          </p>
        ) : null}
      </aside>
    </div>
  );
}

/** Pass it on, and I can help, with the honest line under the help button. */
function Actions({ left, until, funded }: { left: number; until: string; funded: boolean }) {
  return (
    <div className="flex flex-col gap-4 pt-6">
      <SwipeButton gesture="shake" data-testid={TID.hand.pass} disabled={left === 0} onClick={() => navigate("/pass")} className="w-full">
        {t("common.word.passOn")}
      </SwipeButton>
      {left === 0 ? (
        <p className="ah-label m-0" data-testid={TID.hand.passesLeft} data-value={left}>
          {t("hand.passesNone")}
        </p>
      ) : left < 3 ? (
        <p className="ah-label m-0" data-testid={TID.hand.passesLeft} data-value={left}>
          {t("hand.passesLeft", { n: left })}
        </p>
      ) : null}
      <div className="pt-8">
        <SwipeButton gesture="cheer" variant="amber" data-testid={TID.hand.help} onClick={() => navigate("/give")} className="w-full">
          {t("common.word.canHelp")}
        </SwipeButton>
      </div>
      <p className="ah-label m-0" data-testid={TID.hand.helpNote}>
        {t(funded ? "hand.helpNote" : "hand.helpNote.noReward", { date: until })}
      </p>
    </div>
  );
}

/** The route as people, with "{n} hands so far." The rail gets the signed route for wave 5's flip. */
function Route({ opened, reward, decimals, you, next }: { opened: OpenedAddress; reward: bigint; decimals: number; you: boolean; next: boolean }) {
  const hands: RailHand[] = routeHands(opened).map((hand) => ({ role: hand.role, ...(hand.address ? { address: hand.address } : {}) }));
  return (
    <div className="flex flex-col gap-2" data-testid={TID.hand.rail} data-value={hands.length}>
      <ChainRail
        hands={hands}
        route={{
          chainId: opened.head.chainId,
          core: opened.head.core,
          hand: opened.hand,
          signedShakes: opened.signedShakes,
          ...(opened.signedGive ? { signedGive: opened.signedGive } : {}),
          reward,
          decimals,
        }}
        you={you}
        next={next}
        caption={false}
      />
      <p className="ah-label m-0" data-testid={TID.hand.handsSoFar} data-value={hands.length}>
        {t("hand.handsSoFar", { n: hands.length })}
      </p>
    </div>
  );
}

/**
 * The evidence under the card, one tap away (the lens opens it): what the link proved here, the
 * description's hash against Core's, how far the route can still go, and holders' own lists,
 * which are never the asker's words and stand only here (D-36).
 */
function Evidence({ opened, left, lens }: { opened: OpenedAddress; left: number; lens: boolean }) {
  const extra = holderStatements(opened);
  const rows: ReactNode[] = [
    t("hand.lens.link", { kind: opened.head.kind, shakes: opened.signedShakes.length, shape: opened.seen.shape }),
    t("hand.lens.claim", { claim: opened.end.claimBps, min: opened.hand.minClaimBps, key: shortAddress(opened.end.lastKey) }),
    t("hand.lens.data", { id: opened.hand.handId.toString(), hash: opened.hand.dataHash }),
    t("hand.lens.passes", { n: left, k: opened.hand.payoutGasK }),
    t("hand.lens.terms", { raiser: shortAddress(opened.hand.raiser), token: shortAddress(opened.hand.token), root: shortAddress(opened.hand.rootKey) }),
  ];
  return (
    <Disclose label={t("hand.evidence")}>
      {rows.map((row, index) => (
        <span key={index} className="ah-meta ah-meta--exact break-all">
          {row}
        </span>
      ))}
      <Mark kind="checked" />
      {lens && extra.length > 0 ? (
        <div className="flex flex-col gap-1 pt-2" data-testid={TID.hand.statements}>
          <span className="ah-meta ah-meta--ink">{t("hand.lens.statements")}</span>
          {extra.map((list) => (
            <span key={String(list.at)} className="ah-meta ah-meta--exact break-all">
              {list.at === "give" ? t("hand.lens.statementGive") : t("hand.lens.statementAt", { n: list.at + 1 })}: {list.statements.map((s) => `${s.name}=${s.value}`).join(" · ")}
            </span>
          ))}
        </div>
      ) : null}
    </Disclose>
  );
}

/**
 * A give link opened here (UX-SPEC §8.2): a holder passes it back the way it came; the asker
 * goes on to thank. The address copied is the one this tab holds, from memory.
 */
function GiveArrived({ raiser }: { raiser: boolean }) {
  const address = addressOf();
  if (raiser) {
    return (
      <div className="flex flex-col gap-4 pt-6" data-testid={TID.hand.giveLink} data-value="raiser">
        <p className="m-0 text-[length:var(--fs-card-title)] font-extrabold leading-tight tracking-[-0.02em]">{t("hand.give.raiser")}</p>
        <SwipeButton gesture="bow" variant="amber" data-testid={TID.hand.toThank} onClick={() => navigate("/thank")} className="w-full">
          {t("hand.give.toThank")}
        </SwipeButton>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid={TID.hand.giveLink} data-value="holder">
      <p className="m-0 text-[length:var(--fs-card-title)] font-extrabold leading-tight tracking-[-0.02em]">{t("hand.give.holder")}</p>
      {address ? (
        <>
          <div data-testid={TID.hand.copy}>
            <CopyRow value={address} />
          </div>
          {typeof navigator !== "undefined" && typeof navigator.share === "function" ? (
            <QuietButton data-testid={TID.hand.share} onClick={() => void navigator.share({ text: address }).catch(() => undefined)} className="self-start">
              {t("common.word.share")}
            </QuietButton>
          ) : null}
        </>
      ) : null}
      <p className="ah-label m-0">{t("hand.give.mine")}</p>
      <ConnectButton />
    </div>
  );
}
