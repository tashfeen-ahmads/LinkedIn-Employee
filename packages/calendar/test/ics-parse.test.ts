import { describe, expect, it } from "vitest";
import { parseIcsBusy } from "../src/ics-parse.js";

/**
 * Reading a rep's real calendar.
 *
 * Every case here is one where getting it wrong means a rep sitting in two
 * meetings at once, and finding out by being in one of them. The bias is
 * deliberate and one-directional: a block we invent costs an offered slot, a
 * block we miss costs the meeting.
 */

const WINDOW = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z"), fallbackTimezone: "UTC" };

function ics(...body: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...body, "END:VCALENDAR"].join("\r\n");
}

function event(...lines: string[]): string {
  return ics("BEGIN:VEVENT", ...lines, "END:VEVENT");
}

describe("parseIcsBusy", () => {
  it("reads a plain UTC event", () => {
    const busy = parseIcsBusy(event("DTSTART:20261005T140000Z", "DTEND:20261005T150000Z"), WINDOW);

    expect(busy).toEqual([{ start: "2026-10-05T14:00:00.000Z", end: "2026-10-05T15:00:00.000Z" }]);
  });

  it("resolves a zoned time through its own offset, not the server's", () => {
    // 10:00 in New York in October is 14:00 UTC. Treating the digits as UTC
    // would move every event by four hours, which is worse than not reading
    // the calendar at all: the busy blocks land where the rep is free.
    const busy = parseIcsBusy(
      event("DTSTART;TZID=America/New_York:20261005T100000", "DTEND;TZID=America/New_York:20261005T110000"),
      WINDOW,
    );

    expect(busy[0]?.start).toBe("2026-10-05T14:00:00.000Z");
  });

  it("puts an all-day event on the right day for the rep", () => {
    // A day off is the calendar's day, not UTC's. In Auckland the two are
    // thirteen hours apart, so UTC would block half of the wrong day and leave
    // half the real one open.
    const busy = parseIcsBusy(event("DTSTART;VALUE=DATE:20261005"), {
      ...WINDOW,
      fallbackTimezone: "Pacific/Auckland",
    });

    expect(busy[0]?.start).toBe("2026-10-04T11:00:00.000Z");
    // One day long, per RFC 5545, even with no DTEND.
    expect(Date.parse(busy[0]!.end) - Date.parse(busy[0]!.start)).toBe(86_400_000);
  });

  it("honours DURATION when there is no DTEND", () => {
    const busy = parseIcsBusy(event("DTSTART:20261005T140000Z", "DURATION:PT1H30M"), WINDOW);

    expect(busy[0]?.end).toBe("2026-10-05T15:30:00.000Z");
  });

  it("ignores a cancelled event", () => {
    // Feeds keep cancelled events so clients can remove them. Treating one as
    // busy blocks a slot the rep actually has free, every week, forever.
    expect(parseIcsBusy(event("DTSTART:20261005T140000Z", "DTEND:20261005T150000Z", "STATUS:CANCELLED"), WINDOW)).toEqual([]);
  });

  it("ignores an event the rep marked as free", () => {
    // TRANSP:TRANSPARENT is "show me as available". A birthday or an
    // all-day informational entry would otherwise wipe out the whole day.
    expect(parseIcsBusy(event("DTSTART:20261005T140000Z", "DTEND:20261005T150000Z", "TRANSP:TRANSPARENT"), WINDOW)).toEqual([]);
  });

  it("expands a weekly recurrence rather than blocking once", () => {
    // A standup counted once is fifty-one slots a year offered on top of a
    // meeting that is really happening.
    const busy = parseIcsBusy(
      event("DTSTART:20261005T090000Z", "DTEND:20261005T091500Z", "RRULE:FREQ=WEEKLY;COUNT=4"),
      WINDOW,
    );

    expect(busy).toHaveLength(4);
    expect(busy.map((b) => b.start)).toEqual([
      "2026-10-05T09:00:00.000Z",
      "2026-10-12T09:00:00.000Z",
      "2026-10-19T09:00:00.000Z",
      "2026-10-26T09:00:00.000Z",
    ]);
  });

  it("stops a recurrence at UNTIL", () => {
    const busy = parseIcsBusy(
      event("DTSTART:20261005T090000Z", "DTEND:20261005T093000Z", "RRULE:FREQ=DAILY;UNTIL=20261008T000000Z"),
      WINDOW,
    );

    expect(busy).toHaveLength(3);
  });

  it("skips an occurrence the rep deleted", () => {
    const busy = parseIcsBusy(
      event(
        "DTSTART:20261005T090000Z",
        "DTEND:20261005T093000Z",
        "RRULE:FREQ=DAILY;COUNT=3",
        "EXDATE:20261006T090000Z",
      ),
      WINDOW,
    );

    expect(busy.map((b) => b.start)).toEqual(["2026-10-05T09:00:00.000Z", "2026-10-07T09:00:00.000Z"]);
  });

  it("unfolds a wrapped line, so a long rule is not silently truncated", () => {
    // RFC 5545 wraps at 75 octets with a leading space. Reading line by line
    // turns FREQ=WEEKLY;COUNT=4 into FREQ=WEEKLY, which recurs for ever.
    const folded = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:20261005T090000Z", "DTEND:20261005T093000Z", "RRULE:FREQ=WEE", " KLY;COUNT=2", "END:VEVENT", "END:VCALENDAR"].join("\r\n");

    expect(parseIcsBusy(folded, WINDOW)).toHaveLength(2);
  });

  it("keeps only what overlaps the window", () => {
    const busy = parseIcsBusy(
      event("DTSTART:20260105T140000Z", "DTEND:20260105T150000Z"),
      WINDOW,
    );

    expect(busy).toEqual([]);
  });

  it("keeps an event that starts before the window and runs into it", () => {
    // A week away that began in September still blocks the first of October.
    const busy = parseIcsBusy(event("DTSTART:20260928T000000Z", "DTEND:20261003T000000Z"), WINDOW);

    expect(busy).toHaveLength(1);
  });

  it("drops an event with no usable start rather than guessing", () => {
    expect(parseIcsBusy(event("SUMMARY:no times here"), WINDOW)).toEqual([]);
    expect(parseIcsBusy(event("DTSTART:not-a-date", "DTEND:20261005T150000Z"), WINDOW)).toEqual([]);
  });

  it("drops a zero-length or backwards event", () => {
    expect(parseIcsBusy(event("DTSTART:20261005T140000Z", "DTEND:20261005T140000Z"), WINDOW)).toEqual([]);
    expect(parseIcsBusy(event("DTSTART:20261005T150000Z", "DTEND:20261005T140000Z"), WINDOW)).toEqual([]);
  });

  it("cannot be made to run away by an unbounded rule", () => {
    // A daily rule with no COUNT and no UNTIL is normal, and must terminate at
    // the window rather than iterating for ever.
    const busy = parseIcsBusy(event("DTSTART:20261001T090000Z", "DTEND:20261001T093000Z", "RRULE:FREQ=DAILY"), WINDOW);

    expect(busy.length).toBeGreaterThan(28);
    expect(busy.length).toBeLessThanOrEqual(32);
  });

  it("caps what one feed can produce", () => {
    const busy = parseIcsBusy(
      event("DTSTART:20261001T090000Z", "DTEND:20261001T093000Z", "RRULE:FREQ=DAILY"),
      { ...WINDOW, maxIntervals: 5 },
    );

    expect(busy).toHaveLength(5);
  });

  it("reads several events from one feed", () => {
    const feed = ics(
      "BEGIN:VEVENT",
      "DTSTART:20261005T140000Z",
      "DTEND:20261005T150000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART:20261006T140000Z",
      "DTEND:20261006T150000Z",
      "END:VEVENT",
    );

    expect(parseIcsBusy(feed, WINDOW)).toHaveLength(2);
  });
});
