import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { intervalFromPriceLookupKey, normalizeSubscriptionStatus, planFromPriceLookupKey, verifyStripeWebhook } from "../src/stripe.js";

const SECRET = "whsec_test";
const NOW = new Date("2026-09-08T12:00:00Z");

function signed(body: string, at: Date = NOW, secret = SECRET): string {
  const timestamp = Math.floor(at.getTime() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

const body = JSON.stringify({
  id: "evt_1",
  type: "customer.subscription.updated",
  data: { object: { status: "active" } },
});

describe("verifyStripeWebhook", () => {
  it("accepts a correctly signed, recent event", () => {
    const event = verifyStripeWebhook({ body, signatureHeader: signed(body), secret: SECRET, now: NOW });
    expect(event.type).toBe("customer.subscription.updated");
  });

  it("rejects a wrong signature", () => {
    const forged = signed(body, NOW, "whsec_attacker");
    expect(() => verifyStripeWebhook({ body, signatureHeader: forged, secret: SECRET, now: NOW })).toThrow(
      /signature/i,
    );
  });

  it("rejects a body altered after signing", () => {
    const header = signed(body);
    const tampered = body.replace("active", "canceled");
    expect(() =>
      verifyStripeWebhook({ body: tampered, signatureHeader: header, secret: SECRET, now: NOW }),
    ).toThrow(/signature/i);
  });

  it("rejects a replayed event outside the tolerance window", () => {
    const old = new Date(NOW.getTime() - 3_600_000);
    expect(() =>
      verifyStripeWebhook({ body, signatureHeader: signed(body, old), secret: SECRET, now: NOW }),
    ).toThrow(/tolerance/i);
  });

  it("rejects a malformed header", () => {
    expect(() =>
      verifyStripeWebhook({ body, signatureHeader: "garbage", secret: SECRET, now: NOW }),
    ).toThrow(/malformed/i);
  });
});

describe("planFromPriceLookupKey", () => {
  it("maps the four prices to their plans, and anything else to nothing", () => {
    expect(planFromPriceLookupKey("pro_monthly")).toBe("pro");
    expect(planFromPriceLookupKey("PRO_YEARLY")).toBe("pro");
    expect(planFromPriceLookupKey("autopilot_monthly")).toBe("autopilot");
    expect(planFromPriceLookupKey("autopilot_yearly")).toBe("autopilot");
    // Never "trial": a paying workspace read as a lapsed trial is stopped.
    expect(planFromPriceLookupKey("mystery")).toBeNull();
    expect(planFromPriceLookupKey(null)).toBeNull();
    expect(intervalFromPriceLookupKey("pro_yearly")).toBe("year");
    expect(intervalFromPriceLookupKey("autopilot_monthly")).toBe("month");
  });
});

describe("normalizeSubscriptionStatus", () => {
  it("maps Stripe's wider status set onto ours", () => {
    expect(normalizeSubscriptionStatus("active")).toBe("active");
    expect(normalizeSubscriptionStatus("incomplete_expired")).toBe("canceled");
    expect(normalizeSubscriptionStatus("incomplete")).toBe("unpaid");
    expect(normalizeSubscriptionStatus("paused")).toBe("unpaid");
    expect(normalizeSubscriptionStatus("something_new")).toBeNull();
  });
});

describe("rolling a signing secret", () => {
  it("accepts a delivery signed with either secret while Stripe signs with both", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    const t = Math.floor(now.getTime() / 1000);
    const body = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated", data: { object: {} } });
    const sig = (secret: string) => createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    const header = `t=${t},v1=${sig("whsec_new")},v1=${sig("whsec_old")}`;
    expect(verifyStripeWebhook({ body, signatureHeader: header, secret: "whsec_old", now }).id).toBe("evt_1");
    expect(verifyStripeWebhook({ body, signatureHeader: header, secret: "whsec_new", now }).id).toBe("evt_1");
    expect(() => verifyStripeWebhook({ body, signatureHeader: header, secret: "whsec_other", now })).toThrow();
  });

  it("reads a paused subscription as stopped, not as an unknown plan", () => {
    expect(normalizeSubscriptionStatus("paused")).toBe("unpaid");
  });
});
