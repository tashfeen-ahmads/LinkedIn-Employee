import {
  PACING_LOOP,
  PACING_STALE_MS,
  dailyReport,
  knowledgeSentences,
  type AgentKnowledge,
  type ReportFacts,
} from "@le/shared";
import { weeklyReportEmail } from "@le/email";
import type { WorkerContext } from "../context.js";
import { trySend } from "../email.js";

/**
 * The week, in the same words the overview uses.
 *
 * The daily digest is a working tool — counters and the number waiting — and it
 * is the wrong thing to forward to whoever signs off the subscription. This is
 * the one somebody forwards: what the agent did, in sentences, plus what it has
 * accumulated that could not be handed to a new tool on day one.
 *
 * `dailyReport` and `knowledgeSentences` do the writing, which is the point.
 * The screen reads those two functions and so does this, so the email and the
 * dashboard cannot describe the same week differently — and a rep believing
 * whichever they happened to open is exactly how this product has gone wrong
 * before.
 */
const WEEK_MS = 7 * 86_400_000;

/** The events a week's report is assembled from. Same set as the screen's. */
const COUNTED = [
  "prospect.warmed",
  "invite.sent",
  "invite.accepted",
  "message.sent",
  "reply.sent",
  "message.received",
  "meeting.booked",
  "prospect.opted_out",
] as const;

export async function runWeeklyReport(ctx: WorkerContext, now: Date = new Date()): Promise<number> {
  const { db } = ctx;
  if (!ctx.email) return 0;

  const from = new Date(now.getTime() - WEEK_MS);

  const { data: memberships } = await db.from("memberships").select("workspace_id, user_id");
  if (!memberships?.length) return 0;

  const { data: profiles } = await db
    .from("profiles")
    .select("id, email, full_name")
    .in("id", [...new Set(memberships.map((m) => m.user_id))]);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const byWorkspace = new Map<string, string[]>();
  for (const membership of memberships) {
    const existing = byWorkspace.get(membership.workspace_id) ?? [];
    existing.push(membership.user_id);
    byWorkspace.set(membership.workspace_id, existing);
  }

  // Read once for the whole run rather than once per workspace: the pacing loop
  // is a property of the deployment, not of a tenant.
  const { data: beat } = await db
    .from("worker_heartbeats")
    .select("beat_at")
    .eq("name", PACING_LOOP)
    .maybeSingle();
  const stamped = beat?.beat_at ? Date.parse(beat.beat_at) : null;
  const loopStalled = stamped === null || now.getTime() - stamped > PACING_STALE_MS;

  let sent = 0;

  for (const [workspaceId, userIds] of byWorkspace) {
    const facts = await weekFacts(ctx, workspaceId, from, now, loopStalled);

    /*
     * A week in which nothing happened at all does not get an email.
     *
     * A weekly report is a claim that something was done; sent into a week
     * where nothing was, it is an advert for a product that did not run, and
     * a report people delete unopened stops being read at exactly the moment
     * there is something worth reading. The exception is a stalled loop, which
     * is the one silence worth mailing about.
     */
    const didSomething =
      facts.warmed + facts.invited + facts.messaged + facts.accepted + facts.replies > 0;
    if (!didSomething && !loopStalled) continue;

    const knowledge = await workspaceKnowledge(ctx, workspaceId);
    const lines = dailyReport(facts);
    const knowledgeLines = knowledgeSentences(knowledge);

    for (const userId of userIds) {
      const profile = profileById.get(userId);
      if (!profile?.email) continue;

      const ok = await trySend(
        ctx.email,
        weeklyReportEmail({
          to: profile.email,
          repName: profile.full_name,
          appUrl: ctx.env.APP_URL,
          lines,
          knowledge: knowledgeLines,
          invited: facts.invited,
          accepted: facts.accepted,
        }),
      );
      if (ok) sent++;
    }
  }

  return sent;
}

/** A week's work, in the shape `dailyReport` reads. */
async function weekFacts(
  ctx: WorkerContext,
  workspaceId: string,
  from: Date,
  now: Date,
  loopStalled: boolean,
): Promise<ReportFacts> {
  const { data: events } = await ctx.db
    .from("events")
    .select("name")
    .eq("workspace_id", workspaceId)
    .in("name", COUNTED as unknown as string[])
    .gte("created_at", from.toISOString())
    .lt("created_at", now.toISOString())
    .limit(5000);

  const count = (name: string) => (events ?? []).filter((row) => row.name === name).length;

  const { data: waiting } = await ctx.db
    .from("conversations")
    .select("needs_human_reason")
    .eq("workspace_id", workspaceId)
    .eq("needs_human", true)
    .limit(200);

  const held = new Map<string, number>();
  for (const row of waiting ?? []) {
    const reason = (row.needs_human_reason ?? "").trim();
    held.set(reason, (held.get(reason) ?? 0) + 1);
  }

  return {
    warmed: count("prospect.warmed"),
    invited: count("invite.sent"),
    accepted: count("invite.accepted"),
    messaged: count("message.sent") + count("reply.sent"),
    replies: count("message.received"),
    meetings: count("meeting.booked"),
    optedOut: count("prospect.opted_out"),
    held: [...held.entries()].map(([reason, n]) => ({ reason, count: n })).sort((a, b) => b.count - a.count),
    /*
     * Not reported over a week.
     *
     * A throttle is an explanation for a quiet afternoon; summed across seven
     * days it is a number nobody can act on, and the allowance line is a
     * statement about today. Both are on the screen, where the window they
     * describe is the window being looked at.
     */
    throttledMs: 0,
    allowance: null,
    loopStalled,
  };
}

/** What this workspace has accumulated, counted once. */
async function workspaceKnowledge(ctx: WorkerContext, workspaceId: string): Promise<AgentKnowledge> {
  const head = { count: "exact" as const, head: true };
  const [openers, offers, variants, contacted, docs, replies] = await Promise.all([
    ctx.db.from("hooks").select("id", head).eq("workspace_id", workspaceId).not("approved_at", "is", null),
    ctx.db.from("pitches").select("id", head).eq("workspace_id", workspaceId).not("approved_at", "is", null),
    ctx.db.from("campaign_variants").select("id", head).eq("workspace_id", workspaceId),
    ctx.db
      .from("prospects")
      .select("id", head)
      .eq("workspace_id", workspaceId)
      .not("last_contacted_at", "is", null),
    ctx.db.from("knowledge_documents").select("id", head).eq("workspace_id", workspaceId),
    ctx.db.from("reply_drafts").select("id", head).eq("workspace_id", workspaceId).eq("status", "sent"),
  ]);

  return {
    openers: openers.count ?? 0,
    offers: offers.count ?? 0,
    anglesTested: variants.count ?? 0,
    peopleContacted: contacted.count ?? 0,
    knowledgeDocuments: docs.count ?? 0,
    repliesSent: replies.count ?? 0,
  };
}
