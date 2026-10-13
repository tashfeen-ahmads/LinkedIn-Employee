import { describe, expect, it } from "vitest";
import { LINKEDIN_LIMITS } from "@le/shared";
import { dailyInviteCap } from "@le/linkedin";
import { WINDOW_DAYS, capForDay, planToday } from "../src/lib/limit-plan";
import { buildCapTable } from "../src/lib/limit-table";

const { caps, neverSentCap } = buildCapTable();
const base = { caps, neverSentCap, weeklyCeiling: LINKEDIN_LIMITS.invitesPerWeek };
const CEILING = LINKEDIN_LIMITS.invitesPerWeek;
const MAX = LINKEDIN_LIMITS.invitesPerDayMax;
/** Seven days with `n` sent on the oldest of them and nothing since. */
const onlyOldest = (n: number) => [n, 0, 0, 0, 0, 0, 0];

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
    const plan = planToday({ ...base, days: null, sentByDay: [] });
    expect(plan.today).toBe(LINKEDIN_LIMITS.invitesPerDayStart);
    expect(plan.rampDay).toBe(1);
  });

  it("reaches the full allowance at the end of the ramp", () => {
    const plan = planToday({ ...base, days: LINKEDIN_LIMITS.warmupDays, sentByDay: [] });
    expect(plan.dailyCap).toBe(LINKEDIN_LIMITS.invitesPerDayMax);
    expect(plan.rampDay).toBeNull();
  });

  it("lets the week bind before the day", () => {
    const plan = planToday({ ...base, days: 60, sentByDay: onlyOldest(CEILING - 5) });
    expect(plan).toMatchObject({ today: 5, weeklyLeft: 5, binding: "week" });
  });

  it("sends nothing once the week is spent, and never goes negative", () => {
    const plan = planToday({ ...base, days: 60, sentByDay: onlyOldest(CEILING + 40) });
    expect(plan).toMatchObject({ today: 0, weeklyLeft: 0 });
    expect(plan.line).toMatch(/spent/);
  });

  it("treats nonsense input as zero rather than inventing an allowance", () => {
    const plan = planToday({ ...base, days: -4, sentByDay: [Number.NaN, -3, Number.POSITIVE_INFINITY] });
    expect(plan.dailyCap).toBe(neverSentCap);
    expect(plan.weeklyLeft).toBe(LINKEDIN_LIMITS.invitesPerWeek);
  });
});

describe("limit calculator, a rolling seven days", () => {
  const WORKDAYS = [1, 2, 3, 4, 5];
  const TUESDAY = 2;

  it("counts last week's Wednesday to Friday on a Tuesday, where a Monday reset would forget them", () => {
    // A fully warmed account launched on a Wednesday at the daily maximum:
    // Wed, Thu, Fri, Sat, Sun, Mon, and today (Tuesday) so far.
    const sentByDay = [MAX, MAX, CEILING - 2 * MAX, 0, 0, 0, 0];
    const plan = planToday({ ...base, days: 60, sentByDay, weekday: TUESDAY, workingDays: WORKDAYS });
    // Counted from Monday the week would hold nothing, and the plan would hand
    // over a full day. Counted over the last seven days, there is no room.
    expect(plan.sentInWindow).toBe(CEILING);
    expect(plan).toMatchObject({ today: 0, weeklyLeft: 0 });
    // Wednesday's invitations are the first to turn seven days old.
    expect(plan.nextFree).toEqual({ inDays: 1, frees: MAX });
    expect(plan.line).toMatch(/free up tomorrow/);
    expect(plan.line).not.toMatch(/Monday|resets/);
  });

  it("frees a day's invitations exactly seven days after they were sent, never all at once", () => {
    const sentByDay = [0, 0, 30, 30, 0, 40, 0];
    const plan = planToday({ ...base, days: 60, sentByDay, weekday: TUESDAY, workingDays: WORKDAYS });
    expect(plan.weeklyLeft).toBe(0);
    // The oldest day with anything in it was four days ago (Friday); it
    // leaves the window in three days, on Friday, taking its 30 with it.
    expect(plan.nextFree).toEqual({ inDays: 3, frees: 30 });
    expect(plan.line).toMatch(/30 free up on Friday/);
  });

  it("reads today's own sends against the day's cap as well as the window", () => {
    const plan = planToday({ ...base, days: 60, sentByDay: [0, 0, 0, 0, 0, 0, MAX] });
    expect(plan).toMatchObject({ today: 0, weeklyLeft: CEILING - MAX, binding: "day" });
    expect(plan.line).toMatch(/tomorrow/);
  });

  it("only ever looks at seven days", () => {
    const plan = planToday({ ...base, days: 60, sentByDay: [CEILING, ...Array<number>(WINDOW_DAYS).fill(0)] });
    expect(plan.sentInWindow).toBe(0);
    expect(plan.weeklyLeft).toBe(CEILING);
  });

  it("names when the seven-day ceiling starts to bind at the full daily cap", () => {
    const monday = planToday({ ...base, days: 60, sentByDay: [], weekday: 1, workingDays: WORKDAYS });
    expect(monday.today).toBe(MAX);
    // Mon, Tue at the cap leave less than a full day for Wednesday.
    expect(monday.line).toMatch(/starts to bind on Wednesday, 2 days from now/);
    const unknown = planToday({ ...base, days: 60, sentByDay: [] });
    expect(unknown.line).toMatch(/in 2 days/);
  });

  it("keeps every seven days in a row at or under the ceiling, launched on any weekday", () => {
    // Follow the plan to the letter for six weeks: send exactly what it
    // allows on every working day. A Monday reset passes this for a launch on
    // Monday and fails it for any other, at more than the ceiling.
    for (let launch = 0; launch < 7; launch++) {
      const history: number[] = [];
      for (let day = 0; day < 42; day++) {
        const weekday = (launch + day) % 7;
        const plan = planToday({
          ...base,
          days: 60 + day,
          sentByDay: [...history.slice(-(WINDOW_DAYS - 1)), 0],
          weekday,
          workingDays: WORKDAYS,
        });
        history.push(WORKDAYS.includes(weekday) ? plan.today : 0);
      }
      for (let end = WINDOW_DAYS; end <= history.length; end++) {
        const span = history.slice(end - WINDOW_DAYS, end).reduce((a, b) => a + b, 0);
        expect(span, `launch weekday ${launch}, seven days ending day ${end - 1}`).toBeLessThanOrEqual(CEILING);
      }
      // And it is a ceiling, not a throttle: the busiest week reaches it.
      expect(Math.max(...history.map((_, i) => history.slice(i, i + WINDOW_DAYS).reduce((a, b) => a + b, 0)))).toBe(CEILING);
    }
  });
});
