import {
  canTransition,
  INVITE_CAPACITY_BEAT,
  INVITE_CAPACITY_EVERY_MS,
  LINKEDIN_LIMITS,
  PACING_LAST_ACTION,
  PACING_LAST_FAILURE,
  PACING_LOOP,
  type CampaignProspectStatus,
} from "@le/shared";
import { entitlementFor, trialLimitEnforced } from "@le/billing";
import {
  checkAction,
  dailyInviteCap,
  invitationCouldFollow,
  localDate,
  localDayStart,
  nextGapMs,
  spreadGapMs,
  warmStillCounts,
  workingMsLeftToday,
} from "@le/linkedin";
import type { Db } from "@le/db";
import { enqueueOnce, jobId } from "../queues.js";
import type { Queues } from "../queues.js";
import { resetCountersIfNeeded, toUsage, type AccountRecord, ACCOUNT_USAGE_COLUMNS } from "../accounts.js";
import { recordBeat } from "../heartbeat.js";
import { outreachPause } from "../platform.js";

/**
 * The pacing loop. Runs every few minutes and, for each running campaign, asks
 * the rate limiter how much the account may still do today, then enqueues
 * exactly that many actions with jittered delays.
 *
 * The limiter is consulted here AND again immediately before each action is
 * sent, because minutes pass in between and a rep may act manually meanwhile.
 */
export async function runCampaignTick(
  db: Db,
  queues: Queues,
  now: Date = new Date(),
  /**
   * The provider, so the loop can ask how many invitations LinkedIn is still
   * holding. Optional because every existing caller and every existing test
   * passes three arguments, and a loop that refuses to run without a provider
   * would be a worse failure than one that skips a sample.
   */
  linkedin?: unknown,
): Promise<number> {
  // The heartbeat used to be written at the end of the run, which meant a run
  // that threw wrote nothing — and "threw" and "never ran" are the same absence
  // from every screen. That is not a hypothetical: the first tick with actual
  // work to do threw, and the product reported eight hours of silence as a
  // stopped loop while the loop was in fact running and failing every five
  // minutes. A report you only get when the work succeeded is a report about
  // the times you did not need it.
  try {
    return await tick(db, queues, now, linkedin);
  } catch (err) {
    const reason = (err as { message?: string })?.message ?? "unknown";
    console.error("campaign tick failed", { reason });
    await beat(db, now, { failed: reason });
    // And again under a name no successful run ever writes. The stamp above is
    // overwritten by the next quiet decline five minutes from now, so on its
    // own it reports a loop that has been failing all day as a loop that is
    // fine — which is the same disease it was written to cure.
    await recordBeat(db, PACING_LAST_FAILURE, { failed: reason }, now);
    // Rethrown so the queue retries and the error tracker sees it. The point of
    // the stamp above is that it is written before this line, not instead of it.
    throw err;
  }
}

async function tick(db: Db, queues: Queues, now: Date, linkedin?: unknown): Promise<number> {
  const { data: campaigns } = await db
    .from("campaigns")
    .select("id, workspace_id, linkedin_account_id, daily_invite_cap, owner_user_id, warm_up")
    .eq("status", "running");
  if (!campaigns?.length) {
    await beat(db, now, { campaigns: 0, enqueued: 0 });
    return 0;
  }

  // The operator's kill switch. Said in the stamp, because "paused by us" and
  // "nothing to do" are otherwise the same `enqueued: 0` (rule 21).
  const paused = await outreachPause(db);
  if (paused) {
    await beat(db, now, { campaigns: campaigns.length, enqueued: 0, paused });
    return 0;
  }

  let enqueued = 0;
  // One lookup per workspace and per account, not per campaign: several
  // running campaigns commonly share both.
  const entitled = new Map<string, boolean>();
  const accounts = new Map<string, { account: AccountRecord; timezone: string } | null>();

  // Why each campaign got what it got.
  //
  // Reporting only the count made a healthy decline and a broken deployment
  // the same line: `enqueued: 0` is what this loop says when it is two o'clock
  // in the morning, and also what it says when the account is disconnected,
  // the trial has lapsed, or there is nobody left to invite. Four different
  // things to do about it. The count was never the useful half.
  const decisions: Array<{ campaign: string; reason: string }> = [];
  const say = (campaign: string, reason: string) => {
    if (decisions.length < 20) decisions.push({ campaign, reason });
  };

  // What is already on the conveyor belt, read once for every campaign and
  // every account this run touches. See `invitesInFlight`.
  const inFlight = await invitesInFlight(db, queues, campaigns as CampaignRow[], now);

  for (const campaign of campaigns) {
    // A trial that has ended, or a subscription that has, stops outreach here.
    // Reading is never blocked; see packages/billing/src/entitlement.ts.
    if (!entitled.has(campaign.workspace_id)) {
      entitled.set(campaign.workspace_id, await canWorkspaceSend(db, campaign.workspace_id, now));
    }
    if (!entitled.get(campaign.workspace_id)) {
      say(campaign.id, "workspace cannot send: trial or subscription");
      continue;
    }

    if (!accounts.has(campaign.linkedin_account_id)) {
      accounts.set(
        campaign.linkedin_account_id,
        await loadAccount(db, campaign.linkedin_account_id, now),
      );
    }
    const loaded = accounts.get(campaign.linkedin_account_id);
    if (!loaded) {
      say(campaign.id, "linkedin account is not active");
      continue;
    }

    const usage = toUsage(loaded.account, loaded.timezone);

    // Follow-ups first: a conversation already started is worth more than a
    // new invitation, and both draw on the same daily message budget.
    enqueued += await enqueueFollowUps(db, queues, campaign, usage, now);

    /*
     * Warming runs before inviting and independently of it.
     *
     * Before, because the point is that the view lands first. Independently,
     * because an invitation throttle stops invitations and nothing else — a
     * campaign held for six hours should come out of it with its next fifty
     * prospects already familiar with the name, rather than with six hours of
     * nothing to show.
     */
    const warmed = await enqueueWarmUps(db, queues, campaign, usage, loaded.account, now);
    enqueued += warmed.enqueued;

    const invites = await enqueueInvites(db, queues, campaign, usage, loaded.account, now, inFlight);
    enqueued += invites.enqueued;

    // Both reasons, not just the invitation's. During a throttle the
    // invitation line reads "holding until 14:07" and the warm-up line reads
    // "warmed 12 profile(s)" — one of those is the campaign doing nothing and
    // the other is the campaign doing the only useful thing available, and
    // reporting only the first makes the second invisible.
    if (warmed.reason) say(campaign.id, warmed.reason);
    say(campaign.id, invites.reason);
  }

  /*
   * The capacity sample runs after every campaign has been dealt with, never
   * before one.
   *
   * It is a diagnostic. Diagnostics do not get to delay the thing they are
   * diagnosing, and putting this ahead of the sending decisions meant a slow
   * provider call stopped the loop before it had done any work at all. Behind
   * them, the worst a bad ten seconds costs is a late heartbeat.
   */
  if (linkedin) {
    for (const loaded of accounts.values()) {
      if (loaded) await sampleInviteCapacity({ db, linkedin }, loaded.account, now);
    }
  }

  await beat(db, now, {
    campaigns: campaigns.length,
    enqueued,
    decisions,
    // What is actually sitting in the queue. A job already holding the id this
    // loop would use is accepted silently by BullMQ and never added, so a
    // single stuck or failed invitation can stop a campaign for ever with the
    // loop reporting a cheerful zero every five minutes. The counts are the
    // only place that shows.
    queue: await jobCounts(queues),
  });
  // A run that sent somebody, kept where a quiet run cannot erase it. "Nothing
  // has gone out since 11:04 this morning" and "nothing has ever gone out" are
  // different situations, and the single upserted row reports both as the
  // decline it happens to be making right now.
  if (enqueued > 0) {
    await recordBeat(db, PACING_LAST_ACTION, { enqueued, campaigns: campaigns.length, decisions }, now);
  }
  return enqueued;
}

/**
 * How much work is waiting, per queue, if the queue can say.
 *
 * Guarded because the test double is a plain object with an `add`. A
 * diagnostic that throws is worse than one that is absent — it would take the
 * pacing loop down with it, which is the one loop that must keep running.
 */
async function jobCounts(queues: Queues): Promise<Record<string, unknown>> {
  const queue = queues.linkedinAction as unknown as {
    getJobCounts?: () => Promise<Record<string, number>>;
  };
  if (typeof queue.getJobCounts !== "function") return { counts: "unavailable" };
  try {
    return await queue.getJobCounts();
  } catch (err) {
    return { counts: (err as { message?: string })?.message ?? "unknown" };
  }
}

/**
 * Records that this loop ran, whatever it decided.
 *
 * Every exit above is a silent `continue` or `return 0`, and deliberately so —
 * the loop declines far more often than it acts, and an event each time would
 * bury the ones that matter. But that leaves a campaign launched into a dead
 * worker looking exactly like one waiting out the gap between two invitations:
 * status "running", nobody invited, nothing anywhere. A whole first live launch
 * was spent not knowing which, and the answer was only in the deployment's
 * logs, where the person who pressed Launch cannot go.
 *
 * So the run itself is the record, whether or not it did anything. A stamp that
 * only appeared on a productive run would be missing during exactly the quiet
 * stretch it exists to explain.
 */
/**
 * Ask LinkedIn how many invitations it is still holding, at most hourly.
 *
 * The question that explained four days of refusals in the first live
 * workspace, and that nothing in this product had ever asked. Our own records
 * only know the invitations we issued; LinkedIn counts every one this account
 * has ever sent and nobody answered, including the ones from before it signed
 * up, and past its ceiling it refuses new ones outright.
 *
 * Stamped rather than asked on demand, because the useful shape is a trend. A
 * count climbing towards the ceiling is a warning somebody can act on; the
 * same count read once, by whoever happened to open a screen, is an anecdote.
 *
 * Failure is recorded, not swallowed. "We could not ask" and "there is nothing
 * outstanding" are the two answers that must never look alike — a confident
 * zero here is the difference between "your account is fine" and "your account
 * cannot send".
 */
async function sampleInviteCapacity(
  ctx: { db: Db; linkedin: unknown },
  account: AccountRecord,
  now: Date,
): Promise<void> {
  const provider = ctx.linkedin as {
    listPendingInvitations?: (input: { accountId: string; limit?: number }) => Promise<{
      invitations: Array<{ sentAt: string | null }>;
      raw: unknown;
      truncated?: boolean;
    }>;
  };
  if (typeof provider.listPendingInvitations !== "function") return;
  if (!account.provider_account_id) return;

  const { data: last } = await ctx.db
    .from("worker_heartbeats")
    .select("beat_at")
    .eq("name", INVITE_CAPACITY_BEAT)
    .maybeSingle();
  const since = last?.beat_at ? now.getTime() - Date.parse(last.beat_at) : Number.POSITIVE_INFINITY;
  if (Number.isFinite(since) && since < INVITE_CAPACITY_EVERY_MS) return;

  try {
    /*
     * A deadline, and the deadline is the whole mechanism.
     *
     * This call has no business stopping anybody's campaign, and without a
     * timeout that is exactly what it does: the pacing loop runs at
     * concurrency one, so a provider endpoint that hangs takes the sending
     * loop with it — and a stopped loop is silent from every screen, which is
     * the failure this repo has the most rules about. It happened on the first
     * run, in production, and the tick did not stamp again for six minutes
     * because it never returned.
     *
     * The same lesson as `/health` and its queue ping (rule 22): a check that
     * can wait for ever tells you nothing and costs you everything. Ten
     * seconds is generous for a list endpoint and short enough that a bad
     * minute at the provider is invisible to sending.
     */
    const { invitations, raw, truncated } = await withDeadline(
      provider.listPendingInvitations({ accountId: account.provider_account_id, limit: 500 }),
      CAPACITY_DEADLINE_MS,
    );
    const dates = invitations
      .map((row) => (row.sentAt ? Date.parse(row.sentAt) : Number.NaN))
      .filter((ms) => Number.isFinite(ms));
    await recordBeat(
      ctx.db,
      INVITE_CAPACITY_BEAT,
      {
        account: account.id,
        pending: invitations.length,
        // "500" and "at least 500" are different answers to "is this account
        // crowded", and the second is the one that matters.
        atLeast: truncated || undefined,
        oldest: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
        // The provider's own field names when the list is empty, so a mapping
        // that is wrong cannot report a confident zero.
        shape: invitations.length === 0 ? describePayload(raw) : undefined,
      },
      now,
    );
  } catch (err) {
    await recordBeat(
      ctx.db,
      INVITE_CAPACITY_BEAT,
      { account: account.id, pending: null, failed: (err as { message?: string })?.message ?? "unknown" },
      now,
    );
  }
}

/** How long to wait for the provider before giving up and carrying on. */
const CAPACITY_DEADLINE_MS = 10_000;

/**
 * Resolve, or give up.
 *
 * The rejected promise is deliberately not awaited anywhere: an HTTP call that
 * eventually fails after we stopped caring must not surface as an unhandled
 * rejection and take the process down.
 */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`the provider did not answer within ${Math.round(ms / 1000)}s`)),
      ms,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** The provider's own keys, so an empty list is never mistaken for a zero. */
function describePayload(raw: unknown): string {
  if (Array.isArray(raw)) return `array(${raw.length})`;
  if (raw && typeof raw === "object") {
    const keys = Object.keys(raw as Record<string, unknown>);
    return keys.length ? `object{${keys.slice(0, 10).join(",")}}` : "empty object";
  }
  return typeof raw;
}

async function beat(db: Db, now: Date, detail: Record<string, unknown>): Promise<void> {
  await recordBeat(db, PACING_LOOP, detail, now);
}

type CampaignRow = {
  id: string;
  workspace_id: string;
  linkedin_account_id: string;
  daily_invite_cap: number;
  owner_user_id: string;
  warm_up: boolean;
};

/**
 * Look at profiles, so the invitations that follow are not cold.
 *
 * Deliberately not gated on `invites_paused_until`, which is the whole reason
 * it is a separate action. LinkedIn refusing connection requests is LinkedIn
 * forming an opinion about how fast this account asks strangers to connect; it
 * is not a ban on the account using LinkedIn. So a campaign that cannot invite
 * anybody for six hours can still spend those six hours building the
 * familiarity that makes the invitation land when it is finally allowed —
 * which turns the worst thing that happens to a campaign into the best
 * preparation for it.
 *
 * Its own allowance for the same reason. A view drawn from the invitation
 * budget would mean warming somebody cost us the ability to write to them.
 */
async function enqueueWarmUps(
  db: Db,
  queues: Queues,
  campaign: CampaignRow,
  usage: ReturnType<typeof toUsage>,
  account: AccountRecord,
  now: Date,
): Promise<{ enqueued: number; reason: string | null }> {
  if (!campaign.warm_up) return { enqueued: 0, reason: null };

  /*
   * A view is only worth its allowance if the invitation can follow it.
   *
   * The warm-up ignores an invitation throttle on purpose, because a throttle
   * stops invitations and not profile views — that is what lets a held
   * campaign keep doing something useful. But "keep doing something useful"
   * stops being true the moment the invitation cannot arrive while the view is
   * still recent: eight people were viewed on a Friday afternoon against a
   * hold that ran until the following afternoon, and every one of those views
   * was spent twenty-three hours early.
   *
   * So the question is not "may I view somebody" but "will an invitation still
   * be possible when this view matures". Waiting costs nothing — the people
   * are not going anywhere, and the view will be spent later at full value
   * rather than now at a fraction of it.
   */
  if (
    !invitationCouldFollow(
      {
        usage,
        pausedUntil: account.invites_paused_until ? new Date(account.invites_paused_until) : null,
        maturesAfterMs: LINKEDIN_LIMITS.warmUpToInviteMinMs,
        windowMs: LINKEDIN_LIMITS.warmUpToInviteMaxMs,
      },
      now,
    )
  ) {
    /*
     * ...but say so only if there is somebody it would have warmed.
     *
     * This gate is evaluated before anything asks whether anyone is left, so a
     * campaign that had warmed its whole list reported "holding the warm-up: no
     * invitation could follow a view" on every tick for ever — a sentence about
     * a throttle, on a campaign with nothing to throttle. That sends somebody to
     * investigate the account when the answer is "this campaign is finished
     * warming", which is rule 21's disease exactly: a reason that is true of one
     * situation, printed during another.
     *
     * Asked here rather than at the top so the ordinary sending path still does
     * one query. The refusing path can afford a second.
     */
    const { data: anyone } = await db
      .from("campaign_prospects")
      // Same question as the pool below, so the two cannot disagree about
      // whether this campaign still has warming to do.
      .select("id, warmed_at")
      .eq("campaign_id", campaign.id)
      .eq("status", "queued")
      .limit(50);
    if (!(anyone ?? []).some((row) => !warmStillCounts(row.warmed_at, now))) {
      return { enqueued: 0, reason: null };
    }

    return {
      enqueued: 0,
      reason: "holding the warm-up: no invitation could follow a view soon enough to be worth it",
    };
  }

  const decision = checkAction("profile_view", usage, now);
  if (!decision.allowed && decision.reason !== "too_soon") {
    return { enqueued: 0, reason: `warm-up limiter: ${decision.reason}` };
  }

  const budget = Math.max(0, LINKEDIN_LIMITS.profileViewsPerDay - usage.profileViewsToday);
  if (budget === 0) return { enqueued: 0, reason: "warm-up allowance used up today" };

  const { data: pool } = await db
    .from("campaign_prospects")
    .select("id, warmed_at")
    .eq("campaign_id", campaign.id)
    .eq("status", "queued")
    /*
     * Never viewed, or viewed so long ago the view is spent.
     *
     * It was `.is("warmed_at", null)` — only people nobody had looked at —
     * because viewing somebody twice spends a second allowance on a
     * familiarity already bought. That is right while the first view is still
     * worth something, and wrong once the window has closed: those eight
     * prospects held a Friday view against a hold that ran into the weekend,
     * and nothing would ever have looked at them again.
     *
     * Expressed in memory rather than as `.or()`, for the reason the invite
     * path gives: the in-memory double cannot model that filter faithfully,
     * and a query the tests cannot reproduce is a query nothing checks.
     */
    .limit(budget * 4);

  const waiting = (pool ?? []).filter((row) => !warmStillCounts(row.warmed_at, now)).slice(0, budget);
  if (!waiting.length) return { enqueued: 0, reason: null };

  let delay = decision.allowed ? 0 : decision.retryAfterMs;
  let added = 0;
  let revived = 0;
  for (const row of waiting) {
    delay += nextGapMs();
    const outcome = await enqueueOnce(
      queues.linkedinAction,
      "warm-up",
      { kind: "warm_up", workspaceId: campaign.workspace_id, campaignProspectId: row.id },
      { delay, jobId: jobId("warm-up", row.id) },
    );
    if (outcome === "added") added++;
    else if (outcome === "revived") revived++;
  }

  if (added + revived === 0) return { enqueued: 0, reason: null };
  return { enqueued: added + revived, reason: `warmed ${added + revived} profile(s)` };
}

async function enqueueInvites(
  db: Db,
  queues: Queues,
  campaign: CampaignRow,
  usage: ReturnType<typeof toUsage>,
  account: AccountRecord,
  now: Date,
  inFlight: InFlight,
): Promise<{ enqueued: number; reason: string }> {
  /*
   * LinkedIn asked for time, so nothing is offered until it has had it.
   *
   * Checked before the limiter because it is a different kind of no: ours is a
   * pace we chose, this is the platform refusing outright. Without it the loop
   * walks the next prospect into the same wall every few minutes — seven real
   * people were written off that way in twenty-five minutes, each attempt
   * another rejected invitation against an account already being slowed down.
   */
  const pausedUntil = account.invites_paused_until ? Date.parse(account.invites_paused_until) : 0;
  if (Number.isFinite(pausedUntil) && pausedUntil > now.getTime()) {
    return {
      enqueued: 0,
      reason: `${account.invites_paused_reason ?? "the provider refused invitations"} — holding until ${new Date(pausedUntil).toISOString()}`,
    };
  }

  const decision = checkAction("invite", usage, now);
  if (!decision.allowed && decision.reason !== "too_soon") {
    // The limiter's own word for it, not a paraphrase. "outside_working_hours"
    // and "daily_invite_cap" are correct behaviour and need saying as such;
    // reported as a bare zero they read as a product that does not work.
    return { enqueued: 0, reason: `limiter: ${decision.reason}` };
  }

  if (!inFlight.known) {
    // Budgeting without knowing what is already queued is how a day's
    // allowance gets queued twice. Nobody is lost by waiting five minutes.
    return { enqueued: 0, reason: `could not read what is already queued: ${inFlight.reason ?? "unknown"}` };
  }

  /*
   * What is left today, net of what has been sent *and* what is already on
   * its way.
   *
   * The budget used to be the lowest of the account's ramp, the week and the
   * campaign's own cap — read off counters that only move when an invitation
   * actually goes out. So nothing counted what this campaign had sent today,
   * and nothing counted the jobs already sitting delayed in the queue: a
   * campaign capped at five a day was handed the account's whole allowance,
   * and every tick between placing a job and that job sending saw the same
   * full allowance and placed more. `daily_invite_cap` was a number on a form.
   *
   * The account's share is subtracted across campaigns, because the ramp is a
   * fact about the account (rules 3 and 4): two campaigns on one account each
   * reading "ten left" is twenty invitations from an account allowed ten. The
   * send path would refuse the extra ten, and they would then wait for
   * tomorrow's window and land in its first minutes as a backlog — the burst,
   * one day late. The in-flight count is read from the queue itself once per
   * run and grows as this run places work, so whichever campaign is visited
   * first, the second sees what the first took.
   */
  //
  // Only what is due before the rep's midnight comes off today. A job parked
  // until tomorrow morning — refused on a cap, or placed past the end of the
  // window — will be spent from tomorrow's allowance, and counting it today
  // as well would charge the account twice for one invitation. The week is
  // charged for all of it, which can only ever err towards sending less.
  const dayEnd = localDayStart(now, usage.timezone).getTime() + 86_400_000;
  const onAccount = [...inFlight.entries.values()].filter((e) => e.accountId === campaign.linkedin_account_id);
  const dueToday = onAccount.filter((e) => e.at < dayEnd);
  const accountInFlight = dueToday.length;
  const campaignInFlight = dueToday.filter((e) => e.campaignId === campaign.id).length;
  const { count: sentToday } = await db
    .from("campaign_prospects")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .gte("invited_at", localDayStart(now, usage.timezone).toISOString());

  const accountCap = dailyInviteCap(usage.firstActionAt, now) - usage.invitesToday - accountInFlight;
  const weeklyLeft = LINKEDIN_LIMITS.invitesPerWeek - usage.invitesThisWeek - onAccount.length;
  const campaignLeft = campaign.daily_invite_cap - (sentToday ?? 0) - campaignInFlight;
  const budget = Math.max(0, Math.min(accountCap, weeklyLeft, campaignLeft));
  if (budget === 0) {
    return {
      enqueued: 0,
      reason: `no allowance left today (account ${accountCap}, week ${weeklyLeft}, campaign ${campaignLeft} of ${campaign.daily_invite_cap}; ${accountInFlight} already queued on the account)`,
    };
  }

  const warmFirst = db
    .from("campaign_prospects")
    // `warmed_at` is read, not just tested for null: a view older than the
    // warm-up window bought nothing that is still there to spend.
    .select("id, next_action_at, warmed_at")
    .eq("campaign_id", campaign.id)
    .eq("status", "queued");

  // On a warm-up campaign, nobody is invited before they have been looked at.
  //
  // Without this the first tick after launch invites everybody cold and the
  // warm-up becomes a setting that changes nothing — the exact failure mode
  // every feature on this list has had at least once.
  const { data: waiting } = await (campaign.warm_up ? warmFirst.not("warmed_at", "is", null) : warmFirst)
    // Read wider than the budget, because some of these are serving a hold of
    // their own and are filtered out below. Taking exactly `budget` rows first
    // would let a handful of held prospects fill the whole allowance and send
    // nobody. Widened by what is already queued, which is filtered out too.
    .limit((budget + campaignInFlight) * 4);

  // A prospect LinkedIn refused *about them* — "already invited recently" —
  // carries its own wait. Filtered here rather than in the query because the
  // condition is "null or past", which PostgREST expresses with `.or()` and
  // the in-memory double cannot model faithfully.
  /*
   * A warm that has gone stale is not a warm.
   *
   * The query above asks only whether `warmed_at` is set, and for three days
   * this deployment's eight warmed prospects carried a view spent on the Friday
   * against a hold that ran into the weekend. Inviting them on that would send
   * a cold invitation out of a warm-up campaign and report it as a warm-up that
   * worked. They are dropped here and re-warmed below, which costs one profile
   * view rather than one invitation.
   */
  const stale = campaign.warm_up
    ? (waiting ?? []).filter((row) => !warmStillCounts(row.warmed_at, now)).length
    : 0;
  const queued = (waiting ?? [])
    // Already on its way. Its job holds the id, so enqueueing it again would
    // be declined anyway — but only after it had taken a slot in this run's
    // budget that a new invitation should have had.
    .filter((row) => !inFlight.entries.has(row.id))
    .filter((row) => (campaign.warm_up ? warmStillCounts(row.warmed_at, now) : true))
    .filter((row) => {
      if (!row.next_action_at) return true;
      const due = Date.parse(row.next_action_at);
      return !Number.isFinite(due) || due <= now.getTime();
    })
    .slice(0, budget);
  if (!queued.length) {
    return {
      enqueued: 0,
      reason: stale
        ? `${stale} warmed too long ago to still count — re-warming before inviting`
        : waiting?.length
          ? `${waiting.length} waiting on a per-person hold from LinkedIn`
          : campaign.warm_up
            ? "nobody warmed and waiting yet"
            : "nobody left to invite",
    };
  }

  /*
   * Spread across the rest of the day rather than fired consecutively.
   *
   * One tick places the whole of today's allowance, so the gap between two of
   * them is the only thing deciding whether this account looks like a person
   * working or a script running — see `spreadGapMs`, which is where the cost of
   * getting it wrong is written down.
   *
   * The window is measured from where the *first* invitation will actually
   * land, not from now: a `too_soon` refusal means the account acted a minute
   * ago, and the day it has left starts when that gap is served.
   *
   * Warm-ups are deliberately *not* spread this way. A view is only worth its
   * allowance if the invitation can still follow it inside the four hours that
   * make it a warm-up, so those stay clustered on `nextGapMs` and the spacing
   * that matters for them is the per-prospect wait stamped after the view.
   */
  /*
   * ...and behind whatever this account already has queued.
   *
   * A later tick placing its own invitations from "now" would interleave them
   * with the ones an earlier tick spread across the afternoon, and two that
   * happen to land a minute apart are the pattern the spread exists to stop.
   * Continuing from the last one keeps the day one evenly spaced line however
   * many ticks contributed to it.
   */
  const lastPlaced = Math.max(0, ...dueToday.map((e) => e.at));
  const startDelay = Math.max(decision.allowed ? 0 : decision.retryAfterMs, lastPlaced - now.getTime(), 0);
  const windowMs = workingMsLeftToday(
    new Date(now.getTime() + startDelay),
    usage.workingHours,
    usage.timezone,
  );

  let delay = startDelay;
  let added = 0;
  let revived = 0;
  let pending = 0;
  for (const row of queued) {
    /*
     * Paced against the day's whole allowance, not against however many
     * happen to be eligible in this one tick.
     *
     * A warmed prospect becomes invitable in its own 45-minute-to-4-hour
     * window, so most ticks see a trickle rather than the full list. Divided
     * by the trickle, two eligible people would be placed four hours apart
     * and the next tick would queue its own two on top of them — a rate
     * nobody chose. Divided by the allowance, the rate is the same whether a
     * tick finds ten or one, which is what makes it a pace.
     */
    delay += spreadGapMs({ remaining: budget, windowMs });
    /*
     * Never later than the warm-up still counts.
     *
     * The spread places the day's invitations evenly, and on a long afternoon
     * that can be five hours out — past the four-hour window that makes the
     * earlier view a warm-up. The invitation then went out cold anyway, the
     * view spent for nothing. A warmed prospect is placed no later than its
     * window allows (with a margin for the send path's own gap), and one
     * whose window has already gone is left for the loop to re-warm.
     */
    let at = delay;
    if (campaign.warm_up && row.warmed_at) {
      const latest = Date.parse(row.warmed_at) + LINKEDIN_LIMITS.warmUpToInviteMaxMs - WARM_MARGIN_MS - now.getTime();
      if (!(latest > 0)) continue;
      at = Math.min(delay, latest);
    }
    // The id is what stops a second tick queueing the same invitation five
    // minutes later — and what strands a prospect for ever when the job that
    // holds it has already finished without sending. enqueueOnce keeps the
    // first behaviour and refuses the second.
    const outcome = await enqueueOnce(
      queues.linkedinAction,
      "invite",
      { kind: "invite", workspaceId: campaign.workspace_id, campaignProspectId: row.id },
      { delay: at, jobId: jobId("invite", row.id) },
    );
    if (outcome === "added") added++;
    else if (outcome === "revived") revived++;
    else pending++;
    // Recorded as in flight, so the next campaign on this account — visited
    // later in this same run — budgets against it.
    if (outcome !== "already_pending") {
      inFlight.entries.set(row.id, {
        campaignId: campaign.id,
        accountId: campaign.linkedin_account_id,
        at: now.getTime() + at,
      });
    }
  }

  // Said in full, because these three numbers are three different situations
  // and they used to be reported as one. `queued 7` while seven jobs sat
  // finished in Redis is the sentence that cost a working day.
  const parts = [`queued ${added} invitation(s)`];
  if (revived) parts.push(`re-queued ${revived} stranded`);
  if (pending + campaignInFlight) parts.push(`${pending + campaignInFlight} already waiting`);
  return { enqueued: added + revived, reason: parts.join(", ") };
}

/**
 * Invitations already queued and not yet sent, by campaign and by account.
 *
 * The account counters move when an invitation goes out, and a job placed this
 * morning for three this afternoon has not gone out. Budgeting from the
 * counters alone therefore counted none of the day's queued work, and every
 * tick in between saw the full allowance again. The queue is the only place
 * that knows what is in flight, so it is asked — once per run, not once per
 * campaign.
 *
 * Only rows still `queued` count. A job whose prospect has already been
 * invited, closed or failed will do nothing when it runs, and counting it
 * would spend a slot on a send that cannot happen.
 *
 * `known: false` is a queue that could not be read, which is a different
 * answer from an empty one and is never reported as zero. A queue double with
 * no `getJobs` at all is empty by construction — the same convention as
 * `enqueueOnce`.
 */
interface InFlight {
  known: boolean;
  reason?: string;
  /**
   * Every invitation waiting, delayed or running, by campaign_prospect id:
   * whose it is, and when it is due in epoch ms.
   */
  entries: Map<string, { campaignId: string; accountId: string; at: number }>;
}

const PENDING_STATES = ["active", "waiting", "delayed", "prioritized", "paused"] as const;

async function invitesInFlight(db: Db, queues: Queues, campaigns: CampaignRow[], now: Date): Promise<InFlight> {
  const state: InFlight = { known: true, entries: new Map() };
  const queue = queues.linkedinAction as unknown as {
    getJobs?: (types: readonly string[]) => Promise<
      Array<{ name?: string; data?: { kind?: string; campaignProspectId?: string }; timestamp?: number; delay?: number } | null | undefined>
    >;
  };
  if (typeof queue.getJobs !== "function") return state;

  let jobs: Awaited<ReturnType<NonNullable<typeof queue.getJobs>>>;
  try {
    jobs = await queue.getJobs(PENDING_STATES);
  } catch (err) {
    return { ...state, known: false, reason: (err as { message?: string })?.message ?? "unknown" };
  }

  const dueAt = new Map<string, number>();
  for (const job of jobs ?? []) {
    if (job?.data?.kind !== "invite" || !job.data.campaignProspectId) continue;
    const at = Number(job.timestamp ?? now.getTime()) + Number(job.delay ?? 0);
    dueAt.set(job.data.campaignProspectId, Number.isFinite(at) ? at : now.getTime());
  }
  if (!dueAt.size) return state;

  const accountOf = new Map(campaigns.map((c) => [c.id, c.linkedin_account_id]));
  const ids = [...dueAt.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: rows } = await db
      .from("campaign_prospects")
      .select("id, campaign_id, status")
      .in("id", ids.slice(i, i + 200));
    for (const row of rows ?? []) {
      if (row.status !== "queued") continue;
      // A campaign that is not running sends nothing from its queue, so its
      // jobs take nothing from today's allowance while it stays that way.
      const accountId = accountOf.get(row.campaign_id);
      if (!accountId) continue;
      state.entries.set(row.id, { campaignId: row.campaign_id, accountId, at: dueAt.get(row.id) ?? now.getTime() });
    }
  }
  return state;
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
    // Same hazard as an invitation, and worse: a follow-up job that finished
    // without sending leaves somebody who accepted a connection request waiting
    // on a message that no later tick will ever queue.
    const outcome = await enqueueOnce(
      queues.linkedinAction,
      "follow_up",
      {
        kind: "follow_up",
        workspaceId: campaign.workspace_id,
        campaignProspectId: row.id,
        stepNumber: nextStep,
      },
      { delay, jobId: jobId("follow_up", row.id, nextStep) },
    );
    if (outcome !== "already_pending") count++;
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
    // Read per call rather than once at import, so the switch takes effect on
    // the next tick after the variable changes and a test can set it.
    { enforceTrial: trialLimitEnforced(process.env.TRIAL_LIMIT_ENFORCED) },
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
  now: Date,
): Promise<{ account: AccountRecord; timezone: string } | null> {
  const { data: accountRow } = await db
    .from("linkedin_accounts")
    .select(ACCOUNT_USAGE_COLUMNS)
    .eq("id", accountId)
    .single();
  if (!accountRow || accountRow.status !== "active") return null;

  /*
   * The zone first, because the day the counters belong to is the rep's.
   *
   * This read the UTC date, while every cap, retry and spread was measured
   * from the rep's own midnight. For a rep in California that put the reset at
   * five in the afternoon: the counters emptied with an hour of the working
   * day still to run, and the whole of the next day's allowance went out
   * between five and six — the burst rule 48 exists to prevent, arriving
   * every afternoon through the counter rather than the spread.
   */
  const { data: profile } = await db.from("profiles").select("timezone").eq("id", accountRow.user_id).single();
  const timezone = profile?.timezone ?? "UTC";
  const account = await resetCountersIfNeeded(db, accountRow as AccountRecord, localDate(now, timezone));
  return { account, timezone };
}

/** Room left before a warm-up stops counting, for the send path's own gap and retries. */
const WARM_MARGIN_MS = 15 * 60_000;
