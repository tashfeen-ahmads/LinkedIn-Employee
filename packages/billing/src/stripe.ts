import { createHmac, timingSafeEqual } from "node:crypto";
import type { Plan } from "./entitlement.js";

const API = "https://api.stripe.com/v1";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  fetchImpl?: typeof fetch;
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "StripeError";
  }
}

/**
 * Thin Stripe client: a checkout session, a billing portal link, and webhook
 * verification. Deliberately not the full SDK — this is all the surface the
 * product needs, and every call is one that changes what a customer is charged.
 */
export class StripeClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: StripeConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, form: Record<string, string>): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form),
    });
    const text = await res.text();
    if (!res.ok) throw new StripeError(`Stripe ${path} failed with ${res.status}`, res.status, text);
    return JSON.parse(text) as T;
  }

  async createCheckoutSession(input: {
    workspaceId: string;
    priceId: string;
    quantity: number;
    customerEmail?: string;
    /** An existing Stripe customer, so a returning workspace keeps its history. */
    customerId?: string;
    /** The app trial's end, when it is still running: no charge until then. */
    trialEndsAt?: string | null;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ id: string; url: string }> {
    return this.request<{ id: string; url: string }>("/checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": input.priceId,
      "line_items[0][quantity]": String(input.quantity),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      // The workspace id travels with the subscription so a webhook arriving
      // days later still knows which tenant it belongs to.
      client_reference_id: input.workspaceId,
      "metadata[workspace_id]": input.workspaceId,
      "subscription_data[metadata][workspace_id]": input.workspaceId,
      ...(input.customerId
        ? { customer: input.customerId }
        : input.customerEmail
          ? { customer_email: input.customerEmail }
          : {}),
      // Somebody whose trial has a week to run should not lose it by paying
      // early: the first charge waits until it ends.
      ...(input.trialEndsAt ? { "subscription_data[trial_end]": String(Math.floor(Date.parse(input.trialEndsAt) / 1000)) } : {}),
    });
  }

  async createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
    return this.request<{ url: string }>("/billing_portal/sessions", {
      customer: input.customerId,
      return_url: input.returnUrl,
    });
  }
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * Verifies Stripe's signature header and returns the parsed event.
 *
 * Billing webhooks decide whether a workspace may send, so an unverified one is
 * a free subscription for anyone who can find the URL. The timestamp check
 * stops an old, genuinely-signed event being replayed.
 */
export function verifyStripeWebhook(input: {
  body: string;
  signatureHeader: string;
  secret: string;
  toleranceSeconds?: number;
  now?: Date;
}): StripeEvent {
  const tolerance = input.toleranceSeconds ?? 300;
  const now = input.now ?? new Date();

  const parts = new Map(
    input.signatureHeader
      .split(",")
      .map((part) => part.trim().split("="))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([key, value]) => [key, value] as [string, string]),
  );

  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !signature) throw new Error("Malformed Stripe signature header");

  const age = Math.abs(now.getTime() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > tolerance) throw new Error("Stripe webhook timestamp outside tolerance");

  const expected = createHmac("sha256", input.secret).update(`${timestamp}.${input.body}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid Stripe webhook signature");

  return JSON.parse(input.body) as StripeEvent;
}

/** The four prices, by the lookup key each carries in Stripe. */
export const PRICE_KEYS = ["pro_monthly", "pro_yearly", "autopilot_monthly", "autopilot_yearly"] as const;
export type PriceKey = (typeof PRICE_KEYS)[number];

/**
 * Maps a Stripe price's lookup key onto our plan, or null when it is not one
 * of ours.
 *
 * An unknown key used to read as "trial", so a paying workspace whose price
 * had been renamed in Stripe would have been treated as a lapsed trial and
 * stopped. Null means the caller leaves the plan as it is.
 */
export function planFromPriceLookupKey(lookupKey: string | null | undefined): "pro" | "autopilot" | null {
  const key = (lookupKey ?? "").toLowerCase();
  if (key === "pro" || key.startsWith("pro_")) return "pro";
  if (key === "autopilot" || key.startsWith("autopilot_")) return "autopilot";
  return null;
}

/** Monthly or yearly, from the price's own lookup key. */
export function intervalFromPriceLookupKey(lookupKey: string | null | undefined): "month" | "year" | null {
  const key = (lookupKey ?? "").toLowerCase();
  if (key.endsWith("_yearly") || key.endsWith("_annual")) return "year";
  if (key.endsWith("_monthly")) return "month";
  return null;
}

/** The subscription statuses we store, normalised from Stripe's larger set. */
export function normalizeSubscriptionStatus(
  status: string | null | undefined,
): "active" | "trialing" | "past_due" | "canceled" | "unpaid" | null {
  switch (status) {
    case "active":
    case "trialing":
    case "past_due":
    case "canceled":
    case "unpaid":
      return status;
    case "incomplete_expired":
      return "canceled";
    case "incomplete":
      return "unpaid";
    default:
      return null;
  }
}
