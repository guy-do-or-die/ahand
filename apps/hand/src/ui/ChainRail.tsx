import type { Hand, SignedGive, SignedShake } from "@ahand/sdk";
import type { Address } from "viem";

import { clsx } from "../lib/clsx";
import { shortAddress } from "./format";
import { useWords } from "./words";

/** One hand on the route. Labels are positions and facts, never relationships (UX-SPEC §8.2). */
export interface RailHand {
  role: "asker" | "passer" | "helper";
  /** Shown short and in mono. Leave it out where no address was named: the rail says "someone". */
  address?: Address;
  /** A name the caller has proved for the address (an ENS name that resolves both ways). */
  name?: string;
}

/**
 * The signed route behind the hands, for the back of each card. Wave 5 turns every hand into
 * a flip card when this is given and runs the SDK's checks on it; until then the rail only
 * marks itself as able to turn.
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

/**
 * The route as people: hands joined by 2px lines. The segment that reached the viewer is
 * amber, the viewer is an amber chip, and a dashed slot after it stands for whoever is next.
 * A long route scrolls sideways; the list can be focused so the keyboard can scroll it.
 */
export function ChainRail({ hands, route, you = true, next = you, caption = true, className }: ChainRailProps) {
  const words = useWords();
  const count = words.rail.count(hands.length);
  return (
    <div className={clsx("ah-stack", className)} data-flippable={route ? "true" : undefined}>
      <ol className="ah-rail" tabIndex={0} aria-label={count}>
        {hands.map((hand, index) => (
          <li key={index} className="ah-rail__item">
            {index > 0 ? <span aria-hidden="true" className="ah-rail__line" /> : null}
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
          </li>
        ))}
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
      {caption ? <p className="ah-label">{count}</p> : null}
    </div>
  );
}
