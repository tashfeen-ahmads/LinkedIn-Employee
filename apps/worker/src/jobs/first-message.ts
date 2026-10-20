import { writeFirstMessage, FIRST_MESSAGE_PROMPT_VERSION } from "@le/agents";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { agentForCampaign, modelFor, voiceOf } from "../agent.js";
import { businessFor } from "../brand.js";

/**
 * Writes the first message for each person who has just accepted (rule 66).
 *
 * Here rather than on the send path, which never waits on a model (rule 1's
 * reason: a slow answer there is a missed send), and here rather than at
 * build time, because only the people who accept ever need one. The step goes
 * twenty to ninety minutes after acceptance, which is the time this has.
 *
 * Best effort by construction. Any failure leaves the row without one, and
 * the send path sends the campaign's own step 1, exactly as before.
 */
export async function writeFirstMessages(ctx: WorkerContext, workspaceId: string, campaignProspectIds: string[]): Promise<number> {
  if (!campaignProspectIds.length) return 0;
  const { db } = ctx;
  const { data: rows } = await db
    .from("campaign_prospects")
    .select("id, campaign_id, prospect_id, variant_id, invite_note, status, last_step_sent")
    .eq("workspace_id", workspaceId)
    .in("id", campaignProspectIds);

  let written = 0;
  for (const row of rows ?? []) {
    if (row.status !== "accepted" || row.last_step_sent) continue;
    try {
      const [{ data: prospect }, { data: campaign }, { data: variant }] = await Promise.all([
        db
          .from("prospects")
          .select("first_name, headline, title, company, location")
          .eq("id", row.prospect_id)
          .eq("workspace_id", workspaceId)
          .maybeSingle(),
        db
          .from("campaigns")
          .select("name, owner_user_id, agent_id, rules")
          .eq("id", row.campaign_id)
          .eq("workspace_id", workspaceId)
          .maybeSingle(),
        row.variant_id
          ? db.from("campaign_variants").select("angle").eq("id", row.variant_id).eq("workspace_id", workspaceId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (!prospect?.first_name || !campaign) continue;

      const agent = await agentForCampaign(db, row.campaign_id);
      const business = await businessFor(db, workspaceId, agent?.id ?? null);
      if (!business) continue;
      const { data: rep } = await db.from("profiles").select("full_name").eq("id", campaign.owner_user_id).maybeSingle();
      const agents = ctx.agentsFor(workspaceId);

      const message = await writeFirstMessage(agents, {
        business,
        repName: agent?.fromName?.trim() || rep?.full_name || business.companyName,
        angle:
          (variant as { angle?: string } | null)?.angle ??
          ((campaign.rules as { angle?: string } | null)?.angle?.trim() || campaign.name),
        inviteNote: row.invite_note,
        voice: voiceOf(agent),
        model: modelFor(agents.client, agent).model,
        prospect: {
          firstName: prospect.first_name,
          headline: prospect.headline,
          title: prospect.title,
          company: prospect.company,
          location: prospect.location,
        },
      });
      if (!message) continue;

      const { error } = await db
        .from("campaign_prospects")
        .update({ first_message: message, first_message_prompt_version: FIRST_MESSAGE_PROMPT_VERSION })
        .eq("id", row.id)
        .eq("workspace_id", workspaceId)
        // Only while it is still ahead of them: never rewrite what was sent.
        .eq("status", "accepted");
      if (!error) written += 1;
    } catch (err) {
      console.error("could not write a first message", { campaignProspectId: row.id, reason: String(err) });
    }
  }
  if (written) {
    await recordEvent(db, {
      workspaceId,
      name: "first_message.written",
      subjectType: "workspace",
      subjectId: workspaceId,
      payload: { written },
    }).catch(() => undefined);
  }
  return written;
}

/** Everybody who has accepted and not yet been written to, without one: written now. */
export async function fillFirstMessages(ctx: WorkerContext): Promise<number> {
  const { data: rows } = await ctx.db
    .from("campaign_prospects")
    .select("id, workspace_id, last_step_sent")
    .eq("status", "accepted")
    .is("first_message", null)
    .limit(200);
  const byWorkspace = new Map<string, string[]>();
  for (const row of rows ?? []) {
    if (row.last_step_sent) continue;
    byWorkspace.set(row.workspace_id, [...(byWorkspace.get(row.workspace_id) ?? []), row.id]);
  }
  let written = 0;
  for (const [workspaceId, ids] of byWorkspace) written += await writeFirstMessages(ctx, workspaceId, ids);
  return written;
}
