import { handHash, readHand, type Hand, type SignedGive, type SignedShake } from "@ahand/sdk";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Address } from "viem";

import { clsx } from "../lib/clsx";
import type { RailHand } from "./rail";
import { Flip, useReducedMotion, useTwistWords } from "./Flip";
import { count, money, percent, shortAddress } from "./format";
import { GiveBack } from "./GiveBack";
import { coreAnswer, Exact, Fact, ProofBody, ShakeBack, useProof } from "./ShakeBack";
import { useLang } from "./ambient";
import { useWords } from "./words";
import { TID } from "../testids";

/**
 * The signed route behind the hands, for the back of each card. When it is given and its
 * length matches the hands (the asker, one per Shake, and the helper when a Give ends it),
 * every hand turns over (UX-SPEC §3).
 */
export interface RailRoute {
  chainId: number;
  core: Address;
  hand: Hand;
  signedShakes: SignedShake[];
  signedGive?: SignedGive;
  /** The reward now and the token's decimals, for a share written as money. */
  reward?: bigint;
  decimals?: number;
}

export interface ChainRailProps {
  /** Oldest first: the asker, then each hand so far. */
  hands: RailHand[];
  route?: RailRoute;
  /** The amber chip for the viewer after the last hand. */
  you?: boolean;
  /** The dashed empty slot after the viewer: "the next person?". */
  next?: boolean;
  /** The line under the rail: "3 hands so far." */
  caption?: boolean;
  className?: string;
}

const GESTURE = { asker: "✋", passer: "🤝", helper: "🙌" } as const;

/** Whether the route stands behind exactly these hands, so each card can turn to its own part. */
export function routeFits(hands: readonly RailHand[], route: RailRoute | undefined): route is RailRoute {
  if (!route) return false;
  const signed = hands.filter((hand) => !hand.dropped);
  const expected = 1 + route.signedShakes.length + (route.signedGive ? 1 : 0);
  if (signed.length !== expected || signed[0]?.role !== "asker") return false;
  return signed.every((hand, index) => (index === 0 ? hand.role === "asker" : index <= route.signedShakes.length ? hand.role === "passer" : hand.role === "helper"));
}

/** Each hand's place on the signed route (the asker 0, Shake i at i + 1), or undefined for a dropped one. */
function placesOf(hands: readonly RailHand[]): (number | undefined)[] {
  let place = 0;
  return hands.map((hand) => (hand.dropped ? undefined : place++));
}

/** Room kept between the viewer's chip and the rail's edge when the rail scrolls to it, in CSS pixels. */
const EDGE = 8;

/**
 * Scrolls the rail sideways, and nothing but the rail, until the viewer's chip shows, with the
 * empty slot after it where both fit.
 */
function showYou(list: HTMLElement, smooth: boolean): void {
  const you = list.querySelector(".ah-rail__you");
  if (!you) return;
  const frame = list.getBoundingClientRect();
  const end = (list.querySelector(".ah-rail__slot") ?? you).getBoundingClientRect();
  // Far enough to show the end of the rail, but never so far that the chip's own start is cut.
  const by = Math.min(Math.max(end.right + EDGE - frame.right, 0), you.getBoundingClientRect().left - EDGE - frame.left);
  if (Math.abs(by) >= 1) list.scrollBy?.({ left: by, behavior: smooth ? "smooth" : "auto" });
}

/**
 * The route as people: hands joined by 2px lines. The segment that reached the viewer is
 * amber, the viewer is an amber chip, and a dashed slot after it stands for whoever is next.
 * A long route scrolls sideways; the list can be focused so the keyboard can scroll it.
 * Given the signed route, each hand turns over: the asker's back holds the Hand's terms, a
 * pass's back its Shake, the helper's back its Give, each checked when it turns. One hand is
 * turned at a time, and its back opens under the rail, so the rail itself never moves; when
 * the hand is turned back, the rail scrolls to the viewer's chip.
 */
export type { LeftOut, RailHand } from "./rail";

export function ChainRail({ hands, route, you = true, next = you, caption = true, className }: ChainRailProps) {
  const words = useWords();
  const twist = useTwistWords();
  const reduced = useReducedMotion();
  const soFar = words.rail.count(hands.filter((hand) => !hand.dropped).length);
  const flips = routeFits(hands, route);
  const places = placesOf(hands);
  const list = useRef<HTMLOListElement>(null);
  /** The hand now turned over, by its place on the rail. */
  const [turned, setTurned] = useState<number | undefined>(undefined);
  const wasTurned = useRef(false);
  useEffect(() => {
    if (turned === undefined && wasTurned.current && list.current) showYou(list.current, !reduced);
    wasTurned.current = turned !== undefined;
    // Only a turn runs this.
  }, [turned]);
  // The lines between the rail's parts: twist.css lays the rail out as that many joined columns.
  const links = hands.length - 1 + (you ? 1 : 0) + (next ? 1 : 0);
  return (
    <div className={clsx("ah-stack", flips && "ah-railbox", className)} data-flippable={flips ? "true" : undefined}>
      <ol
        ref={list}
        className={clsx("ah-rail", flips && "ah-rail--flips")}
        style={flips ? ({ "--ah-rail-links": links } as CSSProperties) : undefined}
        tabIndex={0}
        aria-label={soFar}
      >
        {hands.map((hand, index) => {
          const named = hand.name ? (
            <span className="ah-rail__name ah-rail__name--human">{hand.name}</span>
          ) : hand.address ? (
            <span className="ah-rail__name ah-exact">{shortAddress(hand.address)}</span>
          ) : (
            <span className="ah-rail__name ah-rail__name--human">{words.rail.someone}</span>
          );
          const face = (
            <span className="ah-rail__hand">
              <span aria-hidden="true" className="ah-rail__gesture">
                {GESTURE[hand.role]}
              </span>
              <span className="sr-only">{words.rail[hand.role]}: </span>
              {hand.dropped ? <s className="ah-rail__dropped">{named}</s> : named}
              {hand.dropped ? (
                <>
                  {hand.dropped.share ? <s className="ah-rail__share">{hand.dropped.share}</s> : null}
                  <span className="sr-only">, {words.rail.dropped}</span>
                </>
              ) : null}
              {hand.flag === "asker" ? (
                <span className="ah-rail__flag" data-testid={TID.kit.railFlag}>
                  {words.rail.askerOwn}
                </span>
              ) : null}
            </span>
          );
          const place = places[index];
          const flag = hand.flag === "asker" ? <p className="ah-back__flag">{words.rail.askerOwnWhy}</p> : null;
          return (
            <li key={index} className="ah-rail__item" data-role={hand.role} data-dropped={hand.dropped ? "true" : undefined} data-flag={hand.flag}>
              {index > 0 ? <span aria-hidden="true" className={clsx("ah-rail__line", hand.dropped && "ah-rail__line--dropped")} /> : null}
              {flips && place !== undefined ? (
                <Flip
                  variant="rail"
                  flipped={turned === index}
                  onTurn={(up) => setTurned(up ? index : undefined)}
                  front={face}
                  backLabel={hand.role === "asker" ? twist.backOfAsker : hand.role === "helper" ? twist.backOfGive : twist.backOfPass}
                  back={() => (
                    <>
                      {flag}
                      {hand.role === "asker" ? <TermsBack route={route} /> : hand.role === "helper" ? <GiveBack route={route} /> : <ShakeBack route={route} position={place - 1} />}
                    </>
                  )}
                />
              ) : (
                face
              )}
            </li>
          );
        })}
        {you ? (
          <li className="ah-rail__item">
            <span aria-hidden="true" className="ah-rail__line ah-rail__line--reaching" />
            <span className="ah-rail__you">{words.rail.you}</span>
          </li>
        ) : null}
        {next ? (
          <li className="ah-rail__item">
            <span aria-hidden="true" className="ah-rail__line ah-rail__line--next" />
            <span className="ah-rail__slot">
              <span className="sr-only">{words.rail.next}</span>
            </span>
          </li>
        ) : null}
      </ol>
      {caption ? <p className="ah-label">{soFar}</p> : null}
    </div>
  );
}

/**
 * The asker's back: the Hand's terms, which every Shake and the Give carry inside what they
 * seal (EIP-712 `Hand`), and Core's `hands(id)` read at a named block to show the same terms.
 */
function TermsBack({ route }: { route: RailRoute }) {
  const twist = useTwistWords();
  const lang = useLang();
  const { hand } = route;
  const proof = useProof(
    `terms:${route.chainId}:${route.core}:${hand.handId}:${hand.rootKey}`,
    async (client) => {
      let same: boolean | undefined;
      const answer = await coreAnswer(client, "hands(id)", async (pinned) => {
        const read = await readHand(pinned, route.core, hand.handId);
        same =
          read.hand.raiser.toLowerCase() === hand.raiser.toLowerCase() &&
          read.hand.token.toLowerCase() === hand.token.toLowerCase() &&
          read.hand.rootKey.toLowerCase() === hand.rootKey.toLowerCase() &&
          read.hand.payoutGasK === hand.payoutGasK &&
          read.hand.minClaimBps === hand.minClaimBps &&
          read.hand.dataHash.toLowerCase() === hand.dataHash.toLowerCase();
        return undefined;
      });
      const after =
        same === undefined ? undefined : (
          <p className="ah-back__verdict" data-testid={TID.twist.match} data-status={same ? "match" : "differ"}>
            <span aria-hidden="true">{same ? "✓ " : "✗ "}</span>
            {same ? twist.termsMatch : twist.termsDiffer}
          </p>
        );
      return { steps: [], answer, after };
    },
    route.chainId,
  );
  return (
    <div className="ah-back" lang={lang}>
      <p className="ah-back__label">{twist.terms}</p>
      <dl className="ah-back__facts">
        <Fact label="handId" testId={TID.twist.hand} value={hand.handId.toString()}>
          {count(hand.handId)}
        </Fact>
        <Fact label="raiser">
          <Exact>{hand.raiser}</Exact>
        </Fact>
        <Fact label="token">
          <Exact>{hand.token}</Exact>
        </Fact>
        <Fact label="rootKey">
          <Exact>{hand.rootKey}</Exact>
        </Fact>
        <Fact label="payoutGasK">{count(hand.payoutGasK)}</Fact>
        <Fact label="minClaimBps">
          {count(hand.minClaimBps)} · {percent(hand.minClaimBps, lang)}
        </Fact>
        <Fact label="dataHash">
          <Exact>{hand.dataHash}</Exact>
        </Fact>
        <Fact label="handHash">
          <Exact>{handHash(hand)}</Exact>
        </Fact>
        <Fact label={twist.rewardNow}>
          {route.reward === undefined || route.decimals === undefined ? "—" : route.reward === 0n ? twist.noReward : money(route.reward, route.decimals, lang, { cents: true })}
        </Fact>
      </dl>
      <ProofBody proof={proof} sentence={() => ""} checks={false} />
    </div>
  );
}
