export type Plan = "trial" | "solo" | "pro" | "teams" | "canceled";

export interface WorkspaceBilling {
  plan: Plan;
  /** ISO timestamp, or null when the workspace never had a trial. */
  trialEndsAt: string | null;
  /** Present once Stripe reports an active or past-due subscription. */
  subscriptionStatus?: "active" | "trialing" | "past_due" | "canceled" | "unpaid" | null;
  seats: number;
}

export type EntitlementReason =
  | "active_subscription"
  | "trial_active"
  | "trial_expired"
  | "subscription_canceled"
  | "payment_failed"
  | "seat_limit_exceeded"
  | "no_plan";

export interface Entitlement {
  /** May this workspace start new outreach right now? */
  canSend: boolean;
  /** May people still sign in and read what happened? Almost always yes. */
  canRead: boolean;
  reason: EntitlementReason;
  /** Whole days left in the trial, floored. Null outside a trial. */
  trialDaysLeft: number | null;
}

/**
 * Whether a workspace may send.
 *
 * Two rules shape this. Sending is what costs us money and costs the customer
 * their LinkedIn account's goodwill, so it stops the moment they stop paying.
 * Reading never stops: locking someone out of the record of conversations
 * their own reps had would be indefensible, and a past-due card is usually an
 * expired card, not a decision to leave.
 */
export function entitlementFor(billing: WorkspaceBilling, now: Date = new Date()): Entitlement {
  const trialDaysLeft = daysLeft(billing.trialEndsAt, now);

  if (billing.subscriptionStatus === "active" || billing.subscriptionStatus === "trialing") {
    return { canSend: true, canRead: true, reason: "active_subscription", trialDaysLeft };
  }

  // Past due keeps sending for now: Stripe retries a failed payment for days,
  // and cutting a paying customer off over a card that expired on Tuesday
  // loses the campaign, not just the invoice.
  if (billing.subscriptionStatus === "past_due") {
    return { canSend: true, canRead: true, reason: "payment_failed", trialDaysLeft };
  }

  if (billing.subscriptionStatus === "canceled" || billing.subscriptionStatus === "unpaid") {
    return { canSend: false, canRead: true, reason: "subscription_canceled", trialDaysLeft };
  }

  if (billing.plan === "trial") {
    if (trialDaysLeft !== null && trialDaysLeft > 0) {
      return { canSend: true, canRead: true, reason: "trial_active", trialDaysLeft };
    }
    return { canSend: false, canRead: true, reason: "trial_expired", trialDaysLeft: 0 };
  }

  if (billing.plan === "canceled") {
    return { canSend: false, canRead: true, reason: "subscription_canceled", trialDaysLeft };
  }

  // A paid plan name with no subscription record means the two sides have
  // drifted. Fail closed on sending rather than give away the product.
  return { canSend: false, canRead: true, reason: "no_plan", trialDaysLeft };
}

/** Whole days remaining, floored at zero. Null when there is no trial. */
export function daysLeft(trialEndsAt: string | null, now: Date = new Date()): number | null {
  if (!trialEndsAt) return null;
  const end = Date.parse(trialEndsAt);
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.floor((end - now.getTime()) / 86_400_000));
}

export const PLAN_SEATS: Record<Plan, number> = {
  trial: 1,
  solo: 1,
  pro: 5,
  teams: 100,
  canceled: 0,
};

export function withinSeatLimit(billing: WorkspaceBilling, memberCount: number): boolean {
  return memberCount <= Math.max(billing.seats, PLAN_SEATS[billing.plan] ?? 0);
}

/** Message shown in the app when sending is blocked. */
export function entitlementMessage(entitlement: Entitlement): string | null {
  switch (entitlement.reason) {
    case "trial_expired":
      return "Your trial has ended. Campaigns are paused until you choose a plan; nothing has been deleted.";
    case "subscription_canceled":
      return "Your subscription has ended. Campaigns are paused, and your conversations remain readable.";
    case "payment_failed":
      return "We could not charge your card. Campaigns keep running for now — please update your payment details.";
    case "no_plan":
      return "We could not confirm your plan. Campaigns are paused; get in touch and we will sort it out.";
    default:
      return null;
  }
}
