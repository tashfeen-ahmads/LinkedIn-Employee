import { LINKEDIN_LIMITS } from "@le/shared";
import type { WorkerContext } from "../context.js";
import { pollHealth } from "../accounts.js";
import { recordEvent } from "../context.js";
import { detectAcceptedInvitations } from "./acceptance.js";
import { runRetentionSweep } from "./retention.js";
import type { Queues } from "../queues.js";

/**
 * Nightly housekeeping:
 *  - poll every connected account's health, so a restriction is caught within
 *    a day even if no action happened to hit it;
 *  - notice which invitations were accepted, which is what starts the
 *    follow-up sequence;
 *  - withdraw stale pending invitations, which keeps the pending-invite count
 *    down and with it the risk of a limit;
 *  - close campaign prospects whose sequence has run out;
 *  - erase prospect data held past the workspace's retention limit;
 *  - re-enqueue approved replies that were never dispatched;
 *  - flag accounts whose acceptance rate has fallen far enough to attract
 *    LinkedIn's attention.
 */
export async function runMaintenance(
  ctx: WorkerContext,
  queues: Queues,
  now: Date = new Date(),
): Promise<void> {
  const { db } = ctx;

  const { data: accounts } = await db
    .from("linkedin_accounts")
    .select("id, workspace_id, status, provider_account_id")
    .in("status", ["active", "warning"]);

  for (const account of accounts ?? []) {
    try {
      await pollHealth(db, ctx.linkedin, account, { email: ctx.email, appUrl: ctx.env.APP_URL });
    } catch (err) {
      console.error("health poll failed", account.id, err);
    }
  }

  const accepted = await detectAcceptedInvitations(ctx, now);
  if (accepted > 0) console.log(`${accepted} invitations accepted since the last check`);

  await sweepApprovedDrafts(ctx, queues, now);
  await flagPoorAcceptanceRates(ctx);
  await withdrawStaleInvites(ctx, now);
  await closeExhaustedSequences(ctx, now);

  const erased = await runRetentionSweep(ctx, now);
  if (erased > 0) console.log(`retention sweep erased ${erased} prospects`);
}

async function withdrawStaleInvites(ctx: WorkerContext, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - LINKEDIN_LIMITS.withdrawAfterDays * 86_400_000).toISOString();
  const { data: stale } = await ctx.db
    .from("campaign_prospects")
    .select("id, workspace_id, invitation_id, campaign_id")
    .eq("status", "invited")
    .not("invitation_id", "is", null)
    .lt("invited_at", cutoff)
    // LinkedIn permits one withdrawal pass per week; keep the batch small.
    .limit(50);

  for (const row of stale ?? []) {
    const { data: campaign } = await ctx.db
      .from("campaigns")
      .select("linkedin_account_id")
      .eq("id", row.campaign_id)
      .single();
    if (!campaign) continue;
    const { data: account } = await ctx.db
      .from("linkedin_accounts")
      .select("provider_account_id, status")
      .eq("id", campaign.linkedin_account_id)
      .single();
    if (!account?.provider_account_id || account.status !== "active") continue;

    const result = await ctx.linkedin.withdrawInvitation({
      accountId: account.provider_account_id,
      invitationId: row.invitation_id!,
    });
    if (result.ok) {
      await ctx.db
        .from("campaign_prospects")
        .update({ status: "closed", status_reason: "invitation expired", closed_at: now.toISOString() })
        .eq("id", row.id);
    }
  }
}

async function closeExhaustedSequences(ctx: WorkerContext, now: Date): Promise<void> {
  const { data: rows } = await ctx.db
    .from("campaign_prospects")
    .select("id, campaign_id, last_step_sent")
    .in("status", ["messaged_1", "messaged_2", "messaged_3"])
    .is("next_action_at", null)
    .limit(500);

  // One count per distinct campaign, not one per prospect: 500 exhausted
  // prospects usually belong to a handful of campaigns.
  const stepCounts = new Map<string, number>();
  for (const campaignId of new Set((rows ?? []).map((row) => row.campaign_id))) {
    const { count } = await ctx.db
      .from("campaign_steps")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId);
    stepCounts.set(campaignId, count ?? 0);
  }

  for (const row of rows ?? []) {
    const count = stepCounts.get(row.campaign_id) ?? 0;
    if (count <= row.last_step_sent) {
      await ctx.db
        .from("campaign_prospects")
        .update({ status: "closed", status_reason: "sequence completed", closed_at: now.toISOString() })
        .eq("id", row.id);
    }
  }
}

/**
 * Re-enqueues replies a human approved but that never reached LinkedIn.
 *
 * The web app enqueues the send itself; if the worker was down at that moment
 * the row sits approved forever and the prospect is simply left hanging. This
 * is the safety net the inbox promises.
 *
 * A short grace period avoids racing the enqueue that just happened.
 */
async function sweepApprovedDrafts(ctx: WorkerContext, queues: Queues, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 10 * 60_000).toISOString();
  const { data: stranded } = await ctx.db
    .from("reply_drafts")
    .select("id, workspace_id, conversation_id, resolved_at")
    .eq("status", "approved")
    .lt("resolved_at", cutoff)
    .limit(100);

  for (const draft of stranded ?? []) {
    // The job id is the same one the web app would have used, so a queued job
    // is not duplicated by this sweep.
    await queues.linkedinAction.add(
      "reply",
      {
        kind: "reply",
        workspaceId: draft.workspace_id,
        conversationId: draft.conversation_id,
        draftId: draft.id,
      },
      { jobId: `reply:${draft.id}` },
    );
  }
}

/**
 * Warns about an account whose invitations are being ignored.
 *
 * A low acceptance rate is the signal LinkedIn itself watches: it means the
 * targeting is wrong or the note reads as spam, and continuing at volume is
 * how an account gets restricted. This does not pause anything — the rate is a
 * judgement about campaign quality, not evidence of a violation — but the rep
 * is told, and the digest carries it.
 */
async function flagPoorAcceptanceRates(ctx: WorkerContext): Promise<void> {
  const { data: accounts } = await ctx.db
    .from("linkedin_accounts")
    .select("id, workspace_id, status")
    .eq("status", "active");

  for (const account of accounts ?? []) {
    const { data: campaigns } = await ctx.db
      .from("campaigns")
      .select("id")
      .eq("linkedin_account_id", account.id);
    const campaignIds = (campaigns ?? []).map((campaign) => campaign.id);
    if (campaignIds.length === 0) continue;

    const { data: rows } = await ctx.db
      .from("campaign_prospects")
      .select("status")
      .in("campaign_id", campaignIds);

    const invited = (rows ?? []).filter((row) => row.status !== "queued").length;
    // Below this there is not enough signal to judge a campaign by.
    if (invited < MIN_INVITES_FOR_RATE) continue;

    const accepted = (rows ?? []).filter(
      (row) => !["queued", "invited", "failed", "closed"].includes(row.status),
    ).length;
    const rate = accepted / invited;
    if (rate >= LINKEDIN_LIMITS.minHealthyAcceptanceRate) continue;

    await recordEvent(ctx.db, {
      workspaceId: account.workspace_id,
      name: "linkedin.account.low_acceptance",
      subjectType: "linkedin_account",
      subjectId: account.id,
      payload: { lowAcceptanceRate: Number(rate.toFixed(3)), invited },
    });
  }
}

/** Fewer invitations than this and the rate is noise, not a signal. */
const MIN_INVITES_FOR_RATE = 40;
