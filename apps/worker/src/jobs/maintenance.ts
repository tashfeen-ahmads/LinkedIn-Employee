import { LINKEDIN_LIMITS } from "@le/shared";
import type { WorkerContext } from "../context.js";
import { pollHealth } from "../accounts.js";

/**
 * Nightly housekeeping:
 *  - poll every connected account's health, so a restriction is caught within
 *    a day even if no action happened to hit it;
 *  - withdraw stale pending invitations, which keeps the pending-invite count
 *    down and with it the risk of a limit;
 *  - close campaign prospects whose sequence has run out.
 */
export async function runMaintenance(ctx: WorkerContext, now: Date = new Date()): Promise<void> {
  const { db } = ctx;

  const { data: accounts } = await db
    .from("linkedin_accounts")
    .select("id, workspace_id, status, provider_account_id")
    .in("status", ["active", "warning"]);

  for (const account of accounts ?? []) {
    try {
      await pollHealth(db, ctx.linkedin, account);
    } catch (err) {
      console.error("health poll failed", account.id, err);
    }
  }

  await withdrawStaleInvites(ctx, now);
  await closeExhaustedSequences(ctx, now);
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

  for (const row of rows ?? []) {
    const { count } = await ctx.db
      .from("campaign_steps")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", row.campaign_id);
    if ((count ?? 0) <= row.last_step_sent) {
      await ctx.db
        .from("campaign_prospects")
        .update({ status: "closed", status_reason: "sequence completed", closed_at: now.toISOString() })
        .eq("id", row.id);
    }
  }
}
