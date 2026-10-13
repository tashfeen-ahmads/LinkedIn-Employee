import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findFreeSlots, offerableStarts } from "../src/slots.js";
import { planDays, type PlannedMeeting } from "../src/plan.js";

/**
 * The calendar screen and the Reply Agent answering the same question.
 *
 * Rule 6: `slots.ts` produces the only datetimes that reach a prospect. A
 * screen that worked out its own availability would drift from it, and the
 * screen's answer is the one a rep believes — they would block a Tuesday that
 * was never on offer, or see a gap the agent will not use and conclude the
 * product is broken.
 */

const ZONE = "America/New_York";
const HOURS = { start: 9, end: 17, days: [1, 2, 3, 4, 5] };
// A Monday, well clear of the notice period below.
const FROM = new Date("2026-10-05T00:00:00Z");

// The slot finder never offers a time in the past, so the clock is pinned to
// FROM: against the real clock this week went by on October 12, 2026 and every
// test here found nothing to draw.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FROM);
});
afterAll(() => {
  vi.useRealTimers();
});

function base(over: Partial<Parameters<typeof planDays>[0]> = {}) {
  return {
    from: FROM,
    days: 7,
    durationMinutes: 30,
    workingHours: HOURS,
    timezone: ZONE,
    meetings: [] as PlannedMeeting[],
    blocked: [],
    minNoticeHours: 0,
    bufferMinutes: 15,
    ...over,
  };
}

describe("planDays", () => {
  it("covers the days asked for, in the rep's own zone", () => {
    const plan = planDays(base());
    expect(plan).toHaveLength(7);
    expect(new Set(plan.map((d) => d.date)).size).toBe(7);
    // Dates are the rep's, not UTC's. Midnight UTC on the 5th is still the
    // 4th in New York, and the rep means the 4th.
    expect(plan[0]!.date < plan[6]!.date).toBe(true);
  });

  it("offers nothing on a day outside working hours, and says which", () => {
    const plan = planDays(base());
    const weekend = plan.filter((d) => !d.working);
    expect(weekend.length).toBeGreaterThan(0);
    for (const day of weekend) {
      expect(day.free, `${day.date} offered a slot on a non-working day`).toHaveLength(0);
      // "outside-hours" and "full" send a rep to two different places.
      expect(day.state).toBe("outside-hours");
    }
  });

  it("never offers a time the agent would not offer", () => {
    /*
     * The assertion this file exists for. Every start the calendar draws must
     * appear in `offerableStarts`, which is what the agent's own
     * `findFreeSlots` is built from.
     */
    const options = base({
      blocked: [{ start: "2026-10-06T14:00:00Z", end: "2026-10-06T16:00:00Z" }],
      meetings: [
        { id: "m1", who: "Dana", start: "2026-10-07T15:00:00Z", end: "2026-10-07T15:30:00Z" },
      ],
    });
    const plan = planDays(options);
    const agent = new Set(
      offerableStarts({
        from: FROM,
        to: new Date(FROM.getTime() + 7 * 86_400_000),
        durationMinutes: 30,
        workingHours: HOURS,
        timezone: ZONE,
        busy: [
          { start: "2026-10-06T14:00:00Z", end: "2026-10-06T16:00:00Z" },
          { start: "2026-10-07T15:00:00Z", end: "2026-10-07T15:30:00Z" },
        ],
        minNoticeHours: 0,
        bufferMinutes: 15,
      }),
    );
    const drawn = plan.flatMap((d) => d.free);
    expect(drawn.length).toBeGreaterThan(0);
    for (const start of drawn) {
      expect(agent.has(start), `calendar drew ${start}, which the agent would not offer`).toBe(true);
    }
  });

  it("holds the three the agent picks inside what it draws", () => {
    // The reply's three options are a subset of the week on screen, so a rep
    // can always find the time a prospect was given.
    const options = base();
    const drawn = new Set(planDays(options).flatMap((d) => d.free));
    const offered = findFreeSlots({
      from: FROM,
      to: new Date(FROM.getTime() + 7 * 86_400_000),
      durationMinutes: 30,
      workingHours: HOURS,
      timezone: ZONE,
      busy: [],
      minNoticeHours: 0,
      bufferMinutes: 15,
    });
    expect(offered.length).toBeGreaterThan(0);
    for (const slot of offered) {
      expect(drawn.has(slot), `agent offered ${slot}, which the calendar does not show`).toBe(true);
    }
  });

  it("counts a booked meeting against the day's ceiling", () => {
    /*
     * A rep with a maximum of two and one already booked has room for one
     * more, not two. Left uncounted, the screen promises a third that the
     * booking path then refuses — and the person finding out is the prospect.
     */
    const withMeeting = planDays(
      base({
        maxPerDay: 2,
        meetings: [
          { id: "m1", who: "Dana", start: "2026-10-05T14:00:00Z", end: "2026-10-05T14:30:00Z" },
        ],
      }),
    );
    const monday = withMeeting.find((d) => d.meetings.length > 0)!;
    expect(monday.free.length).toBeLessThanOrEqual(1);
  });

  it("shows a block that started the day before", () => {
    // Contained-by-the-day would drop an overnight block and draw the morning
    // as free.
    const plan = planDays(
      base({ blocked: [{ start: "2026-10-05T20:00:00Z", end: "2026-10-06T15:00:00Z" }] }),
    );
    const touched = plan.filter((d) => d.blocked.length > 0);
    expect(touched.length, "an overnight block appeared on only one day").toBeGreaterThan(1);
  });

  it("puts a meeting on the day the rep sees it, not the UTC one", () => {
    // 00:30 UTC on the 7th is 20:30 on the 6th in New York.
    const plan = planDays(
      base({
        meetings: [
          { id: "m1", who: null, start: "2026-10-07T00:30:00Z", end: "2026-10-07T01:00:00Z" },
        ],
      }),
    );
    const day = plan.find((d) => d.meetings.length > 0);
    expect(day?.date).toBe("2026-10-06");
  });
});

/*
 * The week across the autumn clock change.
 *
 * Fixed 24-hour steps from local midnight land at 23:00 on the *same* date
 * after the 25-hour day (America/New_York, Sunday 1 November 2026): Sunday was
 * drawn twice, every later column was an hour out, and Thursday — with every
 * time the agent would offer on it — was never drawn at all.
 */
describe("planDays across a clock change", () => {
  // Friday 30 October 2026, 08:00 in New York (EDT).
  const DST_NOW = new Date("2026-10-30T12:00:00Z");
  beforeAll(() => vi.setSystemTime(DST_NOW));
  afterAll(() => vi.setSystemTime(FROM));

  const week = (timezone: string, from = DST_NOW) =>
    planDays({
      from,
      days: 7,
      durationMinutes: 30,
      workingHours: HOURS,
      timezone,
      meetings: [],
      blocked: [],
      minNoticeHours: 0,
      bufferMinutes: 15,
    });

  it("draws seven distinct dates through the end of daylight saving", () => {
    expect(week("America/New_York").map((d) => d.date)).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);
  });

  it("offers Thursday after the change, at the rep's own nine o'clock", () => {
    const thursday = week("America/New_York").find((d) => d.date === "2026-11-05")!;
    // 09:00 EST is 14:00 UTC.
    expect(thursday.free[0]).toBe("2026-11-05T14:00:00.000Z");
  });

  it("starts the day at local midnight east of Greenwich and on a half-hour offset", () => {
    // 23:00 in Tokyo and 19:30 in Kolkata: both still the 31st locally.
    expect(week("Asia/Tokyo", new Date("2026-10-31T14:00:00Z"))[0]!.date).toBe("2026-10-31");
    expect(week("Asia/Kolkata", new Date("2026-10-31T14:00:00Z")).map((d) => d.date)).toHaveLength(7);
    expect(new Set(week("Asia/Kolkata", new Date("2026-10-31T14:00:00Z")).map((d) => d.date)).size).toBe(7);
  });
});
