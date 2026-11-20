import { handHash, readHand, type Hand, type SignedGive, type SignedShake } from "@ahand/sdk";
import type { Address } from "viem";

import { clsx } from "../lib/clsx";
import { Flip, useTwistWords } from "./Flip";
import { count, money, percent, shortAddress } from "./format";
import { GiveBack } from "./GiveBack";
import { coreAnswer, Exact, Fact, ProofBody, ShakeBack, useProof } from "./ShakeBack";
import { useLang } from "./ambient";
import { useWords } from "./words";
import { TID } from "../testids";

/** One hand on the route. Labels are positions and facts, never relationships (UX-SPEC §8.2). */
export interface RailHand {
  role: "asker" | "passer" | "helper";
  /** Shown short and in mono. Leave it out where no address was named: the rail says "someone". */
  address?: Address;
  /** A name the caller has proved for the address (an ENS name that resolves both ways). */
  name?: string;
}

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
  const expected = 1 + route.signedShakes.length + (route.signedGive ? 1 : 0);
  if (hands.length !== expected || hands[0]?.role !== "asker") return false;
  return hands.every((hand, index) => (index === 0 ? hand.role === "asker" : index <= route.signedShakes.length ? hand.role === "passer" : hand.role === "helper"));
}

/**
 * The route as people: hands joined by 2px lines. The segment that reached the viewer is
 * amber, the viewer is an amber chip, and a dashed slot after it stands for whoever is next.
 * A long route scrolls sideways; the list can be focused so the keyboard can scroll it.
 * Given the signed route, each hand is a flip card: the asker's back holds the Hand's terms,
 * a pass's back its Shake, the helper's back its Give, each checked when it turns.
 */
export function ChainRail({ hands, route, you = true, next = you, caption = true, className }: ChainRailProps) {
  const words = useWords();
  const twist = useTwistWords();
  const soFar = words.rail.count(hands.length);
  const flips = routeFits(hands, route);
  return (
    <div className={clsx("ah-stack", className)} data-flippable={flips ? "true" : undefined}>
      <ol className={clsx("ah-rail", flips && "ah-rail--flips")} tabIndex={0} aria-label={soFar}>
        {hands.map((hand, index) => {
          const face = (
            <span className="ah-rail__hand">
              <span aria-hidden="true" className="ah-rail__gesture">
                {GESTURE[hand.role]}
              </span>
              <span className="sr-only">{words.rail[hand.role]}: </span>
              {hand.name ? (
                <span className="ah-rail__name ah-rail__name--human">{hand.name}</span>
              ) : hand.address ? (
                <span className="ah-rail__name ah-exact">{shortAddress(hand.address)}</span>
              ) : (
                <span className="ah-rail__name ah-rail__name--human">{words.rail.someone}</span>
              )}
            </span>
          );
          return (
            <li key={index} className="ah-rail__item" data-role={hand.role}>
              {index > 0 ? <span aria-hidden="true" className="ah-rail__line" /> : null}
              {flips ? (
                <Flip
                  variant="rail"
                  front={face}
                  backLabel={hand.role === "asker" ? twist.backOfAsker : hand.role === "helper" ? twist.backOfGive : twist.backOfPass}
                  back={() =>
                    hand.role === "asker" ? <TermsBack route={route} /> : hand.role === "helper" ? <GiveBack route={route} /> : <ShakeBack route={route} position={index - 1} />
                  }
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
        <Fact core label="handId" testId={TID.twist.hand} value={hand.handId.toString()}>
          {count(hand.handId)}
        </Fact>
        <Fact core label="raiser">
          <Exact>{hand.raiser}</Exact>
        </Fact>
        <Fact core label="token">
          <Exact>{hand.token}</Exact>
        </Fact>
        <Fact core label="rootKey">
          <Exact>{hand.rootKey}</Exact>
        </Fact>
        <Fact core label="payoutGasK">{count(hand.payoutGasK)}</Fact>
        <Fact core label="minClaimBps">
          {count(hand.minClaimBps)} · {percent(hand.minClaimBps, lang)}
        </Fact>
        <Fact core label="dataHash">
          <Exact>{hand.dataHash}</Exact>
        </Fact>
        <Fact core label="handHash">
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
