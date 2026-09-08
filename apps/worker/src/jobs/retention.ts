import type { Db } from "@le/db";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";

/**
 * Data retention and erasure.
 *
 * This product stores personal data about people who never signed up for it:
 * names, job titles, employers, and the contents of conversations. Under GDPR
 * that makes the customer a controller and us a processor, and it makes these
 * three operations obligations rather than features.
 */

export interface ErasureResult {
  prospectsDeleted: number;
  messagesDeleted: number;
  meetingsDeleted: number;
}

/**
 * Erases one person on request (GDPR article 17).
 *
 * The prospect row is removed along with everything derived from it, but a
 * tombstone stays behind on the do-not-contact list. Fully forgetting someone
 * who asked not to be contacted would let the next campaign import them again
 * and message them a week later, which is the opposite of what they asked for.
 */
export async function eraseProspect(
  ctx: WorkerContext,
  input: { workspaceId: string; prospectId: string; reason: string },
): Promise<ErasureResult> {
  const { db } = ctx;

  const { data: prospect } = await db
    .from("prospects")
    .select("id, workspace_id, linkedin_url")
    .eq("id", input.prospectId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!prospect) return { prospectsDeleted: 0, messagesDeleted: 0, meetingsDeleted: 0 };

  const { data: conversations } = await db
    .from("conversations")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("prospect_id", prospect.id);
  const conversationIds = (conversations ?? []).map((c) => c.id);

  let messagesDeleted = 0;
  if (conversationIds.length) {
    const { data: messages } = await db
      .from("messages")
      .select("id")
      .in("conversation_id", conversationIds);
    messagesDeleted = messages?.length ?? 0;
    await db.from("messages").delete().in("conversation_id", conversationIds);
    await db.from("reply_drafts").delete().in("conversation_id", conversationIds);
  }

  const { data: meetings } = await db
    .from("meetings")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("prospect_id", prospect.id);

  await db.from("meetings").delete().eq("prospect_id", prospect.id).eq("workspace_id", input.workspaceId);
  await db.from("conversations").delete().eq("prospect_id", prospect.id).eq("workspace_id", input.workspaceId);
  await db.from("campaign_prospects").delete().eq("prospect_id", prospect.id).eq("workspace_id", input.workspaceId);

  // The tombstone: identity reduced to the one fact we must keep.
  await db
    .from("prospects")
    .update({
      first_name: null,
      last_name: null,
      headline: null,
      title: null,
      company: null,
      company_size: null,
      industry: null,
      location: null,
      about: null,
      provider_id: null,
      crm_contact_id: null,
      signals: [] as never,
      fit_reasons: [] as never,
      fit_score: null,
      intent_score: null,
      do_not_contact: true,
      do_not_contact_reason: `erased: ${input.reason}`,
    })
    .eq("id", prospect.id);

  await recordEvent(db, {
    workspaceId: input.workspaceId,
    name: "prospect.opted_out",
    subjectType: "prospect",
    subjectId: prospect.id,
    // Deliberately records no personal data, only that an erasure happened.
    payload: { erased: true, reason: input.reason, messagesDeleted },
  });

  return { prospectsDeleted: 1, messagesDeleted, meetingsDeleted: meetings?.length ?? 0 };
}

/**
 * Deletes prospect data the workspace has held longer than its retention
 * setting and is no longer using. Anyone in an open conversation or with an
 * upcoming meeting is left alone: retention limits are about data nobody needs,
 * not about deleting a deal in progress.
 */
export async function runRetentionSweep(ctx: WorkerContext, now: Date = new Date()): Promise<number> {
  const { db } = ctx;
  const { data: workspaces } = await db.from("workspaces").select("id, data_retention_days");
  let erased = 0;

  for (const workspace of workspaces ?? []) {
    const days = workspace.data_retention_days ?? 365;
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();

    const { data: stale } = await db
      .from("prospects")
      .select("id, created_at, last_contacted_at, do_not_contact")
      .eq("workspace_id", workspace.id)
      .lt("created_at", cutoff)
      .limit(200);

    for (const prospect of stale ?? []) {
      // Already erased down to a tombstone; nothing left to remove.
      if (prospect.do_not_contact) continue;
      if (await hasLiveActivity(db, workspace.id, prospect.id, now)) continue;

      await eraseProspect(ctx, {
        workspaceId: workspace.id,
        prospectId: prospect.id,
        reason: `retention limit of ${days} days`,
      });
      erased++;
    }
  }

  return erased;
}

async function hasLiveActivity(db: Db, workspaceId: string, prospectId: string, now: Date): Promise<boolean> {
  const { data: upcoming } = await db
    .from("meetings")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("prospect_id", prospectId)
    .gte("starts_at", now.toISOString())
    .limit(1);
  if (upcoming?.length) return true;

  const { data: active } = await db
    .from("campaign_prospects")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("prospect_id", prospectId)
    .not("status", "in", "(closed,opted_out,failed)")
    .limit(1);
  return Boolean(active?.length);
}

export interface WorkspaceExport {
  exportedAt: string;
  workspace: unknown;
  prospects: unknown[];
  conversations: unknown[];
  messages: unknown[];
  meetings: unknown[];
  campaigns: unknown[];
}

/**
 * Everything a workspace holds, as JSON. Serves both a customer's own
 * portability request and their ability to answer one from a prospect.
 * Credentials are never included.
 */
export async function exportWorkspace(ctx: WorkerContext, workspaceId: string): Promise<WorkspaceExport> {
  const { db } = ctx;

  const [workspace, prospects, conversations, meetings, campaigns] = await Promise.all([
    db.from("workspaces").select("id, name, plan, created_at").eq("id", workspaceId).maybeSingle(),
    db.from("prospects").select("*").eq("workspace_id", workspaceId),
    db.from("conversations").select("*").eq("workspace_id", workspaceId),
    db.from("meetings").select("*").eq("workspace_id", workspaceId),
    db.from("campaigns").select("*").eq("workspace_id", workspaceId),
  ]);

  const { data: messages } = await db
    .from("messages")
    .select("id, conversation_id, direction, source, body, sent_at, created_at")
    .eq("workspace_id", workspaceId);

  return {
    exportedAt: new Date().toISOString(),
    workspace: workspace.data ?? null,
    prospects: prospects.data ?? [],
    conversations: conversations.data ?? [],
    messages: messages ?? [],
    meetings: meetings.data ?? [],
    campaigns: campaigns.data ?? [],
  };
}
