import { describe, expect, it } from "vitest";
import { TIER_FEATURES } from "@le/billing";
import { RulesOfEngagementSchema } from "@le/shared";
import { FakeDb } from "./fake-db.js";
import { rulesForPlan, workspaceEntitlement, workspaceFeatures } from "../src/billing.js";
import { applyBillingEvent } from "../src/server.js";

const WS = "11111111-1111-4111-8111-111111111111";

describe("rules narrowed to the plan", () => {
  const autopilot = RulesOfEngagementSchema.parse({ mode: "autopilot", autonomy: "autonomous", handOffOnPricing: false });

  it("holds every reply and every pricing question for a person on Pro", () => {
    const rules = rulesForPlan(autopilot, TIER_FEATURES.pro);
    expect(rules).toMatchObject({ mode: "approval", autonomy: "supervised", handOffOnPricing: true });
  });

  it("leaves Autopilot's rules exactly as the campaign set them", () => {
    expect(rulesForPlan(autopilot, TIER_FEATURES.autopilot)).toEqual(autopilot);
  });

  it("only ever narrows: a cautious campaign stays cautious on Autopilot", () => {
    const cautious = RulesOfEngagementSchema.parse({});
    expect(rulesForPlan(cautious, TIER_FEATURES.autopilot)).toEqual(cautious);
  });
});

describe("reading the plan", () => {
  it("gives Pro's features when the workspace cannot be read, the smaller answer", async () => {
    const db = new FakeDb();
    db.seed("workspaces", []);
    expect(await workspaceEntitlement(db.asDb(), WS)).toBeNull();
    expect(await workspaceFeatures(db.asDb(), WS)).toEqual(TIER_FEATURES.pro);
  });
});

describe("Stripe events", () => {
  function workspace(extra: Record<string, unknown> = {}) {
    const db = new FakeDb();
    db.seed("workspaces", [{ id: WS, plan: "trial", subscription_status: null, last_billing_event_at: null, ...extra }]);
    return db;
  }
  const subscription = (created: number, status: string, lookupKey: string) => ({
    type: "customer.subscription.updated",
    created,
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
        status,
        metadata: { workspace_id: WS },
        cancel_at_period_end: false,
        items: { data: [{ price: { lookup_key: lookupKey, recurring: { interval: "year" } }, quantity: 1, current_period_end: 1_900_000_000 }] },
      },
    },
  });

  it("sets the plan, the interval and the status from the subscription", async () => {
    const db = workspace();
    await applyBillingEvent({ db: db.asDb() }, subscription(1_800_000_000, "active", "autopilot_yearly"));
    expect(db.find("workspaces", { id: WS })).toMatchObject({
      plan: "autopilot",
      billing_interval: "year",
      subscription_status: "active",
      stripe_customer_id: "cus_1",
    });
  });

  it("never lets an older event undo a newer one", async () => {
    const db = workspace();
    await applyBillingEvent({ db: db.asDb() }, subscription(1_800_000_100, "canceled", "pro_monthly"));
    await applyBillingEvent({ db: db.asDb() }, subscription(1_800_000_000, "active", "pro_monthly"));
    expect(db.find("workspaces", { id: WS })?.subscription_status).toBe("canceled");
  });

  it("leaves the plan alone for a price it does not recognise, rather than calling it a trial", async () => {
    const db = workspace({ plan: "autopilot" });
    await applyBillingEvent({ db: db.asDb() }, subscription(1_800_000_000, "active", "legacy_gold"));
    expect(db.find("workspaces", { id: WS })?.plan).toBe("autopilot");
  });
});
