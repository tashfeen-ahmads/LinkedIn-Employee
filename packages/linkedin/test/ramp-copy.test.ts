import { describe, expect, it } from "vitest";
import { DAYS_TO_SUSTAINED, LINKEDIN_LIMITS, RAMP_SENTENCE, SUSTAINED_INVITES_PER_DAY, rampCapOnDay } from "@le/shared";
import { dailyInviteCap } from "../src/rate-limit.js";

/**
 * What the screens say about the pace is the limiter's own arithmetic.
 *
 * The limiter allows 35 on a single day once warmed, and the 100-a-week cap
 * averages 20 across a working week. The sentence says both, computed from the
 * caps; these keep it on the same line the limiter draws.
 */
describe("the ramp as the screens describe it", () => {
  it("draws the same line as the limiter, every day of the warm-up", () => {
    const first = new Date("2026-10-01T09:00:00Z");
    for (let d = 0; d <= LINKEDIN_LIMITS.warmupDays + 2; d += 1) {
      expect(rampCapOnDay(d), `day ${d}`).toBe(dailyInviteCap(first, new Date(first.getTime() + d * 86_400_000)));
    }
  });

  it("names the pace the weekly cap allows on a working week, and when the ramp reaches it", () => {
    expect(SUSTAINED_INVITES_PER_DAY).toBe(Math.floor(LINKEDIN_LIMITS.invitesPerWeek / 5));
    expect(rampCapOnDay(DAYS_TO_SUSTAINED)).toBeGreaterThanOrEqual(SUSTAINED_INVITES_PER_DAY);
    expect(rampCapOnDay(DAYS_TO_SUSTAINED - 1)).toBeLessThan(SUSTAINED_INVITES_PER_DAY);
    expect(RAMP_SENTENCE).toContain(`rising to ${LINKEDIN_LIMITS.invitesPerDayMax}`);
    expect(RAMP_SENTENCE).toContain(`about ${SUSTAINED_INVITES_PER_DAY} a working day`);
  });
});
