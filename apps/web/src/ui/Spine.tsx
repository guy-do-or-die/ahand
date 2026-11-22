import { useId, useState } from "react";

import { TID } from "../testids";
import { GestureEmoji } from "./Gesture";
import type { RailHand } from "./rail";
import { useWords } from "./words";

/** How many passes the opened line lists, counted back from the viewer; a longer route says how many came before. */
const NEAREST = 40;

/**
 * Those who passed a hand on, as one row of the receiver's screen (the Deal card drawn as the
 * route's spine: who asked, who passed it on, you). Folded, the row is one line whatever their
 * number: Core accepts a route of hundreds of passes, and a count with what they kept together
 * says what a person needs before acting. So the reward at the asker, less this, is the amount at
 * the viewer's place.
 *
 * Opened, the line goes on down the spine as one small row for each pass, in the route's order:
 * who (a proved name, or "someone"; where the pass named an address, the word opens that person)
 * and what that pass kept. A pass names where its share lands and nothing more, so a row is never
 * a claim about who held the link. A very long route lists the passes nearest to the viewer and
 * counts the earlier ones.
 *
 * A pass that named the asker's own address is said without opening anything (the SDK's
 * `raiserHops`; the rail's flag under the lens).
 */
export function SpinePassers({
  hands,
  kept,
  shares,
  onPerson,
  fixed = false,
}: {
  /** In a picture of a card (DealCard.tsx `DealPicture`) the line says how many and does not open. */
  fixed?: boolean;
  hands: readonly RailHand[];
  /** What all of them kept together, written for the page; absent where nothing was kept. */
  kept?: string | undefined;
  /** What each kept, in the same order; absent for a pass that kept nothing. */
  shares?: readonly (string | undefined)[] | undefined;
  onPerson?: ((hand: RailHand) => void) | undefined;
}) {
  const words = useWords();
  const [open, setOpen] = useState(false);
  const id = useId();
  const flagged = hands.some((hand) => hand.flag === "asker");
  const from = Math.max(0, hands.length - NEAREST);
  return (
    <li className="ah-spine__row" data-role="passers">
      <span className="ah-spine__node">
        <GestureEmoji kind="shake" still className="ah-spine__gesture" />
      </span>
      <div className="ah-spine__body">
        {fixed ? (
          <p className="ah-spine__fold ah-spine__fold--fixed" data-testid={TID.kit.spineFold} data-value={hands.length}>
            {words.spine.passed(hands.length)}
          </p>
        ) : (
          <button type="button" className="ah-spine__fold" aria-expanded={open} aria-controls={open ? id : undefined} data-testid={TID.kit.spineFold} data-value={hands.length} onClick={() => setOpen(!open)}>
            {words.spine.passed(hands.length)}
          </button>
        )}
        {kept ? (
          <p className="ah-spine__quiet" data-testid={TID.kit.spineKept}>
            {words.spine.kept(kept, hands.length)}
          </p>
        ) : null}
        {flagged ? (
          <p className="ah-spine__quiet" data-role="passer" data-flag="asker">
            {words.spine.flagged}{" "}
            <span className="ah-rail__flag" data-testid={TID.kit.railFlag}>
              {words.rail.askerOwn}
            </span>
          </p>
        ) : null}
        {open ? (
          <ol id={id} className="ah-spine__passes">
            {from > 0 ? <li className="ah-spine__earlier">{words.spine.earlier(from)}</li> : null}
            {hands.slice(from).map((hand, offset) => {
              const index = from + offset;
              const who = hand.name ?? words.rail.someone;
              const share = shares?.[index];
              return (
                <li key={index} className="ah-spine__pass" data-testid={TID.kit.spinePass} data-index={index}>
                  {onPerson && hand.address ? (
                    <button type="button" className="ah-person-link ah-spine__who" data-testid={TID.kit.spinePerson} onClick={() => onPerson(hand)}>
                      {who}
                    </button>
                  ) : (
                    <span className="ah-spine__who">{who}</span>
                  )}
                  {share ? <span className="ah-spine__share">{words.spine.kept(share, 1)}</span> : null}
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </li>
  );
}
