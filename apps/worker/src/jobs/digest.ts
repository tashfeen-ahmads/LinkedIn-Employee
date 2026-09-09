import { digestEmail } from "@le/email";
import type { WorkerContext } from "../context.js";
import { trySend } from "../email.js";

/**
 * The daily digest. One email per rep, covering what their agent did while they
 * were not looking, and leading with the number that actually needs them: the
 * replies waiting for approval.
 */
export async function runDailyDigest(ctx: WorkerContext, now: Date = new Date()): Promise<number> {
  const { db } = ctx;
  if (!ctx.email) return 0;

  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const { data: memberships } = await db.from("memberships").select("workspace_id, user_id");
  if (!memberships?.length) return 0;

  // Everything workspace-wide is fetched once per workspace, not once per rep.
  // The old shape re-ran the same queries for every member of a team and then
  // looked up one conversation per pending draft, so a workspace with ten reps
  // did ten times the work to send ten emails.
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

  let sent = 0;

  for (const [workspaceId, userIds] of byWorkspace) {
    const shared = await loadWorkspaceActivity(ctx, workspaceId, since);

    for (const userId of userIds) {
      const profile = profileById.get(userId);
      if (!profile?.email) continue;

      const summary = await summarise(ctx, workspaceId, userId, shared, now);

      // Nothing happened and nothing is waiting: do not send an email whose
      // only content is four zeroes. A digest people ignore stops being read.
      if (
        summary.invitesSent === 0 &&
        summary.replies === 0 &&
        summary.meetingsBooked === 0 &&
        summary.awaitingApproval === 0 &&
        summary.warnings.length === 0
      ) {
        continue;
      }

      const ok = await trySend(
        ctx.email,
        digestEmail({ to: profile.email, repName: profile.full_name, appUrl: ctx.env.APP_URL, ...summary }),
      );
      if (ok) sent++;
    }
  }

  return sent;
}

interface WorkspaceActivity {
  events: Array<{ name: string; subject_id: string | null }>;
  /** Pending draft ids mapped to the campaign their conversation belongs to. */
  pendingByCampaign: Array<string | null>;
}

/** The workspace-wide reads every rep's summary needs, done once. */
async function loadWorkspaceActivity(
  ctx: WorkerContext,
  workspaceId: string,
  since: string,
): Promise<WorkspaceActivity> {
  const { db } = ctx;

  const [{ data: events }, { data: pendingDrafts }] = await Promise.all([
    db.from("events").select("name, subject_id, created_at").eq("workspace_id", workspaceId).gte("created_at", since),
    db.from("reply_drafts").select("id, conversation_id").eq("workspace_id", workspaceId).eq("status", "pending"),
  ]);

  const conversationIds = [...new Set((pendingDrafts ?? []).map((d) => d.conversation_id))];
  const { data: conversations } = conversationIds.length
    ? await db.from("conversations").select("id, campaign_id").in("id", conversationIds)
    : { data: [] };
  const campaignByConversation = new Map((conversations ?? []).map((c) => [c.id, c.campaign_id]));

  return {
    events: (events ?? []).map((e) => ({ name: e.name, subject_id: e.subject_id })),
    pendingByCampaign: (pendingDrafts ?? []).map((d) => campaignByConversation.get(d.conversation_id) ?? null),
  };
}

async function summarise(
  ctx: WorkerContext,
  workspaceId: string,
  userId: string,
  shared: WorkspaceActivity,
  now: Date,
) {
  const { db } = ctx;

  // Scope everything to this rep's own campaigns. A digest that reports the
  // team's totals as one person's work is worse than none: it flatters whoever
  // did least and buries whoever did most.
  const { data: ownCampaigns } = await db
    .from("campaigns")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("owner_user_id", userId);
  const campaignIds = new Set((ownCampaigns ?? []).map((campaign) => campaign.id));

  const { data: ownCampaignProspects } = campaignIds.size
    ? await db.from("campaign_prospects").select("id").in("campaign_id", [...campaignIds])
    : { data: [] };
  const mine = new Set((ownCampaignProspects ?? []).map((row) => row.id));

  const count = (name: string) =>
    shared.events.filter((event) => event.name === name && (!event.subject_id || mine.has(event.subject_id)))
      .length;

  // A draft on a conversation with no campaign belongs to nobody in
  // particular, so every rep sees it rather than none of them.
  const awaitingApproval = shared.pendingByCampaign.filter(
    (campaignId) => !campaignId || campaignIds.has(campaignId),
  ).length;

  const { data: meetings } = await db
    .from("meetings")
    .select("starts_at, prospect_id")
    .eq("workspace_id", workspaceId)
    .eq("rep_user_id", userId)
    .gte("starts_at", now.toISOString())
    .order("starts_at", { ascending: true })
    .limit(3);

  const { data: meetingProspects } = meetings?.length
    ? await db
        .from("prospects")
        .select("id, first_name, last_name, company")
        .in("id", meetings.map((m) => m.prospect_id))
    : { data: [] };
  const prospectById = new Map((meetingProspects ?? []).map((p) => [p.id, p]));

  const upcoming = (meetings ?? []).map((meeting) => {
    const prospect = prospectById.get(meeting.prospect_id);
    const name = `${prospect?.first_name ?? ""} ${prospect?.last_name ?? ""}`.trim() || "a prospect";
    const when = new Date(meeting.starts_at).toUTCString().slice(0, 22);
    return `${name}${prospect?.company ? ` (${prospect.company})` : ""} — ${when}`;
  });

  const { data: account } = await db
    .from("linkedin_accounts")
    .select("status, status_detail")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  const warnings: string[] = [];
  if (account && account.status !== "active") {
    warnings.push(
      `Your LinkedIn account is ${account.status.replace(/_/g, " ")} — sending is paused until it is reconnected.`,
    );
  }

  return {
    invitesSent: count("invite.sent"),
    accepted: count("invite.accepted"),
    replies: count("message.received"),
    meetingsBooked: count("meeting.booked"),
    awaitingApproval,
    upcoming,
    warnings,
  };
}
