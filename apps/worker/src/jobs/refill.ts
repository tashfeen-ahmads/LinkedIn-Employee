import { dailyInviteCap } from "@le/linkedin";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { enqueueOnce, jobId, type Queues } from "../queues.js";

/** How many days of invitations a running campaign keeps queued before it looks for more. */
export const REFILL_DAYS_OF_ALLOWANCE = 2;
/** At most one refill per campaign in this long: every page comes off a seat somebody pays for. */
export const REFILL_EVERY_MS = 24 * 60 * 60_000;
/** One search page, the same as Find more. */
export const REFILL_SIZE = 50;

export const REFILL_EVENT = "campaign.refill_queued";

/**
 * Keeps a running campaign supplied with people to invite.
 *
 * A list grew only when somebody pressed Find more, and nobody did. By late
 * October three of seven running campaigns had nobody left to invite, one
 * whole list was five people long, and every account on the deployment sent
 * well under its allowance while each owner read the ramp as broken. The cap
 * was never the limit; the list was.
 *
 * It is the same search Find more runs, under the same job id, so a press and
 * a refill can never queue two: the stored position is continued (rule 20),
 * everybody already known is excluded, and the copy a human approved is kept.
 * It only asks once a campaign is down to two days of allowance, at most once
 * a day per campaign, and never after LinkedIn has said there is nobody left.
 */
export async function refillCampaigns(
  ctx: WorkerContext,
  queues: Pick<Queues, "targeting">,
  now: Date = new Date(),
): Promise<number> {
  const { db } = ctx;
  const { data: campaigns, error } = await db
    .from("campaigns")
    .select("id, workspace_id, owner_user_id, customer_profile_id, linkedin_account_id, daily_invite_cap")
    .eq("status", "running")
    .eq("search_exhausted", false)
    .not("customer_profile_id", "is", null);
  if (error || !campaigns?.length) return 0;

  const ids = campaigns.map((c) => c.id);
  const accountIds = [...new Set(campaigns.map((c) => c.linkedin_account_id).filter(Boolean))] as string[];
  const since = new Date(now.getTime() - REFILL_EVERY_MS).toISOString();
  const [queued, accounts, recent] = await Promise.all([
    db.from("campaign_prospects").select("campaign_id").in("campaign_id", ids).eq("status", "queued").limit(20_000),
    accountIds.length
      ? db
          .from("linkedin_accounts")
          .select("id, status, provider_account_id, first_action_at")
          .in("id", accountIds)
      : Promise.resolve({ data: [], error: null }),
    db.from("events").select("subject_id").eq("name", REFILL_EVENT).in("subject_id", ids).gte("created_at", since),
  ]);
  // A count that could not be read is not an empty list: refilling on it would
  // spend a page on a campaign that may have hundreds queued.
  if (queued.error || accounts.error || recent.error) return 0;

  const waiting = new Map<string, number>();
  for (const row of queued.data ?? []) waiting.set(row.campaign_id, (waiting.get(row.campaign_id) ?? 0) + 1);
  const accountById = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const refilledToday = new Set((recent.data ?? []).map((e) => e.subject_id));

  let started = 0;
  for (const campaign of campaigns) {
    if (refilledToday.has(campaign.id)) continue;
    const account = campaign.linkedin_account_id ? accountById.get(campaign.linkedin_account_id) : undefined;
    if (!account || account.status !== "active" || !account.provider_account_id) continue;

    const firstAction = account.first_action_at ? new Date(account.first_action_at) : null;
    const allowance = Math.min(campaign.daily_invite_cap ?? Infinity, dailyInviteCap(firstAction, now));
    if ((waiting.get(campaign.id) ?? 0) >= REFILL_DAYS_OF_ALLOWANCE * allowance) continue;

    const data = {
      workspaceId: campaign.workspace_id,
      userId: campaign.owner_user_id,
      customerProfileId: campaign.customer_profile_id as string,
      linkedinAccountId: account.id,
      limit: REFILL_SIZE,
      campaignId: campaign.id,
    };
    const outcome = await enqueueOnce(queues.targeting, "targeting", data, {
      jobId: jobId("targeting", data.customerProfileId, campaign.id),
    });
    if (outcome === "already_pending") continue;
    await Promise.all([
      recordEvent(db, {
        workspaceId: campaign.workspace_id,
        name: REFILL_EVENT,
        subjectType: "campaign",
        subjectId: campaign.id,
        payload: { queued: waiting.get(campaign.id) ?? 0, allowance },
      }),
      recordEvent(db, {
        workspaceId: campaign.workspace_id,
        name: "targeting.queued",
        actorUserId: campaign.owner_user_id,
        subjectType: "customer_profile",
        subjectId: data.customerProfileId,
        payload: { limit: REFILL_SIZE, campaignId: campaign.id, trigger: "refill" },
      }),
    ]).catch((err) => console.error("could not record a refill", err));
    started += 1;
  }
  return started;
}
