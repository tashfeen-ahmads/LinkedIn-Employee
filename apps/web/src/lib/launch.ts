import "server-only";
import { isIdleReleased } from "@le/shared";
import { createClient } from "@/lib/supabase-server";
import { callWorker } from "@/lib/worker";
import { launchBlockers, type LaunchState } from "@/lib/campaign";

/**
 * Launching a campaign, in one definition.
 *
 * Two screens launch: the campaign page, and the last step of onboarding,
 * where a new customer's first campaign goes live. They must refuse for the
 * same reasons and start sending the same way, so neither carries its own
 * copy — two copies of the one action that reaches strangers is how one of
 * them comes to skip a check.
 */
export type LaunchOutcome =
  | { status: "missing" }
  | { status: "blocked"; blockers: string[] }
  | { status: "failed" }
  /** Running. `kicked` is whether the sending loop answered the press. */
  | { status: "launched"; kicked: boolean };

/** Reads exactly what launchBlockers needs, for the re-check at the moment of the press. */
export async function launchState(campaignId: string, workspaceId: string): Promise<LaunchState | null> {
  const supabase = await createClient();
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("connection_note, daily_invite_cap, linkedin_account_id")
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!campaign) return null;

  const [{ data: steps }, { data: queuedNotes, count }, { data: account }] = await Promise.all([
    supabase.from("campaign_steps").select("message, delay_days").eq("campaign_id", campaignId),
    supabase
      .from("campaign_prospects")
      // The notes as well as the count: launchBlockers holds each person's
      // note to LinkedIn's cap, and the re-check must see what the page saw.
      .select("invite_note", { count: "exact" })
      .eq("campaign_id", campaignId)
      .eq("status", "queued"),
    supabase
      .from("linkedin_accounts")
      .select("status, status_detail")
      .eq("id", campaign.linkedin_account_id)
      .maybeSingle(),
  ]);

  return {
    connectionNote: campaign.connection_note,
    steps: (steps ?? []).map((s) => ({ message: s.message, delayDays: s.delay_days })),
    dailyInviteCap: campaign.daily_invite_cap,
    prospectCount: count ?? 0,
    accountStatus: account?.status ?? null,
    accountReleasedIdle: isIdleReleased(account),
    inviteNotes: (queuedNotes ?? []).map((row) => row.invite_note),
  };
}

/**
 * Re-checks the blockers, sets the campaign running and tells the worker.
 *
 * The blockers are re-checked here and not only rendered as a disabled button:
 * a form can be submitted by anyone who can reach the route, and launching is
 * the action that reaches strangers.
 */
export async function launch(
  campaignId: string,
  session: { workspaceId: string; userId: string },
): Promise<LaunchOutcome> {
  const state = await launchState(campaignId, session.workspaceId);
  if (!state) return { status: "missing" };
  const blockers = launchBlockers(state);
  if (blockers.length > 0) return { status: "blocked", blockers };

  const supabase = await createClient();
  // Checked by the rows it changed: an update that matched nothing (refused,
  // or the campaign gone since the read above) launched nothing, and saying
  // "launched" over it is a live campaign on no screen but this one.
  const { data: updated, error } = await supabase
    .from("campaigns")
    .update({ status: "running", launched_at: new Date().toISOString() })
    .eq("id", campaignId)
    .eq("workspace_id", session.workspaceId)
    .select("id");
  if (error || !updated?.length) {
    if (error) console.error(`[campaign] launch: ${error.message}`);
    return { status: "failed" };
  }

  // A round trip to the worker rather than a row the schedule notices later:
  // a worker that was not running used to produce no error at all, and the
  // first invitation is paced from the press rather than the next tick.
  const kicked = await callWorker("/jobs/campaign-tick", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    campaignId,
  });
  if (!kicked.ok) console.error(`[campaign] campaign-tick not reached: ${kicked.error}`);
  return { status: "launched", kicked: kicked.ok };
}
