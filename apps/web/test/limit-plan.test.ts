import { describe, expect, it } from "vitest";
import { LINKEDIN_LIMITS } from "@le/shared";
import { dailyInviteCap } from "@le/linkedin";
import { capForDay, planToday } from "../src/lib/limit-plan";
import { buildCapTable } from "../src/lib/limit-table";

const { caps, neverSentCap } = buildCapTable();
const base = { caps, neverSentCap, weeklyCeiling: LINKEDIN_LIMITS.invitesPerWeek };

describe("limit calculator", () => {
  it("reads the sender's dailyInviteCap for every day, including past the ramp", () => {
    const now = new Date("2026-03-10T15:00:00Z");
    for (let d = 0; d <= LINKEDIN_LIMITS.warmupDays + 30; d++) {
      const first = new Date(now.getTime() - d * 86_400_000);
      expect(capForDay(caps, neverSentCap, d), `day ${d}`).toBe(dailyInviteCap(first, now));
    }
    expect(capForDay(caps, neverSentCap, null)).toBe(dailyInviteCap(null, now));
  });

  it("starts a never-used account at the starting cap", () => {
    const plan = planToday({ ...base, days: null, sentThisWeek: 0 });
    expect(plan.today).toBe(LINKEDIN_LIMITS.invitesPerDayStart);
    expect(plan.rampDay).toBe(1);
  });

  it("reaches the full allowance at the end of the ramp", () => {
    const plan = planToday({ ...base, days: LINKEDIN_LIMITS.warmupDays, sentThisWeek: 0 });
    expect(plan.dailyCap).toBe(LINKEDIN_LIMITS.invitesPerDayMax);
    expect(plan.rampDay).toBeNull();
  });

  it("lets the week bind before the day", () => {
    const plan = planToday({ ...base, days: 60, sentThisWeek: LINKEDIN_LIMITS.invitesPerWeek - 5 });
    expect(plan).toMatchObject({ today: 5, weeklyLeft: 5, binding: "week" });
  });

  it("sends nothing once the week is spent, and never goes negative", () => {
    const plan = planToday({ ...base, days: 60, sentThisWeek: LINKEDIN_LIMITS.invitesPerWeek + 40 });
    expect(plan).toMatchObject({ today: 0, weeklyLeft: 0 });
    expect(plan.line).toMatch(/spent/);
  });

  it("treats nonsense input as zero rather than inventing an allowance", () => {
    const plan = planToday({ ...base, days: -4, sentThisWeek: Number.NaN });
    expect(plan.dailyCap).toBe(neverSentCap);
    expect(plan.weeklyLeft).toBe(LINKEDIN_LIMITS.invitesPerWeek);
  });
});
