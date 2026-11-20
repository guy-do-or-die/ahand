/**
 * The reminder (UX-SPEC §7.4, brief 02 §1 item 13): an iCalendar file (RFC 5545) made in the
 * page and offered as a download. No service is involved and nothing leaves the device.
 *
 * One VEVENT at the Hand's end, with one VALARM before it: three days before, or one day before
 * for a Hand whose whole life (from its raise to its end) is a week or less. The stamp the file
 * needs (DTSTAMP) is the network's time handed in by the caller, never the device's clock.
 */

const DAY = 86_400;

/** How long before the end the alarm rings, in seconds. */
export function alarmLead(openedAt: number, expiry: number): number {
  return expiry - openedAt <= 7 * DAY ? DAY : 3 * DAY;
}

export interface Reminder {
  chainId: number;
  core: string;
  handId: bigint;
  openedAt: number;
  expiry: number;
  /** DTSTAMP: the network's time when the file was made. */
  stamp: number;
  /** Where to care for the Hand: the /care page of this site. */
  url: string;
  /** The words, in the reader's language. */
  summary: string;
  description: string;
  alarm: string;
}

/** 20261120T140200Z */
export function icsTime(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** TEXT values: backslash, semicolon, comma and line breaks escaped (RFC 5545 §3.3.11). */
export function icsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets, never inside a character (RFC 5545 §3.1). */
export function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74; // a continuation line starts with one space
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** The whole file, lines joined by CRLF as the format requires. */
export function reminderIcs(r: Reminder): string {
  const lead = alarmLead(r.openedAt, r.expiry) / DAY;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//aHand//care//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:hand-${r.chainId}-${r.core.toLowerCase()}-${r.handId}-${r.expiry}@ahand`,
    `DTSTAMP:${icsTime(r.stamp)}`,
    `DTSTART:${icsTime(r.expiry)}`,
    `SUMMARY:${icsText(r.summary)}`,
    `DESCRIPTION:${icsText(r.description)}`,
    `URL:${r.url}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(r.alarm)}`,
    `TRIGGER;RELATED=START:-P${lead}D`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** The file's name: one per Hand and end, so a later reminder after an extension does not overwrite the old one silently. */
export function reminderName(handId: bigint, expiry: number): string {
  return `ahand-${handId}-${icsTime(expiry).slice(0, 8)}.ics`;
}
