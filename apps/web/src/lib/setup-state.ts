import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@le/db";
import { nextStep, type OnboardingState, type OnboardingStep } from "@le/shared";
import { hasToldUsWhatTheySell, readStrategyState } from "./strategy-state";

/**
 * Where this workspace has got to, read once and used everywhere.
 *
 * The dashboard computed these seven facts inline and the sidebar computed
 * none of them, so the nav could not say which section needed the person and
 * the dashboard could not put the answer anywhere prominent. Two screens
 * disagreeing about what is finished is the failure mode this product keeps
 * finding — the checklist and the nudge emails already share one definition
 * (`ONBOARDING_STEPS`), and this is the other half: one reading of the facts
 * that definition is evaluated against.
 *
 * Every query is a `head: true` count. This runs on every page load through the
 * layout, so it must stay cheap enough to be invisible.
 */
export async function readSetupState(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
): Promise<{ state: OnboardingState; next: OnboardingStep | null }> {
  const head = { count: "exact" as const, head: true };

  const [business, approved, account, campaign, launched, knowledge] = await Promise.all([
    supabase.from("business_profiles").select("id", head).eq("workspace_id", workspaceId),
    supabase
      .from("customer_profiles")
      .select("id", head)
      .eq("workspace_id", workspaceId)
      .not("approved_at", "is", null),
    supabase
      .from("linkedin_accounts")
      .select("id", head)
      .eq("workspace_id", workspaceId)
      .eq("status", "active"),
    supabase.from("campaigns").select("id", head).eq("workspace_id", workspaceId),
    supabase
      .from("campaigns")
      .select("id", head)
      .eq("workspace_id", workspaceId)
      .not("launched_at", "is", null),
    supabase.from("knowledge_documents").select("id", head).eq("workspace_id", workspaceId),
  ]);

  const any = (result: { count: number | null }) => (result.count ?? 0) > 0;
  const strategy = await readStrategyState(supabase, workspaceId, any(business));

  const state: OnboardingState = {
    // Ticked when the person has done their part, not when the agent has
    // finished its own: this step's only output is written by the Strategy
    // Agent, and reading its absence as "they have not filled in the form"
    // told a real tester for twenty-one minutes that they had not.
    hasBusinessProfile: hasToldUsWhatTheySell(strategy),
    hasApprovedProfile: any(approved),
    hasLinkedInAccount: any(account),
    hasCampaign: any(campaign),
    hasLaunchedCampaign: any(launched),
    hasCalendar: false,
    hasKnowledge: any(knowledge),
  };

  return { state, next: nextStep(state) };
}
