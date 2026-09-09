import { checkAction } from "@le/linkedin";
import { canTransition, exclusionReason, matchExclusion, type CampaignProspectStatus } from "@le/shared";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { applyHealth, recordAction, toUsage, type AccountRecord, ACCOUNT_USAGE_COLUMNS } from "../accounts.js";
import { syncConversationToCrm } from "../crm.js";
import { loadExclusions } from "../exclusions.js";
import type { LinkedInActionJob } from "../queues.js";

/**
 * Performs one LinkedIn action. Everything that touches a real account funnels
 * through here so the limiter, the health check and the audit log cannot be
 * bypassed by adding a new caller.
 */
export async function runLinkedInAction(ctx: WorkerContext, job: LinkedInActionJob): Promise<void> {
  if (job.kind === "reply") return sendApprovedReply(ctx, job);

  const { db } = ctx;
  const { data: cp } = await db
    .from("campaign_prospects")
    .select("id, workspace_id, campaign_id, prospect_id, status, last_step_sent, invitation_id")
    .eq("id", job.campaignProspectId)
    .single();
  if (!cp) return;

  const { data: campaign } = await db
    .from("campaigns")
    .select("id, status, connection_note, linkedin_account_id, owner_user_id")
    .eq("id", cp.campaign_id)
    .single();
  if (!campaign || campaign.status !== "running") return;

  const { data: prospect } = await db
    .from("prospects")
    .select("id, provider_id, linkedin_url, first_name, company, do_not_contact")
    .eq("id", cp.prospect_id)
    .single();
  if (!prospect) return;

  // A prospect can be banned between scheduling and sending.
  if (prospect.do_not_contact) {
    await closeProspect(ctx, cp.id, "prospect marked do not contact");
    return;
  }

  // And their account can land on the shared exclusion list in the same window
  // — a colleague closes the deal, or the customer signs. Checked here, at the
  // last possible moment, for the same reason the limiter is: a campaign
  // launched this morning already has invitations queued against every name on
  // it, and filtering at targeting time would not touch a single one.
  const excluded = matchExclusion(await loadExclusions(db, cp.workspace_id), {
    company: prospect.company,
    linkedinUrl: prospect.linkedin_url,
  });
  if (excluded) {
    await closeProspect(ctx, cp.id, exclusionReason(excluded));
    return;
  }

  const { data: accountRow } = await db
    .from("linkedin_accounts")
    .select(ACCOUNT_USAGE_COLUMNS)
    .eq("id", campaign.linkedin_account_id)
    .single();
  if (!accountRow || accountRow.status !== "active" || !accountRow.provider_account_id) return;

  const { data: profile } = await db.from("profiles").select("timezone").eq("id", accountRow.user_id).single();
  const usage = toUsage(accountRow as AccountRecord, profile?.timezone ?? "UTC");

  // Second limiter check, immediately before the call. The first was minutes
  // ago at scheduling time and the account may have been used since.
  const kind = job.kind === "invite" ? "invite" : "message";
  const decision = checkAction(kind, usage, new Date());
  if (!decision.allowed) {
    throw new RescheduleError(decision.reason, decision.retryAfterMs);
  }

  if (job.kind === "invite") {
    if (!canTransition(cp.status as CampaignProspectStatus, "invited")) return;
    if (!prospect.provider_id) {
      await failProspect(ctx, cp.id, "no provider id for prospect");
      return;
    }
    const result = await ctx.linkedin.sendInvitation({
      accountId: accountRow.provider_account_id,
      providerId: prospect.provider_id,
      note: renderTemplate(campaign.connection_note, prospect.first_name),
    });
    if (result.health) await applyHealth(db, accountRow, result.health, { email: ctx.email, appUrl: ctx.env.APP_URL });
    if (!result.ok) {
      await failProspect(ctx, cp.id, result.error ?? "invitation failed");
      return;
    }
    await recordAction(db, accountRow.id, "invite");
    await db
      .from("campaign_prospects")
      .update({
        status: "invited",
        invited_at: new Date().toISOString(),
        invitation_id: result.providerId ?? null,
        next_action_at: null,
      })
      .eq("id", cp.id);
    await db.from("prospects").update({ last_contacted_at: new Date().toISOString() }).eq("id", prospect.id);
    await recordEvent(db, {
      workspaceId: cp.workspace_id,
      name: "invite.sent",
      subjectType: "campaign_prospect",
      subjectId: cp.id,
    });
    return;
  }

  // follow_up
  const target = `messaged_${job.stepNumber}` as CampaignProspectStatus;
  if (!canTransition(cp.status as CampaignProspectStatus, target)) return;

  const { data: step } = await db
    .from("campaign_steps")
    .select("message, delay_days")
    .eq("campaign_id", cp.campaign_id)
    .eq("step_number", job.stepNumber)
    .single();
  if (!step) return;

  const conversation = await ensureConversation(ctx, {
    workspaceId: cp.workspace_id,
    prospectId: prospect.id,
    linkedinAccountId: accountRow.id,
    campaignId: cp.campaign_id,
  });

  const body = renderTemplate(step.message, prospect.first_name);
  const result = await ctx.linkedin.sendMessage({
    accountId: accountRow.provider_account_id,
    chatId: conversation.provider_chat_id ?? undefined,
    providerId: prospect.provider_id ?? undefined,
    text: body,
  });
  if (result.health) await applyHealth(db, accountRow, result.health, { email: ctx.email, appUrl: ctx.env.APP_URL });
  if (!result.ok) {
    await failProspect(ctx, cp.id, result.error ?? "message failed");
    return;
  }

  await recordAction(db, accountRow.id, "message");
  await db.from("messages").insert({
    workspace_id: cp.workspace_id,
    conversation_id: conversation.id,
    direction: "outbound",
    source: "agent",
    body,
    provider_message_id: result.providerId ?? null,
    sent_at: new Date().toISOString(),
  });

  const { data: nextStep } = await db
    .from("campaign_steps")
    .select("delay_days")
    .eq("campaign_id", cp.campaign_id)
    .eq("step_number", job.stepNumber + 1)
    .maybeSingle();

  await db
    .from("campaign_prospects")
    .update({
      status: target,
      last_step_sent: job.stepNumber,
      next_action_at: nextStep ? addDays(new Date(), nextStep.delay_days).toISOString() : null,
    })
    .eq("id", cp.id);
  await db.from("prospects").update({ last_contacted_at: new Date().toISOString() }).eq("id", prospect.id);
  await recordEvent(db, {
    workspaceId: cp.workspace_id,
    name: "message.sent",
    subjectType: "campaign_prospect",
    subjectId: cp.id,
    payload: { step: job.stepNumber },
  });
  await syncConversationToCrm(db, ctx.env, {
    workspaceId: cp.workspace_id,
    prospectId: prospect.id,
    body,
    direction: "outbound",
    authoredBy: "agent",
    occurredAt: new Date().toISOString(),
  });
}

/** Sends a draft a human approved in the inbox. */
async function sendApprovedReply(
  ctx: WorkerContext,
  job: Extract<LinkedInActionJob, { kind: "reply" }>,
): Promise<void> {
  const { db } = ctx;
  const { data: draft } = await db
    .from("reply_drafts")
    .select("id, workspace_id, conversation_id, body, prompt_version, status")
    .eq("id", job.draftId)
    .single();
  if (!draft || draft.status !== "approved") return;

  const { data: conversation } = await db
    .from("conversations")
    .select("id, prospect_id, linkedin_account_id, provider_chat_id")
    .eq("id", draft.conversation_id)
    .single();
  if (!conversation) return;

  const { data: account } = await db
    .from("linkedin_accounts")
    .select(ACCOUNT_USAGE_COLUMNS)
    .eq("id", conversation.linkedin_account_id)
    .single();
  if (!account?.provider_account_id || account.status !== "active") return;

  // A human approving a draft does not exempt it from the caps: it is still a
  // message leaving a real LinkedIn account, and the limiter is the only thing
  // between a campaign and a restriction. Rule 1 in CLAUDE.md.
  const { data: replyProfile } = await db
    .from("profiles")
    .select("timezone")
    .eq("id", account.user_id)
    .single();
  const replyDecision = checkAction(
    "message",
    toUsage(account as AccountRecord, replyProfile?.timezone ?? "UTC"),
    new Date(),
  );
  if (!replyDecision.allowed) {
    throw new RescheduleError(replyDecision.reason, replyDecision.retryAfterMs);
  }

  const { data: prospect } = await db
    .from("prospects")
    .select("id, provider_id, do_not_contact")
    .eq("id", conversation.prospect_id)
    .single();
  if (!prospect || prospect.do_not_contact) return;

  const result = await ctx.linkedin.sendMessage({
    accountId: account.provider_account_id,
    chatId: conversation.provider_chat_id ?? undefined,
    providerId: prospect.provider_id ?? undefined,
    text: draft.body,
  });
  if (result.health) await applyHealth(db, account, result.health, { email: ctx.email, appUrl: ctx.env.APP_URL });
  if (!result.ok) return;

  await recordAction(db, account.id, "message");
  await db.from("messages").insert({
    workspace_id: draft.workspace_id,
    conversation_id: conversation.id,
    direction: "outbound",
    source: "agent",
    body: draft.body,
    provider_message_id: result.providerId ?? null,
    prompt_version: draft.prompt_version,
    sent_at: new Date().toISOString(),
  });
  await db.from("reply_drafts").update({ status: "sent", resolved_at: new Date().toISOString() }).eq("id", draft.id);
  await db.from("conversations").update({ needs_human: false, needs_human_reason: null }).eq("id", conversation.id);
  await recordEvent(db, {
    workspaceId: draft.workspace_id,
    name: "reply.sent",
    subjectType: "conversation",
    subjectId: conversation.id,
  });
  await syncConversationToCrm(db, ctx.env, {
    workspaceId: draft.workspace_id,
    prospectId: prospect.id,
    body: draft.body,
    direction: "outbound",
    authoredBy: "agent",
    occurredAt: new Date().toISOString(),
  });
}

export async function ensureConversation(
  ctx: WorkerContext,
  input: { workspaceId: string; prospectId: string; linkedinAccountId: string; campaignId?: string; providerChatId?: string },
): Promise<{ id: string; provider_chat_id: string | null }> {
  const { db } = ctx;
  const { data: existing } = await db
    .from("conversations")
    .select("id, provider_chat_id")
    .eq("workspace_id", input.workspaceId)
    .eq("prospect_id", input.prospectId)
    .eq("linkedin_account_id", input.linkedinAccountId)
    .maybeSingle();
  if (existing) {
    if (input.providerChatId && !existing.provider_chat_id) {
      await db.from("conversations").update({ provider_chat_id: input.providerChatId }).eq("id", existing.id);
      return { ...existing, provider_chat_id: input.providerChatId };
    }
    return existing;
  }

  const { data: created, error } = await db
    .from("conversations")
    .insert({
      workspace_id: input.workspaceId,
      prospect_id: input.prospectId,
      linkedin_account_id: input.linkedinAccountId,
      campaign_id: input.campaignId ?? null,
      provider_chat_id: input.providerChatId ?? null,
    })
    .select("id, provider_chat_id")
    .single();
  if (error || !created) throw new Error(`could not create conversation: ${error?.message}`);
  return created;
}

async function closeProspect(ctx: WorkerContext, campaignProspectId: string, reason: string): Promise<void> {
  await ctx.db
    .from("campaign_prospects")
    .update({ status: "closed", status_reason: reason, closed_at: new Date().toISOString(), next_action_at: null })
    .eq("id", campaignProspectId);
}

async function failProspect(ctx: WorkerContext, campaignProspectId: string, reason: string): Promise<void> {
  await ctx.db
    .from("campaign_prospects")
    .update({ status: "failed", status_reason: reason, next_action_at: null })
    .eq("id", campaignProspectId);
}

/** Only {{first_name}} is supported; anything else stays literal by design. */
export function renderTemplate(template: string, firstName: string | null): string {
  return template.replace(/\{\{\s*first_name\s*\}\}/gi, firstName?.trim() || "there");
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Thrown when the limiter denies an action that was already scheduled. */
export class RescheduleError extends Error {
  constructor(
    readonly reason: string,
    readonly retryAfterMs: number,
  ) {
    super(`rate limited: ${reason}, retry in ${Math.round(retryAfterMs / 1000)}s`);
    this.name = "RescheduleError";
  }
}
