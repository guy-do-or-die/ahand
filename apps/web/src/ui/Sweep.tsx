import { useEffect, useState } from "react";

import { clsx } from "../lib/clsx";
import { useReducedMotion } from "./Flip";
import { TID } from "../testids";

/**
 * The marker sweep. When a thank lands, the amber marker of the brand's
 * covers sweeps the receipt row by row, in the order of Core's events, as a stroke along the
 * foot of each row that stays there; the last row it reaches is the helper's, whose chip it stops under
 * while 🙏 bows. A row is swept only after its own flag says its log was read, and never before
 * the row above it: the animation replays the evidence, it does not run ahead of it. With less
 * motion every row whose turn has come shows its finished state at once.
 *
 * Amber is only ever a fill here and never lies behind words (in the dark theme they are
 * paper-coloured); no shadow.
 */

/** One row's sweep; twist.css keeps the same length in its animation. */
export const SWEEP_MS = 420;

export type SweepState = "idle" | "sweeping" | "done";

/** The marker band behind one row. Decorative: the row's words and the table's flags carry the meaning. */
export function Sweep({ state }: { state: SweepState }) {
  return <span aria-hidden="true" className={clsx("ah-sweep", `ah-sweep--${state}`)} data-testid={TID.twist.sweep} data-state={state} />;
}

/**
 * Which rows are swept, from one flag per row (true once that row's log was read). Rows are
 * swept strictly in order, one at a time, each only once its flag is true. Returns undefined
 * when there are no flags: then nothing is drawn.
 */
export function useSweep(flags: readonly boolean[] | undefined): SweepState[] | undefined {
  const reduced = useReducedMotion();
  const [done, setDone] = useState(0);
  const [active, setActive] = useState<number | undefined>(undefined);
  const total = flags?.length ?? 0;
  const ready = flags ? leadingTrue(flags) : 0;

  // Flags only ever turn true; if a new receipt arrives with fewer read rows, start over.
  useEffect(() => {
    if (done > ready) {
      setDone(ready);
      setActive(undefined);
    }
  }, [done, ready]);

  useEffect(() => {
    if (!flags || reduced || active !== undefined || done >= ready) return;
    setActive(done);
  }, [flags, reduced, active, done, ready]);

  useEffect(() => {
    if (active === undefined) return;
    const timer = setTimeout(() => {
      setDone(active + 1);
      setActive(undefined);
    }, SWEEP_MS);
    return () => clearTimeout(timer);
  }, [active]);

  if (!flags) return undefined;
  const swept = reduced ? ready : done;
  return Array.from({ length: total }, (_, index): SweepState =>
    index < swept ? "done" : !reduced && index === active ? "sweeping" : "idle",
  );
}

/** How many flags from the first are true: the rows whose turn has come. */
export function leadingTrue(flags: readonly boolean[]): number {
  const first = flags.findIndex((flag) => !flag);
  return first < 0 ? flags.length : first;
}
