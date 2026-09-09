import { LINKEDIN_LIMITS, canTransition, type CampaignProspectStatus } from "@le/shared";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";

/**
 * Notices that an invitation was accepted.
 *
 * Nothing else did. `invited` was set when the invitation went out and no code
 * path ever moved a prospect to `accepted` — which is the status the follow-up
 * scheduler waits for, so no campaign ever sent its second message. The
 * sequence stopped at the connection request, silently, for every prospect.
 *
 * LinkedIn sends no acceptance event and an invitation leaving the pending list
 * could equally mean it was declined, so acceptance is read from the one
 * unambiguous fact: the person is now a connection.
 */
export async function detectAcceptedInvitations(ctx: WorkerContext, now: Date = new Date()): Promise<number> {
  const { db } = ctx;

  const { data: accounts } = await db
    .from("linkedin_accounts")
    .select("id, workspace_id, provider_account_id, status")
    .in("status", ["active", "warning"]);

  let accepted = 0;
  for (const account of accounts ?? []) {
    if (!account.provider_account_id) continue;
    try {
      accepted += await detectForAccount(ctx, account, now);
    } catch (error) {
      // One provider failure must not stop the other accounts being checked.
      console.error("acceptance check failed", account.id, error);
    }
  }
  return accepted;
}

async function detectForAccount(
  ctx: WorkerContext,
  account: { id: string; workspace_id: string; provider_account_id: string | null },
  now: Date,
): Promise<number> {
  const { db } = ctx;

  const { data: campaigns } = await db
    .from("campaigns")
    .select("id")
    .eq("linkedin_account_id", account.id);
  const campaignIds = (campaigns ?? []).map((campaign) => campaign.id);
  if (campaignIds.length === 0) return 0;

  // Only invitations still outstanding. Anything older has been withdrawn by
  // the maintenance sweep, so a connection made now is not from this campaign.
  const oldest = new Date(now.getTime() - LINKEDIN_LIMITS.withdrawAfterDays * 86_400_000);
  const { data: outstanding } = await db
    .from("campaign_prospects")
    .select("id, campaign_id, prospect_id, status")
    .in("campaign_id", campaignIds)
    .eq("status", "invited")
    .gte("invited_at", oldest.toISOString())
    .limit(500);
  if (!outstanding?.length) return 0;

  const { data: prospects } = await db
    .from("prospects")
    .select("id, provider_id")
    .in("id", outstanding.map((row) => row.prospect_id));
  const providerIdByProspect = new Map((prospects ?? []).map((p) => [p.id, p.provider_id]));

  const relations = await ctx.linkedin.listRelations({
    accountId: account.provider_account_id!,
    since: oldest.toISOString(),
  });
  const connected = new Set(relations.map((relation) => relation.providerId));
  if (connected.size === 0) return 0;

  let count = 0;
  for (const row of outstanding) {
    const providerId = providerIdByProspect.get(row.prospect_id);
    if (!providerId || !connected.has(providerId)) continue;
    if (!canTransition(row.status as CampaignProspectStatus, "accepted")) continue;

    const delayDays = await firstStepDelay(ctx, row.campaign_id);
    await db
      .from("campaign_prospects")
      .update({
        status: "accepted",
        accepted_at: now.toISOString(),
        // What makes the follow-up scheduler pick them up. Without it the
        // prospect sits in `accepted` and is still never messaged.
        next_action_at: new Date(now.getTime() + delayDays * 86_400_000).toISOString(),
      })
      .eq("id", row.id);

    await recordEvent(db, {
      workspaceId: account.workspace_id,
      name: "invite.accepted",
      subjectType: "campaign_prospect",
      subjectId: row.id,
    });
    count++;
  }
  return count;
}

/** How long after accepting the first follow-up is due. */
async function firstStepDelay(ctx: WorkerContext, campaignId: string): Promise<number> {
  const { data } = await ctx.db
    .from("campaign_steps")
    .select("delay_days")
    .eq("campaign_id", campaignId)
    .eq("step_number", 1)
    .maybeSingle();
  return data?.delay_days ?? 1;
}
