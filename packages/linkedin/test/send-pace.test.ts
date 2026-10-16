import { describe, expect, it } from "vitest";
import { LINKEDIN_LIMITS } from "@le/shared";
import { inviteFloorMs, invitePaceCeilingMs, invitePaceMs, invitePaceWaitMs } from "../src/rate-limit.js";

const NOW = new Date("2026-10-16T13:00:00Z");
const NINE_TO_FIVE = { start: 9, end: 17, days: [1, 2, 3, 4, 5] };
/** A two-day-old account: ten a day. */
const NEW_ACCOUNT = { firstActionAt: new Date("2026-10-15T12:00:00Z"), workingHours: NINE_TO_FIVE };
const MIN = 60_000;

describe("the send path's floor between invitations (rule 64)", () => {
  it("is half a whole day's pace: about seventeen minutes for ten a day over eight hours", () => {
    const floor = inviteFloorMs(NEW_ACCOUNT, NOW);
    expect(floor).toBeGreaterThan(16 * MIN);
    expect(floor).toBeLessThan(18 * MIN);
  });

  it("never drops under the ordinary two-minute floor", () => {
    const allDay = { firstActionAt: new Date("2026-01-01T00:00:00Z"), workingHours: { start: 0, end: 1, days: [0, 1, 2, 3, 4, 5, 6] } };
    expect(inviteFloorMs(allDay, NOW)).toBe(LINKEDIN_LIMITS.minGapMs);
  });

  it("waits out what is left of the floor since the last invitation", () => {
    const floor = inviteFloorMs(NEW_ACCOUNT, NOW);
    const fiveAgo = new Date(NOW.getTime() - 5 * MIN);
    expect(invitePaceWaitMs({ usage: NEW_ACCOUNT, lastInviteAt: fiveAgo, inFlight: false, now: NOW })).toBe(floor - 5 * MIN);
    const longAgo = new Date(NOW.getTime() - 2 * 3_600_000);
    expect(invitePaceWaitMs({ usage: NEW_ACCOUNT, lastInviteAt: longAgo, inFlight: false, now: NOW })).toBe(0);
    expect(invitePaceWaitMs({ usage: NEW_ACCOUNT, lastInviteAt: null, inFlight: false, now: NOW })).toBe(0);
  });

  it("counts another invitation mid-send as one that has just gone", () => {
    expect(invitePaceWaitMs({ usage: NEW_ACCOUNT, lastInviteAt: null, inFlight: true, now: NOW })).toBe(
      inviteFloorMs(NEW_ACCOUNT, NOW),
    );
  });
});

describe("the slowest the pace places invitations", () => {
  it("is the top of the jitter, so a view budget is a guarantee and not an average", () => {
    const pace = { remaining: 10, windowMs: 8 * 3_600_000, dayMs: 8 * 3_600_000, dayAllowance: 10 };
    expect(invitePaceCeilingMs(pace)).toBeCloseTo(invitePaceMs(pace)! * 1.4, 0);
    expect(invitePaceCeilingMs({ remaining: 1, windowMs: 0 })).toBeNull();
  });
});
