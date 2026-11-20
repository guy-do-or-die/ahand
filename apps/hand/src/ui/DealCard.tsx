import { useId, useState, type ReactNode } from "react";
import type { Address } from "viem";

import { clsx } from "../lib/clsx";
import { Ambient, useLang, useLens, type Lang } from "./ambient";
import { count, day, inBothZones, minute, money, percent, unitsText } from "./format";
import { Identity } from "./Identity";
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
  /** The raiser's address. Left out (the raise screen's preview, before any account) the "Asked by" row is not drawn. */
  raiser?: Address;
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
 */
export function DealCard(props: DealCardProps) {
  if (props.lang === undefined) return <Card {...props} />;
  return (
    <Ambient lang={props.lang}>
      <Card {...props} />
    </Ambient>
  );
}

function Card({ state, description, reward, decimals, expiry, closedAt, claimBps, viewer = "holder", raiser, raiserName, handId, block, timeZone, heading = "h2", children, className }: DealCardProps) {
  const lang = useLang();
  const lens = useLens();
  const words = useWords().deal;
  const asker = viewer === "asker" ? words.asker : undefined;
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

  const funded = reward > 0n;
  const until = day(expiry, lang, timeZone);
  const closedOn = closedAt ? day(closedAt, lang, timeZone) : until;
  const floor = claimBps !== undefined ? (reward * BigInt(claimBps)) / 10_000n : undefined;
  // Only a Hand with a number was read from the chain; a preview has no source to open.
  const onChain = handId !== undefined;
  const showReward = onChain && (lens || rewardOpen);
  const showExpiry = onChain && (lens || expiryOpen);
  // A closed Hand whose closing second did not come along says the day and opens nothing.
  const closedSource = onChain && closedAt ? closedAt : undefined;
  const showClosed = closedSource !== undefined && (lens || closedOpen);
  const showFloor = lens || floorOpen;

  const when = state === "open" ? around(words.openUntil) : state === undefined ? around(words.until) : state === "expired" ? around(words.wasOpenUntil) : undefined;
  const closedSentence = state === "thanked" ? around(words.thanked) : state === "refunded" ? around(funded ? words.refunded : words.closed) : undefined;
  const blockLine = block ? `${words.block} ${count(block.number)}` : undefined;
  const amount = money(reward, decimals, lang);
  const floorText = floor === undefined ? "" : asker ? asker.floor(money(floor, decimals, lang), percent(claimBps ?? 0, lang)) : words.atLeast(money(floor, decimals, lang));
  const ifHelp = asker ? asker.ifHelp : words.ifHelp;

  return (
    <article className={clsx("ah-deal", className)} aria-labelledby={titleId} data-state={state ?? "unknown"} data-funded={funded} data-viewer={viewer}>
      <div className="ah-deal__head">
        <span aria-hidden="true" className="ah-deal__gesture">
          ✋
        </span>
        <div className="min-w-0 flex-1">
          {description.status === "attached" ? (
            <>
              <p className="ah-deal__intro">{asker ? asker.intro : words.intro}</p>
              <Heading id={titleId} className="ah-deal__title">
                {description.title}
              </Heading>
              {description.content ? <p className="ah-deal__content">{description.content}</p> : null}
            </>
          ) : (
            <Heading id={titleId} className="ah-deal__title">
              {asker ? asker.bare : words.bare}
            </Heading>
          )}
        </div>
      </div>

      {description.status === "lost" ? <p className="ah-note">{words.lost}</p> : null}

      <div className="ah-stack">
        <p className="ah-deal__money">
          {funded ? (
            <>
              {words.reward[0]}
              {onChain ? (
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
              {onChain ? (
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
          <p className="ah-label">{funded ? (asker ? asker.sendBack : words.sendBack) : words.closeNow}</p>
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
      {state === undefined ? <p className="ah-note">{words.noClock}</p> : null}

      {state === "open" ? (
        <dl className="ah-deal__rows">
          {funded && floor !== undefined ? (
            <div className="ah-deal__row">
              <dt>{ifHelp}</dt>
              <dd data-open={showFloor}>
                <button type="button" className="ah-figure" aria-expanded={showFloor} aria-controls={showFloor ? floorId : undefined} onClick={() => setFloorOpen(!showFloor)}>
                  {floorText}
                </button>
                {showFloor ? (
                  <div id={floorId} className="ah-evidence">
                    <span className="ah-label">{asker ? asker.floorWhy : words.floorWhy}</span>
                    <span className="ah-meta ah-meta--exact">reward × claimBps / 10 000</span>
                    <span className="ah-meta ah-meta--exact">
                      {unitsText(reward, decimals)} × {claimBps} / 10 000 = {unitsText(floor, decimals)}
                    </span>
                    <Mark kind="checked" />
                  </div>
                ) : null}
              </dd>
            </div>
          ) : null}
          <div className="ah-deal__row">
            <dt>{asker ? asker.ifPass : words.ifPass}</dt>
            <dd>{funded ? (asker ? asker.keepShare : words.keepShare) : words.passFree}</dd>
          </div>
          <div className="ah-deal__row">
            <dt>{asker ? asker.ifNobody(until) : words.ifNobody(until)}</dt>
            <dd>{funded ? (asker ? asker.goesBack : words.goesBack) : words.closes}</dd>
          </div>
        </dl>
      ) : null}

      {children}

      {raiser ? (
        <div className="ah-deal__foot">
          <span className="ah-label">{asker ? asker.askedBy : words.askedBy}</span>
          <Identity address={raiser} name={raiserName} />
        </div>
      ) : null}
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
