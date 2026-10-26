import { fetchAllRows } from "@le/db";
import { dailyInviteCap } from "@le/linkedin";
import { workspaceEntitlement } from "../billing.js";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { outreachPause } from "../platform.js";
import { enqueueOnce, jobId, type Queues } from "../queues.js";

/** How many days of invitations a running campaign keeps queued before it looks for more. */
export const REFILL_DAYS_OF_ALLOWANCE = 2;
/** At most one refill per campaign in this long: every page comes off a seat somebody pays for. */
export const REFILL_EVERY_MS = 24 * 60 * 60_000;
/** One search page, the same as Find more. */
export const REFILL_SIZE = 50;
/**
 * A campaign launched this recently is left alone: its first list has only
 * just been queued, and the pacing loop has not yet placed a day of it.
 */
export const REFILL_LAUNCH_GRACE_MS = 24 * 60 * 60_000;

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
 * It only asks once the account is down to two days of its allowance across
 * every running campaign on it (and the campaign to two days of its own cap),
 * at most once a day per campaign and once per run per account, never in a
 * campaign's first day, and never after LinkedIn has said there is nobody
 * left.
 *
 * Nothing is searched for outreach that cannot happen: not while the operator
 * pause is on, not for a workspace whose plan does not send, and not for a
 * strategy nobody has approved or one set aside. Each search spends a page of
 * the rep's seat and writes prospect rows that exclude those people for good
 * (rule 27), so a search that cannot lead to an invitation is a loss twice.
 */
export async function refillCampaigns(
  ctx: WorkerContext,
  queues: Pick<Queues, "targeting">,
  now: Date = new Date(),
): Promise<number> {
  const { db } = ctx;
  // Unreadable counts as paused (rule 59): a hiccup is not permission.
  if (await outreachPause(db)) return 0;
  /*
   * Every running campaign, not only the ones that could be refilled.
   *
   * The allowance belongs to the account (rules 3 and 4), and every running
   * campaign on it draws on the same one. Compared campaign by campaign, a
   * free account running five campaigns with 116 people queued between them,
   * eleven days of its allowance, still had each campaign refilled because
   * each one alone looked short. So the queue is counted per account, across
   * every running campaign on it, including the ones that cannot be refilled
   * themselves (search exhausted, no strategy): their people still go out
   * from the same allowance.
   */
  const { data: running, error } = await db
    .from("campaigns")
    .select(
      "id, workspace_id, owner_user_id, customer_profile_id, linkedin_account_id, daily_invite_cap, search_exhausted, launched_at",
    )
    .eq("status", "running");
  if (error || !running?.length) return 0;
  const launchedBefore = now.getTime() - REFILL_LAUNCH_GRACE_MS;
  const campaigns = running.filter(
    (c) =>
      c.search_exhausted !== true &&
      c.customer_profile_id &&
      // Launched in the last day: its list was built for this launch and has
      // not been given a day to drain yet.
      !(c.launched_at && Date.parse(c.launched_at) > launchedBefore),
  );
  if (!campaigns.length) return 0;

  const ids = campaigns.map((c) => c.id);
  const accountIds = [...new Set(campaigns.map((c) => c.linkedin_account_id).filter(Boolean))] as string[];
  // Every running campaign on those accounts, whose queues the accounts share.
  const sharing = running.filter((c) => c.linkedin_account_id && accountIds.includes(c.linkedin_account_id));
  const accountOf = new Map(sharing.map((c) => [c.id, c.linkedin_account_id as string]));
  const profileIds = [...new Set(campaigns.map((c) => c.customer_profile_id).filter(Boolean))] as string[];
  const since = new Date(now.getTime() - REFILL_EVERY_MS).toISOString();
  // Every queued row, page by page: PostgREST answers at most a thousand, and a
  // campaign past the thousandth would read as empty and be refilled every day.
  let queued: { data: Array<{ campaign_id: string }>; error: null } | { data: null; error: string };
  try {
    const paged = await fetchAllRows<{ id: string; campaign_id: string }>((from, to) =>
      db
        .from("campaign_prospects")
        .select("id, campaign_id")
        .in("campaign_id", sharing.map((c) => c.id))
        .eq("status", "queued")
        .order("id")
        .range(from, to),
    );
    queued = paged.truncated ? { data: null, error: "too many queued rows to count" } : { data: paged.rows, error: null };
  } catch (err) {
    queued = { data: null, error: String(err) };
  }
  const [profiles, accounts, recent] = await Promise.all([
    db.from("customer_profiles").select("id, approved_at, do_not_pursue").in("id", profileIds),
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
  if (queued.error || profiles.error || accounts.error || recent.error) return 0;

  const waiting = new Map<string, number>();
  const waitingOnAccount = new Map<string, number>();
  for (const row of queued.data ?? []) {
    waiting.set(row.campaign_id, (waiting.get(row.campaign_id) ?? 0) + 1);
    const accountId = accountOf.get(row.campaign_id);
    if (accountId) waitingOnAccount.set(accountId, (waitingOnAccount.get(accountId) ?? 0) + 1);
  }
  // At most one refill per account per run, the shortest campaign first. Each
  // search adds up to a page, and two found short in the same hour would both
  // be filled before either had been counted.
  const refilledAccounts = new Set<string>();
  campaigns.sort((a, b) => (waiting.get(a.id) ?? 0) - (waiting.get(b.id) ?? 0));
  const accountById = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const refilledToday = new Set((recent.data ?? []).map((e) => e.subject_id));
  // Targeting refuses a strategy nobody approved (rule 9); asking anyway would
  // write a fresh "stopped" banner on a running campaign every day.
  const searchable = new Set(
    (profiles.data ?? []).filter((p) => p.approved_at && !p.do_not_pursue).map((p) => p.id as string),
  );
  const canSend = new Map<string, boolean>();

  let started = 0;
  for (const campaign of campaigns) {
    if (refilledToday.has(campaign.id)) continue;
    if (!searchable.has(campaign.customer_profile_id as string)) continue;
    if (!canSend.has(campaign.workspace_id)) {
      canSend.set(campaign.workspace_id, Boolean((await workspaceEntitlement(db, campaign.workspace_id, now))?.canSend));
    }
    if (!canSend.get(campaign.workspace_id)) continue;
    const account = campaign.linkedin_account_id ? accountById.get(campaign.linkedin_account_id) : undefined;
    if (!account || account.status !== "active" || !account.provider_account_id) continue;

    if (refilledAccounts.has(account.id)) continue;

    const firstAction = account.first_action_at ? new Date(account.first_action_at) : null;
    const accountAllowance = dailyInviteCap(firstAction, now);
    const allowance = Math.min(campaign.daily_invite_cap ?? Infinity, accountAllowance);
    // The account first: two days of what it may send, across every campaign
    // on it. Then the campaign, which can be capped below the account.
    if ((waitingOnAccount.get(account.id) ?? 0) >= REFILL_DAYS_OF_ALLOWANCE * accountAllowance) continue;
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
    // A search already running for this account's campaign is this hour's
    // refill for the account either way.
    refilledAccounts.add(account.id);
    if (outcome === "already_pending") continue;
    await Promise.all([
      recordEvent(db, {
        workspaceId: campaign.workspace_id,
        name: REFILL_EVENT,
        subjectType: "campaign",
        subjectId: campaign.id,
        payload: {
          queued: waiting.get(campaign.id) ?? 0,
          queuedOnAccount: waitingOnAccount.get(account.id) ?? 0,
          allowance,
          accountAllowance,
        },
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
