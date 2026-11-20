import { useId, useState, type ReactNode } from "react";
import type { Address } from "viem";

import { clsx } from "../lib/clsx";
import { Ambient, useLang, useLens, type Lang } from "./ambient";
import { count, day, minute, money, unitsText } from "./format";
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
  raiser: Address;
  /** A name proved for the raiser's address (ENS both ways); the card still says "Someone". */
  raiserName?: string;
  /** For the evidence under the reward: `hands(12).reward`. */
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
 * thanked. Each figure opens to its source.
 */
export function DealCard(props: DealCardProps) {
  if (props.lang === undefined) return <Card {...props} />;
  return (
    <Ambient lang={props.lang}>
      <Card {...props} />
    </Ambient>
  );
}

function Card({ state, description, reward, decimals, expiry, closedAt, claimBps, raiser, raiserName, handId, block, timeZone, heading = "h2", children, className }: DealCardProps) {
  const lang = useLang();
  const lens = useLens();
  const words = useWords().deal;
  const titleId = useId();
  const rewardId = useId();
  const floorId = useId();
  const [rewardOpen, setRewardOpen] = useState(false);
  const [floorOpen, setFloorOpen] = useState(false);
  const Heading = heading;

  const funded = reward > 0n;
  const until = day(expiry, lang, timeZone);
  const closedOn = closedAt ? day(closedAt, lang, timeZone) : until;
  const floor = claimBps !== undefined ? (reward * BigInt(claimBps)) / 10_000n : undefined;
  const showReward = lens || rewardOpen;
  const showFloor = lens || floorOpen;

  const when = state === "open" ? words.openUntil(until) : state === undefined ? words.until(until) : state === "expired" ? words.wasOpenUntil(until) : undefined;
  const blockLine = block ? `${words.block} ${count(block.number)}` : undefined;

  return (
    <article className={clsx("ah-deal", className)} aria-labelledby={titleId} data-state={state ?? "unknown"} data-funded={funded}>
      <div className="ah-deal__head">
        <span aria-hidden="true" className="ah-deal__gesture">
          ✋
        </span>
        <div className="min-w-0 flex-1">
          {description.status === "attached" ? (
            <>
              <p className="ah-deal__intro">{words.intro}</p>
              <Heading id={titleId} className="ah-deal__title">
                {description.title}
              </Heading>
              {description.content ? <p className="ah-deal__content">{description.content}</p> : null}
            </>
          ) : (
            <Heading id={titleId} className="ah-deal__title">
              {words.bare}
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
              <button type="button" className="ah-figure ah-marker" aria-expanded={showReward} aria-controls={showReward ? rewardId : undefined} onClick={() => setRewardOpen(!showReward)}>
                {money(reward, decimals, lang)}
              </button>
              {words.reward[1]}
            </>
          ) : (
            words.noReward
          )}
          {when ? ` · ${when}` : null}
        </p>
        {funded && showReward ? (
          <div id={rewardId} className="ah-evidence">
            <span className="ah-meta ah-meta--exact">
              hands({handId !== undefined ? handId.toString() : "id"}).reward = {reward.toString()}
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
        {funded && floor !== undefined && state === "open" ? (
          <RewardBar progress={Number(claimBps) / 10_000} label={`${words.ifHelp}: ${words.atLeast(money(floor, decimals, lang))}`} />
        ) : null}
      </div>

      {state === "expired" ? (
        <div className="ah-stack">
          <p className="ah-deal__state">{words.timeUp}</p>
          <p className="ah-label">{funded ? words.sendBack : words.closeNow}</p>
        </div>
      ) : null}
      {state === "thanked" || state === "refunded" ? (
        <div className="ah-deal__foot">
          <p className="ah-deal__state">{state === "thanked" ? words.thanked(closedOn) : funded ? words.refunded(closedOn) : words.closed(closedOn)}</p>
          <Mark kind="chain" />
        </div>
      ) : null}
      {state === undefined ? <p className="ah-note">{words.noClock}</p> : null}

      {state === "open" ? (
        <dl className="ah-deal__rows">
          {funded && floor !== undefined ? (
            <div className="ah-deal__row">
              <dt>{words.ifHelp}</dt>
              <dd data-open={showFloor}>
                <button type="button" className="ah-figure" aria-expanded={showFloor} aria-controls={showFloor ? floorId : undefined} onClick={() => setFloorOpen(!showFloor)}>
                  {words.atLeast(money(floor, decimals, lang))}
                </button>
                {showFloor ? (
                  <div id={floorId} className="ah-evidence">
                    <span className="ah-label">{words.floorWhy}</span>
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
            <dt>{words.ifPass}</dt>
            <dd>{funded ? words.keepShare : words.passFree}</dd>
          </div>
          <div className="ah-deal__row">
            <dt>{words.ifNobody(until)}</dt>
            <dd>{funded ? words.goesBack : words.closes}</dd>
          </div>
        </dl>
      ) : null}

      {children}

      <div className="ah-deal__foot">
        <span className="ah-label">{words.askedBy}</span>
        <Identity address={raiser} name={raiserName} />
      </div>
      {lens && block ? (
        <p className="ah-meta">
          {words.networkTime} · {blockLine} · {minute(block.timestamp, lang, timeZone)}
        </p>
      ) : null}
    </article>
  );
}
