import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@le/db";
import { hasOwnBookingLink } from "@le/shared";

type Client = SupabaseClient<Database>;

/**
 * Whether anybody in this workspace sends their own scheduling link (rule 31).
 *
 * Filtered to this workspace's members by hand: a platform admin can read
 * every profile, so leaning on row-level security alone would answer for
 * other companies' reps too.
 */
export async function workspaceUsesOwnBookingLink(supabase: Client, workspaceId: string): Promise<boolean> {
  const { data: members } = await supabase.from("memberships").select("user_id").eq("workspace_id", workspaceId);
  const ids = (members ?? []).map((member) => member.user_id);
  if (ids.length === 0) return false;
  const { data: profiles } = await supabase.from("profiles").select("booking_url").in("id", ids);
  return (profiles ?? []).some((profile) => hasOwnBookingLink(profile.booking_url));
}

/**
 * Whether this campaign's replies offer the rep's own scheduling link.
 *
 * The reply job offers the link of whoever owns the LinkedIn account the
 * campaign sends from, so that is the profile read here; the campaign's owner
 * is the fallback when the account row cannot be read.
 */
export async function campaignUsesOwnBookingLink(
  supabase: Client,
  workspaceId: string,
  campaign: { linkedin_account_id: string | null; owner_user_id: string | null },
): Promise<boolean> {
  return hasOwnBookingLink(await campaignBookingUrl(supabase, workspaceId, campaign));
}

/**
 * The scheduling link a meeting campaign sends when its call to action has no
 * destination of its own: that of whoever owns the account it sends from, as
 * the worker reads it on the send path. Null means Nora's own booking page.
 */
export async function campaignBookingUrl(
  supabase: Client,
  workspaceId: string,
  campaign: { linkedin_account_id: string | null; owner_user_id: string | null },
): Promise<string | null> {
  const { data: account } = campaign.linkedin_account_id
    ? await supabase
        .from("linkedin_accounts")
        .select("user_id")
        .eq("id", campaign.linkedin_account_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle()
    : { data: null };
  const userId = account?.user_id ?? campaign.owner_user_id;
  if (!userId) return null;
  const { data: profile } = await supabase.from("profiles").select("booking_url").eq("id", userId).maybeSingle();
  return hasOwnBookingLink(profile?.booking_url) ? (profile?.booking_url?.trim() ?? null) : null;
}
