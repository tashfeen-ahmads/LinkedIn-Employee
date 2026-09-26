import { describe, expect, it } from "vitest";
import { LINKEDIN_LIMITS } from "@le/shared";
import { spreadGapMs } from "../src/rate-limit.js";

/**
 * The day's allowance is spread across the day, not fired consecutively.
 *
 * This is the rule the first live account was lost to. Its warm-up ramp said
 * ten invitations on day one and nothing said *when*, so all seven it had
 * people for went out between 16:52 and 17:19 — the first seven actions that
 * account had ever taken. LinkedIn throttled invitations from it and was still
 * refusing five days later, with five outstanding and seven sent all week.
 *
 * A daily ceiling with no pacing underneath it is a burst with a maximum size.
 */

const HOUR = 3_600_000;
/** Deterministic draws, so an assertion about a gap is about the arithmetic. */
const fixed = (value: number) => () => value;

describe("spreadGapMs", () => {
  it("spends the day on the day's allowance", () => {
    // Eight hours, ten invitations: roughly three quarters of an hour apart,
    // which is a person working. The old behaviour was two to nine minutes
    // apart, which is the same ten invitations inside an hour.
    const gap = spreadGapMs({ remaining: 10, windowMs: 8 * HOUR, random: fixed(0.5) });
    expect(gap).toBeGreaterThan(30 * 60_000);
    expect(gap).toBeLessThan(60 * 60_000);
  });

  it("fits the whole allowance inside the window even on its worst day", () => {
    /*
     * A guarantee, not an average, and the difference is the point.
     *
     * Divide the window by the count alone and the *expected* last invitation
     * lands on its edge — so every second day pushes its last few past the end
     * of the rep's hours, where the send path defers them and the allowance is
     * quietly not spent. The jitter's own ceiling is in the divisor so that the
     * one day in a million which draws high ten times running still fits.
     *
     * `fixed(1)` is exactly that day: every gap as wide as the jitter allows.
     */
    const window = 8 * HOUR;
    let total = 0;
    for (let i = 0; i < 10; i += 1) {
      total += spreadGapMs({ remaining: 10, windowMs: window, random: fixed(1) });
    }
    expect(total).toBeLessThanOrEqual(window);

    // And the same over many real draws, which is the case that actually ships.
    for (let run = 0; run < 200; run += 1) {
      let sum = 0;
      for (let i = 0; i < 10; i += 1) sum += spreadGapMs({ remaining: 10, windowMs: window });
      expect(sum).toBeLessThanOrEqual(window);
    }
  });

  it("never goes below the ordinary gap between two actions", () => {
    /*
     * A campaign launched at twenty to five: ten invitations do not fit into
     * twenty minutes at any pace, and the answer is the old cadence rather
     * than a gap of a few seconds. This is the one case where the fit above
     * does not hold, and it holds in the right direction — the floor overruns
     * the window rather than the window crushing the floor, and what overruns
     * is deferred by the send path instead of being sent in a burst.
     */
    const gap = spreadGapMs({ remaining: 10, windowMs: 20 * 60_000, random: fixed(0) });
    expect(gap).toBeGreaterThanOrEqual(LINKEDIN_LIMITS.minGapMs);
  });

  it("falls back to the ordinary gap when there is no window at all", () => {
    // Outside working hours the window is zero. Dividing by it would be a gap
    // of nothing, which is every invitation at once.
    const gap = spreadGapMs({ remaining: 10, windowMs: 0, random: fixed(0.5) });
    expect(gap).toBeGreaterThanOrEqual(LINKEDIN_LIMITS.minGapMs);
    expect(gap).toBeLessThanOrEqual(LINKEDIN_LIMITS.maxGapMs);
  });

  it("never hands back a delay that is not a number", () => {
    /*
     * The one case the floor does not rescue. Every step after the divisor
     * multiplies the window, and `Math.max(floor, NaN)` is NaN — a delay of
     * NaN on the queue is a job with no delay, so the whole allowance goes out
     * at once. The burst this function exists to prevent, arriving through it.
     */
    for (const window of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const gap = spreadGapMs({ remaining: 10, windowMs: window, random: fixed(0.5) });
      expect(Number.isFinite(gap)).toBe(true);
      expect(gap).toBeGreaterThanOrEqual(LINKEDIN_LIMITS.minGapMs);
      expect(gap).toBeLessThanOrEqual(LINKEDIN_LIMITS.maxGapMs);
    }
  });

  it("is never mechanical", () => {
    /*
     * An identical gap repeated is the signature the pacing exists to avoid:
     * a burst spread evenly is still a script, just a slower one.
     */
    const gaps = new Set<number>();
    for (let i = 0; i < 40; i += 1) {
      gaps.add(spreadGapMs({ remaining: 10, windowMs: 8 * HOUR }));
    }
    expect(gaps.size).toBeGreaterThan(20);
  });

  it("paces a small allowance wider than a large one", () => {
    // Two invitations across a working day are hours apart; twenty are
    // minutes apart. The allowance is what sets the rate.
    const few = spreadGapMs({ remaining: 2, windowMs: 8 * HOUR, random: fixed(0.5) });
    const many = spreadGapMs({ remaining: 20, windowMs: 8 * HOUR, random: fixed(0.5) });
    expect(few).toBeGreaterThan(many * 3);
  });

  it("treats an empty allowance as one, rather than dividing by zero", () => {
    const gap = spreadGapMs({ remaining: 0, windowMs: 8 * HOUR, random: fixed(0.5) });
    expect(Number.isFinite(gap)).toBe(true);
    expect(gap).toBeGreaterThan(0);
  });
});
