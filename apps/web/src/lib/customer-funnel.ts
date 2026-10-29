import { entitlementFor } from "@le/billing";
import { PLANS } from "./plans";

/**
 * The customer funnel for the operator console: how many workspaces reach
 * each stage, and where the money is.
 *
 * Pure, so the console page and its test read the same thing. Stages are
 * counted per workspace and each is "ever reached", so a stage can never hold
 * more than the one above it in practice; the first is everybody who signed up
 * in the window.
 */

export interface FunnelWorkspace {
  id: string;
  created_at: string;
  plan: string | null;
  trial_ends_at: string | null;
  subscription_status: string | null;
  billing_interval: string | null;
  cancel_at_period_end?: boolean | null;
  /** Set once a workspace subscribes, and kept after a cancellation. */
  stripe_subscription_id?: string | null;
}

export interface FunnelFacts {
  workspaces: readonly FunnelWorkspace[];
  accounts: ReadonlyArray<{ workspace_id: string; provider_account_id: string | null; first_action_at: string | null }>;
  campaigns: ReadonlyArray<{ workspace_id: string; launched_at: string | null }>;
  /** Workspaces that have had at least one reply. */
  replied: ReadonlySet<string>;
}

export type BillingState =
  | "free"
  | "trial"
  | "trial_ended"
  | "subscribed_in_trial"
  | "paying"
  | "past_due"
  | "cancelling"
  | "cancelled";

export const BILLING_STATE_LABEL: Record<BillingState, string> = {
  free: "Free (joined before pricing)",
  trial: "On the free trial",
  trial_ended: "Trial ended, no plan",
  subscribed_in_trial: "Chose a plan, still in trial",
  paying: "Paying",
  past_due: "Payment failed",
  cancelling: "Paying, cancels at period end",
  cancelled: "Cancelled",
};

/** Where a workspace stands with billing, read through the same rule the send path uses. */
export function billingState(w: FunnelWorkspace, now: Date = new Date()): BillingState {
  if (w.plan === "free") return "free";
  const status = w.subscription_status;
  if (status === "canceled" || status === "unpaid") return "cancelled";
  if (status === "past_due") return "past_due";
  if (status === "trialing" && w.trial_ends_at && Date.parse(w.trial_ends_at) > now.getTime()) return "subscribed_in_trial";
  if (status === "active" || status === "trialing") return w.cancel_at_period_end ? "cancelling" : "paying";
  const entitlement = entitlementFor(
    {
      plan: (w.plan ?? "trial") as never,
      trialEndsAt: w.trial_ends_at,
      subscriptionStatus: null,
      seats: 1,
    },
    now,
    { enforceTrial: true },
  );
  return entitlement.canSend ? "trial" : "trial_ended";
}

/** Monthly recurring revenue in dollars: yearly plans count as a twelfth. */
export function monthlyRevenue(w: FunnelWorkspace, now: Date = new Date()): number {
  const state = billingState(w, now);
  if (state !== "paying" && state !== "cancelling" && state !== "past_due") return 0;
  const plan = PLANS.find((p) => p.key === w.plan);
  if (!plan) return 0;
  return w.billing_interval === "year" ? plan.yearly / 12 : plan.monthly;
}

export interface CustomerFunnel {
  steps: Array<{ label: string; value: number; hint: string }>;
  billing: Record<BillingState, number>;
  mrr: number;
  /** Trials ending in the next seven days with no plan chosen, soonest first. */
  endingSoon: Array<{ id: string; endsAt: string }>;
}

export function customerFunnel(facts: FunnelFacts, now: Date = new Date(), sinceDays: number | null = null): CustomerFunnel {
  const since = sinceDays === null ? -Infinity : now.getTime() - sinceDays * 86_400_000;
  const cohort = facts.workspaces.filter((w) => Date.parse(w.created_at) >= since);
  const ids = new Set(cohort.map((w) => w.id));
  const has = (rows: ReadonlyArray<{ workspace_id: string }>, test: (row: never) => boolean) =>
    new Set(rows.filter((row) => ids.has(row.workspace_id) && test(row as never)).map((row) => row.workspace_id));

  const connected = has(facts.accounts, (a: { provider_account_id: string | null }) => Boolean(a.provider_account_id));
  const built = has(facts.campaigns, () => true);
  const launched = has(facts.campaigns, (c: { launched_at: string | null }) => Boolean(c.launched_at));
  const invited = has(facts.accounts, (a: { first_action_at: string | null }) => Boolean(a.first_action_at));
  const replied = new Set([...facts.replied].filter((id) => ids.has(id)));
  // "Ever reached", like every other stage: a workspace that paid and later
  // cancelled still chose a plan, or churn would read as never converting.
  const chose = cohort.filter(
    (w) =>
      Boolean(w.stripe_subscription_id) ||
      ["paying", "cancelling", "past_due", "subscribed_in_trial", "cancelled"].includes(billingState(w, now)),
  );

  const billing = Object.fromEntries(Object.keys(BILLING_STATE_LABEL).map((k) => [k, 0])) as Record<BillingState, number>;
  for (const w of cohort) billing[billingState(w, now)] += 1;

  const week = now.getTime() + 7 * 86_400_000;
  const endingSoon = cohort
    .filter((w) => billingState(w, now) === "trial" && w.trial_ends_at && Date.parse(w.trial_ends_at) <= week)
    .map((w) => ({ id: w.id, endsAt: w.trial_ends_at! }))
    .sort((a, b) => a.endsAt.localeCompare(b.endsAt));

  return {
    steps: [
      { label: "Signed up", value: cohort.length, hint: "Workspaces created" },
      { label: "Connected LinkedIn", value: connected.size, hint: "A LinkedIn account finished connecting" },
      { label: "Built a campaign", value: built.size, hint: "At least one campaign exists" },
      { label: "Launched a campaign", value: launched.size, hint: "At least one campaign was launched" },
      { label: "Sent an invitation", value: invited.size, hint: "Their account sent its first action" },
      { label: "Got a reply", value: replied.size, hint: "At least one prospect replied" },
      { label: "Chose a plan", value: chose.length, hint: "Ever subscribed, including those still in their trial or since cancelled" },
    ],
    billing,
    mrr: Math.round(cohort.reduce((sum, w) => sum + monthlyRevenue(w, now), 0)),
    endingSoon,
  };
}
