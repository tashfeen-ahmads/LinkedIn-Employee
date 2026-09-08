import {
  applyRules,
  classifyReply,
  draftReply,
  DRAFT_PROMPT_VERSION,
  type ConversationTurn,
} from "@le/agents";
import {
  BusinessProfileSchema,
  CustomerProfileSchema,
  RulesOfEngagementSchema,
  canTransition,
  type CampaignProspectStatus,
} from "@le/shared";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import type { InboundMessageJob, Queues } from "../queues.js";
import { ensureConversation } from "./linkedin-action.js";
import { offerSlots, resolveCalendar } from "../calendar.js";
import { tryBookMeeting } from "./booking.js";

/**
 * Agent 3 end to end: a prospect replies, we classify it, decide whether a
 * machine may answer, draft the reply, and either send it or park it in the
 * inbox for a human. The sequence stops the moment a reply arrives, whatever
 * it says: nobody should receive follow-up 2 after they already answered.
 */
export async function handleInboundMessage(
  ctx: WorkerContext,
  queues: Queues,
  job: InboundMessageJob,
): Promise<void> {
  const { db } = ctx;

  const { data: account } = await db
    .from("linkedin_accounts")
    .select("id, workspace_id, user_id, provider_account_id")
    .eq("id", job.linkedinAccountId)
    .single();
  if (!account) return;

  const { data: prospect } = await db
    .from("prospects")
    .select("id, workspace_id, first_name, last_name")
    .eq("workspace_id", job.workspaceId)
    .eq("provider_id", job.fromProviderId)
    .maybeSingle();
  // A message from someone we never contacted is not ours to answer.
  if (!prospect) return;

  const conversation = await ensureConversation(ctx, {
    workspaceId: job.workspaceId,
    prospectId: prospect.id,
    linkedinAccountId: account.id,
    providerChatId: job.providerChatId,
  });

  // Idempotency: webhooks redeliver, and polling overlaps with them.
  const { data: existing } = await db
    .from("messages")
    .select("id")
    .eq("workspace_id", job.workspaceId)
    .eq("provider_message_id", job.providerMessageId)
    .maybeSingle();
  if (existing) return;

  const { data: inbound } = await db
    .from("messages")
    .insert({
      workspace_id: job.workspaceId,
      conversation_id: conversation.id,
      direction: "inbound",
      source: "human",
      body: job.text,
      provider_message_id: job.providerMessageId,
      sent_at: job.receivedAt,
    })
    .select("id")
    .single();

  await db
    .from("conversations")
    .update({ last_message_at: job.receivedAt })
    .eq("id", conversation.id);
  await recordEvent(db, {
    workspaceId: job.workspaceId,
    name: "message.received",
    subjectType: "conversation",
    subjectId: conversation.id,
  });

  const campaignProspect = await stopSequence(ctx, conversation.id, prospect.id);
  const campaignId = campaignProspect?.campaign_id ?? null;

  const { data: campaign } = campaignId
    ? await db
        .from("campaigns")
        .select("id, customer_profile_id, rules, reply_mode, owner_user_id")
        .eq("id", campaignId)
        .single()
    : { data: null };

  const rules = RulesOfEngagementSchema.parse({
    ...(campaign?.rules && typeof campaign.rules === "object" ? campaign.rules : {}),
    ...(campaign?.reply_mode ? { mode: campaign.reply_mode } : {}),
  });

  const history = await loadHistory(ctx, conversation.id, inbound?.id);
  const knowledge = await loadKnowledge(ctx, job.workspaceId);
  const agents = ctx.agentsFor(job.workspaceId);

  const classification = await classifyReply(agents, {
    message: job.text,
    history,
    knowledgeTitles: knowledge.map((k) => k.title),
  });

  if (inbound) {
    await db.from("messages").update({ classification: classification as never }).eq("id", inbound.id);
  }

  const decision = applyRules(classification, rules);

  if (decision.action === "stop_sequence") {
    await db
      .from("prospects")
      .update({
        do_not_contact: classification.optOut,
        do_not_contact_reason: classification.optOut ? "opted out on LinkedIn" : null,
      })
      .eq("id", prospect.id);
    if (campaignProspect) {
      await db
        .from("campaign_prospects")
        .update({
          status: classification.optOut ? "opted_out" : "negative",
          status_reason: decision.reason ?? null,
          closed_at: new Date().toISOString(),
          next_action_at: null,
        })
        .eq("id", campaignProspect.id);
    }
    await recordEvent(db, {
      workspaceId: job.workspaceId,
      name: classification.optOut ? "prospect.opted_out" : "reply.needs_human",
      subjectType: "conversation",
      subjectId: conversation.id,
      payload: { reason: decision.reason ?? null },
    });
    return;
  }

  let bookedMeeting = false;
  const business = await loadBusinessProfile(ctx, job.workspaceId);
  if (!business) {
    await flagForHuman(ctx, conversation.id, job.workspaceId, "no business profile configured");
    return;
  }

  const customerProfile = campaign?.customer_profile_id
    ? await loadCustomerProfile(ctx, campaign.customer_profile_id)
    : undefined;

  const { data: rep } = await db
    .from("profiles")
    .select("full_name, bio, timezone")
    .eq("id", account.user_id)
    .single();

  const timezone = rep?.timezone ?? "UTC";
  const calendar = await resolveCalendar(db, ctx.env, {
    workspaceId: job.workspaceId,
    userId: account.user_id,
    timezone,
  });

  // If this reply accepts a time we previously offered, book it before drafting
  // anything: the confirmation message should say the meeting is in the diary,
  // not offer the same slots again.
  if (calendar) {
    const offered = await lastOfferedSlots(ctx, conversation.id);
    const meetingId = await tryBookMeeting(ctx, {
      workspaceId: job.workspaceId,
      conversationId: conversation.id,
      prospectId: prospect.id,
      repUserId: account.user_id,
      offeredSlots: offered,
      message: job.text,
      binding: calendar,
      durationMinutes: ctx.env.MEETING_DURATION_MINUTES,
    });
    if (meetingId) bookedMeeting = true;
  }

  const slots = calendar && !bookedMeeting
    ? await offerSlots(calendar, {
        workingHours: parseWorkingHours(campaign?.rules),
        durationMinutes: ctx.env.MEETING_DURATION_MINUTES,
      })
    : { iso: [], readable: [] };

  const draft = await draftReply(agents, {
    business,
    profile: customerProfile,
    repName: rep?.full_name ?? "the sender",
    repBio: rep?.bio ?? undefined,
    knowledge,
    history,
    message: job.text,
    classification,
    rules,
    // The only datetimes the agent may name. An empty list means it offers to
    // send times rather than inventing any.
    availableSlots: slots.readable,
    bookedMeeting,
  });

  const { data: saved } = await db
    .from("reply_drafts")
    .insert({
      workspace_id: job.workspaceId,
      conversation_id: conversation.id,
      in_reply_to: inbound?.id ?? null,
      body: draft.message,
      proposes_meeting: draft.proposesMeeting,
      // The ISO slots we actually offered, not the model's rendering of them.
      // The booking step matches a prospect's acceptance against this list, so
      // it has to be authoritative.
      proposed_slots: (draft.proposesMeeting ? slots.iso : []) as never,
      unanswered_questions: draft.unansweredQuestions as never,
      prompt_version: DRAFT_PROMPT_VERSION,
      status: decision.action === "send" ? "approved" : "pending",
    })
    .select("id")
    .single();

  await recordEvent(db, {
    workspaceId: job.workspaceId,
    name: decision.action === "send" ? "reply.drafted" : "reply.needs_human",
    subjectType: "conversation",
    subjectId: conversation.id,
    payload: { reason: decision.reason ?? null, proposesMeeting: draft.proposesMeeting },
  });

  if (decision.action === "hold_for_human") {
    await flagForHuman(ctx, conversation.id, job.workspaceId, decision.reason ?? "held for review");
    return;
  }

  if (saved) {
    await queues.linkedinAction.add(
      "reply",
      { kind: "reply", workspaceId: job.workspaceId, conversationId: conversation.id, draftId: saved.id },
      { jobId: `reply:${saved.id}` },
    );
  }
}

async function flagForHuman(ctx: WorkerContext, conversationId: string, workspaceId: string, reason: string) {
  await ctx.db
    .from("conversations")
    .update({ needs_human: true, needs_human_reason: reason })
    .eq("id", conversationId);
}

/** A reply ends the automated sequence; the conversation takes over. */
async function stopSequence(
  ctx: WorkerContext,
  conversationId: string,
  prospectId: string,
): Promise<{ id: string; campaign_id: string } | null> {
  const { data: cp } = await ctx.db
    .from("campaign_prospects")
    .select("id, campaign_id, status")
    .eq("prospect_id", prospectId)
    .not("status", "in", "(closed,opted_out,failed)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!cp) return null;

  if (canTransition(cp.status as CampaignProspectStatus, "replied")) {
    await ctx.db
      .from("campaign_prospects")
      .update({ status: "replied", replied_at: new Date().toISOString(), next_action_at: null })
      .eq("id", cp.id);
  } else {
    await ctx.db.from("campaign_prospects").update({ next_action_at: null }).eq("id", cp.id);
  }
  void conversationId;
  return { id: cp.id, campaign_id: cp.campaign_id };
}

async function loadHistory(
  ctx: WorkerContext,
  conversationId: string,
  excludeMessageId?: string,
): Promise<ConversationTurn[]> {
  const { data } = await ctx.db
    .from("messages")
    .select("id, direction, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(40);
  return (data ?? [])
    .filter((m) => m.id !== excludeMessageId)
    .map((m) => ({
      role: m.direction === "outbound" ? ("rep" as const) : ("prospect" as const),
      text: m.body,
      at: m.created_at,
    }));
}

async function loadKnowledge(ctx: WorkerContext, workspaceId: string) {
  const { data } = await ctx.db
    .from("knowledge_documents")
    .select("title, content")
    .eq("workspace_id", workspaceId)
    .limit(20);
  return data ?? [];
}

async function loadBusinessProfile(ctx: WorkerContext, workspaceId: string) {
  const { data } = await ctx.db
    .from("business_profiles")
    .select("spec")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const parsed = BusinessProfileSchema.safeParse(data.spec);
  return parsed.success ? parsed.data : null;
}

async function loadCustomerProfile(ctx: WorkerContext, id: string) {
  const { data } = await ctx.db.from("customer_profiles").select("spec").eq("id", id).maybeSingle();
  if (!data) return undefined;
  const parsed = CustomerProfileSchema.safeParse(data.spec);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The ISO slots named in the last outbound message. Stored on the draft that
 * produced it, so the booking step matches against what we actually offered
 * rather than re-deriving availability.
 */
async function lastOfferedSlots(ctx: WorkerContext, conversationId: string): Promise<string[]> {
  const { data } = await ctx.db
    .from("reply_drafts")
    .select("proposed_slots, created_at")
    .eq("conversation_id", conversationId)
    .eq("proposes_meeting", true)
    .in("status", ["sent", "approved"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Array.isArray(data?.proposed_slots) ? (data.proposed_slots as string[]) : [];
}

function parseWorkingHours(rules: unknown): { start: number; end: number; days: number[] } {
  const fallback = { start: 9, end: 17, days: [1, 2, 3, 4, 5] };
  if (!rules || typeof rules !== "object") return fallback;
  const hours = (rules as { workingHours?: unknown }).workingHours;
  if (!hours || typeof hours !== "object") return fallback;
  const h = hours as Partial<{ start: number; end: number; days: number[] }>;
  if (typeof h.start === "number" && typeof h.end === "number" && Array.isArray(h.days)) {
    return { start: h.start, end: h.end, days: h.days };
  }
  return fallback;
}
