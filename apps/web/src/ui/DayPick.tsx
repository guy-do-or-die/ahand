import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { clsx } from "../lib/clsx";
import type { Lang } from "./ambient";

/**
 * A month of days to pick one from, drawn in the app's own terms: a tone under it, the chosen day
 * on amber, days outside the allowed span quiet and not pressable. It is the same on every device
 * (a browser's own date picker is a different thing on each, and on a desktop a foreign one).
 *
 * Dates are plain "2027-04-01" strings and all the arithmetic is on the calendar itself, in UTC,
 * so nothing here reads a clock: the caller says which day is the first allowed, which the last,
 * and which is chosen (on /raise all three come from the chain's time).
 *
 * Keyboard: the arrows move by a day and by a week, across months, within the span; Home and End
 * go to the week's ends; Enter and Space pick; Escape closes it without picking (onClose). One day
 * at a time is in the tab order.
 */

const LOCALE: Record<Lang, string> = { en: "en-GB", ru: "ru-RU" };

/** The parts of "2027-04-01". */
export function partsOf(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return { year, month, day };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** "2027-04-01" from its parts; a day past the month's end rolls into the next month, as the calendar does. */
export function dateOf(year: number, month: number, day: number): string {
  const at = new Date(Date.UTC(year, month - 1, day));
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/** A date some days later (or earlier). */
export function addDays(date: string, days: number): string {
  const { year, month, day } = partsOf(date);
  return dateOf(year, month, day + days);
}

/**
 * A month as rows of seven, Monday first: each cell a date of that month or undefined where the
 * month has not begun or has ended.
 */
export function monthRows(year: number, month: number): (string | undefined)[][] {
  const first = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | undefined)[] = [...Array<undefined>(first).fill(undefined), ...Array.from({ length }, (_, index) => dateOf(year, month, index + 1))];
  while (cells.length % 7 !== 0) cells.push(undefined);
  return Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
}

const within = (date: string, min: string, max: string) => date >= min && date <= max;
const clamp = (date: string, min: string, max: string) => (date < min ? min : date > max ? max : date);

export function DayPick({
  value,
  min,
  max,
  lang,
  label,
  earlier,
  later,
  onPick,
  onClose,
  testId,
}: {
  /** The chosen day. */
  value: string;
  /** The first and the last day that can be chosen. */
  min: string;
  max: string;
  lang: Lang;
  /** What is being picked, for a screen reader ("The last day it stays open"). */
  label: string;
  /** The names of the two steps between months. */
  earlier: string;
  later: string;
  onPick: (date: string) => void;
  /** Escape inside the calendar: the caller closes it and puts the keyboard back where it opened it. */
  onClose?: () => void;
  testId?: string;
}) {
  const chosen = clamp(value, min, max);
  const [shown, setShown] = useState(() => ({ year: partsOf(chosen).year, month: partsOf(chosen).month }));
  // The day the keyboard is on; it is the one day in the tab order.
  const [at, setAt] = useState(chosen);
  const grid = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${at}"]`)?.focus();
  }, [at, shown]);

  // The month's own name and the year, with nothing a locale adds between or after them (in Russian: no abbreviated word for "year" after the number).
  const title = `${new Intl.DateTimeFormat(LOCALE[lang], { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(shown.year, shown.month - 1, 1)))} ${shown.year}`;
  // 1 January 2024 was a Monday.
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(LOCALE[lang], { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + index))));
  const whole = (date: string) => new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(partsOf(date).year, partsOf(date).month - 1, partsOf(date).day)));
  const firstOfShown = dateOf(shown.year, shown.month, 1);
  const lastOfShown = dateOf(shown.year, shown.month + 1, 0);
  const step = (by: number) => {
    const to = partsOf(dateOf(shown.year, shown.month + by, 1));
    setShown({ year: to.year, month: to.month });
    // the keyboard's day follows the month, kept inside the span
    setAt((was) => clamp(dateOf(to.year, to.month, Math.min(partsOf(was).day, partsOf(dateOf(to.year, to.month + 1, 0)).day)), min, max));
  };
  const go = (to: string) => {
    const next = clamp(to, min, max);
    moved.current = true;
    setAt(next);
    setShown({ year: partsOf(next).year, month: partsOf(next).month });
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const weekday = (new Date(Date.UTC(partsOf(at).year, partsOf(at).month - 1, partsOf(at).day)).getUTCDay() + 6) % 7;
    const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    go(addDays(at, by));
  };
  // The day in the tab order: the keyboard's, when it is in the month on screen; else the first that can be picked there.
  const reach = within(at, firstOfShown, lastOfShown) ? at : clamp(firstOfShown, min, max);

  return (
    <div
      className="ah-cal"
      role="group"
      aria-label={label}
      data-testid={testId}
      data-min={min}
      data-max={max}
      data-value={chosen}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !onClose) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="ah-cal__head">
        <button type="button" className="ah-cal__step" aria-label={earlier} disabled={firstOfShown <= min} data-step="earlier" onClick={() => step(-1)}>
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 3.5L5.5 8l4.5 4.5" />
          </svg>
        </button>
        <span className="ah-cal__month" aria-live="polite">
          {title}
        </span>
        <button type="button" className="ah-cal__step" aria-label={later} disabled={lastOfShown >= max} data-step="later" onClick={() => step(1)}>
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 3.5L10.5 8 6 12.5" />
          </svg>
        </button>
      </div>
      <div className="ah-cal__week" aria-hidden="true">
        {weekdays.map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      <div className="ah-cal__grid" ref={grid} onKeyDown={keys}>
        {monthRows(shown.year, shown.month)
          .flat()
          .map((date, index) =>
            date ? (
              <button
                key={date}
                type="button"
                className={clsx("ah-cal__day", date === chosen && "ah-cal__day--on")}
                data-date={date}
                aria-label={whole(date)}
                aria-pressed={date === chosen}
                disabled={!within(date, min, max)}
                tabIndex={date === reach ? 0 : -1}
                onClick={() => {
                  setAt(date);
                  onPick(date);
                }}
              >
                {partsOf(date).day}
              </button>
            ) : (
              <span key={`blank-${index}`} />
            ),
          )}
      </div>
    </div>
  );
}
