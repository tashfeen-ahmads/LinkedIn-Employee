import { writeComment, COMMENT_PROMPT_VERSION } from "@le/agents";
import {
  ACCOUNT_USAGE_COLUMNS,
  dailyCommentCap,
  isWithinWorkingHours,
  localDate,
  parseWorkingHours,
  toUsage,
  type AccountRecord,
} from "@le/linkedin";
import { LINKEDIN_LIMITS, choosePost, matchExclusion, workingMsLeftToday, worthCommentingOn } from "@le/shared";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { recordBeat } from "../heartbeat.js";
import { rollCounters } from "@le/linkedin";
import { loadExclusions } from "../exclusions.js";
import { outreachPause } from "../platform.js";
import { ENGAGE_LATE_MS } from "./linkedin-action.js";
import { agentForCampaign, modelFor, voiceOf } from "../agent.js";
import { businessFor } from "../brand.js";
import { workspaceEntitlement } from "../billing.js";
import { enqueueOnce, jobId, type Queues } from "../queues.js";

export const ENGAGEMENT_BEAT = "engagement:plan";

/** Likes planned per account in one hourly run, so a day's allowance is spread across the day. */
const REACTIONS_PER_RUN = 3;
/** Comments planned per account in one hourly run. */
const COMMENTS_PER_RUN = 1;
/** People whose posts are read per account per run. Every read comes off the rep's seat. */
const LOOKUPS_PER_RUN = 6;
/**
 * A person whose posts were read is not read again for this long, found or
 * not. Without it the same six people at the top of the list were read every
 * hour, forty-eight times a day, and nobody below them was ever looked at.
 */
export const POSTS_RECHECK_MS = 3 * 86_400_000;
/** The most rows read to choose from; ordered, so "newest first" means the whole list. */
const CANDIDATE_ROWS = 300;

/** The people worth engaging with: in a live conversation with this account, not finished with it. */
const ENGAGEABLE = ["invited", "accepted", "messaged_1", "messaged_2", "messaged_3", "replied", "positive"] as const;

/**
 * Plans likes and comments on prospects' recent posts (rule 68), hourly.
 *
 * For each working account inside its owner's hours: the people in its running
 * campaigns, newest relationships first, none engaged with in the last week;
 * one recent post of their own each, chosen in code (`choosePost`); a like,
 * and a comment when the post says enough to respond to and the day still has
 * room for one. Each becomes an `engagement_actions` row and a job on the one
 * send path, placed minutes apart so an hour's handful never lands at once.
 *
 * The comment is written here, never on the send path, for rule 1's reason: a
 * slow model there is a missed send. A comment that fails its checks after one
 * rewrite is not written at all, and the post is only liked.
 */
export async function planEngagement(
  ctx: WorkerContext,
  queues: Pick<Queues, "linkedinAction">,
  now: Date = new Date(),
): Promise<{ planned: number }> {
  const { db } = ctx;
  // Nothing is read or written while the operator has outreach paused, and an
  // unreadable setting counts as paused (rule 59).
  if (await outreachPause(db)) return { planned: 0 };
  const { data: workspaces, error } = await db.from("workspaces").select("id").eq("engage_posts", true);
  if (error || !workspaces?.length) return { planned: 0 };

  let planned = 0;
  for (const workspace of workspaces) {
    try {
      planned += await planForWorkspace(ctx, queues, workspace.id, now);
    } catch (err) {
      console.error("engagement planning failed", { workspaceId: workspace.id, reason: String(err) });
    }
  }
  await recordBeat(db, ENGAGEMENT_BEAT, { at: now.toISOString(), planned }).catch(() => undefined);
  return { planned };
}

async function planForWorkspace(
  ctx: WorkerContext,
  queues: Pick<Queues, "linkedinAction">,
  workspaceId: string,
  now: Date,
): Promise<number> {
  const { db } = ctx;
  await sweepStale(ctx, workspaceId, now);
  const entitled = await workspaceEntitlement(db, workspaceId, now);
  if (!entitled?.canSend) return 0;

  const { data: campaigns } = await db
    .from("campaigns")
    .select("id, linkedin_account_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "running");
  if (!campaigns?.length) return 0;

  const byAccount = new Map<string, string[]>();
  for (const c of campaigns) {
    if (!c.linkedin_account_id) continue;
    byAccount.set(c.linkedin_account_id, [...(byAccount.get(c.linkedin_account_id) ?? []), c.id]);
  }

  let planned = 0;
  for (const [accountId, campaignIds] of byAccount) {
    const { data: accountRow } = await db.from("linkedin_accounts").select(ACCOUNT_USAGE_COLUMNS).eq("id", accountId).maybeSingle();
    if (!accountRow || accountRow.status !== "active" || !accountRow.provider_account_id) continue;
    // Quiet while LinkedIn is holding the account's invitations.
    if (accountRow.invites_paused_until && Date.parse(accountRow.invites_paused_until) > now.getTime()) continue;
    const { data: owner } = await db.from("profiles").select("timezone, full_name").eq("id", accountRow.user_id).maybeSingle();
    const timezone = owner?.timezone ?? "UTC";
    const hours = parseWorkingHours(accountRow.working_hours);
    if (!isWithinWorkingHours(now, hours, timezone)) continue;
    // Everything planned this run lands before close, never carried overnight
    // onto a post a day older.
    const msLeft = workingMsLeftToday(now, hours, timezone);

    const usage = toUsage(rollCounters(accountRow as AccountRecord, localDate(now, timezone)), timezone);
    const since = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
    const { data: queuedToday } = await db
      .from("engagement_actions")
      .select("kind")
      .eq("linkedin_account_id", accountId)
      .eq("status", "queued")
      .gte("created_at", since);
    const queuedLikes = (queuedToday ?? []).filter((r) => r.kind === "reaction").length;
    const queuedComments = (queuedToday ?? []).filter((r) => r.kind === "comment").length;
    let likesLeft = Math.min(REACTIONS_PER_RUN, LINKEDIN_LIMITS.reactionsPerDay - usage.reactionsToday - queuedLikes);
    let commentsLeft = Math.min(
      COMMENTS_PER_RUN,
      dailyCommentCap(usage.firstActionAt, now) - usage.commentsToday - queuedComments,
    );
    if (likesLeft <= 0) continue;

    const people = await candidates(ctx, workspaceId, campaignIds, now);
    let lookups = 0;
    let offsetMs = 0;
    for (const person of people) {
      if (likesLeft <= 0 || lookups >= LOOKUPS_PER_RUN) break;
      lookups += 1;
      let posts;
      try {
        posts = await ctx.linkedin.listPosts({ accountId: accountRow.provider_account_id, userId: person.providerId, limit: 5 });
      } catch {
        // A read that failed is not "they have no posts", and it is not worth
        // spending the rest of the run's reads finding out why.
        break;
      }
      await db
        .from("prospects")
        .update({ posts_checked_at: now.toISOString() })
        .eq("id", person.prospectId)
        .eq("workspace_id", workspaceId);
      const post = choosePost(posts, now);
      if (!post) continue;

      const base = {
        workspace_id: workspaceId,
        linkedin_account_id: accountId,
        prospect_id: person.prospectId,
        campaign_id: person.campaignId,
        post_id: post.socialId,
        post_url: post.url,
        post_excerpt: post.text.slice(0, 280),
        post_at: post.postedAt,
      };
      // Minutes apart, jittered: a handful an hour, never in a burst.
      offsetMs += (4 + Math.random() * 11) * 60_000;
      if (offsetMs >= msLeft) break;
      const like = await insertAction(ctx, { ...base, kind: "reaction", reaction_type: "like" }, now, offsetMs);
      if (!like) continue;
      if (!(await enqueue(ctx, queues, workspaceId, like, offsetMs))) continue;
      likesLeft -= 1;
      planned += 1;

      if (commentsLeft > 0 && worthCommentingOn(post) && offsetMs + 28 * 60_000 < msLeft) {
        const written = await commentFor(ctx, workspaceId, person.campaignId, post.text, person.firstName, owner?.full_name ?? null);
        if (written) {
          // A while after the like, as a person who read the post would.
          const commentOffset = offsetMs + (8 + Math.random() * 20) * 60_000;
          const comment = await insertAction(
            ctx,
            { ...base, kind: "comment", body: written.comment, grounding: written.grounding, prompt_version: COMMENT_PROMPT_VERSION },
            now,
            commentOffset,
          );
          if (comment && (await enqueue(ctx, queues, workspaceId, comment, commentOffset))) {
            commentsLeft -= 1;
            planned += 1;
          }
        }
      }
    }
  }
  if (planned) {
    await recordEvent(db, {
      workspaceId,
      name: "engagement.planned",
      subjectType: "workspace",
      subjectId: workspaceId,
      payload: { planned },
    }).catch(() => undefined);
  }
  return planned;
}

interface Candidate {
  prospectId: string;
  campaignId: string;
  providerId: string;
  firstName: string | null;
}

/** People in this account's running campaigns, newest relationships first, none touched this week. */
async function candidates(ctx: WorkerContext, workspaceId: string, campaignIds: string[], now: Date): Promise<Candidate[]> {
  const { db } = ctx;
  const { data: rows } = await db
    .from("campaign_prospects")
    .select("prospect_id, campaign_id, status, accepted_at, invited_at")
    .eq("workspace_id", workspaceId)
    .in("campaign_id", campaignIds)
    .in("status", [...ENGAGEABLE])
    .order("accepted_at", { ascending: false })
    .order("invited_at", { ascending: false })
    .limit(CANDIDATE_ROWS);
  if (!rows?.length) return [];
  const ids = [...new Set(rows.map((r) => r.prospect_id))];
  const { data: prospects } = await db
    .from("prospects")
    .select("id, provider_id, first_name, company, linkedin_url, do_not_contact, last_engaged_at, posts_checked_at")
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  // Checked here as well as on the send path, so an excluded person costs
  // neither a read off the seat nor a model call.
  const exclusions = await loadExclusions(db, workspaceId);
  const recentCutoff = now.getTime() - LINKEDIN_LIMITS.engageSamePersonEveryDays * 86_400_000;
  const { data: planned } = await db
    .from("engagement_actions")
    .select("prospect_id")
    .eq("workspace_id", workspaceId)
    .in("prospect_id", ids)
    .gte("created_at", new Date(recentCutoff).toISOString());
  const plannedRecently = new Set((planned ?? []).map((r) => r.prospect_id));
  const byId = new Map((prospects ?? []).map((p) => [p.id, p]));

  // Accepted people first: a like on somebody you are talking to is a person
  // paying attention; on somebody yet to accept, it is a nudge.
  const ordered = [...rows].sort((a, b) => {
    const at = (r: typeof a) => Date.parse(r.accepted_at ?? r.invited_at ?? "") || 0;
    return Number(Boolean(b.accepted_at)) - Number(Boolean(a.accepted_at)) || at(b) - at(a);
  });
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const row of ordered) {
    const p = byId.get(row.prospect_id);
    if (!p?.provider_id || p.do_not_contact || seen.has(p.id) || plannedRecently.has(p.id)) continue;
    if (p.last_engaged_at && Date.parse(p.last_engaged_at) > recentCutoff) continue;
    if (p.posts_checked_at && now.getTime() - Date.parse(p.posts_checked_at) < POSTS_RECHECK_MS) continue;
    if (matchExclusion(exclusions, { company: p.company, linkedinUrl: p.linkedin_url })) continue;
    seen.add(p.id);
    out.push({ prospectId: p.id, campaignId: row.campaign_id, providerId: p.provider_id, firstName: p.first_name ?? null });
  }
  return out;
}

async function commentFor(
  ctx: WorkerContext,
  workspaceId: string,
  campaignId: string,
  postText: string,
  firstName: string | null,
  repName: string | null,
) {
  try {
    const agent = await agentForCampaign(ctx.db, campaignId);
    const business = await businessFor(ctx.db, workspaceId, agent?.id ?? null);
    if (!business) return null;
    const agents = ctx.agentsFor(workspaceId);
    return await writeComment(agents, {
      postText,
      authorFirstName: firstName,
      repName: agent?.fromName?.trim() || repName || "the rep",
      repContext: business.oneLiner || business.offering || business.companyName,
      companyName: business.companyName,
      voice: voiceOf(agent),
      model: modelFor(agents.client, agent).model,
    });
  } catch (err) {
    console.error("could not write a comment", { workspaceId, reason: String(err) });
    return null;
  }
}

/** The row, or null when this post already has one of this kind (the unique index). */
async function insertAction(
  ctx: WorkerContext,
  row: Record<string, unknown>,
  now: Date,
  offsetMs: number,
): Promise<string | null> {
  const { data, error } = await ctx.db
    .from("engagement_actions")
    .insert({ ...row, status: "queued", scheduled_for: new Date(now.getTime() + offsetMs).toISOString() } as never)
    .select("id")
    .maybeSingle();
  if (error || !data) return null;
  return data.id as string;
}

/**
 * Queues the job, or removes the row it was for. A row left `queued` with no
 * job behind it reads as "planned" for ever and, through the unique index,
 * blocks that post for good.
 */
async function enqueue(
  ctx: WorkerContext,
  queues: Pick<Queues, "linkedinAction">,
  workspaceId: string,
  engagementId: string,
  delayMs: number,
): Promise<boolean> {
  try {
    await enqueueOnce(
      queues.linkedinAction,
      "engage",
      { kind: "engage", workspaceId, engagementId },
      { jobId: jobId("engage", engagementId), delay: Math.round(delayMs) },
    );
    return true;
  } catch (err) {
    console.error("could not queue a like or comment", { workspaceId, reason: String(err) });
    await ctx.db.from("engagement_actions").delete().eq("id", engagementId).eq("workspace_id", workspaceId).eq("status", "queued");
    return false;
  }
}

/**
 * Rows whose job will never run them: queued long past their time (a job that
 * failed every retry), or claimed by a send that never finished. Closed with a
 * reason, so the page never shows "planned" for something that is not.
 */
async function sweepStale(ctx: WorkerContext, workspaceId: string, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 2 * ENGAGE_LATE_MS).toISOString();
  await ctx.db
    .from("engagement_actions")
    .update({ status: "skipped", reason: "it could not go out near the time it was planned" })
    .eq("workspace_id", workspaceId)
    .eq("status", "queued")
    .lt("scheduled_for", cutoff);
  await ctx.db
    .from("engagement_actions")
    .update({ status: "failed", reason: "the send did not finish, so it was not tried again" })
    .eq("workspace_id", workspaceId)
    .eq("status", "sending")
    .lt("scheduled_for", cutoff);
}
