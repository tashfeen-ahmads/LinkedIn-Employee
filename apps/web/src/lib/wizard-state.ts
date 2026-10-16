import "server-only";
import type { Db } from "@le/db";
import { readConfirmations, readOnboardingStash, type OnboardingStash, type StepConfirmations } from "@/lib/onboarding-stash";
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
  /**
   * A lookup failed, so the facts below are not known. Never acted on: a
   * failed count read as "nothing launched" would send somebody with live
   * campaigns back through setup (rule 17).
   */
  unreadable: boolean;
  workspaceId: string | null;
  /** This person's role in the workspace: only owners and admins may write the workspace row. */
  role: string | null;
  workspaceName: string | null;
  stash: OnboardingStash;
  /** This person's own confirmations for this workspace, from their profile row. */
  confirmations: StepConfirmations;
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
  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select("workspace_id, role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  const workspaceId = membership?.workspace_id ?? null;
  const empty = readOnboardingStash(null);
  if (!workspaceId) {
    return {
      unreadable: Boolean(membershipError),
      workspaceId: null,
      role: null,
      workspaceName: null,
      stash: empty,
      confirmations: {},
      account: null,
      facts: {
        hasWorkspace: false,
        linkedInActive: false,
        confirmed: { hours: false, voice: false, cta: false },
        hasMeetingHours: false,
        hasApprovedStrategy: false,
        hasCampaign: false,
        hasLaunchedCampaign: false,
      },
    };
  }

  const head = { count: "exact" as const, head: true };
  const [workspace, account, me, approved, campaigns, launched, meetingHours] = await Promise.all([
    supabase.from("workspaces").select("name, onboarding").eq("id", workspaceId).maybeSingle(),
    supabase
      .from("linkedin_accounts")
      .select("id, status, status_detail, provider_account_id, display_name, has_premium, has_sales_navigator, working_hours")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("profiles").select("setup_confirmed").eq("id", userId).maybeSingle(),
    supabase.from("customer_profiles").select("id", head).eq("workspace_id", workspaceId).not("approved_at", "is", null),
    // A list somebody can still launch: an archived draft is not one, and
    // counting it left the last step with nothing on it and no way back.
    supabase.from("campaigns").select("id", head).eq("workspace_id", workspaceId).eq("status", "draft"),
    supabase.from("campaigns").select("id", head).eq("workspace_id", workspaceId).not("launched_at", "is", null),
    supabase.from("availability").select("id", head).eq("workspace_id", workspaceId).eq("user_id", userId),
  ]);
  // The profile read is left out on purpose: confirmations missing only means
  // a step is asked again, which costs a click, while "unreadable" stops the
  // whole page. Everything that decides whether setup is finished is in.
  const unreadable = [workspace, account, approved, campaigns, launched].some((r) => Boolean(r.error));

  const stash = readOnboardingStash(workspace.data?.onboarding);
  const mine = me.error ? {} : readConfirmations(me.data?.setup_confirmed, workspaceId);
  const row = account.data as WizardAccount | null;
  return {
    unreadable,
    workspaceId,
    role: membership?.role ?? null,
    workspaceName: workspace.data?.name ?? null,
    stash,
    confirmations: mine,
    account: row ?? null,
    facts: {
      hasWorkspace: true,
      // A row with no provider account behind it is not connected, whatever
      // its status column says.
      linkedInActive: row?.status === "active" && Boolean(row.provider_account_id),
      confirmed: { hours: Boolean(mine.hours), voice: Boolean(mine.voice), cta: Boolean(mine.cta) },
      // A failed read counts as saved: asking again costs a click, refusing
      // the step forever costs the setup (and "unreadable" is reserved for the
      // facts that decide whether setup is finished).
      hasMeetingHours: meetingHours.error ? true : (meetingHours.count ?? 0) > 0,
      hasApprovedStrategy: (approved.count ?? 0) > 0,
      hasCampaign: (campaigns.count ?? 0) > 0,
      hasLaunchedCampaign: (launched.count ?? 0) > 0,
    },
  };
}
