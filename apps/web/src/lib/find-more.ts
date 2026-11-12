import "server-only";
import { IDLE_RELEASE_TAGLINE, isIdleReleased } from "@le/shared";
import type { createClient } from "@/lib/supabase-server";
import { callWorker, isAlreadyRunning } from "@/lib/worker";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** How many profiles one press reads from LinkedIn. */
export const FIND_MORE_BATCH = 50;

export interface GrowableRow {
  id: string;
  status: string;
  customer_profile_id: string | null;
  search_exhausted: boolean | null;
  created_at: string;
}

/**
 * The campaign a strategy's new people go into: a running one first, then the
 * newest still in use, never an archived or finished one, and never one whose
 * search has reached the end of LinkedIn's answer. One definition, read by the
 * Prospects page, the strategy page and the action, so the button and the line
 * beside it never name different campaigns.
 */
export function growableCampaign<T extends GrowableRow>(rows: readonly T[], strategyId: string): T | null {
  const usable = rows
    .filter((c) => c.customer_profile_id === strategyId)
    .filter((c) => c.status !== "archived" && c.status !== "completed" && !c.search_exhausted)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return usable.find((c) => c.status === "running") ?? usable[0] ?? null;
}

export type FindMoreResult = { ok: true; alreadyRunning: boolean } | { ok: false; reason: string };

/**
 * Reads the next page of a campaign's own search and adds whoever is new to
 * that campaign (rule 20).
 *
 * The one path every "find more" button takes: the campaign's People section,
 * the Prospects page and the strategy page. The Prospects page's button was a
 * link to the campaign's overview, so pressing it landed there and searched
 * nothing. Everything the worker needs (which strategy, which account, where
 * the search stopped) is read off the campaign's own row, never off a form.
 */
export async function queueFindMore(
  supabase: Supabase,
  session: { workspaceId: string; userId: string },
  campaignId: string,
): Promise<FindMoreResult> {
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("customer_profile_id, linkedin_account_id, search_exhausted")
    .eq("id", campaignId)
    .eq("workspace_id", session.workspaceId)
    .maybeSingle();
  if (!campaign?.customer_profile_id) {
    return { ok: false, reason: "This campaign's strategy has been deleted, so there is nothing left to search for." };
  }
  if (campaign.search_exhausted) {
    return { ok: false, reason: "This search has already reached the end of what LinkedIn returns for this strategy." };
  }

  const { data: account } = await supabase
    .from("linkedin_accounts")
    .select("status, status_detail")
    .eq("id", campaign.linkedin_account_id)
    .maybeSingle();
  if (account?.status !== "active") {
    return {
      ok: false,
      reason: isIdleReleased(account)
        ? IDLE_RELEASE_TAGLINE
        : "Reconnect your LinkedIn account on your profile first. Nothing can be searched until it is connected.",
    };
  }

  const queued = await callWorker("/jobs/targeting", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    customerProfileId: campaign.customer_profile_id,
    linkedinAccountId: campaign.linkedin_account_id,
    campaignId,
    limit: FIND_MORE_BATCH,
  });
  if (!queued.ok) return { ok: false, reason: `The search has not started. ${queued.error}` };
  return { ok: true, alreadyRunning: isAlreadyRunning(queued.data) };
}
