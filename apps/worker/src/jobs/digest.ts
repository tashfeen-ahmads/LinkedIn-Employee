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
  let sent = 0;

  for (const membership of memberships ?? []) {
    const { data: profile } = await db
      .from("profiles")
      .select("email, full_name")
      .eq("id", membership.user_id)
      .maybeSingle();
    if (!profile?.email) continue;

    const summary = await summarise(ctx, membership.workspace_id, membership.user_id, since, now);

    // Nothing happened and nothing is waiting: do not send an email whose only
    // content is four zeroes. A digest people ignore stops being read at all.
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
      digestEmail({
        to: profile.email,
        repName: profile.full_name,
        appUrl: ctx.env.APP_URL,
        ...summary,
      }),
    );
    if (ok) sent++;
  }

  return sent;
}

async function summarise(
  ctx: WorkerContext,
  workspaceId: string,
  userId: string,
  since: string,
  now: Date,
) {
  const { db } = ctx;

  const { data: events } = await db
    .from("events")
    .select("name, created_at")
    .eq("workspace_id", workspaceId)
    .gte("created_at", since);

  const count = (name: string) => (events ?? []).filter((event) => event.name === name).length;

  const { count: awaitingApproval } = await db
    .from("reply_drafts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "pending");

  const { data: meetings } = await db
    .from("meetings")
    .select("starts_at, prospect_id")
    .eq("workspace_id", workspaceId)
    .eq("rep_user_id", userId)
    .gte("starts_at", now.toISOString())
    .order("starts_at", { ascending: true })
    .limit(3);

  const upcoming: string[] = [];
  for (const meeting of meetings ?? []) {
    const { data: prospect } = await db
      .from("prospects")
      .select("first_name, last_name, company")
      .eq("id", meeting.prospect_id)
      .maybeSingle();
    const name = `${prospect?.first_name ?? ""} ${prospect?.last_name ?? ""}`.trim() || "a prospect";
    const when = new Date(meeting.starts_at).toUTCString().slice(0, 22);
    upcoming.push(`${name}${prospect?.company ? ` (${prospect.company})` : ""} — ${when}`);
  }

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
    awaitingApproval: awaitingApproval ?? 0,
    upcoming,
    warnings,
  };
}
