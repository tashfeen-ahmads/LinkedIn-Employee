import { describe, expect, it } from "vitest";
import {
  daysLeft,
  entitlementFor,
  entitlementMessage,
  withinSeatLimit,
  type WorkspaceBilling,
} from "../src/entitlement.js";

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
