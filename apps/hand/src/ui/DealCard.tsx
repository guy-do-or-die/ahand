import { Fragment, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Address } from "viem";

import { clsx } from "../lib/clsx";
import { TID } from "../testids";
import { Ambient, useLang, useLens, type Lang } from "./ambient";
import { atLeast, count, day, inBothZones, minute, money, moneyExact, percent, unitsText } from "./format";
import { GestureEmoji } from "./Gesture";
import { Identity } from "./Identity";
import { amountsIn, readAskerWords, type MentionedAmount, type WordsReading } from "./judge";
import { Mark } from "./Mark";
import { RewardBar } from "./RewardBar";
import { useWords } from "./words";

/** The Hand's own words, as the SDK's `readDescription` found them. */
export type DealDescription =
  /** They arrived and matched the hash Core keeps. */
  | { status: "attached"; title: string; content?: string }
  /** Core keeps a hash, and the words did not come with the link. */
  | { status: "lost" }
  /** The Hand states nothing. */
  | { status: "none" };

/**
 * The one conversion from a read description (the SDK's `readDescription` or `readDescriptionOf`,
 * or the words this device kept, as `{ status: "attached", title, content }`) to the card's. Words
 * that matched but carry no title count as not all arrived ("lost"); an empty content is left out.
 */
export function dealDescriptionOf(read: { status: "none" | "attached" | "lost"; title?: string; content?: string } | undefined): DealDescription {
  if (!read || read.status === "none") return { status: "none" };
  if (read.status === "attached" && read.title !== undefined) return { status: "attached", title: read.title, ...(read.content ? { content: read.content } : {}) };
  return { status: "lost" };
}

export interface DealCardProps {
  /**
   * The Hand's state by the network's clock: the SDK's `stateAt(now)` with the latest block's
   * time. Undefined while no block has arrived: the card then shows the dates and claims
   * nothing that depends on "now" (UX-SPEC §15). The card itself never reads a clock.
   */
  state: "open" | "expired" | "thanked" | "refunded" | undefined;
  description: DealDescription;
  /** `hands(id).reward`, in the token's smallest units. Zero is a Hand with no reward. */
  reward: bigint;
  decimals: number;
  /** `hands(id).expiry`, in seconds. */
  expiry: number;
  /** `hands(id).closedAt`, in seconds, for a thanked or refunded Hand. */
  closedAt?: number;
  /**
   * The claim left at the viewer's place on the route, in basis points. With it the card says
   * "at least $28"; without it (the public view, where there is no place) that row is left out.
   */
  claimBps?: number;
  /**
   * Who reads the card. "holder" (the default) is anyone who holds or sees the link: the rows say
   * what *you* get if you help or pass it on. "asker" is the raiser on their own screens: Core
   * refuses their Give, so the rows speak about whoever helps, and `claimBps` (then the Hand's
   * `minClaimBps`) is labelled as the floor they set.
   */
  viewer?: "holder" | "asker";
  /**
   * `hands(id).raiser`. Absent only on /raise's preview before an account is connected: the row
   * then says the address comes once one is, never a zero address (F5).
   */
  raiser?: Address;
  /** Without `raiser`: the account comes by "Log in" (a build that logs in through Privy), not by connecting a wallet. */
  raiserByLogIn?: boolean;
  /** A name proved for the raiser's address (ENS both ways); the card still says "Someone". */
  raiserName?: string;
  /**
   * The Hand's number: the reward and the dates then open to their source, `hands(12).reward`,
   * `hands(12).expiry`, `hands(12).closedAt`. A card without it shows a Hand that is not on the
   * chain yet (the raise screen's preview), so its figures name no source and open to nothing.
   */
  handId?: bigint;
  /** The block the figures were read at: the evidence names it, and the lens shows its time. */
  block?: { number: bigint; timestamp: number };
  /** The card speaks the page's language unless told otherwise. */
  lang?: Lang;
  /** Dates are written in the reader's time zone; a fixed one is for tests and prints. */
  timeZone?: string;
  /**
   * The screen says itself, right under the card, that the network is out of reach (the Hand
   * view's line with the block it last read), so the card leaves out its own shorter one.
   */
  offlineSaid?: boolean;
  /** "h1" where the card is the page's own heading (the Hand view). */
  heading?: "h1" | "h2";
  /** What follows the state line: the receipt of a thanked Hand, for one. */
  children?: ReactNode;
  className?: string;
}

/**
 * The Deal card (UX-SPEC §4): the top of every screen that shows a Hand. In thirty seconds it
 * says who asks for what, the reward and until when, what you get if you help and are
 * thanked, what you keep if you pass it on, and that the reward goes back if nobody is
 * thanked. Each figure opens to its source: the reward and the dates to Core's own fields, the
 * floor to its sum.
 *
 * The title and details are the asker's own words, which Core does not check (E-8). They are
 * labelled so, drawn isolated from the card's own text (H-2), with hidden characters shown as
 * tokens and look-alikes marked, clamped behind "Read all" so the terms Core backs stay on the
 * first screen (H-4), and any amount they mention that differs from the reward is said beside
 * them. The words themselves are never altered: this is display only.
 */
export function DealCard(props: DealCardProps) {
  if (props.lang === undefined) return <Card {...props} />;
  return (
    <Ambient lang={props.lang}>
      <Card {...props} />
    </Ambient>
  );
}

function Card({ state, description, reward, decimals, expiry, closedAt, claimBps, viewer = "holder", raiser, raiserByLogIn, raiserName, handId, block, timeZone, offlineSaid, heading = "h2", children, className }: DealCardProps) {
  const lang = useLang();
  const lens = useLens();
  const words = useWords().deal;
  // The words the asker reads on their own screens (viewer "asker"); undefined for anyone else.
  const own = viewer === "asker" ? words.asker : undefined;
  const titleId = useId();
  const rewardId = useId();
  const expiryId = useId();
  const closedId = useId();
  const floorId = useId();
  const [rewardOpen, setRewardOpen] = useState(false);
  const [expiryOpen, setExpiryOpen] = useState(false);
  const [closedOpen, setClosedOpen] = useState(false);
  const [floorOpen, setFloorOpen] = useState(false);
  const Heading = heading;
  const attached = description.status === "attached" ? description : undefined;
  // The asker's words as drawn: read once, for the words and for the note on what they hide.
  const asker = useMemo(
    () => (attached ? { title: readAskerWords(attached.title), content: attached.content ? readAskerWords(attached.content) : undefined } : undefined),
    [attached?.title, attached?.content],
  );
  const found = asker ? [...new Set([...asker.title.found, ...(asker.content?.found ?? [])])] : [];

  const funded = reward > 0n;
  // "29 Jan" stays on one line: a date cut from its month reads as two facts.
  const until = day(expiry, lang, timeZone).replace(" ", "\u00a0");
  const closedOn = closedAt ? day(closedAt, lang, timeZone) : until;
  // Core rounds every pass's share down and leaves the dust to the helper: the least is the ceiling (M-1).
  const floor = claimBps !== undefined ? atLeast(reward, claimBps) : undefined;
  // Only a Hand with a number was read from the chain; a preview has no source to open. In the
  // calm view (lens off) no figure opens: the amounts and dates are plain words there.
  const onChain = handId !== undefined;
  const figures = onChain && lens;
  const showReward = figures && (lens || rewardOpen);
  const showExpiry = figures && (lens || expiryOpen);
  // A closed Hand whose closing second did not come along says the day and opens nothing.
  const closedSource = figures && closedAt ? closedAt : undefined;
  const showClosed = closedSource !== undefined && (lens || closedOpen);
  const showFloor = lens || floorOpen;

  const when = state === "open" ? around(words.openUntil) : state === undefined ? around(words.until) : state === "expired" ? around(words.wasOpenUntil) : undefined;
  const closedSentence = state === "thanked" ? around(words.thanked) : state === "refunded" ? around(funded ? words.refunded : words.closed) : undefined;
  const blockLine = block ? `${words.block} ${count(block.number)}` : undefined;
  const amount = money(reward, decimals, lang);
  // The least a helper gets: every digit below a cent (floorAmount), said as the floor the asker set on their own screens.
  const floorMoney = floor === undefined ? "" : floorAmount(floor, decimals, lang);
  const floorText = floor === undefined ? "" : own ? own.floor(floorMoney, percent(claimBps ?? 0, lang)) : words.atLeast(floorMoney);
  const ifHelp = own ? own.ifHelp : words.ifHelp;

  return (
    <article className={clsx("ah-deal", className)} aria-labelledby={titleId} data-state={state ?? "unknown"} data-funded={funded} data-viewer={viewer}>
      <div className="ah-deal__head">
        {/* The hand keeps rising while it is up (or still being written); a closed Hand's hand rests. */}
        <GestureEmoji kind="raise" still={state !== undefined && state !== "open"} className="ah-deal__gesture" />
        <div className="min-w-0 flex-1">
          {description.status === "attached" && asker ? (
            <AskerWords title={description.title} content={description.content} reading={asker} titleId={titleId} heading={Heading} intro={own ? own.intro : words.intro} label={own ? own.wordsLabel : words.wordsLabel} />
          ) : (
            <Heading id={titleId} className="ah-deal__title">
              {own ? own.bare : words.bare}
            </Heading>
          )}
        </div>
      </div>

      {description.status === "lost" ? <p className="ah-note">{words.lost}</p> : null}
      {found.length > 0 ? (
        <p className="ah-asker__flag" data-testid={TID.kit.dealHiddenChars} data-value={found.join(" ")}>
          {words.hiddenChars}
        </p>
      ) : null}
      {description.status === "attached" ? <AmountFlag title={description.title} content={description.content} reward={reward} decimals={decimals} /> : null}

      <div className="ah-stack">
        <p className="ah-deal__money">
          {funded ? (
            <>
              {words.reward[0]}
              {figures ? (
                <button type="button" className="ah-figure ah-marker" aria-expanded={showReward} aria-controls={showReward ? rewardId : undefined} onClick={() => setRewardOpen(!showReward)}>
                  {amount}
                </button>
              ) : (
                <span className="ah-marker">{amount}</span>
              )}
              {words.reward[1]}
            </>
          ) : (
            words.noReward
          )}
          {when ? (
            <>
              {" · "}
              {when[0]}
              {figures ? (
                <button type="button" className="ah-figure" aria-expanded={showExpiry} aria-controls={showExpiry ? expiryId : undefined} onClick={() => setExpiryOpen(!showExpiry)}>
                  {until}
                </button>
              ) : (
                until
              )}
              {when[1]}
            </>
          ) : null}
        </p>
        {funded && showReward ? (
          <div id={rewardId} className="ah-evidence" data-source="reward">
            <span className="ah-meta ah-meta--exact">
              hands({handId.toString()}).reward = {reward.toString()}
            </span>
            <span className="ah-meta ah-meta--exact">
              {reward.toString()} / 10^{decimals} = {unitsText(reward, decimals)}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <Mark kind="chain" />
              {blockLine ? <span className="ah-meta">{blockLine}</span> : null}
            </span>
          </div>
        ) : null}
        {when && showExpiry ? (
          <DateSource id={expiryId} field="expiry" handId={handId} seconds={expiry} timeZone={timeZone}>
            <span className="flex flex-wrap items-center gap-2">
              <Mark kind="chain" />
              {blockLine ? <span className="ah-meta">{blockLine}</span> : null}
            </span>
          </DateSource>
        ) : null}
        {funded && floor !== undefined && state === "open" ? (
          <RewardBar progress={Number(claimBps) / 10_000} label={`${ifHelp}: ${floorText}`} />
        ) : null}
      </div>

      {state === "expired" ? (
        <div className="ah-stack">
          <p className="ah-deal__state">{words.timeUp}</p>
          <p className="ah-label">{funded ? (own ? own.sendBack : words.sendBack) : words.closeNow}</p>
        </div>
      ) : null}
      {closedSentence ? (
        <div className="ah-deal__foot ah-deal__closed">
          <p className="ah-deal__state">
            {closedSentence[0]}
            {closedSource !== undefined ? (
              <button type="button" className="ah-figure" aria-expanded={showClosed} aria-controls={showClosed ? closedId : undefined} onClick={() => setClosedOpen(!showClosed)}>
                {closedOn}
              </button>
            ) : (
              closedOn
            )}
            {closedSentence[1]}
          </p>
          {/* The mark beside the sentence opens the same source as the date in it. */}
          {closedSource !== undefined ? <Mark kind="chain" opens={{ id: closedId, open: showClosed, toggle: () => setClosedOpen(!showClosed) }} /> : onChain ? <Mark kind="chain" /> : null}
          {closedSource !== undefined && showClosed ? (
            <DateSource id={closedId} field="closedAt" handId={handId} seconds={closedSource} timeZone={timeZone}>
              {blockLine ? <span className="ah-meta">{blockLine}</span> : null}
            </DateSource>
          ) : null}
        </div>
      ) : null}
      {state === undefined && !offlineSaid ? <p className="ah-note">{words.noClock}</p> : null}

      {state === "open" ? (
        <dl className="ah-deal__rows">
          {funded && floor !== undefined ? (
            <div className="ah-deal__row">
              <dt>{ifHelp}</dt>
              <dd data-open={showFloor}>
                {lens ? (
                  <button type="button" className="ah-figure" aria-expanded={showFloor} aria-controls={showFloor ? floorId : undefined} onClick={() => setFloorOpen(!showFloor)}>
                    {floorText}
                  </button>
                ) : (
                  floorText
                )}
                {showFloor ? (
                  <div id={floorId} className="ah-evidence">
                    <span className="ah-label">{own ? own.floorWhy : words.floorWhy}</span>
                    <span className="ah-meta ah-meta--exact">⌈reward × claimBps / 10 000⌉</span>
                    <span className="ah-meta ah-meta--exact">
                      ⌈{unitsText(reward, decimals)} × {claimBps} / 10 000⌉ = {unitsText(floor, decimals)}
                    </span>
                    <Mark kind="checked" />
                  </div>
                ) : null}
              </dd>
            </div>
          ) : null}
          <div className="ah-deal__row">
            <dt>{own ? own.ifPass : words.ifPass}</dt>
            <dd>{funded ? (own ? own.keepShare : words.keepShare) : words.passFree}</dd>
          </div>
          <div className="ah-deal__row">
            <dt>{own ? own.ifNobody(until) : words.ifNobody(until)}</dt>
            <dd>{funded ? (own ? own.goesBack : words.goesBack) : words.closes}</dd>
          </div>
        </dl>
      ) : null}

      {children}

      {/* On the asker's own screens the calm view needs no row saying the hand is their own. */}
      {own && raiser && !lens ? null : (
        <div className="ah-deal__foot" data-raiser={raiser ? "known" : "later"}>
          <span className="ah-label">{own ? own.askedBy : words.askedBy}</span>
          {raiser ? <Identity address={raiser} name={raiserName} /> : <span className="ah-label">{raiserByLogIn ? words.askedByLaterLogIn : words.askedByLater}</span>}
        </div>
      )}
      {lens && block ? (
        <p className="ah-meta">
          {words.networkTime} · {blockLine} · {minute(block.timestamp, lang, timeZone)}
        </p>
      ) : null}
    </article>
  );
}

/**
 * A sentence written around one value, cut where the value stands, so the card can set a
 * figure there: "open until {20 Dec}" gives ["open until ", ""].
 */
function around(sentence: (value: string) => string): readonly [string, string] {
  const cut = "\u0000";
  const text = sentence(cut);
  const at = text.indexOf(cut);
  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + cut.length)];
}

/**
 * What a date on the card opens to: Core's own field with the second it holds, then that second
 * as a date and time in the reader's zone and in UTC. The caller adds the mark and the block.
 */
function DateSource({ id, field, handId, seconds, timeZone, children }: { id: string; field: "expiry" | "closedAt"; handId: bigint | undefined; seconds: number; timeZone: string | undefined; children?: ReactNode }) {
  const lang = useLang();
  return (
    <div id={id} className="ah-evidence ah-evidence--wide" data-source={field}>
      <span className="ah-meta ah-meta--exact">
        hands({handId?.toString()}).{field} = {seconds}
      </span>
      {inBothZones(seconds, lang, timeZone).map((line) => (
        <span key={line} className="ah-meta ah-meta--exact">
          {line}
        </span>
      ))}
      {children}
    </div>
  );
}

// ── The asker's words ───────────────────────────────────────────────────

/**
 * The asker's text, shown and never altered: isolated from the text around it (`<bdi>`, so a
 * direction control inside cannot turn the card's own words), with each invisible or
 * direction-changing character drawn as a small token such as ⟨RLO⟩ in place of the character
 * itself, and look-alike words and digits marked. For any screen that shows an asker's words.
 */
export function AskerText({ text, reading, block = false }: { text: string; reading?: WordsReading; block?: boolean }) {
  const words = useWords().deal;
  const read = useMemo(() => reading ?? readAskerWords(text), [reading, text]);
  return (
    <bdi dir="auto" className="ah-asker__text">
      {read.pieces.map((piece, index) => {
        if (piece.kind === "text") return <Fragment key={index}>{piece.text}</Fragment>;
        if (piece.kind === "hidden") {
          const breaks = block && (piece.name === "LS" || piece.name === "PS");
          return (
            <span key={index}>
              <span
                className={clsx("ah-hidden", piece.direction && "ah-hidden--direction")}
                title={words.hiddenToken(piece.name)}
                data-char={`U+${piece.char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`}
              >
                ⟨{piece.name}⟩
              </span>
              {breaks ? "\n" : null}
            </span>
          );
        }
        return (
          <span key={index} className="ah-odd" data-why={piece.why} title={piece.why === "compat" ? words.compat : words.mixedScript}>
            {piece.text}
          </span>
        );
      })}
    </bdi>
  );
}

/** Title and details: labelled as the asker's, clamped to a few lines until "Read all". */
function AskerWords({
  title,
  content,
  reading,
  titleId,
  heading: Heading,
  intro,
  label,
}: {
  title: string;
  content?: string;
  reading: { title: WordsReading; content?: WordsReading | undefined };
  titleId: string;
  heading: "h1" | "h2";
  /** The line over the words: the holder's, or the asker's own on their screens. */
  intro: string;
  /** Whose words these are, and that nobody checked them. */
  label: string;
}) {
  const words = useWords().deal;
  const titleRead = reading.title;
  const contentRead = reading.content;
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const contentRef = useRef<HTMLParagraphElement>(null);
  const wordsId = useId();

  // Whether the clamp hides anything: measured, so "Read all" shows only when there is more.
  useLayoutEffect(() => {
    if (open) return;
    const measure = () => {
      // A clamp hides at least one whole line; a few pixels more are the glyphs' own overhang.
      const cut = [titleRef.current, contentRef.current].some((node) => !!node && node.scrollHeight - node.clientHeight > 8);
      setLong(cut);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const node of [titleRef.current, contentRef.current]) if (node) observer.observe(node);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [open, title, content]);

  return (
    <div className="ah-asker" id={wordsId} data-open={open ? "true" : "false"}>
      <p className="ah-asker__label" data-testid={TID.kit.dealWordsLabel}>
        {label}
      </p>
      <p className="ah-deal__intro">{intro}</p>
      <Heading id={titleId} ref={titleRef} className={clsx("ah-deal__title", !open && "ah-clamp ah-clamp--title")}>
        <AskerText text={title} reading={titleRead} />
      </Heading>
      {content && contentRead ? (
        <p ref={contentRef} className={clsx("ah-deal__content", !open && "ah-clamp ah-clamp--content")}>
          <AskerText text={content} reading={contentRead} block />
        </p>
      ) : null}
      {long || open ? (
        <button type="button" className="ah-asker__more" aria-expanded={open} aria-controls={wordsId} data-testid={TID.kit.dealReadAll} onClick={() => setOpen(!open)}>
          {open ? words.readLess : words.readAll}
        </button>
      ) : null}
    </div>
  );
}

/** Amounts the words mention that are not the reward Core holds, said beside the words (E-8). */
function AmountFlag({ title, content, reward, decimals }: { title: string; content?: string; reward: bigint; decimals: number }) {
  const lang = useLang();
  const words = useWords().deal;
  const differing = useMemo(() => {
    const all: MentionedAmount[] = [...amountsIn(title, decimals), ...(content ? amountsIn(content, decimals) : [])];
    const seen = new Set<bigint>();
    return all.filter((found) => found.amount !== reward && !seen.has(found.amount) && seen.add(found.amount));
  }, [title, content, reward, decimals]);
  if (differing.length === 0) return null;
  const shown = differing.slice(0, 3).map((found) => money(found.amount, decimals, lang));
  const list = new Intl.ListFormat(lang === "ru" ? "ru" : "en", { type: "conjunction" }).format(shown);
  return (
    <p className="ah-asker__flag ah-asker__flag--amount" data-testid={TID.kit.dealAmountFlag} data-value={differing.map((found) => unitsText(found.amount, decimals)).join(" ")}>
      {reward > 0n ? words.amountFlag(list, money(reward, decimals, lang)) : words.amountFlagNone(list)}
    </p>
  );
}

/**
 * The least a helper gets, as the card says it: cents when it is a cent or more (cut down, so
 * still a floor), every digit below a cent, never "at least under $0.01" (M-1).
 */
function floorAmount(floor: bigint, decimals: number, lang: Lang): string {
  return floor > 0n && floor * 100n < 10n ** BigInt(decimals) ? moneyExact(floor, decimals, lang) : money(floor, decimals, lang);
}
