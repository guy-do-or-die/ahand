import { useEffect, useState, type FocusEvent, type PointerEvent } from "react";

import { t } from "../../i18n";
import { TID } from "../../testids";
import { DealPicture } from "../../ui";
import { DECIMALS, EXAMPLES, detailsKey, titleKey } from "./examples";

/** How long an example stands before the next one comes by itself: time to read it twice. */
export const STANDS_MS = 9_000;

/**
 * The examples, one at a time, in the place of one card. Each is the receiver's real card drawn
 * as a picture (ui/DealCard.tsx `DealPicture`), so the landing draws no beat of its own and cannot
 * part from the receiver's screen. All of them lie in the same cell and only the one in turn is
 * seen, so the place is as tall as the tallest at any width and in either language, and going to
 * another moves nothing on the page.
 *
 * The next one comes by itself after `STANDS_MS`, arriving the way a Hand does: down its route,
 * beat after beat (landing.css). It waits while the pointer is over the example or the focus is in
 * it, while the page is not seen, and for as long as the reader has paused it. Where the device
 * asks for less motion it still comes, by tone alone and with no move (the app's rule: the tone
 * stays, every move stops), so the pause is always there. What is about the picture and not in it stands
 * in the caption's line: what it is, the pause, and the quiet control that brings the next at once.
 * The receiver's two actions are not drawn: the page has one action, and there is no Hand here to
 * pass or to answer.
 */
export function Sample() {
  const [at, setAt] = useState(0);
  // Whether any example has come after the first: only then does one arrive beat by beat.
  const [moved, setMoved] = useState(false);
  // Whether the reader asked for this one: a screen reader is told of that, never of a change that came by itself.
  const [asked, setAsked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [near, setNear] = useState(false);
  const running = !paused && !near;
  const shown = EXAMPLES[at]!;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      // A page nobody sees keeps its example.
      if (document.hidden) return;
      setAt((now) => (now + 1) % EXAMPLES.length);
      setMoved(true);
      setAsked(false);
    }, STANDS_MS);
    return () => clearInterval(timer);
    // `at`: after any change the new example stands its whole time.
  }, [running, at]);

  const next = () => {
    setAt((at + 1) % EXAMPLES.length);
    setMoved(true);
    setAsked(true);
  };
  const leave = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setNear(false);
  };
  // A finger has no hover: only a mouse over the example holds it.
  const mouse = (over: boolean) => (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse") setNear(over);
  };

  return (
    <figure
      className="lp-sample"
      data-testid={TID.landing.sample}
      data-value={shown.id}
      data-moved={moved || undefined}
      data-running={running}
      onPointerEnter={mouse(true)}
      onPointerLeave={mouse(false)}
      onFocus={() => setNear(true)}
      onBlur={leave}
    >
      <figcaption className="lp-sample__head">
        <span className="ah-meta">{t("landing.sample.label")}</span>
        <span className="lp-sample__controls">
          <button type="button" className="lp-sample__pause" data-testid={TID.landing.samplePause} data-value={paused ? "paused" : "running"} aria-label={t(paused ? "landing.sample.play" : "landing.sample.pause")} onClick={() => setPaused(!paused)}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
              {paused ? <path d="M4 2.5v11l9-5.5z" /> : <path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" />}
            </svg>
          </button>
          <button type="button" className="lp-sample__next" data-testid={TID.landing.sampleNext} onClick={next}>
            {t("landing.sample.next")}
          </button>
        </span>
      </figcaption>
      <div className="lp-sample__stack">
        {EXAMPLES.map((example) => (
          <div key={example.id} className="lp-sample__one" data-testid={TID.landing.example} data-value={example.id} data-current={example === shown} aria-hidden={example === shown ? undefined : true}>
            <DealPicture title={t(titleKey(example))} content={example.details ? t(detailsKey(example)) : undefined} reward={example.reward} decimals={DECIMALS} shares={example.route} />
          </div>
        ))}
      </div>
      {/* Said to a screen reader when the reader asked for another example, never on arrival and never for one that came by itself. */}
      <p className="sr-only" role="status">
        {asked ? t(titleKey(shown)) : ""}
      </p>
    </figure>
  );
}
