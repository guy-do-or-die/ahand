import { marginOf, passesLeft, readDescriptionOf, viewOf, type Hand, type OpenedAddress } from "@ahand/sdk";
import { messageIdOf } from "@ahand/sdk/app";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { isAddressEqual, type Address } from "viem";

import { useChainStatus, useHand, useNow } from "../../chain";
import { config } from "../../config";
import { t, useLang } from "../../i18n";
import { useHoldsLink } from "../../link-carry";
import { navigate, unmarkHandView, usePlace } from "../../router";
import type { ScreenProps } from "../../routes";
import { addressOf, useOpened } from "../../store/memory";
import { TID } from "../../testids";
import { ChainRail, CopyRow, DealCard, dealDescriptionOf, Disclose, ErrorBand, Mark, Proof, QuietButton, SwipeButton, day, shortAddress, useLens, type DealDescription, type RailHand } from "../../ui";
import { ConnectButton, LinkAgain, useWallet } from "../../wallet";
import { Closed } from "./Closed";
import { arrivalOf, canRetry, failureOf, holderStatements, proofPathOf, routeHands, type Failure, type Held } from "./held";
import { showPerson } from "../../shell/person";
import { SendBack } from "./SendBack";
import { Unreachable } from "./Unreachable";
import { LINK_OPTIONS, cardDescription, getHand, peekHeld, pollNow, useDecimals, useGiveCheck, useOpening, useReread, type GiveCheck } from "./useHeld";

/**
 * The Hand view: the screen most people will ever see. It serves every
 * arrival:
 *
 * - a link this tab holds (a bare `/#…`, or a numbered or described address with its link): opened
 *   from memory with `openAddress` and `getHandFor`, which fail closed on any other chain or Core;
 * - a numbered or described address with no link: the public view, with the title only once `viewOf`
 *   matched `d` against the dataHash Core keeps, and no actions;
 * - nothing at all: a plain line back to the start.
 *
 * Open, expiry and reward come from `hands(id)` on every block; the state is `stateAt` at the
 * latest block's time. Before the first block arrives the card shows the dates and claims nothing.
 *
 * A network that can't be reached is never a verdict: the link stays in this tab, the screen
 * says so and reads again on its own (Unreachable.tsx). At phone width the two actions of an
 * open Hand stand in a bar at the bottom of the screen, within thumb reach.
 * While the network can't be reached, or no new block has come for a while, the card claims
 * nothing either: it says which block it was read at, and passing and helping wait.
 * Every Hand leads to its own proof.
 */
export default function HandViewScreen({ params }: ScreenProps) {
  const place = usePlace();
  const opened = useOpened();
  useLang();
  const held: Held | undefined = opened ? { before: opened.before, fragment: opened.fragment } : undefined;
  const arrival = arrivalOf({ path: place.path, search: place.search, params }, held, peekHeld);
  // "/" marked as the Hand view, with no link left in memory (a reload, or Back to a link this tab
  // forgot): this screen says so once, and the entry loses its mark, so the next reload or the
  // site's root typed into this tab shows the start page again.
  const unmark = arrival.kind === "nothing" && place.path === "/";
  // A link on screen is carried across a social login's reload (link-carry.ts).
  useHoldsLink(arrival.kind === "link");
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

/** The label over an error: the app's own words in the reader's language, Core's names as written. */
function codeText(failure: Failure): string {
  return failure.label ? t(failure.label.id, failure.label.values) : failure.code;
}

/**
 * A link or an address that does not open: the plain reason, and nothing opened behind it. When
 * trying again could change the answer (the network's failures), "Try again" opens it once more;
 * the link is still in this tab's memory. The error's own class name is lens-only.
 */
function Refused({ failure, onRetry }: { failure: Failure; onRetry?: () => void }) {
  const lens = useLens();
  const again = onRetry !== undefined && canRetry(failure);
  return (
    <div className="mx-auto flex w-full max-w-[620px] flex-col gap-5" data-testid={TID.hand.error} data-value={failure.id} data-code={failure.code}>
      <h1 className="sr-only">{t("hand.title")}</h1>
      <ErrorBand what={t(failure.id)} code={codeText(failure)} />
      {lens && failure.detail ? <p className="ah-meta ah-meta--exact m-0">{failure.detail}</p> : null}
      {again ? (
        <SwipeButton gesture="raise" still data-testid={TID.hand.retry} onClick={onRetry} className="w-full">
          {t("hand.retry")}
        </SwipeButton>
      ) : null}
      <QuietButton onClick={() => navigate("/")} className="self-start">
        {t("hand.toStart")}
      </QuietButton>
    </div>
  );
}

function LinkView({ held }: { held: Held }) {
  const opening = useOpening(held);
  const [again, reread] = useReread();
  if (!opening || opening.status === "checking") return <Checking />;
  if (opening.status === "unreachable") return <Unreachable retry={opening.retry} held />;
  if (opening.status === "failed") return <Refused failure={opening.failure} onRetry={opening.retry} />;
  const { opened } = opening;
  return <HandBody key={again} core={opened.head.core} hand={opened.hand} opened={opened} description={cardDescription(opened)} onRetry={reread} />;
}

type PublicRead = { status: "checking" } | { status: "unreachable" } | { status: "failed"; failure: Failure } | { status: "ok"; hand: Hand; description: DealDescription };

/**
 * A numbered or described address with no link. The Core in the path, or the main contract when none
 * is named, must be one this build trusts. With `d`, the words shown are the ones that matched
 * the dataHash Core keeps; an unlisted Hand's details are not in `d` and are not looked for.
 */
function PublicView({ chainId, core, handId, path, search }: { chainId: number; core?: Address; handId: bigint; path: string; search: string }) {
  const [shown, setShown] = useState<{ key: string; value: PublicRead }>();
  const [attempt, setAttempt] = useState(0);
  const [again, reread] = useReread();
  const busy = useRef(false);
  const retry = useCallback(() => {
    if (!busy.current) setAttempt((n) => n + 1);
  }, []);
  const key = `${chainId}:${core ?? ""}:${handId}:${search}`;
  useEffect(() => {
    let live = true;
    busy.current = true;
    (async (): Promise<PublicRead> => {
      const named = core ?? config.cores.canonical ?? undefined;
      if (!named) return { status: "failed", failure: { id: "link.no-canonical-core", code: "NO MAIN CONTRACT", label: { id: "hand.code.noCanonical" } } };
      if (!/(^\?|&)d=/.test(search)) return { status: "ok", hand: await getHand({ chainId, core: named, handId }), description: { status: "none" } };
      const { hand, publicPart } = await viewOf(`${window.location.origin}${path}${search}`, (seen) => getHand(seen), LINK_OPTIONS);
      if (!hand) return { status: "failed", failure: { id: "link.malformed", code: "LINK · MALFORMED", label: { id: "hand.code.link.malformed" } } };
      const read = publicPart ? readDescriptionOf(hand, publicPart) : undefined;
      const description: DealDescription = dealDescriptionOf(read);
      return { status: "ok", hand, description };
    })()
      .catch((error: unknown): PublicRead => {
        const failure = failureOf(error, { held: false });
        return failure.network ? { status: "unreachable" } : { status: "failed", failure };
      })
      .then((value) => {
        if (!live) return;
        busy.current = false;
        setShown({ key, value });
      });
    return () => {
      live = false;
      busy.current = false;
    };
  }, [key, attempt]); // `key` carries the address
  const value = shown?.key === key ? shown.value : { status: "checking" as const };
  if (value.status === "checking") return <Checking />;
  if (value.status === "unreachable") return <Unreachable retry={retry} held={false} />;
  if (value.status === "failed") return <Refused failure={value.failure} onRetry={retry} />;
  return <HandBody key={again} core={core ?? config.cores.canonical!} hand={value.hand} description={value.description} onRetry={reread} />;
}

/**
 * The Hand itself: the Deal card, the route, and what can be done from here at the network's
 * time. `opened` is the proven link; without it this is the public view.
 */
function HandBody({ core, hand, opened, description, onRetry }: { core: Address; hand: Hand; opened?: OpenedAddress; description: DealDescription; onRetry: () => void }) {
  const read = useHand(core, hand.handId);
  const now = useNow();
  const chain = useChainStatus();
  const narrow = useNarrow();
  const typing = useTyping();
  const lang = useLang();
  const lens = useLens();
  const wallet = useWallet();
  const decimals = useDecimals(read.data?.coreHand.token);
  const left = useMemo(() => (opened ? passesLeft(opened.hand, opened.signedShakes) : undefined), [opened]);
  const giveCheck = useGiveCheck(core, opened?.head.kind === "give" ? opened : undefined);

  if (!read.data || decimals === undefined) {
    // The link opened and the Hand's own read did not come: the network's failure keeps the link
    // and is tried again; anything else is said as it is, with "Try again" when that could help.
    const failure = read.error && !read.data ? failureOf(read.error, { held: opened !== undefined }) : undefined;
    if (failure && !failure.network) return <Refused failure={failure} onRetry={onRetry} />;
    if (failure || (!read.data && chain.offline)) return <Unreachable retry={onRetry} auto={pollNow} held={opened !== undefined} />;
    return <Checking />;
  }
  const { coreHand: view, state } = read.data;
  if (state === "missing") return <Refused failure={{ id: "core.NotRaised", code: "CORE · NotRaised" }} />;

  const funded = view.reward > 0n;
  const until = day(view.expiry, lang);
  const kind = opened?.head.kind;
  const live = kind === "live";
  const isRaiser = wallet.address !== undefined && isAddressEqual(wallet.address, view.raiser);
  const claimBps = live ? opened!.end.claimBps : undefined;
  const block = now ? { number: now.number, timestamp: now.timestamp } : undefined;
  const closed = state === "thanked" || state === "refunded";
  // The network can't be seen: no "open" or "time's up" from an old block. A closed
  // Hand stays closed whatever happens next, so its state is still said.
  const cut = chain.offline || chain.stale;
  const shown = cut && !closed ? undefined : state;
  const readAt = read.atBlock ?? chain.tip?.number;
  const proof = proofPathOf(opened?.head.chainId ?? config.chain.id, core, view.handId, config.cores.canonical);
  const actions = state === "open" && live;
  // At phone width the two actions stand in a bar at the bottom of the screen. An on-screen
  // keyboard would cover the bar or push it over the field being typed in, so while one is open
  // the buttons stand in the page instead: they are never absent. The same on a screen both
  // narrow and short, where two buttons one over the other would take a third of it and more.
  const bar = actions && narrow && !typing;
  // In the calm view the card is the route's spine, so no separate rail is drawn; under the lens
  // the card stands in full and the rail's hands turn over.
  const person = (hand: RailHand) => {
    if (hand.address) showPerson(hand.address, { role: hand.role === "asker" ? "asker" : "onRoute", ...(hand.name ? { name: hand.name } : {}) });
  };

  const card = (
    <div data-testid={TID.hand.dealCard} data-state={shown ?? "unknown"} data-offline={cut} data-description={description.status} data-reward={view.reward.toString()}>
      <DealCard
        heading="h1"
        state={shown === "open" || shown === "expired" || closed ? shown : undefined}
        description={description}
        reward={view.reward}
        decimals={decimals}
        expiry={view.expiry}
        {...(closed ? { closedAt: view.closedAt } : {})}
        {...(claimBps !== undefined ? { claimBps } : {})}
        raiser={view.raiser}
        onRaiser={() => showPerson(view.raiser, { role: "asker" })}
        handId={view.handId}
        offlineSaid={cut && !closed}
        {...(block ? { block } : {})}
        {...(opened ? { spine: { hands: routeHands(opened), shares: opened.signedShakes.map(({ shake }) => marginOf(view.reward, shake.claimBps, shake.nextClaimBps)), onPerson: person, testId: TID.hand.rail } } : {})}
      />
    </div>
  );

  // On a phone the column of actions comes right after the card, before the route and the
  // evidence, so "Pass it on" and "I can help" are not pushed below the first screen; from md up
  // it is the sticky right column beside both.
  const body = (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_380px] md:grid-rows-[auto_1fr] md:items-start md:gap-x-10 md:gap-y-6">
      {/* The message, then the people it came through: who asks and who passed it on are read
          together, before what can be done about it. */}
      <div className="flex min-w-0 flex-col gap-5 md:col-start-1 md:row-start-1">
        {description.status === "lost" ? <div data-testid={TID.hand.lost}>{card}</div> : card}
        {opened && lens ? <Route opened={opened} reward={view.reward} decimals={decimals} you={live && !closed} next={live && state === "open" && (left ?? 0) > 0} onPerson={person} /> : null}
      </div>

      <aside className="flex min-w-0 flex-col gap-5 md:sticky md:top-6 md:col-start-2 md:row-span-2 md:row-start-1">
        {cut && !closed ? (
          <p className="ah-alert m-0" role="status" data-testid={TID.hand.offline} data-value={readAt?.toString() ?? ""}>
            {lens ? t("hand.offline", { n: readAt?.toString() ?? "?" }) : t("hand.offline.calm")}
          </p>
        ) : null}
        {actions ? <Actions left={left ?? 0} until={until} funded={funded} inBar={bar} off={cut} /> : null}
        {state === "open" && !opened ? (
          <p className="ah-note m-0" data-testid={TID.hand.noLink}>
            {t("hand.noLink")}
          </p>
        ) : null}
        {state === "open" && !opened ? <LinkAgain /> : null}
        {!opened && !closed ? (
          <Proof>
            <ProofLink to={proof} />
          </Proof>
        ) : null}
        {kind === "addressed" && state === "open" ? <p className="ah-note m-0">{t("hand.addressed")}</p> : null}
        {kind === "give" && !closed ? <GiveArrived raiser={isRaiser} check={giveCheck} /> : null}
        {state === "expired" ? <SendBack core={core} handId={view.handId} funded={funded} /> : null}
        {closed ? <Closed core={core} handId={view.handId} raiser={view.raiser} closedAt={view.closedAt} state={state} decimals={decimals} /> : null}
        {opened ? (
          <p className="ah-label ah-label--dim m-0" data-testid={TID.hand.tabOnly}>
            {t("common.tabOnly")}
          </p>
        ) : null}
      </aside>

      {opened ? (
        <div className="flex min-w-0 flex-col gap-6 md:col-start-1 md:row-start-2">
          <Evidence opened={opened} left={left ?? 0} lens={lens} proof={proof} check={state === "open"} />
        </div>
      ) : null}
    </div>
  );
  return (
    <>
      {body}
      {bar ? <ActionBar left={left ?? 0} off={cut} /> : null}
    </>
  );
}

// Written with max- and min-, never as a range: Safari before 16.4 does not read a range.
const NARROW = "(max-width: 767.98px) and (min-height: 560px), (min-width: 600px) and (max-width: 767.98px)";

/**
 * Whether the screen is narrower than the two-column layout (Tailwind's `md`, 768 px) and has
 * room for the bar of two actions. From 600px of width the two stand side by side in it, a row
 * 89px tall, which any height takes (a phone held sideways). Narrower than that they stand one
 * over the other, 173px, which wants 560px of height: on a screen both narrow and short the bar
 * would cover a third of it and more, so there the actions stand in the page.
 */
function useNarrow(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia(NARROW);
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

/** A field that brings up a keyboard when focused. */
function takesText(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  return element instanceof HTMLInputElement && !["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"].includes(element.type);
}

/** How much of the window an on-screen keyboard takes at least, in CSS pixels. */
const KEYBOARD_MIN = 150;

/**
 * Whether an on-screen keyboard is likely open: a text field has the focus, or the visible part
 * of the window is much shorter than the window (browsers that shrink only the visual viewport).
 * The visible part is counted at the page's own scale, so zooming in is not taken for a keyboard.
 */
function useTyping(): boolean {
  return useSyncExternalStore(
    (listener) => {
      document.addEventListener("focusin", listener);
      document.addEventListener("focusout", listener);
      window.visualViewport?.addEventListener("resize", listener);
      return () => {
        document.removeEventListener("focusin", listener);
        document.removeEventListener("focusout", listener);
        window.visualViewport?.removeEventListener("resize", listener);
      };
    },
    () => takesText(document.activeElement) || (window.visualViewport ? window.innerHeight - window.visualViewport.height * window.visualViewport.scale > KEYBOARD_MIN : false),
    () => false,
  );
}

/**
 * The two actions of an open Hand at phone width (the main action within thumb
 * reach): a bar that stays at the bottom of the screen while the Hand is read, and rests at the
 * end of the Hand when the page is scrolled to its foot, so it never covers the footer. It
 * keeps clear of the home indicator (safe-area inset); both buttons are 56 px tall. The honest
 * line about thanks stays in the page, where the buttons stand on wider screens.
 *
 * While the bar stands, the page keeps its height free when it scrolls something into view, so
 * a focused control is never left under it.
 */
function ActionBar({ left, off }: { left: number; off: boolean }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.scrollPaddingBottom;
    // The bar and the thick part of the haze over it: a control brought into view stops clear of both.
    root.style.scrollPaddingBottom = `${(bar.current?.offsetHeight ?? 0) + 36}px`;
    return () => {
      root.style.scrollPaddingBottom = before;
    };
  }, []);
  return (
    <div
      ref={bar}
      className="ah-bar sticky bottom-0 z-10 -mx-6 px-4 pt-5 pb-[max(12px,env(safe-area-inset-bottom))]"
      data-testid={TID.hand.actionBar}
    >
      {/* The same two buttons a wide screen has: a button is one thing at any width. One over the
          other on a phone held upright, with room between them for the lower hand, which stands
          above its own button. Side by side from 600px, where each has the width for its label
          and its fade (a phone held sideways). */}
      <div className="flex flex-col gap-7 min-[600px]:grid min-[600px]:grid-cols-2 min-[600px]:gap-3">
        <SwipeButton gesture="shake" data-testid={TID.hand.pass} disabled={left === 0 || off} onClick={() => navigate("/pass")} className="w-full">
          {t("common.word.passOn")}
        </SwipeButton>
        <SwipeButton gesture="cheer" variant="amber" data-testid={TID.hand.help} disabled={off} onClick={() => navigate("/give")} className="w-full">
          {t("common.word.canHelp")}
        </SwipeButton>
      </div>
    </div>
  );
}

/** "See the proof →": the Hand's passport. */
function ProofLink({ to }: { to: string }) {
  return (
    <a href={to} className="ah-label inline-flex min-h-[44px] items-center self-start font-bold" data-testid={TID.hand.proofLink}>
      {t("hand.proofLink")}
    </a>
  );
}

/**
 * Pass it on, and I can help, with the honest line under the help button. With `inBar` the two
 * buttons stand in the bottom bar instead (ActionBar), and only the lines stay here. `off` while
 * the network can't be seen: both wait until it can.
 */
function Actions({ left, until, funded, inBar, off }: { left: number; until: string; funded: boolean; inBar: boolean; off: boolean }) {
  // Fetch the two screens these buttons open while the network is still here, so a press just
  // as it drops draws /give's or /pass's own offline band, not a screen that never loaded.
  useEffect(() => {
    void import("../give/index.tsx").catch(() => undefined);
    void import("../pass/index.tsx").catch(() => undefined);
  }, []);
  return (
    <div className={inBar ? "flex flex-col gap-4" : "flex flex-col gap-4 md:pt-6"}>
      {inBar ? null : (
        <SwipeButton gesture="shake" data-testid={TID.hand.pass} disabled={left === 0 || off} onClick={() => navigate("/pass")} className="w-full">
          {t("common.word.passOn")}
        </SwipeButton>
      )}
      {left === 0 ? (
        <p className="ah-label m-0" data-testid={TID.hand.passesLeft} data-value={left}>
          {t("hand.passesNone")}
        </p>
      ) : left < 3 ? (
        <p className="ah-label m-0" data-testid={TID.hand.passesLeft} data-value={left}>
          {t("hand.passesLeft", { n: left })}
        </p>
      ) : null}
      {inBar ? null : (
        <div className="pt-8">
          <SwipeButton gesture="cheer" variant="amber" data-testid={TID.hand.help} disabled={off} onClick={() => navigate("/give")} className="w-full">
            {t("common.word.canHelp")}
          </SwipeButton>
        </div>
      )}
      <p className="ah-label m-0" data-testid={TID.hand.helpNote}>
        {t(funded ? "hand.helpNote" : "hand.helpNote.noReward", { date: until })}
      </p>
    </div>
  );
}

/**
 * The route as people, right under the message: who asked, who passed it on, the viewer, and the
 * place of whoever is next. The rail names each of them, so no sentence repeats it. The rail gets
 * the signed route for the flip; a pass at the asker's own address carries the "asker" flag.
 */
function Route({ opened, reward, decimals, you, next, onPerson }: { opened: OpenedAddress; reward: bigint; decimals: number; you: boolean; next: boolean; onPerson: (hand: RailHand) => void }) {
  const hands: RailHand[] = routeHands(opened);
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
        onPerson={onPerson}
      />
    </div>
  );
}

/**
 * The evidence under the card, one tap away (the lens opens it): what the link proved here, the
 * description's hash against Core's, how far the route can still go, and holders' own lists,
 * which are never the asker's words and stand only here. It ends with the way to the
 * Hand's passport and, on an open Hand, to /check for the whole link: /check reads the link from
 * this tab's memory, so nothing of it enters the address.
 */
function Evidence({ opened, left, lens, proof, check }: { opened: OpenedAddress; left: number; lens: boolean; proof: string; check: boolean }) {
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
      <span className="flex flex-col pt-2">
        <ProofLink to={proof} />
        {check ? (
          <a href="/check" className="ah-label inline-flex min-h-[44px] items-center self-start font-bold" data-testid={TID.hand.checkLink}>
            {t("hand.checkLink")}
          </a>
        ) : null}
      </span>
    </Disclose>
  );
}

/**
 * A give link opened here: a holder passes it back the way it came; the asker
 * goes on to thank. The address copied is the one this tab holds, from memory. Core's own
 * `checkGive` is asked first, as the helper's flip asks it: when Core refuses the answer, the
 * front says Core's sentence instead, with nothing to copy and nothing to open.
 */
function GiveArrived({ raiser, check }: { raiser: boolean; check: GiveCheck }) {
  const address = addressOf();
  if (check.status === "refused") {
    return (
      <div className="flex flex-col gap-4 pt-6" data-testid={TID.hand.giveLink} data-value={raiser ? "raiser" : "holder"} data-check="refused">
        <div data-testid={TID.hand.giveRefused} data-value={check.refusal.name}>
          <ErrorBand what={t(messageIdOf(check.refusal))} code={`CORE · ${check.refusal.name}`} />
        </div>
        {raiser ? null : <ConnectButton />}
      </div>
    );
  }
  if (raiser) {
    return (
      <div className="flex flex-col gap-4 pt-6" data-testid={TID.hand.giveLink} data-value="raiser" data-check={check.status}>
        <p className="m-0 text-[length:var(--fs-card-title)] font-extrabold leading-tight tracking-[-0.02em]">{t("hand.give.raiser")}</p>
        <SwipeButton gesture="bow" variant="amber" data-testid={TID.hand.toThank} onClick={() => navigate("/thank")} className="w-full">
          {t("hand.give.toThank")}
        </SwipeButton>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid={TID.hand.giveLink} data-value="holder" data-check={check.status}>
      <p className="m-0 text-[length:var(--fs-card-title)] font-extrabold leading-tight tracking-[-0.02em]">{t("hand.give.holder")}</p>
      {address ? (
        <div data-testid={TID.hand.copy}>
          <CopyRow value={address} />
        </div>
      ) : null}
      <p className="ah-label m-0">{t(config.privy ? "hand.give.mineLogIn" : "hand.give.mine")}</p>
      <ConnectButton />
    </div>
  );
}
