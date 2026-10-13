import { describe, expect, it } from "vitest";
import { workingMsAhead, workingMsLeftToday } from "../src/time.js";

const HOUR = 3_600_000;
const ALWAYS = { start: 0, end: 24, days: [0, 1, 2, 3, 4, 5, 6] };
const OFFICE = { start: 9, end: 17, days: [1, 2, 3, 4, 5] };

describe("workingMsAhead", () => {
  it("carries on past midnight when the hours run around the clock", () => {
    // 11:30 p.m. UTC on a Monday: half an hour left today, the whole of the
    // following days after it.
    const late = new Date("2026-10-12T23:30:00Z");
    expect(workingMsLeftToday(late, ALWAYS, "UTC")).toBe(HOUR / 2);
    expect(workingMsAhead(late, ALWAYS, "UTC")).toBeGreaterThan(24 * HOUR);
  });

  it("stops at the end of the day when the hours do", () => {
    const afternoon = new Date("2026-10-12T16:00:00Z");
    expect(workingMsAhead(afternoon, OFFICE, "UTC")).toBe(HOUR);
  });

  it("stops at a day the rep does not work", () => {
    const weekdaysAllDay = { start: 0, end: 24, days: [1, 2, 3, 4, 5] };
    // 11 p.m. on Friday: Saturday is not a working day.
    const friday = new Date("2026-10-16T23:00:00Z");
    expect(workingMsAhead(friday, weekdaysAllDay, "UTC")).toBe(HOUR);
  });

  it("is zero outside the hours", () => {
    expect(workingMsAhead(new Date("2026-10-12T20:00:00Z"), OFFICE, "UTC")).toBe(0);
  });
});
