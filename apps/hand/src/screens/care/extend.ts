import { EXPIRY_MARGIN, expiryAfter } from "@ahand/sdk";

/**
 * "Keep it open longer" (UX-SPEC §7.4, D-30, D-61), free of React and of the network so it is
 * tested offline (care.test.ts). Every "now" here is a block's timestamp, handed in by the caller
 * from `useNow`; nothing reads the device's clock.
 *
 *   +30, +90   count from the Hand's current end
 *   max        "up to 180 days from today": the network's time plus Core's cap
 *
 * Each target goes through the SDK's `expiryAfter`, so none is ever above the network's time plus
 * Core's `MAX_EXPIRY_PERIOD` less the ten-minute margin. A chip whose target would not move the
 * end later is switched off; so is one that would move it by less than a minute, which at the cap
 * is only the network's clock ticking on, never a choice worth a send.
 */

export const DAY = 86_400;

/** The least a chip must move the end to be offered, in seconds. */
export const MIN_MOVE = 60;

/** Under this much network time before the end, the screen shows the app's own warning (D-30). */
export const LAST_MINUTES = 10 * 60;

export type ChipKey = "30" | "90" | "max";

export interface ExtendChoice {
  key: ChipKey;
  /** The new end, in seconds; 0 when the Hand is no longer open. */
  target: number;
  /** True when the target is at least MIN_MOVE later than the current end: only then can the chip be chosen. */
  moves: boolean;
  /** True for +30 and +90 when the cap cut them short. */
  capped: boolean;
}

/**
 * The three chips at `now` for a Hand ending at `end`, with Core's cap `cap` (seconds). A Hand
 * whose end has come (`now >= end`, Core's own test) gets three chips that do not move: `extend`
 * is refused from that second on.
 */
export function extendChoices(now: number, end: number, cap: number, margin = EXPIRY_MARGIN): ExtendChoice[] {
  const open = now < end;
  const fromEnd = (key: ChipKey, days: number): ExtendChoice => {
    if (!open) return { key, target: 0, moves: false, capped: false };
    const wanted = end + days * DAY;
    const target = expiryAfter(now, wanted - now, cap, margin);
    return { key, target, moves: target >= end + MIN_MOVE, capped: target < wanted };
  };
  const max: ExtendChoice = open ? (() => {
    const target = expiryAfter(now, cap, cap, margin);
    return { key: "max" as const, target, moves: target >= end + MIN_MOVE, capped: false };
  })() : { key: "max", target: 0, moves: false, capped: false };
  return [fromEnd("30", 30), fromEnd("90", 90), max];
}

/** True while the Hand is open and less than ten minutes of network time are left. */
export function inLastMinutes(now: number, end: number): boolean {
  return now < end && end - now < LAST_MINUTES;
}

/** Whole days in Core's cap, for the chip's words ("up to 180 days from today"). */
export function capDays(cap: number): number {
  return Math.floor(cap / DAY);
}
