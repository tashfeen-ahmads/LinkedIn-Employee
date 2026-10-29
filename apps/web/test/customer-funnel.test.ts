import { describe, expect, it } from "vitest";
import { billingState, customerFunnel, monthlyRevenue, type FunnelWorkspace } from "@/lib/customer-funnel";

/*
 * The operator's funnel from sign-up to paying. Billing states are read
 * through the same entitlement rule the send path uses, so the console can
 * never call a workspace paused that is still sending, or the reverse.
 */
const NOW = new Date("2026-10-28T12:00:00Z");
const ws = (over: Partial<FunnelWorkspace>): FunnelWorkspace => ({
  id: "w",
  created_at: "2026-10-20T00:00:00Z",
  plan: "trial",
  trial_ends_at: "2026-11-03T00:00:00Z",
  subscription_status: null,
  billing_interval: null,
  cancel_at_period_end: false,
  ...over,
});

describe("billingState", () => {
  it("tells every state apart", () => {
    expect(billingState(ws({ plan: "free", trial_ends_at: null }), NOW)).toBe("free");
    expect(billingState(ws({}), NOW)).toBe("trial");
    expect(billingState(ws({ trial_ends_at: "2026-10-27T00:00:00Z" }), NOW)).toBe("trial_ended");
    expect(billingState(ws({ plan: "pro", subscription_status: "trialing" }), NOW)).toBe("subscribed_in_trial");
    expect(billingState(ws({ plan: "pro", subscription_status: "active" }), NOW)).toBe("paying");
    expect(billingState(ws({ plan: "pro", subscription_status: "active", cancel_at_period_end: true }), NOW)).toBe("cancelling");
    expect(billingState(ws({ plan: "pro", subscription_status: "past_due" }), NOW)).toBe("past_due");
    expect(billingState(ws({ plan: "pro", subscription_status: "canceled" }), NOW)).toBe("cancelled");
  });
});

describe("monthly revenue", () => {
  it("counts paying plans, yearly as a twelfth, and nothing else", () => {
    expect(monthlyRevenue(ws({ plan: "pro", subscription_status: "active", billing_interval: "month" }), NOW)).toBe(99);
    expect(monthlyRevenue(ws({ plan: "autopilot", subscription_status: "active", billing_interval: "year" }), NOW)).toBeCloseTo(1790 / 12);
    expect(monthlyRevenue(ws({}), NOW)).toBe(0);
    expect(monthlyRevenue(ws({ plan: "pro", subscription_status: "trialing" }), NOW)).toBe(0);
  });
});

describe("customerFunnel", () => {
  it("counts each workspace once per stage, within the period", () => {
    const funnel = customerFunnel(
      {
        workspaces: [
          ws({ id: "a" }),
          ws({ id: "b", plan: "pro", subscription_status: "active", billing_interval: "month" }),
          ws({ id: "old", created_at: "2026-01-01T00:00:00Z" }),
        ],
        accounts: [
          { workspace_id: "a", provider_account_id: "x", first_action_at: null },
          { workspace_id: "b", provider_account_id: "y", first_action_at: "2026-10-21T00:00:00Z" },
          { workspace_id: "b", provider_account_id: "z", first_action_at: null },
        ],
        campaigns: [
          { workspace_id: "b", launched_at: "2026-10-21T00:00:00Z" },
          { workspace_id: "b", launched_at: null },
        ],
        replied: new Set(["b", "old"]),
      },
      NOW,
      30,
    );
    expect(funnel.steps.map((s) => s.value)).toEqual([2, 2, 1, 1, 1, 1, 1]);
    expect(funnel.mrr).toBe(99);
    expect(funnel.endingSoon.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("chose a plan", () => {
  it("counts a workspace that paid and later cancelled", () => {
    const funnel = customerFunnel(
      {
        workspaces: [ws({ id: "gone", plan: "pro", subscription_status: "canceled", stripe_subscription_id: "sub_1" })],
        accounts: [],
        campaigns: [],
        replied: new Set(),
      },
      NOW,
      null,
    );
    expect(funnel.steps.at(-1)!.value).toBe(1);
    expect(funnel.billing.cancelled).toBe(1);
  });
});
