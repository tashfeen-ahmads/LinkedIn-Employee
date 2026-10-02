import { describe, expect, it } from "vitest";
import {
  daysLeft,
  entitlementFor as entitlementForAnyMode,
  entitlementMessage,
  trialLimitEnforced,
  withinSeatLimit,
  type WorkspaceBilling,
} from "../src/entitlement.js";

/**
 * Every test below the switch describes the trial *as enforced* — which is how
 * it will behave the day pricing is decided and `TRIAL_LIMIT_ENFORCED` goes
 * on. They pin the limit on explicitly so that behaviour stays proven while it
 * is suspended: a limit nobody tests is a limit nobody can safely turn back on.
 */
const entitlementFor = (b: WorkspaceBilling, now?: Date) =>
  entitlementForAnyMode(b, now, { enforceTrial: true });

const NOW = new Date("2026-09-08T12:00:00Z");

function billing(overrides: Partial<WorkspaceBilling> = {}): WorkspaceBilling {
  return { plan: "trial", trialEndsAt: null, seats: 1, ...overrides };
}

function inDays(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString();
}

describe("entitlementFor", () => {
  it("lets an active subscription send", () => {
    const result = entitlementFor(billing({ plan: "pro", subscriptionStatus: "active" }), NOW);
    expect(result).toMatchObject({ canSend: true, reason: "active_subscription" });
  });

  it("lets a live trial send", () => {
    const result = entitlementFor(billing({ trialEndsAt: inDays(3) }), NOW);
    expect(result.canSend).toBe(true);
    expect(result.trialDaysLeft).toBe(3);
  });

  it("stops sending the moment a trial expires", () => {
    const result = entitlementFor(billing({ trialEndsAt: inDays(-1) }), NOW);
    expect(result).toMatchObject({ canSend: false, reason: "trial_expired", trialDaysLeft: 0 });
  });

  it("keeps the record readable after a trial expires", () => {
    // Locking a customer out of conversations their own reps had would be
    // indefensible, whatever the billing state.
    expect(entitlementFor(billing({ trialEndsAt: inDays(-30) }), NOW).canRead).toBe(true);
  });

  it("keeps sending while a payment is merely past due", () => {
    const result = entitlementFor(billing({ plan: "pro", subscriptionStatus: "past_due" }), NOW);
    expect(result).toMatchObject({ canSend: true, reason: "payment_failed" });
  });

  it("stops sending once a subscription is canceled", () => {
    const result = entitlementFor(billing({ plan: "pro", subscriptionStatus: "canceled" }), NOW);
    expect(result).toMatchObject({ canSend: false, canRead: true, reason: "subscription_canceled" });
  });

  it("stops sending on an unpaid subscription", () => {
    expect(entitlementFor(billing({ plan: "pro", subscriptionStatus: "unpaid" }), NOW).canSend).toBe(false);
  });

  it("fails closed when a paid plan has no subscription record", () => {
    const result = entitlementFor(billing({ plan: "pro", subscriptionStatus: null }), NOW);
    expect(result).toMatchObject({ canSend: false, reason: "no_plan" });
  });

  it("fails closed on a trial plan with no trial date", () => {
    expect(entitlementFor(billing({ plan: "trial", trialEndsAt: null }), NOW).canSend).toBe(false);
  });

  it("an active subscription outranks an expired trial date", () => {
    const result = entitlementFor(
      billing({ plan: "pro", subscriptionStatus: "active", trialEndsAt: inDays(-10) }),
      NOW,
    );
    expect(result.canSend).toBe(true);
  });
});

describe("daysLeft", () => {
  it("floors partial days", () => {
    expect(daysLeft(new Date(NOW.getTime() + 2.9 * 86_400_000).toISOString(), NOW)).toBe(2);
  });

  it("never goes negative", () => {
    expect(daysLeft(inDays(-5), NOW)).toBe(0);
  });

  it("returns null for a missing or unparseable date", () => {
    expect(daysLeft(null, NOW)).toBeNull();
    expect(daysLeft("not a date", NOW)).toBeNull();
  });
});

describe("withinSeatLimit", () => {
  it("allows a team up to its plan's seats", () => {
    expect(withinSeatLimit(billing({ plan: "pro", seats: 5 }), 5)).toBe(true);
    expect(withinSeatLimit(billing({ plan: "solo", seats: 1 }), 2)).toBe(false);
  });
});

describe("entitlementMessage", () => {
  it("explains a block without blaming the customer", () => {
    const expired = entitlementMessage(entitlementFor(billing({ trialEndsAt: inDays(-1) }), NOW));
    expect(expired).toContain("nothing has been deleted");
  });

  it("says nothing when sending is fine", () => {
    expect(entitlementMessage(entitlementFor(billing({ trialEndsAt: inDays(2) }), NOW))).toBeNull();
  });
});

describe("trial boundary", () => {
  it("keeps sending on the final day, when the floored day count is already zero", () => {
    // Ending a seven-day trial after six is a bug the customer notices.
    const hoursLeft = new Date(NOW.getTime() + 6 * 3_600_000).toISOString();
    const result = entitlementFor(billing({ trialEndsAt: hoursLeft }), NOW);
    expect(result.trialDaysLeft).toBe(0);
    expect(result.canSend).toBe(true);
    expect(result.reason).toBe("trial_active");
  });

  it("stops the moment the trial instant passes", () => {
    const justGone = new Date(NOW.getTime() - 1000).toISOString();
    expect(entitlementFor(billing({ trialEndsAt: justGone }), NOW).canSend).toBe(false);
  });
});

/*
 * The trial limit while it is switched off — the default until pricing and the
 * trial are decided.
 *
 * Nobody should find their campaigns paused by an end date that was only ever
 * a placeholder, so every trial workspace sends, existing and new, whatever
 * its `trial_ends_at` says. Only the trial is suspended: a subscription that
 * was cancelled or went unpaid is somebody's decision and still stops sending.
 */
describe("with the trial limit off (the default)", () => {
  it("lets an expired trial keep sending", () => {
    const result = entitlementForAnyMode(billing({ trialEndsAt: inDays(-30) }), NOW);
    expect(result.canSend).toBe(true);
    expect(result.reason).toBe("trial_unlimited");
  });

  it("lets a trial with no date at all send", () => {
    // Fails closed when enforced; open while the limit is suspended.
    expect(entitlementForAnyMode(billing({ trialEndsAt: null }), NOW).canSend).toBe(true);
  });

  it("shows no countdown, so no screen can say a trial is ending", () => {
    // A sidebar reading "2 days left" over an account that keeps sending on
    // day three lies in the direction that makes people panic.
    expect(entitlementForAnyMode(billing({ trialEndsAt: inDays(2) }), NOW).trialDaysLeft).toBeNull();
  });

  it("says nothing alarming", () => {
    expect(entitlementMessage(entitlementForAnyMode(billing({ trialEndsAt: inDays(-1) }), NOW))).toBeNull();
  });

  it("still stops a cancelled subscription", () => {
    // Suspending the placeholder must not suspend a real decision.
    const result = entitlementForAnyMode(billing({ plan: "pro", subscriptionStatus: "canceled" }), NOW);
    expect(result.canSend).toBe(false);
  });

  it("is off unless the variable says exactly true", () => {
    // Off by default means unset, empty and anything ambiguous all read as
    // off — the safe direction while there is no price to charge.
    expect(trialLimitEnforced(undefined)).toBe(false);
    expect(trialLimitEnforced("")).toBe(false);
    expect(trialLimitEnforced("false")).toBe(false);
    expect(trialLimitEnforced("1")).toBe(false);
    expect(trialLimitEnforced("true")).toBe(true);
    expect(trialLimitEnforced(" TRUE ")).toBe(true);
  });
});
