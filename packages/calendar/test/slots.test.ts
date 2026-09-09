import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findFreeSlots, formatSlot, mergeIntervals, isWithinWorkingHours } from "../src/slots.js";

const WORKING = { start: 9, end: 17, days: [1, 2, 3, 4, 5] };
// Monday 2026-09-07, 08:00 UTC.
const NOW = new Date("2026-09-07T08:00:00Z");

function options(overrides: Partial<Parameters<typeof findFreeSlots>[0]> = {}) {
  return {
    from: NOW,
    to: new Date(NOW.getTime() + 7 * 86_400_000),
    durationMinutes: 30,
    workingHours: WORKING,
    timezone: "UTC",
    busy: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("findFreeSlots", () => {
  it("offers three slots by default", () => {
    expect(findFreeSlots(options())).toHaveLength(3);
  });

  it("respects the minimum notice period", () => {
    const slots = findFreeSlots(options({ minNoticeHours: 24 }));
    for (const slot of slots) {
      expect(Date.parse(slot)).toBeGreaterThanOrEqual(NOW.getTime() + 24 * 3_600_000);
    }
  });

  it("never offers a time outside working hours", () => {
    for (const slot of findFreeSlots(options())) {
      expect(isWithinWorkingHours(new Date(slot), WORKING, "UTC")).toBe(true);
    }
  });

  it("never offers a weekend", () => {
    const slots = findFreeSlots(options({ maxSlots: 6 }));
    for (const slot of slots) {
      const day = new Date(slot).getUTCDay();
      expect(day).toBeGreaterThan(0);
      expect(day).toBeLessThan(6);
    }
  });

  it("skips a slot that collides with an existing meeting", () => {
    const wideOpen = findFreeSlots(options({ maxSlots: 1 }));
    const taken = wideOpen[0]!;
    const withConflict = findFreeSlots(
      options({
        maxSlots: 1,
        busy: [{ start: taken, end: new Date(Date.parse(taken) + 30 * 60_000).toISOString() }],
      }),
    );
    expect(withConflict[0]).not.toBe(taken);
  });

  it("leaves a buffer around existing meetings", () => {
    const busyStart = "2026-09-08T13:00:00Z";
    const busyEnd = "2026-09-08T14:00:00Z";
    const slots = findFreeSlots(options({ maxSlots: 8, busy: [{ start: busyStart, end: busyEnd }] }));
    for (const slot of slots) {
      const start = Date.parse(slot);
      const end = start + 30 * 60_000;
      // No slot may fall inside the meeting plus its 15-minute buffer.
      expect(start < Date.parse(busyEnd) + 15 * 60_000 && end > Date.parse(busyStart) - 15 * 60_000).toBe(false);
    }
  });

  it("spreads options across days rather than stacking one afternoon", () => {
    const slots = findFreeSlots(options());
    const days = new Set(slots.map((slot) => slot.slice(0, 10)));
    expect(days.size).toBe(slots.length);
  });

  it("returns nothing rather than a bad time when the window is fully booked", () => {
    const busy = [{ start: NOW.toISOString(), end: new Date(NOW.getTime() + 7 * 86_400_000).toISOString() }];
    expect(findFreeSlots(options({ busy }))).toEqual([]);
  });

  it("honours the rep's own time zone", () => {
    const slots = findFreeSlots(options({ timezone: "America/New_York", maxSlots: 2 }));
    for (const slot of slots) {
      expect(isWithinWorkingHours(new Date(slot), WORKING, "America/New_York")).toBe(true);
      // 09:00 in New York is 13:00 UTC, so a UTC-morning slot would be a bug.
      expect(new Date(slot).getUTCHours()).toBeGreaterThanOrEqual(13);
    }
  });

  it("does not offer a slot whose end runs past the working day", () => {
    const slots = findFreeSlots(options({ durationMinutes: 60, maxSlots: 8 }));
    for (const slot of slots) {
      const end = new Date(Date.parse(slot) + 60 * 60_000 - 60_000);
      expect(isWithinWorkingHours(end, WORKING, "UTC")).toBe(true);
    }
  });
});

describe("mergeIntervals", () => {
  it("merges overlapping and touching intervals", () => {
    const merged = mergeIntervals([
      { start: "2026-09-08T09:00:00Z", end: "2026-09-08T10:00:00Z" },
      { start: "2026-09-08T09:30:00Z", end: "2026-09-08T11:00:00Z" },
      { start: "2026-09-08T11:00:00Z", end: "2026-09-08T12:00:00Z" },
    ]);
    expect(merged).toEqual([{ start: "2026-09-08T09:00:00.000Z", end: "2026-09-08T12:00:00.000Z" }]);
  });

  it("keeps disjoint intervals apart and drops malformed ones", () => {
    const merged = mergeIntervals([
      { start: "2026-09-08T09:00:00Z", end: "2026-09-08T10:00:00Z" },
      { start: "2026-09-08T14:00:00Z", end: "2026-09-08T15:00:00Z" },
      { start: "nonsense", end: "also nonsense" },
      { start: "2026-09-08T16:00:00Z", end: "2026-09-08T15:00:00Z" },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("formatSlot", () => {
  it("renders a slot the way a person would read it", () => {
    const text = formatSlot("2026-09-08T14:00:00Z", "UTC");
    expect(text).toContain("Tuesday");
    expect(text).toContain("September 8");
  });
});
