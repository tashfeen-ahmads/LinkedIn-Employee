import "server-only";
import type { Db } from "@le/db";
import { readOnboardingStash, type OnboardingStash } from "@/lib/onboarding-stash";
import type { WizardFacts } from "@/lib/wizard";

/** This person's own LinkedIn account row, as the onboarding steps read it. */
export interface WizardAccount {
  id: string;
  status: string;
  status_detail: string | null;
  provider_account_id: string | null;
  display_name: string | null;
  has_premium: boolean | null;
  has_sales_navigator: boolean | null;
  working_hours: unknown;
}

export interface WizardRead {
  workspaceId: string | null;
  workspaceName: string | null;
  stash: OnboardingStash;
  account: WizardAccount | null;
  facts: WizardFacts;
}

/**
 * Everything the onboarding steps decide from, read for one person.
 *
 * From rows, never from which buttons were pressed: a LinkedIn step that
 * counted a press of Connect as connected is how a rep came to sit on a
 * "connecting" row for three days while every screen said otherwise.
 */
export async function readWizard(supabase: Db, userId: string): Promise<WizardRead> {
  const { data: membership } = await supabase
    .from("memberships")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  const workspaceId = membership?.workspace_id ?? null;
  const empty = readOnboardingStash(null);
  if (!workspaceId) {
    return {
      workspaceId: null,
      workspaceName: null,
      stash: empty,
      account: null,
      facts: {
        hasWorkspace: false,
        linkedInActive: false,
        confirmed: { hours: false, voice: false, cta: false },
        hasApprovedStrategy: false,
        hasCampaign: false,
        hasLaunchedCampaign: false,
      },
    };
  }

  const head = { count: "exact" as const, head: true };
  const [{ data: workspace }, { data: account }, approved, campaigns, launched] = await Promise.all([
    supabase.from("workspaces").select("name, onboarding").eq("id", workspaceId).maybeSingle(),
    supabase
      .from("linkedin_accounts")
      .select("id, status, status_detail, provider_account_id, display_name, has_premium, has_sales_navigator, working_hours")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("customer_profiles").select("id", head).eq("workspace_id", workspaceId).not("approved_at", "is", null),
    // A list somebody can still launch: an archived draft is not one, and
    // counting it left the last step with nothing on it and no way back.
    supabase.from("campaigns").select("id", head).eq("workspace_id", workspaceId).eq("status", "draft"),
    supabase.from("campaigns").select("id", head).eq("workspace_id", workspaceId).not("launched_at", "is", null),
  ]);

  const stash = readOnboardingStash(workspace?.onboarding);
  const mine = stash.confirmed[userId] ?? {};
  return {
    workspaceId,
    workspaceName: workspace?.name ?? null,
    stash,
    account: (account as WizardAccount | null) ?? null,
    facts: {
      hasWorkspace: true,
      // A row with no provider account behind it is not connected, whatever
      // its status column says.
      linkedInActive: account?.status === "active" && Boolean(account.provider_account_id),
      confirmed: { hours: Boolean(mine.hours), voice: Boolean(mine.voice), cta: Boolean(mine.cta) },
      hasApprovedStrategy: (approved.count ?? 0) > 0,
      hasCampaign: (campaigns.count ?? 0) > 0,
      hasLaunchedCampaign: (launched.count ?? 0) > 0,
    },
  };
}
