import { describe, expect, it } from "vitest";
import { TIER_FEATURES, entitlementFor } from "@le/billing";
import { replyPlanNote, trialEnforcedFromBeat } from "../src/lib/entitlement";

/**
 * The web app holds no Stripe secrets, so whether a trial's end stops anybody
 * is read from the worker's own boot stamp. The banner saying "your trial has
 * ended" over campaigns the worker is still sending is the drift this exists
 * to prevent.
 */
describe("trialEnforcedFromBeat", () => {
  it("follows what the worker said it enforces", () => {
    expect(trialEnforcedFromBeat({ trialEnforced: true }, undefined)).toBe(true);
    expect(trialEnforcedFromBeat({ trialEnforced: false }, undefined)).toBe(false);
  });

  it("announces no stop it cannot see: a missing stamp, or one from before the field, is not enforced", () => {
    expect(trialEnforcedFromBeat(null, undefined)).toBe(false);
    expect(trialEnforcedFromBeat({ commit: "abc" }, undefined)).toBe(false);
    expect(trialEnforcedFromBeat("true", undefined)).toBe(false);
  });

  it("still honours the emergency switch on the web app", () => {
    expect(trialEnforcedFromBeat({ trialEnforced: true }, "false")).toBe(false);
  });
});

describe("replyPlanNote", () => {
  const NOW = new Date("2026-10-01T12:00:00Z");
  it("tells a Pro workspace its replies wait for it", () => {
    const pro = entitlementFor({ plan: "pro", trialEndsAt: null, subscriptionStatus: "active", seats: 1 }, NOW);
    expect(pro.features).toEqual(TIER_FEATURES.pro);
    expect(replyPlanNote(pro)).toMatch(/On Pro, every reply waits for you/);
  });

  it("says nothing on Autopilot, or when the plan could not be read", () => {
    const autopilot = entitlementFor({ plan: "autopilot", trialEndsAt: null, subscriptionStatus: "active", seats: 1 }, NOW);
    expect(replyPlanNote(autopilot)).toBeNull();
    expect(replyPlanNote(null)).toBeNull();
  });
});
