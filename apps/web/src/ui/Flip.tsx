import { Fragment, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";

import enCommon from "../i18n/common/en";
import ruCommon from "../i18n/common/ru";
import { clsx } from "../lib/clsx";
import { useLang, type Lang } from "./ambient";
import { TID } from "../testids";
import { TWIST_WORDS, type TwistWords } from "./twist-words";

/**
 * The twist: every hand turns over. `Flip` is a two-sided card. Its front is
 * whatever it wraps, inside a real button with `aria-expanded`; its back follows that button in
 * the document, so a screen reader reads the proof as the next paragraph. A tap, Enter or Space
 * turns it in 360 ms of `rotateY`; under `prefers-reduced-motion` the sides swap with no motion.
 * Tapping the back turns it again.
 *
 * A receipt row ("row") turns as one card: the back takes the front's place. A hand on the rail
 * ("rail") turns where it stands and stays up, filled with ink, while its back opens as a sheet
 * under the whole rail, as wide as the rail, so no hand, the viewer's chip or the empty slot is
 * pushed off the screen (twist.css lays it out; the document order stays button, then back).
 *
 * The back is rendered only while it is shown (or turning), so what it checks is checked when
 * someone looks: "the checks this browser just ran".
 */

/** The turn takes this long; twist.css says the same in its transition. */
export const FLIP_MS = 360;

export interface FlipProps {
  /** The front: phrasing content only (it sits inside a button). */
  front: ReactNode;
  /** The back, built only while it is shown. */
  back: () => ReactNode;
  /** What the back is, for a screen reader: "what was checked". */
  backLabel: string;
  /** "rail": a hand on the ChainRail, its back a sheet under the rail; "row": a receipt row, turning as one card. */
  variant: "rail" | "row";
  className?: string;
  /**
   * Which side is up, when the caller holds it (the rail turns one hand at a time). Left out, the
   * card holds it itself.
   */
  flipped?: boolean;
  /** Called at each turn with the side that should now be up. */
  onTurn?: (flipped: boolean) => void;
}

const reduceQuery = "(prefers-reduced-motion: reduce)";

function subscribeMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const query = window.matchMedia(reduceQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Whether the reader asked for less motion; the twist then shows end states at once. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(reduceQuery).matches,
    () => false,
  );
}

/** Room kept between a turned card and the edge of the screen, in CSS pixels. */
const REVEAL_MARGIN = 12;

/** What a reader does to move the page themselves; after any of these the page is theirs. */
const READER_INPUTS = ["pointerdown", "wheel", "touchmove", "keydown"] as const;

/**
 * Brings a card that has just turned into view: all of its back when the front and the back fit
 * on the screen together; otherwise the front at the top, so the reader sees which hand the back
 * belongs to and reads on from its first line. `scrollIntoView` keeps clear of whatever the page
 * declares as covered (`scroll-padding` on the root), and the fit is judged by the same measure.
 */
function reveal(front: HTMLElement, back: HTMLElement, smooth: boolean): void {
  const behavior = smooth ? "smooth" : "auto";
  const root = getComputedStyle(document.documentElement);
  const covered = (parseFloat(root.scrollPaddingTop) || 0) + (parseFloat(root.scrollPaddingBottom) || 0);
  const span = back.getBoundingClientRect().bottom - front.getBoundingClientRect().top;
  if (span <= window.innerHeight - covered - 2 * REVEAL_MARGIN) back.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior });
  else front.scrollIntoView?.({ block: "start", inline: "nearest", behavior });
}

export function Flip({ front, back, backLabel, variant, className, flipped: held, onTurn }: FlipProps) {
  const words = useTwistWords();
  const reduced = useReducedMotion();
  const id = useId();
  const [own, setOwn] = useState(false);
  const flipped = held ?? own;
  // The back stays in the document while it turns away, and leaves once it faces away.
  const [lingers, setLingers] = useState(false);
  const mounted = flipped || lingers;
  const frontRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  // A card that arrives already turned stays where the page put it; only a turn moves the page.
  const arrived = useRef(false);

  useEffect(() => {
    const turned = arrived.current;
    arrived.current = true;
    if (flipped) {
      setLingers(true);
      const face = frontRef.current;
      const sheet = backRef.current;
      if (!turned || !face || !sheet) return;
      reveal(face, sheet, !reduced);
      // The back grows as its checks come in. Until the reader touches the page again, the
      // page keeps the grown back in view.
      if (typeof ResizeObserver === "undefined") return;
      let height = sheet.offsetHeight;
      const watch = new ResizeObserver(() => {
        if (sheet.offsetHeight > height) reveal(face, sheet, !reduced);
        height = sheet.offsetHeight;
      });
      watch.observe(sheet);
      const stop = () => watch.disconnect();
      for (const input of READER_INPUTS) window.addEventListener(input, stop, { capture: true, once: true, passive: true });
      return () => {
        stop();
        for (const input of READER_INPUTS) window.removeEventListener(input, stop, { capture: true });
      };
    }
    if (reduced) {
      setLingers(false);
      return;
    }
    const timer = setTimeout(() => setLingers(false), FLIP_MS);
    return () => clearTimeout(timer);
    // Only a turn runs this: a change of the motion setting moves nothing by itself.
  }, [flipped]);

  const turn = useCallback(() => {
    const next = !flipped;
    if (held === undefined) setOwn(next);
    onTurn?.(next);
  }, [flipped, held, onTurn]);

  // A tap anywhere on the back turns it again, unless it lands on something of its own to press.
  const onBack = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea, summary")) return;
    turn();
  };

  return (
    <div
      className={clsx("ah-flip", `ah-flip--${variant}`, flipped && "ah-flip--flipped", className)}
      data-testid={TID.twist.flip}
      data-flipped={String(flipped)}
    >
      <div className="ah-flip__card">
        <button
          ref={frontRef}
          type="button"
          className="ah-flip__face ah-flip__front"
          aria-expanded={flipped}
          aria-controls={id}
          onClick={turn}
          data-testid={TID.twist.front}
        >
          {front}
          <span className="sr-only"> · {flipped ? words.turnBack : words.turnOver}</span>
        </button>
        <div
          ref={backRef}
          id={id}
          role="group"
          aria-label={backLabel}
          className="ah-flip__face ah-flip__back"
          hidden={!mounted}
          onClick={onBack}
          data-testid={TID.twist.back}
        >
          {mounted ? back() : null}
          {mounted ? (
            <p aria-hidden="true" className="ah-flip__hint">
              {words.tapBack}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Reveals `total` items one by one once `ready`, `stepMs` apart: the checks ticking in Core's
 * order. With less motion, all at once. Returns how many are shown.
 */
export function useTicks(total: number, ready: boolean, stepMs = TICK_MS): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!ready) {
      setShown(0);
      return;
    }
    if (reduced) {
      setShown(total);
      return;
    }
    setShown(0);
    let at = 0;
    const id = setInterval(() => {
      at += 1;
      setShown(at);
      if (at >= total) clearInterval(id);
    }, stepMs);
    return () => clearInterval(id);
  }, [total, ready, reduced, stepMs]);
  return reduced && ready ? total : shown;
}

export const TICK_MS = 140;

// ── Words ──────────────────────────────────────────────────────────────────
//
// The twist's own words live in twist-words.ts, the kit's catalogue for them, beside ui/words.ts.

export { TWIST_WORDS, type TwistWords } from "./twist-words";

export function useTwistWords(): TwistWords {
  return TWIST_WORDS[useLang()];
}

/**
 * Core's own names inside a mono line: camelCase fields and functions (payoutGasK, minClaimBps,
 * checkRoute), hands(id), eth_call, and error names (InvalidClaim). The kit's mono voice sets
 * lines in capitals; these keep Core's spelling.
 */
const CORE_NAME = /(\b[a-z]+\(id\)|\beth_call\b|\b[a-z]+(?:[A-Z][a-z0-9]*)+\b|\b[A-Z][a-z]+(?:[A-Z][a-z0-9]*)+\b)/g;

/** A mono line whose Core names keep their own letters; the rest follows the line's style. */
export function CoreText({ text }: { text: string }) {
  const parts = text.split(CORE_NAME);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="ah-exact">
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Core's refusal sentence for an error name, from i18n/common, in the reader's language. */
export function refusalSentence(name: string, lang: Lang): string | undefined {
  const table = (lang === "ru" ? ruCommon : enCommon) as Record<string, string>;
  return table[`core.${name}`];
}
