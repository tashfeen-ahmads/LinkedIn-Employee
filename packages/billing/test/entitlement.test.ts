import { describe, expect, it } from "vitest";
import {
  billingConfigured,
  trialDaysLeft as daysLeft,
  trialEnforced,
  entitlementFor as entitlementForAnyMode,
  entitlementMessage,
  TIER_FEATURES,
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
    // Seats are not what the plans price; only a cancelled workspace has none.
    expect(withinSeatLimit(billing({ plan: "pro", seats: 5 }), 5)).toBe(true);
    expect(withinSeatLimit(billing({ plan: "canceled", seats: 0 }), 1)).toBe(false);
  });
});

describe("entitlementMessage", () => {
  it("explains a block without blaming the customer", () => {
    const expired = entitlementMessage(entitlementFor(billing({ trialEndsAt: inDays(-1) }), NOW));
    expect(expired).toContain("Nothing has been deleted");
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

  it("is on unless the variable says exactly false", () => {
    // Pricing is decided, and every workspace from before it is on the free
    // plan the trial never touches, so on is the default and off is the
    // deliberate act.
    expect(trialLimitEnforced(undefined)).toBe(true);
    expect(trialLimitEnforced("")).toBe(true);
    expect(trialLimitEnforced("true")).toBe(true);
    expect(trialLimitEnforced("false")).toBe(false);
    expect(trialLimitEnforced(" FALSE ")).toBe(false);
  });
});

describe("plans", () => {
  it("keeps everybody who joined while it was free on everything, for good", () => {
    const result = entitlementFor(billing({ plan: "free", trialEndsAt: inDays(-90) }), NOW);
    expect(result).toMatchObject({ canSend: true, reason: "free_plan", tier: "autopilot", trialDaysLeft: null });
    expect(result.features.autopilotReplies).toBe(true);
  });

  it("gives a trial every Autopilot feature", () => {
    const result = entitlementFor(billing({ trialEndsAt: inDays(5) }), NOW);
    expect(result.tier).toBe("autopilot");
    expect(result.features).toEqual(TIER_FEATURES.autopilot);
  });

  it("separates the paid plans by what Nora does on its own, never by what it sends", () => {
    const pro = entitlementFor(billing({ plan: "pro", subscriptionStatus: "active" }), NOW);
    const autopilot = entitlementFor(billing({ plan: "autopilot", subscriptionStatus: "active" }), NOW);
    expect(pro.canSend && autopilot.canSend).toBe(true);
    expect(pro.features).toEqual({ autopilotReplies: false, autoBooking: false, pricingAnswers: false, crmSync: false });
    expect(autopilot.features).toEqual({ autopilotReplies: true, autoBooking: true, pricingAnswers: true, crmSync: true });
  });

  it("reads the old plan names as Pro", () => {
    expect(entitlementFor(billing({ plan: "solo", subscriptionStatus: "active" }), NOW).tier).toBe("pro");
  });
});

describe("choosing a plan during the trial", () => {
  it("keeps Autopilot until the trial ends, even on Pro", () => {
    // Stripe's first charge is the trial's end; until then the workspace has
    // what it was promised.
    const result = entitlementFor(
      billing({ plan: "pro", subscriptionStatus: "trialing", trialEndsAt: inDays(9) }),
      NOW,
    );
    expect(result).toMatchObject({ canSend: true, reason: "active_subscription", tier: "autopilot" });
    expect(result.features).toEqual(TIER_FEATURES.autopilot);
  });

  it("drops to Pro once the trial's end has passed", () => {
    const result = entitlementFor(
      billing({ plan: "pro", subscriptionStatus: "trialing", trialEndsAt: inDays(-1) }),
      NOW,
    );
    expect(result.tier).toBe("pro");
  });

  it("is Pro on an active Pro subscription, whatever the old trial date says", () => {
    const result = entitlementFor(billing({ plan: "pro", subscriptionStatus: "active", trialEndsAt: inDays(9) }), NOW);
    expect(result.tier).toBe("pro");
  });
});

describe("whether the trial is enforced on a deployment", () => {
  const configured = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_WEBHOOK_SECRET: "whsec",
    STRIPE_PRICE_PRO_MONTHLY: "price_1",
    STRIPE_PRICE_PRO_YEARLY: "price_2",
    STRIPE_PRICE_AUTOPILOT_MONTHLY: "price_3",
    STRIPE_PRICE_AUTOPILOT_YEARLY: "price_4",
  };

  it("is on only when somebody could actually pay", () => {
    expect(billingConfigured(configured)).toBe(true);
    expect(trialEnforced(configured)).toBe(true);
  });

  it("pauses nobody when Stripe is not configured", () => {
    // A trial ended on a deployment that cannot take a payment is a stop
    // nobody can lift.
    expect(trialEnforced({})).toBe(false);
    expect(trialEnforced({ ...configured, STRIPE_SECRET_KEY: "" })).toBe(false);
  });

  it("pauses nobody when any one of the four prices is missing", () => {
    expect(trialEnforced({ ...configured, STRIPE_PRICE_AUTOPILOT_YEARLY: undefined })).toBe(false);
  });

  it("still honours the emergency switch", () => {
    expect(trialEnforced({ ...configured, TRIAL_LIMIT_ENFORCED: "false" })).toBe(false);
  });
});
