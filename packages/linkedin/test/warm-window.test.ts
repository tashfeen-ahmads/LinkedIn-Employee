import { describe, expect, it } from "vitest";
import { LINKEDIN_LIMITS } from "@le/shared";
import { invitationCouldFollow, type AccountUsage } from "../src/rate-limit.js";

/*
 * Whether a view is worth spending.
 *
 * The warm-up buys recency: a request arriving to a name somebody saw a few
 * hours ago lands better than one from a stranger. Spend the view when the
 * invitation cannot follow, and you have paid a real allowance for nothing —
 * which is what happened to eight people on a Friday afternoon, viewed against
 * a hold that ran until the following afternoon.
 */

const WINDOW = LINKEDIN_LIMITS.warmUpToInviteMaxMs; // four hours
const MATURES = LINKEDIN_LIMITS.warmUpToInviteMinMs; // forty-five minutes
const NOW = new Date("2026-09-25T10:00:00Z"); // A Friday, mid-morning.

function usage(over: Partial<AccountUsage> = {}): AccountUsage {
  return {
    connectedAt: new Date("2026-09-01T09:00:00Z"),
    firstActionAt: new Date("2026-09-01T09:00:00Z"),
    invitesToday: 0,
    invitesThisWeek: 0,
    messagesToday: 0,
    profileViewsToday: 0,
    lastActionAt: null,
    workingHours: { start: 8, end: 18, days: [1, 2, 3, 4, 5] },
    timezone: "UTC",
    ...over,
  };
}

const could = (over: Parameters<typeof invitationCouldFollow>[0], now = NOW) =>
  invitationCouldFollow(over, now);

describe("when a view is worth spending", () => {
  it("is, on an ordinary working morning", () => {
    expect(could({ usage: usage(), pausedUntil: null, maturesAfterMs: MATURES, windowMs: WINDOW })).toBe(true);
  });

  it("is, while a hold ends inside the window", () => {
    // A six hour hold with two hours left is still a window a view can live
    // in — and using the tail of a hold is the whole argument for warming
    // during one.
    expect(
      could({
        usage: usage(),
        pausedUntil: new Date("2026-09-25T12:00:00Z"),
        maturesAfterMs: MATURES,
        windowMs: WINDOW,
      }),
    ).toBe(true);
  });

  it("is not, while a hold outlasts the window", () => {
    // The Friday failure, exactly: viewed at 14:43 against a hold to 14:07 the
    // next day.
    expect(
      could({
        usage: usage(),
        pausedUntil: new Date("2026-09-26T14:07:00Z"),
        maturesAfterMs: MATURES,
        windowMs: WINDOW,
      }),
    ).toBe(false);
  });

  it("is not, once today's invitation allowance is spent", () => {
    // The next invitation is tomorrow, so a view now is a view wasted
    // overnight. This is the failure a hold made obvious and that would have
    // happened quietly every single evening without it.
    expect(
      could({
        usage: usage({ invitesToday: 99, invitesThisWeek: 99 }),
        pausedUntil: null,
        maturesAfterMs: MATURES,
        windowMs: WINDOW,
      }),
    ).toBe(false);
  });

  it("is not, once the working day is nearly over", () => {
    // 17:30 on a Friday: the invitation cannot go before six, so it goes on
    // Monday morning — some sixty hours after the view.
    expect(
      could(
        { usage: usage(), pausedUntil: null, maturesAfterMs: MATURES, windowMs: WINDOW },
        new Date("2026-09-25T17:30:00Z"),
      ),
    ).toBe(false);
  });

  it("is not, outside working hours altogether", () => {
    expect(
      could(
        { usage: usage(), pausedUntil: null, maturesAfterMs: MATURES, windowMs: WINDOW },
        new Date("2026-09-25T22:00:00Z"),
      ),
    ).toBe(false);
  });

  it("ignores the ordinary gap between two actions", () => {
    /*
     * `too_soon` is the two-to-eleven minute pause between any two actions on
     * an account. It is minutes and it is never the reason a view goes stale —
     * counting it would refuse to warm anybody within ten minutes of any other
     * action, which on a busy account is always.
     */
    expect(
      could({
        usage: usage({ lastActionAt: new Date(NOW.getTime() - 30_000) }),
        pausedUntil: null,
        maturesAfterMs: MATURES,
        windowMs: WINDOW,
      }),
    ).toBe(true);
  });

  it("treats an expired hold as no hold", () => {
    // A stale timestamp is not a hold. Reading one as current would stop
    // warming for ever on any account that was ever throttled.
    expect(
      could({
        usage: usage(),
        pausedUntil: new Date("2026-09-25T09:00:00Z"),
        maturesAfterMs: MATURES,
        windowMs: WINDOW,
      }),
    ).toBe(true);
  });

  it("survives a hold date that cannot be parsed", () => {
    // `invites_paused_until` is a string from the database and nothing
    // guarantees it parses. NaN must not become "hold for ever" or "no hold at
    // all" by accident — it has to be a decision somebody made.
    expect(
      could({
        usage: usage(),
        pausedUntil: new Date("not a date"),
        maturesAfterMs: MATURES,
        windowMs: WINDOW,
      }),
    ).toBe(true);
  });
});
