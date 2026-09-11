import { canTransition, LINKEDIN_LIMITS, type CampaignProspectStatus } from "@le/shared";
import { entitlementFor } from "@le/billing";
import { checkAction, dailyInviteCap, nextGapMs } from "@le/linkedin";
import type { Db } from "@le/db";
import type { Queues } from "../queues.js";
import { resetCountersIfNeeded, toUsage, type AccountRecord, ACCOUNT_USAGE_COLUMNS } from "../accounts.js";

/**
 * The pacing loop. Runs every few minutes and, for each running campaign, asks
 * the rate limiter how much the account may still do today, then enqueues
 * exactly that many actions with jittered delays.
 *
 * The limiter is consulted here AND again immediately before each action is
 * sent, because minutes pass in between and a rep may act manually meanwhile.
 */
export async function runCampaignTick(db: Db, queues: Queues, now: Date = new Date()): Promise<number> {
  const today = now.toISOString().slice(0, 10);

  const { data: campaigns } = await db
    .from("campaigns")
    .select("id, workspace_id, linkedin_account_id, daily_invite_cap, owner_user_id")
    .eq("status", "running");
  if (!campaigns?.length) return 0;

  let enqueued = 0;
  // One lookup per workspace and per account, not per campaign: several
  // running campaigns commonly share both.
  const entitled = new Map<string, boolean>();
  const accounts = new Map<string, { account: AccountRecord; timezone: string } | null>();

  for (const campaign of campaigns) {
    // A trial that has ended, or a subscription that has, stops outreach here.
    // Reading is never blocked; see packages/billing/src/entitlement.ts.
    if (!entitled.has(campaign.workspace_id)) {
      entitled.set(campaign.workspace_id, await canWorkspaceSend(db, campaign.workspace_id, now));
    }
    if (!entitled.get(campaign.workspace_id)) continue;

    if (!accounts.has(campaign.linkedin_account_id)) {
      accounts.set(
        campaign.linkedin_account_id,
        await loadAccount(db, campaign.linkedin_account_id, today),
      );
    }
    const loaded = accounts.get(campaign.linkedin_account_id);
    if (!loaded) continue;

    const usage = toUsage(loaded.account, loaded.timezone);

    // Follow-ups first: a conversation already started is worth more than a
    // new invitation, and both draw on the same daily message budget.
    enqueued += await enqueueFollowUps(db, queues, campaign, usage, now);
    enqueued += await enqueueInvites(db, queues, campaign, usage, now);
  }

  return enqueued;
}

type CampaignRow = {
  id: string;
  workspace_id: string;
  linkedin_account_id: string;
  daily_invite_cap: number;
  owner_user_id: string;
};

async function enqueueInvites(
  db: Db,
  queues: Queues,
  campaign: CampaignRow,
  usage: ReturnType<typeof toUsage>,
  now: Date,
): Promise<number> {
  const decision = checkAction("invite", usage, now);
  if (!decision.allowed && decision.reason !== "too_soon") return 0;

  const accountCap = dailyInviteCap(usage.firstActionAt, now) - usage.invitesToday;
  const weeklyLeft = LINKEDIN_LIMITS.invitesPerWeek - usage.invitesThisWeek;
  const budget = Math.max(0, Math.min(accountCap, weeklyLeft, campaign.daily_invite_cap));
  if (budget === 0) return 0;

  const { data: queued } = await db
    .from("campaign_prospects")
    .select("id")
    .eq("campaign_id", campaign.id)
    .eq("status", "queued")
    .limit(budget);
  if (!queued?.length) return 0;

  let delay = decision.allowed ? 0 : decision.retryAfterMs;
  for (const row of queued) {
    delay += nextGapMs();
    await queues.linkedinAction.add(
      "invite",
      { kind: "invite", workspaceId: campaign.workspace_id, campaignProspectId: row.id },
      { delay, jobId: `invite:${row.id}` },
    );
  }
  return queued.length;
}

async function enqueueFollowUps(
  db: Db,
  queues: Queues,
  campaign: CampaignRow,
  usage: ReturnType<typeof toUsage>,
  now: Date,
): Promise<number> {
  const decision = checkAction("message", usage, now);
  if (!decision.allowed && decision.reason !== "too_soon") return 0;

  const budget = Math.max(0, LINKEDIN_LIMITS.messagesPerDay - usage.messagesToday);
  if (budget === 0) return 0;

  const { data: due } = await db
    .from("campaign_prospects")
    .select("id, status, last_step_sent")
    .eq("campaign_id", campaign.id)
    .in("status", ["accepted", "messaged_1", "messaged_2"])
    .lte("next_action_at", now.toISOString())
    .limit(budget);
  if (!due?.length) return 0;

  let delay = decision.allowed ? 0 : decision.retryAfterMs;
  let count = 0;
  for (const row of due) {
    const nextStep = row.last_step_sent + 1;
    const target = `messaged_${nextStep}` as CampaignProspectStatus;
    if (!canTransition(row.status as CampaignProspectStatus, target)) continue;
    delay += nextGapMs();
    await queues.linkedinAction.add(
      "follow_up",
      {
        kind: "follow_up",
        workspaceId: campaign.workspace_id,
        campaignProspectId: row.id,
        stepNumber: nextStep,
      },
      { delay, jobId: `follow_up:${row.id}:${nextStep}` },
    );
    count++;
  }
  return count;
}

/** Whether billing permits this workspace to start new outreach. */
async function canWorkspaceSend(db: Db, workspaceId: string, now: Date): Promise<boolean> {
  const { data } = await db
    .from("workspaces")
    .select("plan, trial_ends_at, subscription_status, seats")
    .eq("id", workspaceId)
    .maybeSingle();
  if (!data) return false;

  return entitlementFor(
    {
      plan: data.plan as never,
      trialEndsAt: data.trial_ends_at,
      subscriptionStatus: (data.subscription_status ?? null) as never,
      seats: data.seats ?? 1,
    },
    now,
  ).canSend;
}

/**
 * An account ready for the limiter, or null when it must not be given work.
 *
 * Only an active account gets work: paused, warned, restricted and
 * reauth-required accounts are all left alone until a human intervenes.
 */
async function loadAccount(
  db: Db,
  accountId: string,
  today: string,
): Promise<{ account: AccountRecord; timezone: string } | null> {
  const { data: accountRow } = await db
    .from("linkedin_accounts")
    .select(ACCOUNT_USAGE_COLUMNS)
    .eq("id", accountId)
    .single();
  if (!accountRow || accountRow.status !== "active") return null;

  const account = await resetCountersIfNeeded(db, accountRow as AccountRecord, today);
  const { data: profile } = await db.from("profiles").select("timezone").eq("id", account.user_id).single();
  return { account, timezone: profile?.timezone ?? "UTC" };
}
