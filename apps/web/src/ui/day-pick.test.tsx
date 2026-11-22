import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DayPick, addDays, dateOf, monthRows, partsOf } from "./DayPick";

/**
 * The app's own month of days (ui/DayPick.tsx): the calendar's arithmetic, done on the dates
 * themselves with no clock read, and what the month draws. The browser half (opening it, picking,
 * the keyboard) is tests/e2e/smoke/raise.spec.ts.
 */

const pick = (value: string, lang: "en" | "ru" = "en") =>
  renderToStaticMarkup(<DayPick value={value} min="2027-03-02" max="2027-08-28" lang={lang} label="The last day" earlier="Earlier month" later="Later month" onPick={() => undefined} testId="cal" />);

describe("a month of days", () => {
  test("dates are strings, and a day past a month's end rolls on as the calendar does", () => {
    expect(partsOf("2027-04-01")).toEqual({ year: 2027, month: 4, day: 1 });
    expect(dateOf(2027, 2, 29)).toBe("2027-03-01");
    expect(dateOf(2028, 2, 29)).toBe("2028-02-29");
    expect(dateOf(2027, 13, 1)).toBe("2028-01-01");
    expect(addDays("2027-03-31", 1)).toBe("2027-04-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(addDays("2027-12-28", 7)).toBe("2028-01-04");
  });

  test("a month is rows of seven, Monday first, blank where it has not begun or has ended", () => {
    // 1 April 2027 is a Thursday.
    const april = monthRows(2027, 4);
    expect(april.every((row) => row.length === 7)).toBe(true);
    expect(april[0]).toEqual([undefined, undefined, undefined, "2027-04-01", "2027-04-02", "2027-04-03", "2027-04-04"]);
    expect(april.flat().filter(Boolean).length).toBe(30);
    expect(april.flat().at(-1)).toBeUndefined();
    // February 2027 begins on a Monday and fills four rows exactly.
    expect(monthRows(2027, 2)).toHaveLength(4);
    expect(monthRows(2027, 2)[0]![0]).toBe("2027-02-01");
    expect(monthRows(2028, 2).flat().filter(Boolean).length).toBe(29);
  });

  test("it shows the chosen day's month, marks that day, and lets only the days of the span be pressed", () => {
    const html = pick("2027-04-01");
    expect(html).toContain("April 2027");
    expect(html).toMatch(/data-date="2027-04-01"[^>]*aria-label="1 April 2027"[^>]*aria-pressed="true"/);
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(html.match(/data-date="2027-04-/g)?.length).toBe(30);
    expect(html).not.toMatch(/data-date="2027-04-15"[^>]*disabled/);
    // One day is in the tab order: the chosen one.
    expect(html.match(/tabindex="0"/g)?.length).toBe(1);
    expect(html).toMatch(/data-date="2027-04-01"[^>]*tabindex="0"/);
    // The first month of the span: no step earlier, and its first day is not pressable.
    const first = pick("2027-03-05");
    expect(first).toMatch(/data-step="earlier"[^>]*disabled|disabled=""[^>]*data-step="earlier"/);
    expect(first).toMatch(/data-date="2027-03-01"[^>]*disabled/);
    expect(first).not.toMatch(/data-date="2027-03-02"[^>]*disabled/);
    // The last month: no step later, and the days after the last are not pressable.
    const last = pick("2027-08-28");
    expect(last).toMatch(/data-step="later"[^>]*disabled|disabled=""[^>]*data-step="later"/);
    expect(last).toMatch(/data-date="2027-08-29"[^>]*disabled/);
  });

  test("it speaks the page's language, weeks from Monday", () => {
    const ru = pick("2027-04-01", "ru");
    expect(ru).toMatch(/апрель 2027/i);
    expect(ru).toMatch(/aria-label="1 апреля 2027/);
    expect(ru.indexOf(">пн<")).toBeGreaterThan(0);
    expect(ru.indexOf(">пн<")).toBeLessThan(ru.indexOf(">вс<"));
  });

  test("a value outside the span is shown as the nearest day inside it", () => {
    expect(pick("2030-01-01")).toMatch(/data-value="2027-08-28"/);
    expect(pick("2020-01-01")).toMatch(/data-value="2027-03-02"/);
  });
});
