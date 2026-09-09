import { describe, expect, it } from "vitest";
import { LINKEDIN_LIMITS } from "@le/shared";
import {
  checkAction,
  dailyInviteCap,
  isWithinWorkingHours,
  nextGapMs,
  type AccountUsage,
} from "../src/rate-limit.js";

const WORKING = { start: 8, end: 18, days: [1, 2, 3, 4, 5] };
// Wednesday 2026-09-09, 14:00 UTC.
const MIDWEEK_AFTERNOON = new Date("2026-09-09T14:00:00Z");

function usage(overrides: Partial<AccountUsage> = {}): AccountUsage {
  return {
    connectedAt: new Date("2026-01-01T00:00:00Z"),
    invitesToday: 0,
    invitesThisWeek: 0,
    messagesToday: 0,
    lastActionAt: null,
    workingHours: WORKING,
    timezone: "UTC",
    ...overrides,
  };
}

describe("warm-up ramp", () => {
  it("starts new accounts at the conservative daily cap", () => {
    const connectedAt = new Date("2026-09-09T00:00:00Z");
    expect(dailyInviteCap(connectedAt, MIDWEEK_AFTERNOON)).toBe(LINKEDIN_LIMITS.invitesPerDayStart);
  });

  it("reaches the maximum only after the full warm-up period", () => {
    const connectedAt = new Date("2026-09-09T00:00:00Z");
    const dayBefore = new Date(connectedAt.getTime() + (LINKEDIN_LIMITS.warmupDays - 1) * 86_400_000);
    const after = new Date(connectedAt.getTime() + LINKEDIN_LIMITS.warmupDays * 86_400_000);
    expect(dailyInviteCap(connectedAt, dayBefore)).toBeLessThan(LINKEDIN_LIMITS.invitesPerDayMax);
    expect(dailyInviteCap(connectedAt, after)).toBe(LINKEDIN_LIMITS.invitesPerDayMax);
  });

  it("never exceeds the maximum however old the account is", () => {
    const ancient = new Date("2020-01-01T00:00:00Z");
    expect(dailyInviteCap(ancient, MIDWEEK_AFTERNOON)).toBe(LINKEDIN_LIMITS.invitesPerDayMax);
  });
});

describe("working hours", () => {
  it("allows a weekday afternoon", () => {
    expect(isWithinWorkingHours(MIDWEEK_AFTERNOON, WORKING, "UTC")).toBe(true);
  });

  it("blocks nights and weekends", () => {
    expect(isWithinWorkingHours(new Date("2026-09-09T03:00:00Z"), WORKING, "UTC")).toBe(false);
    expect(isWithinWorkingHours(new Date("2026-09-12T14:00:00Z"), WORKING, "UTC")).toBe(false);
  });

  it("evaluates the rep's zone, not the server's", () => {
    // 14:00 UTC is 07:00 in Los Angeles, before the 08:00 window opens.
    expect(isWithinWorkingHours(MIDWEEK_AFTERNOON, WORKING, "America/Los_Angeles")).toBe(false);
    expect(isWithinWorkingHours(MIDWEEK_AFTERNOON, WORKING, "Europe/Berlin")).toBe(true);
  });
});

describe("checkAction", () => {
  it("permits an invite for a healthy account inside working hours", () => {
    expect(checkAction("invite", usage(), MIDWEEK_AFTERNOON)).toEqual({ allowed: true });
  });

  it("denies once the daily invite cap is spent, and says when to retry", () => {
    const decision = checkAction("invite", usage({ invitesToday: 35 }), MIDWEEK_AFTERNOON);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("daily_invite_cap");
      expect(decision.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("enforces the weekly ceiling even when the day is untouched", () => {
    const decision = checkAction(
      "invite",
      usage({ invitesToday: 0, invitesThisWeek: LINKEDIN_LIMITS.invitesPerWeek }),
      MIDWEEK_AFTERNOON,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("weekly_invite_cap");
  });

  it("enforces the daily message cap independently of invites", () => {
    const decision = checkAction(
      "message",
      usage({ messagesToday: LINKEDIN_LIMITS.messagesPerDay }),
      MIDWEEK_AFTERNOON,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("daily_message_cap");
  });

  it("refuses to act twice in quick succession", () => {
    const decision = checkAction(
      "invite",
      usage({ lastActionAt: new Date(MIDWEEK_AFTERNOON.getTime() - 30_000) }),
      MIDWEEK_AFTERNOON,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("too_soon");
      expect(decision.retryAfterMs).toBeLessThanOrEqual(LINKEDIN_LIMITS.minGapMs);
    }
  });

  it("holds everything outside working hours", () => {
    const decision = checkAction("invite", usage(), new Date("2026-09-13T14:00:00Z"));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("outside_working_hours");
  });
});

describe("nextGapMs", () => {
  it("stays inside the configured jitter window", () => {
    for (const r of [0, 0.5, 0.999]) {
      const gap = nextGapMs(() => r);
      expect(gap).toBeGreaterThanOrEqual(LINKEDIN_LIMITS.minGapMs);
      expect(gap).toBeLessThanOrEqual(LINKEDIN_LIMITS.maxGapMs);
    }
  });
});

describe("msUntilNextLocalMidnight", () => {
  it("is exact in a whole-hour zone", async () => {
    const { msUntilNextLocalMidnight } = await import("../src/rate-limit.js");
    // 14:00 UTC leaves ten hours.
    expect(msUntilNextLocalMidnight(MIDWEEK_AFTERNOON, "UTC")).toBe(10 * 3_600_000);
  });

  it("is exact in a half-hour zone", async () => {
    const { msUntilNextLocalMidnight } = await import("../src/rate-limit.js");
    // 14:00 UTC is 19:30 in Kolkata, so 4h30m remain — not 5h.
    expect(msUntilNextLocalMidnight(MIDWEEK_AFTERNOON, "Asia/Kolkata")).toBe(4 * 3_600_000 + 30 * 60_000);
  });

  it("never returns a negative or zero wait", async () => {
    const { msUntilNextLocalMidnight } = await import("../src/rate-limit.js");
    for (const zone of ["UTC", "Asia/Kolkata", "America/Los_Angeles", "Pacific/Chatham"]) {
      expect(msUntilNextLocalMidnight(MIDWEEK_AFTERNOON, zone), zone).toBeGreaterThan(0);
    }
  });
});
