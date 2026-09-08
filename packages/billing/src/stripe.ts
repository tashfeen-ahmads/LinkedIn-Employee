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
      ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
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

/** Maps a Stripe price nickname or lookup key onto our plan names. */
export function planFromPriceLookupKey(lookupKey: string | null | undefined): Plan {
  switch ((lookupKey ?? "").toLowerCase()) {
    case "solo":
      return "solo";
    case "pro":
      return "pro";
    case "teams":
      return "teams";
    default:
      return "trial";
  }
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
