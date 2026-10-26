/**
 * `free` is every workspace that signed up while the product was free: it
 * keeps everything, for good, and is never asked to choose a plan. `trial` is
 * fourteen days of Autopilot with no card. `pro` and `autopilot` are paid.
 * `solo` and `teams` are older names nothing writes any more, read as Pro.
 */
export type Plan = "free" | "trial" | "pro" | "autopilot" | "solo" | "teams" | "canceled";

/** What separates the paid plans: how much Nora does on its own, never how much it sends. */
export type Tier = "pro" | "autopilot";

export interface Features {
  /** Replies sent without a person approving each one. */
  autopilotReplies: boolean;
  /** A meeting booked as soon as somebody accepts a time, without a person confirming it. */
  autoBooking: boolean;
  /** Pricing questions answered from the business's own facts rather than held. */
  pricingAnswers: boolean;
  /** Contacts and meetings written to the customer's CRM. */
  crmSync: boolean;
}

export const TIER_FEATURES: Record<Tier, Features> = {
  pro: { autopilotReplies: false, autoBooking: false, pricingAnswers: false, crmSync: false },
  autopilot: { autopilotReplies: true, autoBooking: true, pricingAnswers: true, crmSync: true },
};

/** The trial is fourteen days of the top plan, with no card. */
export const TRIAL_DAYS = 14;

export interface WorkspaceBilling {
  plan: Plan;
  /** ISO timestamp, or null when the workspace never had a trial. */
  trialEndsAt: string | null;
  /** Present once Stripe reports an active or past-due subscription. */
  subscriptionStatus?: "active" | "trialing" | "past_due" | "canceled" | "unpaid" | null;
  seats: number;
}

export type EntitlementReason =
  /** Signed up while the product was free, and keeps it. */
  | "free_plan"
  | "active_subscription"
  | "trial_active"
  /** A trial workspace while the trial's end date is not being enforced. */
  | "trial_unlimited"
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
  /** Which plan's features apply. A trial is Autopilot; a lapsed account is Pro. */
  tier: Tier;
  features: Features;
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
export function entitlementFor(
  billing: WorkspaceBilling,
  now: Date = new Date(),
  options: { enforceTrial?: boolean } = {},
): Entitlement {
  const enforceTrial = options.enforceTrial ?? false;
  // No countdown anywhere while there is nothing to count down to: a sidebar
  // reading "2 days left" over an account that will keep sending on day three
  // is a screen that lies in the direction that makes people panic.
  const trialDaysLeft = enforceTrial && billing.plan === "trial" ? daysLeft(billing.trialEndsAt, now) : null;
  const paidTier: Tier = billing.plan === "autopilot" ? "autopilot" : "pro";
  const result = (canSend: boolean, reason: EntitlementReason, tier: Tier): Entitlement => ({
    canSend,
    canRead: true,
    reason,
    trialDaysLeft,
    tier,
    features: TIER_FEATURES[tier],
  });

  // Everybody who joined while the product was free keeps it, with every
  // feature, and no screen ever asks them to choose a plan.
  if (billing.plan === "free") return result(true, "free_plan", "autopilot");

  if (billing.subscriptionStatus === "active" || billing.subscriptionStatus === "trialing") {
    return result(true, "active_subscription", paidTier);
  }

  // Past due keeps sending for now: Stripe retries a failed payment for days,
  // and cutting a paying customer off over a card that expired on Tuesday
  // loses the campaign, not just the invoice.
  if (billing.subscriptionStatus === "past_due") return result(true, "payment_failed", paidTier);

  if (billing.subscriptionStatus === "canceled" || billing.subscriptionStatus === "unpaid") {
    return result(false, "subscription_canceled", "pro");
  }

  if (billing.plan === "trial") {
    if (!enforceTrial) return result(true, "trial_unlimited", "autopilot");
    // Compare the instant, not the floored day count: trialDaysLeft is 0 for
    // the whole of the final day, and reading it as expiry would end a
    // fourteen-day trial after thirteen.
    const endsAt = billing.trialEndsAt ? Date.parse(billing.trialEndsAt) : NaN;
    if (Number.isFinite(endsAt) && endsAt > now.getTime()) return result(true, "trial_active", "autopilot");
    return { ...result(false, "trial_expired", "pro"), trialDaysLeft: 0 };
  }

  if (billing.plan === "canceled") return result(false, "subscription_canceled", "pro");

  // A paid plan name with no subscription record means the two sides have
  // drifted. Fail closed on sending rather than give away the product.
  return result(false, "no_plan", "pro");
}

/**
 * Whether a trial's end date stops anything. On unless explicitly turned off.
 *
 * `TRIAL_LIMIT_ENFORCED=false` on both the web app and the worker suspends it
 * with no code change, for an emergency. Everything the limit does is tested
 * with it on.
 *
 * Only the trial is suspended. A cancelled or unpaid subscription still stops
 * sending, because that is somebody's decision, not a placeholder.
 *
 * One parser for both apps, so the sidebar and the sending loop cannot read
 * the same variable two different ways — the screen saying "trial ended" while
 * the loop keeps sending is the drift this exists to prevent.
 */
export function trialLimitEnforced(value: string | undefined): boolean {
  // On unless explicitly turned off, now that pricing is decided. Every
  // workspace from before it is on the `free` plan, which the trial never
  // touches, so this only ever reaches somebody who signed up into a trial.
  return value?.trim().toLowerCase() !== "false";
}

/** Whole days remaining, floored at zero. Null when there is no trial. */
export function daysLeft(trialEndsAt: string | null, now: Date = new Date()): number | null {
  if (!trialEndsAt) return null;
  const end = Date.parse(trialEndsAt);
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.floor((end - now.getTime()) / 86_400_000));
}

/** Seats are not what the plans price, so no paid plan limits them. */
export const PLAN_SEATS: Record<Plan, number> = {
  free: 100,
  trial: 100,
  pro: 100,
  autopilot: 100,
  solo: 100,
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
      return "Your free trial has ended. Campaigns are paused until you choose a plan. Nothing has been deleted.";
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
