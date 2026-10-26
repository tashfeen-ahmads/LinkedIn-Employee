import { TIER_FEATURES, entitlementFor, trialLimitEnforced, type Entitlement, type Features } from "@le/billing";
import type { Db } from "@le/db";

/**
 * What a workspace's plan allows, read once per job.
 *
 * Null when the row could not be read. Callers decide what that means: the
 * send path waits rather than sends (a read that failed is not permission),
 * and the features fall to Pro's, the smaller answer (rule 17).
 */
export async function workspaceEntitlement(db: Db, workspaceId: string, now: Date = new Date()): Promise<Entitlement | null> {
  const { data, error } = await db
    .from("workspaces")
    .select("plan, trial_ends_at, subscription_status, seats")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error || !data) return null;
  return entitlementFor(
    {
      plan: data.plan as never,
      trialEndsAt: data.trial_ends_at,
      subscriptionStatus: (data.subscription_status ?? null) as never,
      seats: data.seats ?? 1,
    },
    now,
    // Read per call rather than once at import, so the switch takes effect on
    // the next job after the variable changes and a test can set it.
    { enforceTrial: trialLimitEnforced(process.env.TRIAL_LIMIT_ENFORCED) },
  );
}

/** The features a workspace has, or Pro's when its plan could not be read. */
export async function workspaceFeatures(db: Db, workspaceId: string, now: Date = new Date()): Promise<Features> {
  return (await workspaceEntitlement(db, workspaceId, now))?.features ?? TIER_FEATURES.pro;
}

/**
 * A campaign's rules, narrowed to what the workspace's plan includes.
 *
 * Pro is "you approve every message": a reply is held for a person however
 * the campaign was set, and a pricing question is never answered on its own.
 * Narrowing only, never widening, and before `applyRules` runs, so the gate
 * itself stays pure (rule 5) and simply reads stricter rules.
 */
export function rulesForPlan<R extends { mode: "approval" | "autopilot"; autonomy: "supervised" | "autonomous"; handOffOnPricing: boolean }>(
  rules: R,
  features: Features,
): R {
  return {
    ...rules,
    ...(features.autopilotReplies ? {} : { mode: "approval" as const, autonomy: "supervised" as const }),
    ...(features.pricingAnswers ? {} : { handOffOnPricing: true }),
  };
}
