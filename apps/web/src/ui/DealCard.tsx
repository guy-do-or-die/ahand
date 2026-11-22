import { Fragment, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Address } from "viem";

import { clsx } from "../lib/clsx";
import { TID } from "../testids";
import { Ambient, useLang, useLens, type Lang } from "./ambient";
import { atLeast, count, day, inBothZones, minute, money, moneyExact, percent, span, unitsText } from "./format";
import { GestureEmoji } from "./Gesture";
import { Identity } from "./Identity";
import { amountsIn, readAskerWords, type MentionedAmount, type WordsReading } from "./judge";
import { Mark } from "./Mark";
import type { RailHand } from "./rail";
import { SpinePassers } from "./Spine";
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
   * nothing that depends on "now". The card itself never reads a clock.
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
   * then says the address comes once one is, never a zero address.
   */
  raiser?: Address;
  /** Without `raiser`: the account comes by "Log in" (a build that logs in through Privy), not by connecting a wallet. */
  raiserByLogIn?: boolean;
  /** A name proved for the raiser's address (ENS both ways); the card still says "Someone". */
  raiserName?: string;
  /** Opens the asker as a person (the shell's person sheet); the line over the words is then a button. */
  onRaiser?: () => void;
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
  /**
   * The route this Hand came by. In the calm view the card is always the route's spine, a row for
   * each of who asked (the words, the whole reward and the date), who passed it on (one line,
   * however many), who answered, and last the viewer's place on an open Hand (the amount that
   * reaches them, under its condition) or what the Hand came to. Without `spine` the card knows no
   * route and draws the asker and the last row only. Under the lens the card is drawn in full and
   * the screen draws the rail, whose hands turn over.
   */
  spine?: {
    hands: readonly RailHand[];
    /** What each pass kept, in the token's smallest units and in the passes' order (Core's own sum for each, rounded down). */
    shares?: readonly bigint[];
    onPerson?: (hand: RailHand) => void;
    testId?: string;
  };
  /** "h1" where the card is the page's own heading (the Hand view). */
  heading?: "h1" | "h2";
  /** What follows the state line: the receipt of a thanked Hand, for one. */
  children?: ReactNode;
  className?: string;
}

/**
 * The Deal card: the top of every screen that shows a Hand. In thirty seconds it
 * says who asks for what, the reward and until when, what you get if you help and are
 * thanked, what you keep if you pass it on, and that the reward goes back if nobody is
 * thanked. Each figure opens to its source: the reward and the dates to Core's own fields, the
 * floor to its sum.
 *
 * The title and details are the asker's own words, which Core does not check. They stand
 * as a quotation under "Someone raised a hand:", so the form itself says whose words they are;
 * the line that says nobody checked them is drawn under the lens, and in the calm view whenever
 * the words give a reason for care (hidden characters, or an amount that is not the reward).
 * They are drawn isolated from the card's own text, with hidden characters shown as tokens
 * and look-alikes marked, clamped behind "Read all" so the terms Core backs stay on the first
 * screen, and any amount they mention that differs from the reward is said beside them.
 * The words themselves are never altered: this is display only.
 */
export function DealCard(props: DealCardProps) {
  if (props.lang === undefined) return <Card {...props} />;
  return (
    <Ambient lang={props.lang}>
      <Card {...props} />
    </Ambient>
  );
}

/**
 * The receiver's card as a picture: an open Hand that is on no chain, as the person it reached
 * would see it (the landing's examples). It is this card and no copy of it, so what is changed on
 * the receiver's screen is changed in the picture. A picture has no clock and nothing to press:
 * no date and no row that points at one, the line that counts the passes does not open, the words
 * stand whole with no "Read all", the title is not a heading of the page it illustrates, and the
 * lens does not turn it, since there is no chain behind it to show.
 *
 * `shares` is what each pass kept, in the route's order (zero for a pass that kept nothing). Each
 * must be a whole number of Core's basis points of the reward, as on a real Hand.
 */
export function DealPicture({ title, content, reward, decimals, shares, className }: { title: string; content?: string | undefined; reward: bigint; decimals: number; shares: readonly bigint[]; className?: string }) {
  const kept = shares.reduce((sum, share) => sum + share, 0n);
  return (
    <Card
      picture
      state="open"
      description={{ status: "attached", title, ...(content ? { content } : {}) }}
      reward={reward}
      decimals={decimals}
      expiry={0}
      claimBps={reward > 0n ? Number(((reward - kept) * 10_000n) / reward) : 10_000}
      spine={{ hands: [{ role: "asker" }, ...shares.map((): RailHand => ({ role: "passer" }))], shares }}
      {...(className ? { className } : {})}
    />
  );
}

function Card({ state, description, reward, decimals, expiry, closedAt, claimBps, viewer = "holder", raiser, raiserByLogIn, raiserName, onRaiser, handId, block, timeZone, offlineSaid, spine, heading = "h2", children, className, picture = false }: DealCardProps & { picture?: boolean }) {
  const lang = useLang();
  const lens = useLens() && !picture;
  const kit = useWords();
  const words = kit.deal;
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
  // A picture's title is the asker's line in an illustration, not a heading of the page around it.
  const Heading = (picture ? "p" : heading) as typeof heading;
  const attached = description.status === "attached" ? description : undefined;
  // The asker's words as drawn: read once, for the words and for the note on what they hide.
  const asker = useMemo(
    () => (attached ? { title: readAskerWords(attached.title), content: attached.content ? readAskerWords(attached.content) : undefined } : undefined),
    [attached?.title, attached?.content],
  );
  const found = asker ? [...new Set([...asker.title.found, ...(asker.content?.found ?? [])])] : [];
  // Amounts the words mention that are not the reward Core holds.
  const otherAmounts = useMemo(() => (attached ? amountsBesides(attached.title, attached.content, reward, decimals) : []), [attached?.title, attached?.content, reward, decimals]);
  // The words give a reason for care: then "not checked" is said in the calm view too.
  const wary = found.length > 0 || otherAmounts.length > 0;

  const funded = reward > 0n;
  // "29 Jan" stays on one line: a date cut from its month reads as two facts.
  const until = day(expiry, lang, timeZone).replace(" ", "\u00a0");
  const closedOn = closedAt ? day(closedAt, lang, timeZone) : until;
  // Core rounds every pass's share down and leaves the dust to the helper: the least is the ceiling.
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

  const when = picture ? undefined : state === "open" ? around(words.openUntil) : state === undefined ? around(words.until) : state === "expired" ? around(words.wasOpenUntil) : undefined;
  const closedSentence = state === "thanked" ? around(words.thanked) : state === "refunded" ? around(funded ? words.refunded : words.closed) : undefined;
  const blockLine = block ? `${words.block} ${count(block.number)}` : undefined;
  const amount = money(reward, decimals, lang);
  // The least a helper gets: every digit below a cent (floorAmount), said as the floor the asker set on their own screens.
  const floorMoney = floor === undefined ? "" : floorAmount(floor, decimals, lang);
  const floorText = floor === undefined ? "" : own ? own.floor(floorMoney, percent(claimBps ?? 0, lang)) : words.atLeast(floorMoney);
  const ifHelp = own ? own.ifHelp : words.ifHelp;
  // The calm view of whoever holds or sees the link: the message says the amount and the screen's
  // own lines say what passing on means, so the card keeps only what neither says.
  const brief = !lens && !own;
  // Passes before this place kept a share: the amber amount is then what reaches whoever helps
  // from here, and the whole reward stands beside it. Under the lens the amber amount is Core's
  // own figure and the row below works the least out.
  const reaches = brief && funded && floor !== undefined && floor < reward;
  // The hand waves once when the card arrives and then rests; a closed Hand's hand never moves.
  const gesture = <GestureEmoji kind="raise" still={state !== undefined && state !== "open"} className="ah-deal__gesture" />;

  const flags = (
    <>
      {description.status === "lost" ? <p className="ah-note">{words.lost}</p> : null}
      {found.length > 0 ? (
        <p className="ah-asker__flag" data-testid={TID.kit.dealHiddenChars} data-value={found.join(" ")}>
          {words.hiddenChars}
        </p>
      ) : null}
      {otherAmounts.length > 0 ? <AmountFlag differing={otherAmounts} reward={reward} decimals={decimals} /> : null}
    </>
  );
  const nobody = (
    <div className="ah-deal__row">
      <dt>{own ? own.ifNobody(until) : words.ifNobody(until)}</dt>
      <dd>{funded ? (own ? own.goesBack : words.goesBack) : words.closes}</dd>
    </div>
  );
  // The line over the words already says someone asked: in the calm view the row stands only
  // for a proved name, or to say the address comes once an account is connected.
  const foot =
    raiser && !lens && !(raiserName && !own) ? null : (
      <div className="ah-deal__foot" data-raiser={raiser ? "known" : "later"}>
        <span className="ah-label">{own ? own.askedBy : words.askedBy}</span>
        {raiser ? <Identity address={raiser} name={raiserName} /> : <span className="ah-label">{raiserByLogIn ? words.askedByLaterLogIn : words.askedByLater}</span>}
      </div>
    );

  // The calm view, on every screen that shows a Hand: the route's spine, a beat for each of who
  // asked, who passed it on, who answered, and last either the viewer's own place on an open Hand
  // or what the Hand came to. Under the lens the card is drawn in full below and the screen draws
  // the rail, whose hands turn over.
  if (!lens) {
    const hands = spine?.hands ?? [];
    const passers = hands.filter((hand) => hand.role === "passer" && !hand.dropped);
    const helper = hands.find((hand) => hand.role === "helper" && !hand.dropped);
    const kept = reaches ? floorAmount(reward - floor!, decimals, lang) : undefined;
    const shares = spine?.shares?.map((share) => (share > 0n ? floorAmount(share, decimals, lang) : undefined));
    // The viewer has a place on the route when they hold a link that can still be passed or answered.
    const you = !own && claimBps !== undefined && (state === "open" || state === undefined);
    const over = state === "expired" || closedSentence !== undefined;
    // Each fact stands once. The whole reward is said at the asker unless the viewer's own beat
    // shows that very amount (nothing was kept on the way); the date stands at the asker, with how
    // far off it is by the chain's clock, and the row about nobody being thanked points back at it.
    const whole = !you || reaches;
    const ahead = block && state === "open" && expiry > block.timestamp ? span(block.timestamp, expiry, lang, timeZone) : undefined;
    const far = block && state === "open" && expiry > block.timestamp ? (ahead ? words.inTime(ahead) : words.soon) : undefined;
    return (
      <article className={clsx("ah-deal ah-deal--spine", className)} aria-labelledby={titleId} data-state={state ?? "unknown"} data-funded={funded} data-viewer={viewer}>
        <ol className="ah-spine" data-testid={spine?.testId ?? TID.kit.spine} data-value={hands.length}>
          <li className="ah-spine__row" data-role="asker">
            <span className="ah-spine__node">
              <GestureEmoji kind="raise" still={state !== undefined && state !== "open"} className="ah-spine__gesture" />
            </span>
            <div className="ah-spine__body">
              {description.status === "attached" && asker ? (
                <AskerWords
                  plain
                  title={description.title}
                  content={description.content}
                  reading={asker}
                  titleId={titleId}
                  heading={Heading}
                  gesture={null}
                  intro={own ? own.intro : words.intro}
                  label={wary ? (own ? own.wordsLabel : words.wordsLabel) : undefined}
                  onRaiser={onRaiser}
                  whole={picture}
                />
              ) : (
                <Heading id={titleId} className="ah-deal__title ah-spine__bare">
                  {own ? own.bare : words.bare}
                </Heading>
              )}
              {flags}
              {/* With no date (a picture) and the whole reward said at the reader's own beat, the line has nothing to say. */}
              {whole || when ? (
                <p className="ah-spine__quiet ah-spine__terms">
                  {whole ? <span data-testid={TID.kit.spineWhole}>{funded ? kit.spine.reward(amount) : words.noReward}</span> : null}
                  {whole && when ? <span aria-hidden="true"> · </span> : null}
                  {when ? (
                    <span className="ah-spine__when">
                      {when[0]}
                      {until}
                      {when[1]}
                      {far ? <span data-testid={TID.kit.spineFar}>, {far}</span> : null}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
          </li>
          {passers.length > 0 ? <SpinePassers hands={passers} kept={kept} shares={shares} onPerson={spine?.onPerson} fixed={picture} /> : null}
          {helper ? (
            <li className="ah-spine__row" data-role="helper">
              <span className="ah-spine__node">
                <GestureEmoji kind="cheer" still className="ah-spine__gesture" />
              </span>
              <div className="ah-spine__body">
                {spine?.onPerson && helper.address ? (
                  <button type="button" className="ah-person-link ah-spine__answered" data-testid={TID.kit.spinePerson} onClick={() => spine.onPerson!(helper)}>
                    {kit.spine.answered}
                  </button>
                ) : (
                  <p className="ah-spine__answered">{kit.spine.answered}</p>
                )}
              </div>
            </li>
          ) : null}
          {you ? (
            <li className="ah-spine__row" data-role="you">
              <span className="ah-spine__node" aria-hidden="true">
                <i className="ah-spine__dot" />
              </span>
              <div className="ah-spine__body">
                <p className="ah-spine__you">{kit.spine.you}</p>
                {/* What reaches the viewer if they help, on amber; the whole it is part of stands at the asker. */}
                <p className={clsx("ah-deal__money", !funded && "ah-deal__money--none")} data-plate={funded ? (reaches ? "reaches" : "reward") : "none"}>
                  {funded ? (
                    <span className="ah-deal__sum">
                      <span className="ah-marker">{reaches ? floorMoney : amount}</span>
                    </span>
                  ) : null}
                  {funded ? " " : null}
                  <span className="ah-deal__terms">
                    <span className="ah-deal__what">{funded ? (state === "open" ? ifHelp : words.rewardWord) : words.noReward}</span>
                    {/* With no row for those who passed it on, what they kept is said here. */}
                    {reaches && passers.length === 0 ? (
                      <>
                        <span className="sr-only"> · </span>
                        <span className="ah-deal__of" data-testid={TID.kit.dealOfWhole}>
                          {words.ofWhole(amount, kept!)}
                        </span>
                      </>
                    ) : null}
                  </span>
                </p>
              </div>
            </li>
          ) : null}
          {over ? (
            <li className="ah-spine__row" data-role="end">
              <span className="ah-spine__node" aria-hidden="true">
                <i className="ah-spine__dot" />
              </span>
              <div className="ah-spine__body ah-spine__end">
                {state === "expired" ? (
                  <>
                    <p className="ah-deal__state">{words.timeUp}</p>
                    <p className="ah-label">{funded ? (own ? own.sendBack : words.sendBack) : words.closeNow}</p>
                  </>
                ) : closedSentence ? (
                  <p className="ah-deal__state">
                    {closedSentence[0]}
                    {closedOn}
                    {closedSentence[1]}
                  </p>
                ) : null}
              </div>
            </li>
          ) : null}
        </ol>
        {state === undefined && !offlineSaid ? <p className="ah-note">{words.noClock}</p> : null}
        {state === "open" && !picture ? (
          <dl className="ah-deal__rows">
            {funded && floor !== undefined && own ? (
              <div className="ah-deal__row">
                <dt>{ifHelp}</dt>
                <dd>{floorText}</dd>
              </div>
            ) : null}
            {/* With a reward, what passing on means is the pass screen's to say. With none, the card
                itself says that passing is free and there is no share to keep. */}
            {brief && funded ? null : (
              <div className="ah-deal__row">
                <dt>{own ? own.ifPass : words.ifPass}</dt>
                <dd>{funded ? (own ? own.keepShare : words.keepShare) : words.passFree}</dd>
              </div>
            )}
            <div className="ah-deal__row">
              <dt>{own ? own.ifNobodyThen : words.ifNobodyThen}</dt>
              <dd>{funded ? (own ? own.goesBack : words.goesBack) : words.closes}</dd>
            </div>
          </dl>
        ) : null}
        {children}
        {picture ? null : foot}
      </article>
    );
  }

  return (
    <article className={clsx("ah-deal", className)} aria-labelledby={titleId} data-state={state ?? "unknown"} data-funded={funded} data-viewer={viewer}>
      {description.status === "attached" && asker ? (
        <AskerWords
          title={description.title}
          content={description.content}
          reading={asker}
          titleId={titleId}
          plain
          heading={Heading}
          gesture={gesture}
          intro={own ? own.intro : words.intro}
          label={lens || wary ? (own ? own.wordsLabel : words.wordsLabel) : undefined}
          onRaiser={onRaiser}
        />
      ) : (
        <div className="ah-deal__head">
          {gesture}
          <Heading id={titleId} className="ah-deal__title min-w-0 flex-1">
            {own ? own.bare : words.bare}
          </Heading>
        </div>
      )}

      {flags}

      <div className="ah-stack">
        {/* The thank-you attached to the message: the amount on amber, what it is, and until when. */}
        <p className={clsx("ah-deal__money", !funded && "ah-deal__money--none")} data-plate={funded ? (reaches ? "reaches" : "reward") : "none"}>
          {funded ? (
            <span className="ah-deal__sum">
              {figures ? (
                <button type="button" className="ah-figure ah-marker" aria-expanded={showReward} aria-controls={showReward ? rewardId : undefined} onClick={() => setRewardOpen(!showReward)}>
                  {amount}
                </button>
              ) : (
                <span className="ah-marker">{reaches ? floorMoney : amount}</span>
              )}
            </span>
          ) : null}
          {funded ? " " : null}
          <span className="ah-deal__terms">
            {/* While the hand is open the amount stands under its condition (a condition, not a
                promise of thanks); a hand that is over, or read under the lens where the row below
                says the condition, calls it the reward. */}
            <span className="ah-deal__what">{funded ? (brief && state === "open" ? ifHelp : words.rewardWord) : words.noReward}</span>
            {/* Both amounts: on amber what reaches whoever helps from here, beside it the whole
                reward it is part of and what was kept on the way. */}
            {reaches ? (
              <>
                <span className="sr-only"> · </span>
                <span className="ah-deal__of" data-testid={TID.kit.dealOfWhole}>
                  {words.ofWhole(amount, floorAmount(reward - floor!, decimals, lang))}
                </span>
              </>
            ) : null}
            {when ? (
              <>
                <span className="sr-only"> · </span>
                <span className="ah-deal__when">
                  {when[0]}
                  {figures ? (
                    <button type="button" className="ah-figure" aria-expanded={showExpiry} aria-controls={showExpiry ? expiryId : undefined} onClick={() => setExpiryOpen(!showExpiry)}>
                      {until}
                    </button>
                  ) : (
                    until
                  )}
                  {when[1]}
                </span>
              </>
            ) : null}
          </span>
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
          {funded && floor !== undefined && !brief ? (
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
          {/* With a reward, what passing on means is the pass screen's to say. With none, the card
              itself says that passing is free and there is no share to keep. */}
          {brief && funded ? null : (
            <div className="ah-deal__row">
              <dt>{own ? own.ifPass : words.ifPass}</dt>
              <dd>{funded ? (own ? own.keepShare : words.keepShare) : words.passFree}</dd>
            </div>
          )}
          {nobody}
        </dl>
      ) : null}

      {children}

      {foot}
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
  gesture,
  intro,
  label,
  onRaiser,
  plain = false,
  whole = false,
}: {
  /** The words stand as words, with no bubble around them (every card since 2026-11-22). */
  plain?: boolean;
  /** The words stand whole: nothing is clamped and there is no "Read all" (a picture has nothing to press). */
  whole?: boolean;
  title: string;
  content?: string;
  reading: { title: WordsReading; content?: WordsReading | undefined };
  titleId: string;
  heading: "h1" | "h2";
  /** The card's hand, standing beside the line over the words. */
  gesture: ReactNode;
  /** The line over the words: the holder's, or the asker's own on their screens. */
  intro: string;
  /** Whose words these are, and that nobody checked them; left out where the bubble says enough. */
  label: string | undefined;
  /** Opens the asker as a person; the line over the words is then a button. */
  onRaiser: (() => void) | undefined;
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
    if (open || whole) return;
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
  }, [open, whole, title, content]);
  const clamped = !open && !whole;

  return (
    <div className="ah-asker" id={wordsId} data-open={open ? "true" : "false"}>
      <p className="ah-deal__lead">
        {gesture}
        {onRaiser ? (
          <button type="button" className="ah-deal__intro ah-person-link" data-testid={TID.kit.dealRaiser} onClick={onRaiser}>
            {intro}
          </button>
        ) : (
          <span className="ah-deal__intro">{intro}</span>
        )}
      </p>
      {/* The asker's words are a message from a person: in the reader's own device font, under the line that says who asks. */}
      <div className={plain ? "ah-asker__words" : "ah-asker__bubble"}>
        <Heading id={titleId} ref={titleRef} className={clsx("ah-deal__title", clamped && "ah-clamp ah-clamp--title")}>
          <AskerText text={title} reading={titleRead} />
        </Heading>
        {content && contentRead ? (
          <p ref={contentRef} className={clsx("ah-deal__content", clamped && "ah-clamp ah-clamp--content")}>
            <AskerText text={content} reading={contentRead} block />
          </p>
        ) : null}
        {long || open ? (
          <button type="button" className="ah-asker__more" aria-expanded={open} aria-controls={wordsId} data-testid={TID.kit.dealReadAll} onClick={() => setOpen(!open)}>
            {open ? words.readLess : words.readAll}
          </button>
        ) : null}
      </div>
      {label ? (
        <p className="ah-asker__label" data-testid={TID.kit.dealWordsLabel}>
          {label}
        </p>
      ) : null}
    </div>
  );
}

/** The amounts the asker's words mention that are not the reward Core holds, each once. */
function amountsBesides(title: string, content: string | undefined, reward: bigint, decimals: number): MentionedAmount[] {
  const all: MentionedAmount[] = [...amountsIn(title, decimals), ...(content ? amountsIn(content, decimals) : [])];
  const seen = new Set<bigint>();
  return all.filter((found) => found.amount !== reward && !seen.has(found.amount) && seen.add(found.amount));
}

/** Amounts the words mention that are not the reward Core holds, said beside the words. */
function AmountFlag({ differing, reward, decimals }: { differing: MentionedAmount[]; reward: bigint; decimals: number }) {
  const lang = useLang();
  const words = useWords().deal;
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
 * still a floor), every digit below a cent, never "at least under $0.01".
 */
function floorAmount(floor: bigint, decimals: number, lang: Lang): string {
  return floor > 0n && floor * 100n < 10n ** BigInt(decimals) ? moneyExact(floor, decimals, lang) : money(floor, decimals, lang);
}
