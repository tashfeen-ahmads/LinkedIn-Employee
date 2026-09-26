import { describe, expect, it } from "vitest";
import { workingMsLeftToday } from "../src/time.js";

/**
 * How much of today's working window is still ahead.
 *
 * Exists so a day's allowance can be spread rather than merely capped. The
 * ramp said an account might send ten invitations on its first day and nothing
 * said *when*, so the pacing loop placed all of them two to nine minutes apart
 * — and the first live account here sent seven connection requests between
 * 16:52 and 17:19, the first seven actions it had ever taken. LinkedIn
 * throttled invitations from it and was still refusing five days later.
 *
 * Tested here rather than through the limiter that re-exports it, because a
 * mutation of this file is only visible to this package's own tests: every
 * other package reads `@le/shared` through its `dist/`.
 */

const HOUR = 3_600_000;

describe("workingMsLeftToday", () => {
  const hours = { start: 9, end: 17, days: [1, 2, 3, 4, 5] };

  it("measures what is left of the window, not of the day", () => {
    // 13:00 UTC on a Wednesday: four hours of a 9-to-5 left, not eleven.
    expect(workingMsLeftToday(new Date("2026-09-23T13:00:00Z"), hours, "UTC")).toBe(4 * HOUR);
  });

  it("is zero once the window has closed", () => {
    // And zero rather than negative: the caller divides by it.
    expect(workingMsLeftToday(new Date("2026-09-23T17:30:00Z"), hours, "UTC")).toBe(0);
  });

  it("is zero on a day nobody works", () => {
    // A Saturday. There is no room to spread into, so the caller falls back to
    // the ordinary gap rather than dividing by nothing.
    expect(workingMsLeftToday(new Date("2026-09-26T13:00:00Z"), hours, "UTC")).toBe(0);
  });

  it("offers the whole window before it opens", () => {
    expect(workingMsLeftToday(new Date("2026-09-23T06:00:00Z"), hours, "UTC")).toBe(8 * HOUR);
  });

  it("reads the window in the rep's own zone, not the server's", () => {
    // 13:00 UTC is 09:00 in New York — the start of the window, so all eight
    // hours are ahead. Read as UTC it would be four.
    expect(workingMsLeftToday(new Date("2026-09-23T13:00:00Z"), hours, "America/New_York")).toBe(
      8 * HOUR,
    );
  });
});
