import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TIER_FEATURES } from "@le/billing";
import { RulesOfEngagementSchema } from "@le/shared";
import { FakeDb } from "./fake-db.js";
import { rulesForPlan, workspaceEntitlement, workspaceFeatures } from "../src/billing.js";
import { applyBillingEvent, createServer, subscriptionEventApplies } from "../src/server.js";
import type { WorkerContext } from "../src/context.js";
import type { Queues } from "../src/queues.js";

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

describe("Stripe events that must not land, or must be retried", () => {
  function workspace(extra: Record<string, unknown> = {}) {
    const db = new FakeDb();
    db.seed("workspaces", [
      { id: WS, plan: "pro", subscription_status: null, stripe_subscription_id: null, last_billing_event_at: null, ...extra },
    ]);
    return db;
  }
  const event = (type: string, created: number, id: string, status: string) => ({
    type,
    created,
    data: {
      object: {
        id,
        customer: "cus_1",
        status,
        metadata: { workspace_id: WS },
        items: { data: [{ price: { lookup_key: "pro_monthly" }, quantity: 1 }] },
      },
    },
  });

  it("throws when the workspace cannot be written, so the webhook asks Stripe to retry", async () => {
    const db = workspace();
    const real = db.asDb();
    const failing = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop !== "from") return Reflect.get(target, prop, receiver);
        return (table: string) => {
          const builder = (target as unknown as { from: (t: string) => object }).from(table);
          if (table !== "workspaces") return builder;
          return new Proxy(builder, {
            get(b, p, r) {
              if (p === "update") return () => ({ eq: async () => ({ data: null, error: { message: "connection reset" } }) });
              const value = Reflect.get(b, p, r);
              return typeof value === "function" ? value.bind(b) : value;
            },
          });
        };
      },
    });
    await expect(
      applyBillingEvent({ db: failing }, event("customer.subscription.updated", 1_800_000_000, "sub_1", "active")),
    ).rejects.toThrow(/connection reset/);
  });

  it("ignores a late event about the previous subscription while the current one is live", async () => {
    // The old subscription's `deleted` arriving after a resubscribe would
    // otherwise mark a paying workspace cancelled and stop its campaigns.
    const db = workspace({ stripe_subscription_id: "sub_new", subscription_status: "active", last_billing_event_at: new Date(1_800_000_000_000).toISOString() });
    await applyBillingEvent({ db: db.asDb() }, event("customer.subscription.deleted", 1_800_000_100, "sub_old", "canceled"));
    expect(db.find("workspaces", { id: WS })).toMatchObject({ subscription_status: "active", stripe_subscription_id: "sub_new" });
  });

  it("lets a new subscription take over once the old one has ended, even before its checkout lands", async () => {
    const db = workspace({ stripe_subscription_id: "sub_old", subscription_status: "canceled", last_billing_event_at: new Date(1_800_000_000_000).toISOString() });
    await applyBillingEvent({ db: db.asDb() }, event("customer.subscription.created", 1_800_000_100, "sub_new", "active"));
    expect(db.find("workspaces", { id: WS })).toMatchObject({ subscription_status: "active", stripe_subscription_id: "sub_new" });
  });

  it("settles two events in the same second by where a subscription can go", async () => {
    // Created and activated in one second: active wins, whichever arrives last.
    const db = workspace({ stripe_subscription_id: "sub_1" });
    await applyBillingEvent({ db: db.asDb() }, event("customer.subscription.updated", 1_800_000_000, "sub_1", "active"));
    await applyBillingEvent({ db: db.asDb() }, event("customer.subscription.created", 1_800_000_000, "sub_1", "unpaid"));
    expect(db.find("workspaces", { id: WS })?.subscription_status).toBe("active");
  });

  it("never lets a same-second update reopen a cancelled subscription", async () => {
    // Cancelled is terminal in Stripe, so the pair can only have ended there.
    const db = workspace({ stripe_subscription_id: "sub_1" });
    await applyBillingEvent({ db: db.asDb() }, event("customer.subscription.deleted", 1_800_000_000, "sub_1", "canceled"));
    await applyBillingEvent({ db: db.asDb() }, event("customer.subscription.updated", 1_800_000_000, "sub_1", "active"));
    expect(db.find("workspaces", { id: WS })?.subscription_status).toBe("canceled");
  });

  it("always takes the subscription a completed checkout names", async () => {
    const db = workspace({ stripe_subscription_id: "sub_old", subscription_status: "canceled" });
    await applyBillingEvent(
      { db: db.asDb() },
      { type: "checkout.session.completed", data: { object: { customer: "cus_1", subscription: "sub_new", client_reference_id: WS } } },
    );
    expect(db.find("workspaces", { id: WS })?.stripe_subscription_id).toBe("sub_new");
  });
});

describe("subscriptionEventApplies", () => {
  const base = {
    type: "customer.subscription.updated",
    subscriptionId: "sub_1",
    createdAt: "2026-10-01T00:00:00.000Z",
    stored: { subscriptionId: "sub_1", status: "trialing" as const, lastEventAt: "2026-10-01T00:00:00.000Z" },
  };

  it("applies a same-second move forward and refuses one backward", () => {
    expect(subscriptionEventApplies({ ...base, status: "active" })).toBe(true);
    expect(subscriptionEventApplies({ ...base, status: "unpaid" })).toBe(false);
  });

  it("refuses an older event and applies a newer one", () => {
    expect(subscriptionEventApplies({ ...base, status: "active", createdAt: "2026-09-30T23:59:59.000Z" })).toBe(false);
    expect(subscriptionEventApplies({ ...base, status: "unpaid", createdAt: "2026-10-01T00:00:01.000Z" })).toBe(true);
  });
});

describe("the Stripe webhook and checkout routes", () => {
  const SECRET = "s".repeat(48);
  const WEBHOOK_SECRET = "whsec_test";
  const USER = "22222222-2222-4222-8222-222222222222";
  const configured = {
    APP_URL: "https://app.test",
    INTERNAL_API_SECRET: SECRET,
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICE_PRO_MONTHLY: "price_pm",
    STRIPE_PRICE_PRO_YEARLY: "price_py",
    STRIPE_PRICE_AUTOPILOT_MONTHLY: "price_am",
    STRIPE_PRICE_AUTOPILOT_YEARLY: "price_ay",
  };

  function server(db: FakeDb, env: Record<string, string> = configured) {
    const ctx = { db: db.asDb(), env } as unknown as WorkerContext;
    return createServer(ctx, {} as Queues);
  }

  function signed(body: string) {
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex");
    return { "stripe-signature": `t=${t},v1=${v1}`, "content-type": "application/json" };
  }

  const body = JSON.stringify({
    id: "evt_1",
    type: "customer.subscription.updated",
    created: 1_800_000_000,
    data: { object: { id: "sub_1", customer: "cus_1", status: "active", metadata: { workspace_id: WS }, items: { data: [{ price: { lookup_key: "pro_monthly" }, quantity: 1 }] } } },
  });

  it("answers 500 when the apply fails and records nothing, so Stripe's retry is applied", async () => {
    const db = new FakeDb();
    db.seed("workspaces", [{ id: WS, plan: "trial", subscription_status: null, stripe_subscription_id: null, last_billing_event_at: null }]);
    const real = db.asDb();
    let failNext = true;
    const flaky = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop !== "from") return Reflect.get(target, prop, receiver);
        return (table: string) => {
          const builder = (target as unknown as { from: (t: string) => object }).from(table);
          if (table !== "workspaces" || !failNext) return builder;
          return new Proxy(builder, {
            get(b, p, r) {
              if (p === "update") {
                failNext = false;
                return () => ({ eq: async () => ({ data: null, error: { message: "connection reset" } }) });
              }
              const value = Reflect.get(b, p, r);
              return typeof value === "function" ? value.bind(b) : value;
            },
          });
        };
      },
    });
    const app = createServer({ db: flaky, env: configured } as unknown as WorkerContext, {} as Queues);

    const first = await app.request("/webhooks/stripe", { method: "POST", headers: signed(body), body });
    expect(first.status).toBe(500);
    expect(db.rows("billing_events")).toHaveLength(0);

    const retry = await app.request("/webhooks/stripe", { method: "POST", headers: signed(body), body });
    expect(retry.status).toBe(200);
    expect(db.find("workspaces", { id: WS })?.subscription_status).toBe("active");
    expect(db.rows("billing_events")).toHaveLength(1);

    const again = await app.request("/webhooks/stripe", { method: "POST", headers: signed(body), body });
    expect(await again.json()).toMatchObject({ duplicate: true });
  });

  function checkoutDb(extra: Record<string, unknown> = {}) {
    const db = new FakeDb();
    db.seed("workspaces", [{ id: WS, plan: "trial", subscription_status: null, stripe_subscription_id: null, ...extra }]);
    db.seed("memberships", [{ id: "m1", workspace_id: WS, user_id: USER, role: "owner" }]);
    return db;
  }
  const checkout = (app: ReturnType<typeof createServer>) =>
    app.request("/jobs/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ workspaceId: WS, userId: USER, price: "pro_monthly" }),
    });

  it("refuses a second checkout beside a live subscription, and sends them to billing", async () => {
    for (const status of ["active", "trialing", "past_due"]) {
      const res = await checkout(server(checkoutDb({ stripe_subscription_id: "sub_1", subscription_status: status })));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/Manage billing/);
    }
  });

  it("says payments are not switched on, in plain words, when any price is missing", async () => {
    const { STRIPE_PRICE_AUTOPILOT_YEARLY: _missing, ...partial } = configured;
    const res = await checkout(server(checkoutDb(), partial));
    expect(res.status).toBe(501);
    const { error } = await res.json();
    expect(error).toMatch(/Payments are not switched on yet/);
    expect(error).not.toMatch(/stripe|STRIPE/i);
  });
});
