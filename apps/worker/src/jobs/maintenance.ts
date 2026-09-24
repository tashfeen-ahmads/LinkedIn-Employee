import { LINKEDIN_LIMITS, MAINTENANCE_BEAT, countFunnel } from "@le/shared";
import { backfillProspectFields } from "./backfill-fields.js";
import type { WorkerContext } from "../context.js";
import { pollHealth, recoverAccounts } from "../accounts.js";
import { recordEvent } from "../context.js";
import { detectAcceptedInvitations } from "./acceptance.js";
import { recoverThrottledProspects, unstickProspects } from "./unstick.js";
import { syncCalendarFeeds } from "./calendar-feed.js";
import { runLifecycleEmails } from "./lifecycle.js";
import { runRetentionSweep } from "./retention.js";
import { jobId } from "../queues.js";
import type { Queues } from "../queues.js";
import { recordBeat } from "../heartbeat.js";

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
 *    LinkedIn's attention;
 *  - nudge a workspace stuck on one setup step, and warn a trial that is
 *    nearly up.
 *
 * **Every step is independent.** They used to run as a bare sequence after the
 * first three, so one throw — a 500 from the provider inside acceptance
 * detection is entirely ordinary — skipped everything below it: approved
 * replies left undispatched, invitations never withdrawn, nudges never sent,
 * and the retention sweep, which is a promise about other people's data, not
 * run at all. Silently, at three in the morning, for as many nights as it kept
 * throwing.
 *
 * And the run stamps a heartbeat carrying **which steps failed**, for the same
 * reason the pacing loop does (rule 21): a night where maintenance found
 * nothing to do and a month where it never ran are the same absence of output
 * from every screen in this product.
 */
export async function runMaintenance(
  ctx: WorkerContext,
  queues: Queues,
  now: Date = new Date(),
): Promise<void> {
  const { db } = ctx;
  const failures: Record<string, string> = {};
  const done: Record<string, number> = {};

  /**
   * One step of the night. A failure is recorded and the night continues.
   *
   * The alternative is what this used to do: stop, having half-finished, with
   * nothing but a log line to say which half.
   */
  const step = async (name: string, run: () => Promise<number | void>): Promise<void> => {
    try {
      const count = await run();
      if (typeof count === "number") done[name] = count;
    } catch (err) {
      failures[name] = err instanceof Error ? err.message : String(err);
      console.error(`maintenance step failed: ${name}`, err);
    }
  };

  // Company and title, read out of the headline for every row that never got
  // them. Cheap, local, and it only ever fills a blank.
  await step("backfillProspectFields", () => backfillProspectFields(db));

  const { data: accounts } = await db
    .from("linkedin_accounts")
    .select("id, workspace_id, status, provider_account_id")
    .in("status", ["active", "warning"]);

  // Before polling: repair any account whose stored id the provider has
  // replaced. Polling first asks about an id that is already gone, marks the
  // row dead, and never looks for the live account sitting beside it.
  await step("recover-accounts", async () => (await recoverAccounts(db, ctx.linkedin)).repaired);

  // Per account, not per loop: one restricted account must not stop the others
  // being checked.
  for (const account of accounts ?? []) {
    await step(`health:${account.id}`, () =>
      pollHealth(db, ctx.linkedin, account, { email: ctx.email, appUrl: ctx.env.APP_URL }),
    );
  }

  // Re-read every connected calendar feed before anything offers times today.
  // A failure here marks the feed and keeps yesterday's intervals.
  await step("calendar-feeds", () => syncCalendarFeeds(ctx));

  await step("acceptance", () => detectAcceptedInvitations(ctx, now));
  // Belt and braces: the hourly job does this too, and a stall is the one
  // failure that is invisible from every screen.
  await step("unstick", () => unstickProspects(ctx.db, now));
  await step("recover-throttled", () => recoverThrottledProspects(ctx.db, now));
  await step("approved-drafts", () => sweepApprovedDrafts(ctx, queues, now));
  await step("acceptance-rates", () => flagPoorAcceptanceRates(ctx));
  await step("withdraw-stale", () => withdrawStaleInvites(ctx, now));
  await step("close-exhausted", () => closeExhaustedSequences(ctx, now));
  await step("lifecycle-emails", () => runLifecycleEmails(ctx, now));
  // Last, and never skipped because something above it threw: this one is a
  // promise about how long other people's data is kept.
  await step("retention", () => runRetentionSweep(ctx, now));

  const failed = Object.keys(failures);
  await recordBeat(
    db,
    MAINTENANCE_BEAT,
    {
      done,
      failed,
      failures,
      accounts: accounts?.length ?? 0,
      // Named rather than inferred from an empty `failures`, because "every
      // step worked" and "the stamp is from an older build that did not record
      // failures" are not the same claim.
      ok: failed.length === 0,
    },
    now,
  );

  if (failed.length) {
    console.error(`maintenance finished with ${failed.length} failed step(s): ${failed.join(", ")}`);
  }
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
      { jobId: jobId("reply", draft.id) },
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
      .select("status, invited_at, accepted_at, replied_at")
      .in("campaign_id", campaignIds);

    // The same funnel the reporting page shows. This had its own fourth
    // definition, which counted a withdrawn invitation as never sent and an
    // excluded prospect as never accepted — so it warned about accounts whose
    // real acceptance rate was fine.
    const counts = countFunnel(rows ?? []);
    // Below this there is not enough signal to judge a campaign by.
    if (counts.invited < MIN_INVITES_FOR_RATE) continue;

    const rate = counts.accepted / counts.invited;
    if (rate >= LINKEDIN_LIMITS.minHealthyAcceptanceRate) continue;

    await recordEvent(ctx.db, {
      workspaceId: account.workspace_id,
      name: "linkedin.account.low_acceptance",
      subjectType: "linkedin_account",
      subjectId: account.id,
      payload: { lowAcceptanceRate: Number(rate.toFixed(3)), invited: counts.invited },
    });
  }
}

/** Fewer invitations than this and the rate is noise, not a signal. */
const MIN_INVITES_FOR_RATE = 40;
