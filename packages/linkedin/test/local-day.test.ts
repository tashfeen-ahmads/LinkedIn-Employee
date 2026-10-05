import { describe, expect, it } from "vitest";
import { LINKEDIN_LIMITS } from "@le/shared";
import { jitteredRetryMs, localDate, localDayStart } from "../src/rate-limit.js";

/**
 * The rep's day, and how long a refused action really waits.
 *
 * Both exist because a single number shared by everything turned into a burst:
 * the counters rolled over at UTC midnight — five in the afternoon in
 * California — and every job a hold or a cap refused woke at the same instant
 * and drained at exactly the two-minute floor.
 */

const fixed = (value: number) => () => value;

describe("localDate", () => {
  it("is the rep's date, not the server's", () => {
    // 01:00 UTC on the 8th is still the evening of the 7th in Los Angeles.
    expect(localDate(new Date("2026-10-08T01:00:00Z"), "America/Los_Angeles")).toBe("2026-10-07");
    expect(localDate(new Date("2026-10-08T01:00:00Z"), "UTC")).toBe("2026-10-08");
    // And already the 8th in Tokyo at 20:00 UTC on the 7th.
    expect(localDate(new Date("2026-10-07T20:00:00Z"), "Asia/Tokyo")).toBe("2026-10-08");
  });

  it("falls back to UTC for a zone it does not know rather than throwing", () => {
    expect(localDate(new Date("2026-10-08T01:00:00Z"), "Not/AZone")).toBe("2026-10-08");
  });
});

describe("localDayStart", () => {
  it("is the rep's midnight", () => {
    // Midnight on the 7th in Los Angeles (PDT) is 07:00 UTC.
    expect(localDayStart(new Date("2026-10-08T01:00:00Z"), "America/Los_Angeles").toISOString()).toBe(
      "2026-10-07T07:00:00.000Z",
    );
  });
});

describe("jitteredRetryMs", () => {
  const { minGapMs, maxGapMs } = LINKEDIN_LIMITS;

  it("never retries before the limiter's own moment", () => {
    expect(jitteredRetryMs(60_000, "too_soon", fixed(0))).toBe(60_000);
    expect(jitteredRetryMs(3_600_000, "outside_working_hours", fixed(0))).toBe(3_600_000 + minGapMs);
  });

  it("adds only the random part of the gap to a too-soon refusal", () => {
    // The floor is already being served; adding a whole gap on top would
    // double it.
    expect(jitteredRetryMs(60_000, "too_soon", fixed(1))).toBe(60_000 + maxGapMs - minGapMs);
  });

  it("gives every other refusal a whole gap, so nothing held wakes together", () => {
    const early = jitteredRetryMs(3_600_000, "held", fixed(0.1));
    const late = jitteredRetryMs(3_600_000, "held", fixed(0.9));
    expect(early).toBeGreaterThanOrEqual(3_600_000 + minGapMs);
    expect(late).toBeLessThanOrEqual(3_600_000 + maxGapMs);
    expect(late).not.toBe(early);
  });

  it("treats a wait that is not a number as no wait, never as NaN", () => {
    // A NaN delay on the queue is no delay at all.
    expect(Number.isFinite(jitteredRetryMs(Number.NaN, "too_soon", fixed(0.5)))).toBe(true);
  });
});
