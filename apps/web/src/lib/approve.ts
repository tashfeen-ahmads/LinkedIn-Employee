import "server-only";
import type { createClient } from "@/lib/supabase-server";

/**
 * Approving a strategy, in one definition (rule 9).
 *
 * Two screens approve: `/app/strategy`, and the approval step of onboarding
 * (rule 65). Both are a person reading the strategy and pressing Approve —
 * the Strategy Agent still approves nothing — and both must write the same
 * thing and check it the same way, or the two copies drift.
 *
 * Checked by the rows it changed: a write that failed or matched nothing used
 * to be followed by "Approved" and a search, the screen saying yes while the
 * row still said no.
 */
export async function approveStrategy(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  profileId: string,
  /**
   * Columns written with the approval only when the strategy has no campaign
   * yet, such as the call to action onboarding chose: a campaign's messages
   * were written toward the ask it already had.
   */
  extraIfNoCampaign: Record<string, unknown> = {},
): Promise<{ ok: false } | { ok: true; hasCampaign: boolean }> {
  // Asked once, before the write, so the call to action and the answer below
  // cannot disagree about whether there is a campaign.
  const { data: already } = await supabase
    .from("campaigns")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("customer_profile_id", profileId)
    .limit(1);
  const hasCampaign = Boolean(already?.length);

  const { data: rows, error } = await supabase
    .from("customer_profiles")
    .update({
      approved_at: new Date().toISOString(),
      do_not_pursue: false,
      ...(hasCampaign ? {} : extraIfNoCampaign),
    })
    .eq("id", profileId)
    .eq("workspace_id", workspaceId)
    .select("id");
  if (error || !rows?.length) {
    if (error) console.error(`[strategy] approve profile: ${error.message}`);
    return { ok: false };
  }
  // Re-approving a strategy that already built a campaign is not a request for
  // a second list of the same people (rule 24): Find more grows it instead.
  return { ok: true, hasCampaign };
}

/** A LinkedIn plan answer as the account row's two flags, or null when it is not one. */
export function planFlags(value: unknown): { has_sales_navigator: boolean; has_premium: boolean } | null {
  if (value === "sales_navigator") return { has_sales_navigator: true, has_premium: true };
  if (value === "premium") return { has_sales_navigator: false, has_premium: true };
  if (value === "basic") return { has_sales_navigator: false, has_premium: false };
  return null;
}
