import "server-only";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery, startedNotice } from "@/lib/worker";
import {
  chooseStrategySource,
  hasStrategySource,
  mergeStash,
  readOnboardingStash,
  sourceFromForm,
} from "@/lib/onboarding-stash";

/** Where the form for a missing source lives, so every refusal lands on it. */
export const STRATEGY_DETAILS = "/app/strategy";

/**
 * Asks the Strategy Agent to write a workspace's first profiles again.
 *
 * "Try again" on a failed run linked to `/onboarding`, and `/onboarding` sends
 * anybody who already has a workspace straight to `/app` — so the button took
 * somebody from the dashboard to the dashboard, and a run that failed stayed
 * failed with no way to start another. This is the retry those links promised.
 *
 * It sends what onboarding kept, or what the person has just typed into the
 * small form on the strategy page when onboarding kept nothing — a workspace
 * set up before the source was stored. With neither, it sends them to that
 * form rather than queueing a run the agent would refuse.
 *
 * Never for a workspace that already has a business profile: without `expand`
 * the agent writes a *second* business (that is what Add a business does), and
 * a retry pressed on a stale tab after the first run landed would split the
 * workspace's strategies across two copies of the same company.
 */
export async function retryStrategy(form: FormData): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "/login";

  const { data: membership } = await supabase
    .from("memberships")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return "/onboarding";
  const workspaceId = membership.workspace_id;

  const [{ data: business }, { data: workspace }] = await Promise.all([
    supabase.from("business_profiles").select("id").eq("workspace_id", workspaceId).limit(1).maybeSingle(),
    supabase.from("workspaces").select("onboarding").eq("id", workspaceId).maybeSingle(),
  ]);
  if (business) return noticeQuery("/app/strategy", "Your profiles are already written.");

  const typed = sourceFromForm(form);
  // Retrying what onboarding kept is anybody's to press; changing what the
  // business is described as is the same decision as adding a business, and
  // has the same owners.
  if (hasStrategySource(typed) && !["owner", "admin"].includes(membership.role)) {
    return errorQuery("/app/strategy", "Only an owner or admin can change what Sage reads.");
  }
  const source = chooseStrategySource(typed, readOnboardingStash(workspace?.onboarding).source);
  if (!source) {
    return `${errorQuery(
      STRATEGY_DETAILS,
      "Tell Sage what you sell first — a website, a LinkedIn page or a sentence or two. It will not invent a business from nothing.",
    )}#details`;
  }

  // Kept before the run is asked for, so the next retry has it even if this
  // one fails too. Merged: the same row holds the sending window and the
  // search tier, which the LinkedIn account row has not claimed yet.
  if (typed === source) {
    await supabase
      .from("workspaces")
      .update({ onboarding: mergeStash(workspace?.onboarding, { source }) as never })
      .eq("id", workspaceId);
  }

  const queued = await callWorker("/jobs/strategy", {
    workspaceId,
    userId: user.id,
    ...source,
  });
  if (!queued.ok) {
    return errorQuery("/app/strategy", `Sage could not be started: ${queued.error}`);
  }
  return noticeQuery(
    "/app/strategy",
    startedNotice(
      queued.data,
      "Sage is reading your business again. Your profiles appear on this page in a few minutes, unapproved — nothing is searched for until you read one.",
    ),
  );
}
