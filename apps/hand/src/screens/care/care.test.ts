import { describe, expect, test } from "bun:test";
import { publicKeyOf } from "@ahand/deliver";
import { describeHand } from "@ahand/sdk";

import { alarmLead, fold, icsText, icsTime, reminderIcs, reminderName } from "./calendar";
import { DAY, LAST_MINUTES, capDays, extendChoices, inLastMinutes } from "./extend";
import { checkKept } from "./kept";

const CAP = 180 * DAY;
const MARGIN = 600;
const NOW = 1_800_000_000;

describe("keep it open longer: the three chips", () => {
  test("+30 and +90 count from the current end; max is the network's time plus the cap less ten minutes", () => {
    const end = NOW + 10 * DAY;
    const [d30, d90, max] = extendChoices(NOW, end, CAP);
    expect(d30).toEqual({ key: "30", target: end + 30 * DAY, moves: true, capped: false });
    expect(d90).toEqual({ key: "90", target: end + 90 * DAY, moves: true, capped: false });
    expect(max).toEqual({ key: "max", target: NOW + CAP - MARGIN, moves: true, capped: false });
  });

  test("a chip past the cap is cut to it; one that would not move the end later is off", () => {
    const end = NOW + CAP - MARGIN; // already at the cap
    const [d30, d90, max] = extendChoices(NOW, end, CAP);
    expect(d30!.target).toBe(NOW + CAP - MARGIN);
    expect(d30!.capped).toBe(true);
    expect(d30!.moves).toBe(false);
    expect(d90!.moves).toBe(false);
    expect(max!.moves).toBe(false);

    // A few seconds after the cap was reached, the clock has ticked on: still nothing worth a send.
    for (const choice of extendChoices(NOW + 30, end, CAP)) expect(choice.moves).toBe(false);
    expect(extendChoices(NOW + 60, end, CAP)[2]!.moves).toBe(true);

    const near = NOW + 120 * DAY;
    const [n30, n90, nmax] = extendChoices(NOW, near, CAP);
    expect(n30).toMatchObject({ target: near + 30 * DAY, moves: true, capped: false });
    expect(n90).toMatchObject({ target: NOW + CAP - MARGIN, moves: true, capped: true });
    expect(nmax!.target).toBe(NOW + CAP - MARGIN);
  });

  test("from the end's own second on, nothing moves (Core refuses extend from block.timestamp >= expiry)", () => {
    for (const now of [NOW, NOW + 1]) {
      for (const choice of extendChoices(now, NOW, CAP)) expect(choice.moves).toBe(false);
    }
    // One second before the end is still allowed (D-30).
    expect(extendChoices(NOW - 1, NOW, CAP).every((choice) => choice.moves)).toBe(true);
  });

  test("the app's warning runs for the last ten minutes, not after the end", () => {
    expect(LAST_MINUTES).toBe(600);
    expect(inLastMinutes(NOW, NOW + 600)).toBe(false);
    expect(inLastMinutes(NOW, NOW + 599)).toBe(true);
    expect(inLastMinutes(NOW, NOW + 1)).toBe(true);
    expect(inLastMinutes(NOW, NOW)).toBe(false);
    expect(capDays(CAP)).toBe(180);
  });
});

/** A small RFC 5545 reader: unfolds lines and returns the components with their properties. */
function parse(ics: string): { lines: string[]; blocks: string[] } {
  expect(ics.endsWith("\r\n")).toBe(true);
  const lines = ics.replace(/\r\n /g, "").split("\r\n").filter(Boolean);
  const blocks = lines.filter((line) => line.startsWith("BEGIN:") || line.startsWith("END:"));
  return { lines, blocks };
}

describe("the reminder file", () => {
  const base = {
    chainId: 31337,
    core: "0x65ac707E2AE7392583de5d6192C619F1D8862309",
    handId: 12n,
    stamp: NOW,
    url: "http://127.0.0.1:18351/care/31337/12",
    summary: "Hand 12 closes, keep it open longer?",
    description: "Open until 20 Dec.\nTo keep it open: http://127.0.0.1:18351/care/31337/12",
    alarm: "Hand 12 closes in 3 days; a reminder; nothing else.",
  };

  test("one VEVENT at the end with one alarm three days before it", () => {
    const ics = reminderIcs({ ...base, openedAt: NOW, expiry: NOW + 30 * DAY });
    const { lines, blocks } = parse(ics);
    expect(blocks).toEqual(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "BEGIN:VALARM", "END:VALARM", "END:VEVENT", "END:VCALENDAR"]);
    expect(lines).toContain(`DTSTART:${icsTime(NOW + 30 * DAY)}`);
    expect(lines).toContain("TRIGGER;RELATED=START:-P3D");
    expect(lines).toContain(`DTSTAMP:${icsTime(NOW)}`);
    expect(lines.find((line) => line.startsWith("DESCRIPTION:Open"))).toBe("DESCRIPTION:Open until 20 Dec.\\nTo keep it open: http://127.0.0.1:18351/care/31337/12");
    expect(ics.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
  });

  test("a Hand of a week or less is reminded one day before", () => {
    expect(alarmLead(NOW, NOW + 7 * DAY)).toBe(DAY);
    expect(alarmLead(NOW, NOW + 7 * DAY + 1)).toBe(3 * DAY);
    expect(reminderIcs({ ...base, openedAt: NOW, expiry: NOW + 7 * DAY })).toContain("TRIGGER;RELATED=START:-P1D");
  });

  test("times are UTC, text is escaped, long lines fold inside no character", () => {
    expect(icsTime(Date.UTC(2026, 11, 20, 14, 2, 0) / 1000)).toBe("20261220T140200Z");
    expect(icsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const long = `SUMMARY:${"Рука ".repeat(40)}`;
    const folded = fold(long);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
    expect(reminderName(12n, Date.UTC(2026, 11, 20) / 1000)).toBe("ahand-12-20261220.ics");
  });
});

describe("the words kept on this device, checked against Core's dataHash (checkKept)", () => {
  const inbox = publicKeyOf(`0x${"11".repeat(32)}`);
  const title = "Who can fix a bicycle wheel today?";
  const content = "Near the station, before six.";
  const withInbox = describeHand({ mode: "unlisted", title, content, inbox });
  const record = { mode: "unlisted" as const, title, content, salt: withInbox.salt! };

  test("the right words and the Hand's inbox key give its dataHash: attached", () => {
    expect(checkKept(record, inbox, true, withInbox.dataHash)).toBe("attached");
  });

  test("before the inbox key is known a Hand described with one cannot be checked: unknown, never mismatch", () => {
    expect(checkKept(record, undefined, false, withInbox.dataHash)).toBe("unknown");
  });

  test("other words with the key known: mismatch", () => {
    expect(checkKept({ ...record, title: "Who can fix a car wheel today?" }, inbox, true, withInbox.dataHash)).toBe("mismatch");
    expect(checkKept({ ...record, salt: `0x${"22".repeat(32)}` }, inbox, true, withInbox.dataHash)).toBe("mismatch");
  });

  test("a Hand described without an inbox key is checked without one: attached before any unlock", () => {
    const bare = describeHand({ mode: "dark", title, content });
    expect(checkKept({ mode: "dark", title, content, salt: bare.salt! }, undefined, false, bare.dataHash)).toBe("attached");
  });
});
