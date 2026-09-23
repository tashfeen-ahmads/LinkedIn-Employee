import {
  FIRST_STEP_DELAY_DAYS,
  LINKEDIN_LIMITS,
  canTransition,
  type CampaignProspectStatus,
} from "@le/shared";
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
    .select("id, campaign_id, prospect_id, status, variant_id")
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

    // Not read off the campaign. Step 1 has no configurable delay, because
    // what precedes it is the acceptance rather than a message (rule 43) — and
    // left configurable it was written as three days into every campaign this
    // deployment built.
    const delayDays = FIRST_STEP_DELAY_DAYS;
    await db
      .from("campaign_prospects")
      .update({
        status: "accepted",
        accepted_at: now.toISOString(),
        // What makes the follow-up scheduler pick them up. Without it the
        // prospect sits in `accepted` and is still never messaged.
        next_action_at: followUpDueAt(now, delayDays).toISOString(),
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

/**
 * When the first follow-up falls due.
 *
 * A delay of zero does not mean "this second". A message arriving in the same
 * second as the acceptance is a robot announcing itself — it is the pattern
 * LinkedIn's own heuristics watch for, on the account this product exists to
 * protect. So zero means soon and human: twenty to ninety minutes, jittered,
 * with the working-hours check still applied on top by the limiter.
 */
export function followUpDueAt(now: Date, delayDays: number, random = Math.random): Date {
  if (delayDays > 0) return new Date(now.getTime() + delayDays * 86_400_000);
  const { acceptFollowUpMinMs, acceptFollowUpMaxMs } = LINKEDIN_LIMITS;
  const spread = acceptFollowUpMaxMs - acceptFollowUpMinMs;
  return new Date(now.getTime() + acceptFollowUpMinMs + Math.floor(random() * spread));
}
