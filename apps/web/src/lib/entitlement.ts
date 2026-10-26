import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@le/db";
import { entitlementFor, trialLimitEnforced, type Entitlement } from "@le/billing";
import { BOOT_BEAT } from "@le/shared";

/**
 * Whether a trial's end is actually stopping anybody, as the worker decides it.
 *
 * The worker ends a trial only when somebody could pay — Stripe's keys and all
 * four prices set — and that is the worker's environment, which this app does
 * not have and should not: the web app holds no Stripe secrets. Copying the
 * variables onto the web host as well would be two readings of one rule, and
 * the day they differ the banner says "your trial has ended" over campaigns
 * that are still sending, or says nothing over campaigns that have stopped.
 *
 * So the worker states its answer in its boot heartbeat (`trialEnforced`), and
 * this reads it. A missing or unreadable stamp, or one from a build before the
 * field existed, reads as not enforced: no screen announces a stop it cannot
 * see. `TRIAL_LIMIT_ENFORCED=false` here still turns it off, the emergency
 * switch on both apps.
 */
export function trialEnforcedFromBeat(detail: unknown, envValue: string | undefined): boolean {
  if (!trialLimitEnforced(envValue)) return false;
  if (!detail || typeof detail !== "object") return false;
  return (detail as { trialEnforced?: unknown }).trialEnforced === true;
}

export async function readTrialEnforced(supabase: SupabaseClient<Database>): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("worker_heartbeats")
      .select("detail")
      .eq("name", BOOT_BEAT)
      .maybeSingle();
    if (error || !data) return false;
    return trialEnforcedFromBeat(data.detail, process.env.TRIAL_LIMIT_ENFORCED);
  } catch {
    return false;
  }
}

/**
 * The workspace's entitlement as the worker reads it, for a screen that needs
 * to say what the plan does. Null when the row could not be read: a screen
 * then says nothing about the plan rather than guessing (rule 17).
 */
export async function readWorkspaceEntitlement(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
): Promise<Entitlement | null> {
  const [{ data, error }, enforceTrial] = await Promise.all([
    supabase.from("workspaces").select("plan, trial_ends_at, subscription_status, seats").eq("id", workspaceId).maybeSingle(),
    readTrialEnforced(supabase),
  ]);
  if (error || !data) return null;
  return entitlementFor(
    {
      plan: data.plan as never,
      trialEndsAt: data.trial_ends_at ?? null,
      subscriptionStatus: (data.subscription_status ?? null) as never,
      seats: data.seats ?? 1,
    },
    new Date(),
    { enforceTrial },
  );
}

/** The line a Pro workspace reads beside the reply setting, or null when its plan answers on its own. */
export function replyPlanNote(entitlement: Entitlement | null): string | null {
  if (!entitlement || entitlement.features.autopilotReplies) return null;
  return "On Pro, every reply waits for you to approve it, whatever this says. Autopilot sends them for you.";
}
