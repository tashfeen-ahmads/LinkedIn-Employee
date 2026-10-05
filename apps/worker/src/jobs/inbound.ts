import {
  applyRules,
  classifyReply,
  containsOptOut,
  draftReply,
  DRAFT_PROMPT_VERSION,
  type ConversationTurn,
} from "@le/agents";
import {
  BusinessProfileSchema,
  parseCustomerProfile,
  RulesOfEngagementSchema,
  canTransition,
  draftLinkCheck,
  extractLinks,
  type CampaignProspectStatus,
  type ReplyClassification,
} from "@le/shared";
import type { WorkerContext } from "../context.js";
import { pitchFor } from "../pitch.js";
import { agentForCampaign, voiceOf } from "../agent.js";
import { recordEvent } from "../context.js";
import { flagForHuman } from "../holds.js";
import { enqueueOnce, jobId } from "../queues.js";
import type { InboundMessageJob, Queues } from "../queues.js";
import { ensureConversation } from "./linkedin-action.js";
import { offerSlots, resolveCalendar, type CalendarBinding } from "../calendar.js";
import { syncConversationToCrm, syncMeetingToCrm } from "../crm.js";
import { bookAcceptedSlot } from "./booking.js";
import { readCampaignCta } from "../cta.js";

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
    .select("id, workspace_id, first_name, last_name, do_not_contact")
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

  // Idempotency: webhooks redeliver, and polling overlaps with them — both
  // doors deliver most replies, so this is the common path, not the rare one.
  // Nothing past this point may call a model for a message already stored.
  const { data: existing } = await db
    .from("messages")
    .select("id, classification")
    .eq("workspace_id", job.workspaceId)
    .eq("provider_message_id", job.providerMessageId)
    .maybeSingle();
  if (existing) {
    await repairUnanswered(ctx, job, {
      prospect,
      conversationId: conversation.id,
      messageId: existing.id as string,
      classification: (existing.classification as ReplyClassification | null) ?? null,
    });
    return;
  }

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
  // The other door may have stored this message a moment ago. Whatever it did
  // with it, this run has nothing to add, and answering twice is the one
  // outcome the idempotency check exists to prevent.
  if (!inbound) return;

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
  await syncConversationToCrm(db, ctx.env, {
    workspaceId: job.workspaceId,
    prospectId: prospect.id,
    body: job.text,
    direction: "inbound",
    authoredBy: "human",
    occurredAt: job.receivedAt,
  });

  const campaignProspect = await stopSequence(ctx, prospect.id);
  const campaignId = campaignProspect?.campaign_id ?? null;
  await linkConversationToCampaign(ctx, conversation.id, prospect.id, campaignId);

  /*
   * "Remove me" is recorded before anybody asks a model what it means.
   *
   * The classifier overrides itself on a literal opt-out phrase, but only if it
   * runs: a provider outage, a malformed response or an exhausted key threw
   * before that override was reached, and the message — already stored — was
   * never looked at again. Rule 7 says opt-outs are checked deterministically
   * *as well as* by the model, and as well as means not after it. There is
   * nothing to draft for somebody who asked us to stop, so no model is called.
   */
  if (containsOptOut(job.text)) {
    await recordOptOut(ctx, {
      workspaceId: job.workspaceId,
      prospectId: prospect.id,
      conversationId: conversation.id,
      reason: "opt-out phrase detected",
    });
    return;
  }

  const { data: campaign } = campaignId
    ? await db
        .from("campaigns")
        .select(
          "id, customer_profile_id, rules, reply_mode, owner_user_id, cta_id, cta_kind, cta_url, cta_label",
        )
        .eq("id", campaignId)
        .single()
    : { data: null };

  const rules = RulesOfEngagementSchema.parse({
    ...(campaign?.rules && typeof campaign.rules === "object" ? campaign.rules : {}),
    ...(campaign?.reply_mode ? { mode: campaign.reply_mode } : {}),
  });

  const history = await loadHistory(ctx, conversation.id, inbound.id as string);
  // The agent this conversation belongs to, resolved before anything reads it.
  // A conversation with no campaign, or on a campaign built before agents,
  // resolves to null and behaves exactly as it always did.
  const agent = campaignProspect?.campaign_id
    ? await agentForCampaign(ctx.db, campaignProspect.campaign_id)
    : null;
  const [knowledge, pitch] = await Promise.all([
    loadKnowledge(ctx, job.workspaceId),
    // This prospect's angle decides which pitch they hear, then their
    // campaign's agent, then the workspace default. They accepted because of
    // one pain being named; hearing an offer that argues a different one is
    // the two halves of the funnel measuring different things (rule 28).
    pitchFor(ctx.db, job.workspaceId, campaignProspect?.variant_id ?? null, agent?.id ?? null),
  ]);
  const agents = ctx.agentsFor(job.workspaceId);

  /*
   * A reply the model could not read is a reply a person has to read.
   *
   * The message is already stored, so a retry finds it and stops — which is
   * right, since a retry must never answer twice, and was wrong while nothing
   * had flagged it: the reply was in the database, on no screen, for good. So
   * the flag goes up before the error goes back to the queue, and the queue's
   * retry finds the flag already standing (`repairUnanswered`).
   */
  let classification: ReplyClassification;
  try {
    classification = await classifyReply(agents, {
      message: job.text,
      history,
      knowledgeTitles: knowledge.map((k) => k.title),
    });
  } catch (error) {
    await holdWithoutDraft(ctx, job.workspaceId, conversation.id, inbound.id as string, UNREAD_REASON);
    throw error;
  }

  await db.from("messages").update({ classification: classification as never }).eq("id", inbound.id);

  const decision = applyRules(classification, rules);

  if (decision.action === "stop_sequence") {
    if (classification.optOut) {
      await recordOptOut(ctx, {
        workspaceId: job.workspaceId,
        prospectId: prospect.id,
        conversationId: conversation.id,
        reason: decision.reason ?? "prospect opted out",
      });
      return;
    }
    if (campaignProspect) {
      await db
        .from("campaign_prospects")
        .update({
          status: "negative",
          status_reason: decision.reason ?? null,
          closed_at: new Date().toISOString(),
          next_action_at: null,
        })
        .eq("id", campaignProspect.id);
    }
    await recordEvent(db, {
      workspaceId: job.workspaceId,
      name: "reply.sequence_stopped",
      subjectType: "conversation",
      subjectId: conversation.id,
      payload: { reason: decision.reason ?? null },
    });
    return;
  }

  let bookedMeeting = false;
  // Set when the prospect accepted a time we could not book. The reply below
  // is written without knowing that, so it waits for the person who now has
  // to sort the meeting out.
  let bookingHeld: string | null = null;
  const business = await loadBusinessProfile(ctx, job.workspaceId);
  if (!business) {
    await holdWithoutDraft(ctx, job.workspaceId, conversation.id, inbound.id as string, "no business profile configured");
    return;
  }

  const customerProfile = campaign?.customer_profile_id
    ? await loadCustomerProfile(ctx, campaign.customer_profile_id)
    : undefined;

  const { data: rep } = await db
    .from("profiles")
    .select("full_name, bio, timezone, booking_url")
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
  //
  // The rep's own availability decides the hours and the length when they
  // have set it. The campaign's hours used to win unconditionally, and since
  // the parser answered nine-to-five when the campaign said nothing, the
  // settings page changed nothing about a single offered time.
  const workingHours = calendar ? meetingHours(calendar, campaign?.rules) : undefined;
  const durationMinutes = calendar?.repSettings
    ? calendar.rules.meetingMinutes
    : ctx.env.MEETING_DURATION_MINUTES;
  if (calendar) {
    const offered = await lastOfferedSlots(ctx, conversation.id);
    const outcome = await bookAcceptedSlot(ctx, {
      workspaceId: job.workspaceId,
      conversationId: conversation.id,
      prospectId: prospect.id,
      repUserId: account.user_id,
      offeredSlots: offered,
      message: job.text,
      binding: calendar,
      durationMinutes,
      workingHours,
    });
    if (outcome.status === "booked") {
      bookedMeeting = true;
      await syncMeetingToCrm(db, ctx.env, { workspaceId: job.workspaceId, meetingId: outcome.meetingId });
    } else if (outcome.status === "held") {
      bookingHeld = outcome.reason;
    }
  }

  const slots = calendar && !bookedMeeting
    ? await offerSlots(calendar, { workingHours, durationMinutes })
    : { iso: [], readable: [] };

  // What this campaign is asking for decides which link, if any, belongs in the
  // reply. A campaign wanting sign-ups should not have its agent proposing
  // times, and a campaign wanting a conversation should carry no link at all.
  // Read through the campaign's CTA pointer when it has one, so the agent
  // offers the destination the library currently holds rather than whatever
  // was copied onto the campaign when it was built.
  const cta = campaign
    ? await readCampaignCta(ctx.db, campaign, job.workspaceId)
    : { kind: "meeting" as const, label: null, url: null, fromLibrary: false };
  const goal = cta.kind;
  const bookingUrl = rep?.booking_url?.trim() || null;
  const ctaUrl = cta.url?.trim() || null;

  const offeredLink =
    goal === "link" ? ctaUrl : goal === "meeting" ? bookingUrl : null;

  // Anything already in the knowledge the agent was handed is fair to quote:
  // it is the customer's own documentation, and a reply that cannot cite the
  // page it is answering from is less useful and no safer.
  const allowedLinks = [
    offeredLink,
    ...knowledge.flatMap((doc) => extractLinks(doc.content ?? "")),
    // The pitch is copy a person approved, so an address inside it is an
    // address they approved. Left out, a pitch that names the company's own
    // site would hold every draft that repeated it — the agent punished for
    // quoting the text it was told to use.
    ...extractLinks(pitch ?? ""),
  ].filter((link): link is string => Boolean(link));

  let draft;
  try {
    draft = await draftReply(agents, {
      business,
      profile: customerProfile,
      repName: rep?.full_name ?? "the sender",
      repBio: rep?.bio ?? undefined,
      knowledge,
      history,
      message: job.text,
      classification,
      // Lead with the pitch when they have just said yes. The writer decides
      // the words; this decides that the link is in them.
      intent: classification.intent,
      // What to offer, rather than leaving the agent to argue for the product
      // from the business profile and reach a different conclusion in every
      // conversation.
      pitch: pitch ?? undefined,
      rules: {
        ...rules,
        // The one link it may send, decided by what the campaign is asking
        // for. Absent means it may send none.
        ...(offeredLink ? { bookingLink: offeredLink } : { bookingLink: undefined }),
      },
      // How this campaign's agent has been told to write, and what it wants to
      // learn. Without these the agent screen changes nothing about a reply,
      // which is the fastest way to teach a rep that the screen is decorative.
      voice: voiceOf(agent),
      qualification: agent?.playbook.qualification,
      goal,
      // The only datetimes the agent may name. An empty list means it offers
      // to send times rather than inventing any.
      //
      // A campaign not asking for a meeting offers none at all: proposing
      // times to somebody who was asked to look at a page is the agent
      // pursuing a goal nobody set.
      availableSlots: goal === "meeting" ? slots.readable : [],
      bookedMeeting,
    });
  } catch (error) {
    // The prospect replied and we could not write an answer. Retrying is the
    // queue's job; making sure a person sees the conversation either way is
    // ours, because the alternative is a warm reply nobody ever reads.
    await holdWithoutDraft(ctx, job.workspaceId, conversation.id, inbound.id as string, UNDRAFTED_REASON);
    throw error;
  }

  // The links this agent was actually given, and the only ones it may send.
  //
  // Rule 6's sibling: the model may not invent a datetime and it may not invent
  // a URL, for the same reason. `acme.com/demo` is exactly what a model writes
  // when a reply wants a link and none was supplied — plausible, specific, a
  // 404, and it reaches a real person under a real rep's name.
  //
  // Held rather than stripped. Removing the URL leaves "you can book a time
  // here:" pointing at nothing, which reads worse than the invented link did,
  // and a hallucinated link is evidence the draft as a whole drifted.
  const linkCheck = draftLinkCheck(draft.message, allowedLinks);
  const gate: { action: "send" | "hold_for_human"; reason?: string } = !linkCheck.ok
    ? { action: "hold_for_human", reason: linkCheck.reason }
    : bookingHeld
      ? { action: "hold_for_human", reason: bookingHeld }
      : decision.action === "send"
        ? { action: "send" }
        : { action: "hold_for_human", reason: decision.reason };
  if (!linkCheck.ok) {
    console.error("held a draft carrying a link nobody gave the agent", {
      conversationId: conversation.id,
      links: linkCheck.links,
    });
  }

  const { data: saved } = await db
    .from("reply_drafts")
    .insert({
      workspace_id: job.workspaceId,
      conversation_id: conversation.id,
      in_reply_to: inbound.id,
      body: draft.message,
      proposes_meeting: draft.proposesMeeting,
      // The ISO slots we actually offered, not the model's rendering of them.
      // The booking step matches a prospect's acceptance against this list, so
      // it has to be authoritative.
      proposed_slots: (draft.proposesMeeting ? slots.iso : []) as never,
      unanswered_questions: draft.unansweredQuestions as never,
      prompt_version: DRAFT_PROMPT_VERSION,
      status: gate.action === "send" ? "approved" : "pending",
      // Stamped when the gate approved it, so the maintenance sweep can find an
      // approved draft whose job never sent it. A null here was invisible to
      // that sweep, which only ever looked at drafts a person had approved.
      resolved_at: gate.action === "send" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  await recordEvent(db, {
    workspaceId: job.workspaceId,
    name: gate.action === "send" ? "reply.drafted" : "reply.needs_human",
    subjectType: "conversation",
    subjectId: conversation.id,
    payload: { reason: gate.reason ?? null, proposesMeeting: draft.proposesMeeting },
  });

  /*
   * Interest is written down, not only acted on.
   *
   * `positive` has been in `campaign_prospect_status` since the first
   * migration and nothing ever set it, so a prospect who replied "yes, send it
   * over" sat at `replied` next to somebody who answered "who is this?". The
   * funnel counted them identically and no screen could tell the two apart —
   * which is the one distinction anybody running a campaign actually wants.
   *
   * Set after the draft is written, so it records what the agent acted on
   * rather than what it intended to.
   */
  if (classification.intent === "interested" && campaignProspect) {
    await db
      .from("campaign_prospects")
      .update({ status: "positive", status_reason: "replied with interest" })
      .eq("id", campaignProspect.id)
      // Never walks a conversation backwards: somebody already booked stays
      // booked, and an opt-out is never reopened by a later warm sentence.
      .in("status", ["invited", "accepted", "messaged_1", "messaged_2", "messaged_3", "replied"]);
  }

  /*
   * Everything below reads the final gate, never the classifier's decision.
   *
   * The draft above is saved from `gate`, and a link check or a failed booking
   * can turn a `send` into a hold after the classifier has spoken. Reading
   * `decision` here saved a held draft as `pending`, raised no flag, and queued
   * a reply job that found the draft unapproved and did nothing — finishing
   * under `reply:<draftId>`, so the rep's own Send a minute later was taken for
   * a duplicate and also did nothing. A held reply nobody was told about,
   * whose Send button was dead.
   */
  if (gate.action === "hold_for_human") {
    await flagForHuman(db, conversation.id, gate.reason ?? "held for review");
    return;
  }

  if (saved) {
    // `enqueueOnce`, not `add`: a finished job must never hold this id
    // (rule 44), or the rep's Send and the maintenance sweep are both refused
    // as duplicates of work that is already over.
    await enqueueOnce(
      queues.linkedinAction,
      "reply",
      { kind: "reply", workspaceId: job.workspaceId, conversationId: conversation.id, draftId: saved.id as string },
      { jobId: jobId("reply", saved.id as string) },
    );
  }
}

/** What a person sees when the model could not write the answer. */
const UNDRAFTED_REASON = "could not draft a reply, answer this one yourself";

/** What a person sees when the model could not read a reply. */
const UNREAD_REASON = "The agent could not read this reply, so nothing was sent. Read it and answer it yourself.";

/** The event that marks a held reply with no draft behind it. */
const HELD_WITHOUT_DRAFT = "reply.held_without_draft";

/**
 * A hold with no draft, recorded against the message it is about.
 *
 * The event is what lets a retry tell "a person was already told about this
 * message" from "the run died before anybody was". Without it the repair below
 * could not tell them apart, and would either stay silent after a crash or
 * re-raise a hold the rep had already dismissed.
 */
async function holdWithoutDraft(
  ctx: WorkerContext,
  workspaceId: string,
  conversationId: string,
  messageId: string,
  reason: string,
): Promise<void> {
  await flagForHuman(ctx.db, conversationId, reason, "reply");
  await recordEvent(ctx.db, {
    workspaceId,
    name: HELD_WITHOUT_DRAFT,
    subjectType: "message",
    subjectId: messageId,
    payload: { reason, conversationId },
  });
}

/**
 * A message already stored, delivered again. Never calls a model.
 *
 * Most deliveries are this: the webhook and the poll both carry nearly every
 * reply, so the second is a no-op — one query for the draft that answered it.
 * But a stored message is not always a handled one. The run that stored it can
 * have died before it classified, flagged or drafted anything (a model outage,
 * a deploy mid-job), and the old `if (existing) return` made that permanent: a
 * prospect's reply in the database and on no screen (rule 10).
 *
 * So the repair finishes the deterministic part. An opt-out is recorded if it
 * was not. A reply with no draft and no hold on record is put in front of a
 * person. It does not draft: a second attempt at the model belongs to a person
 * now, and an answer written twice is worse than one written by hand.
 */
async function repairUnanswered(
  ctx: WorkerContext,
  job: InboundMessageJob,
  input: {
    prospect: { id: string; do_not_contact?: boolean | null };
    conversationId: string;
    messageId: string;
    classification: ReplyClassification | null;
  },
): Promise<void> {
  const { db } = ctx;

  if (containsOptOut(job.text) || input.classification?.optOut) {
    if (!input.prospect.do_not_contact) {
      await recordOptOut(ctx, {
        workspaceId: job.workspaceId,
        prospectId: input.prospect.id,
        conversationId: input.conversationId,
        reason: "opt-out phrase detected",
      });
    }
    return;
  }

  const { data: draft } = await db
    .from("reply_drafts")
    .select("id")
    .eq("conversation_id", input.conversationId)
    .eq("in_reply_to", input.messageId)
    .limit(1)
    .maybeSingle();
  if (draft) return;

  // "Not interested" ends the sequence without a draft, which is the answer.
  if (input.classification?.intent === "not_interested") return;

  const { data: held } = await db
    .from("events")
    .select("id")
    .eq("name", HELD_WITHOUT_DRAFT)
    .eq("subject_id", input.messageId)
    .limit(1)
    .maybeSingle();
  if (held) return;

  await holdWithoutDraft(
    ctx,
    job.workspaceId,
    input.conversationId,
    input.messageId,
    input.classification
      ? "This reply was read but never answered. Answer it yourself."
      : UNREAD_REASON,
  );
}

/**
 * Records an opt-out. Only ever sets the flag, never clears it: a prospect who
 * opted out last month and later sends a neutral "not interested" must not be
 * quietly returned to the contactable pool (rule 7).
 *
 * Every open row on every campaign, not only the latest: a person on two lists
 * who says "remove me" has said it to both.
 */
async function recordOptOut(
  ctx: WorkerContext,
  input: { workspaceId: string; prospectId: string; conversationId: string; reason: string },
): Promise<void> {
  const { db } = ctx;
  await db
    .from("prospects")
    .update({ do_not_contact: true, do_not_contact_reason: "opted out on LinkedIn" })
    .eq("id", input.prospectId);
  await db
    .from("campaign_prospects")
    .update({
      status: "opted_out",
      status_reason: input.reason,
      closed_at: new Date().toISOString(),
      next_action_at: null,
    })
    .eq("prospect_id", input.prospectId)
    .not("status", "in", "(closed,opted_out,failed)");
  await recordEvent(db, {
    workspaceId: input.workspaceId,
    name: "prospect.opted_out",
    subjectType: "conversation",
    subjectId: input.conversationId,
    payload: { reason: input.reason },
  });
}

/**
 * Gives a conversation the campaign its prospect is on, when it has none.
 *
 * A conversation opened by an inbound reply — somebody answering the
 * invitation note before any follow-up went out — was created with no
 * campaign and kept none for ever, so every count read by campaign (the
 * digest, the campaign's own page) left out exactly the replies a campaign
 * exists to produce. Only ever fills a gap: a conversation already tied to a
 * campaign keeps it.
 */
async function linkConversationToCampaign(
  ctx: WorkerContext,
  conversationId: string,
  prospectId: string,
  campaignId: string | null,
): Promise<void> {
  let id = campaignId;
  if (!id) {
    // Stopped, opted out or closed rows still say which campaign found them.
    const { data: latest } = await ctx.db
      .from("campaign_prospects")
      .select("campaign_id")
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    id = (latest?.campaign_id as string | undefined) ?? null;
  }
  if (!id) return;
  await ctx.db.from("conversations").update({ campaign_id: id }).eq("id", conversationId).is("campaign_id", null);
}

/** A reply ends the automated sequence; the conversation takes over. */
async function stopSequence(
  ctx: WorkerContext,
  prospectId: string,
): Promise<{ id: string; campaign_id: string; variant_id: string | null } | null> {
  const { data: cp } = await ctx.db
    .from("campaign_prospects")
    // `variant_id` is which angle this person was written for. It decides
    // which pitch they hear, so the offer sounds like whoever sent the
    // invitation they accepted.
    .select("id, campaign_id, status, variant_id")
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
  return { id: cp.id, campaign_id: cp.campaign_id, variant_id: cp.variant_id ?? null };
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
  const parsed = parseCustomerProfile(data.spec);
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

/**
 * The hours slots are offered within: the rep's own when they have set them,
 * then the campaign's when it explicitly carries some, then the calendar's
 * defaults. Never a fallback that outranks a real setting.
 */
function meetingHours(
  calendar: CalendarBinding,
  rules: unknown,
): { start: number; end: number; days: number[] } {
  if (calendar.repSettings) return calendar.rules.workingHours;
  return campaignWorkingHours(rules) ?? calendar.rules.workingHours;
}

function campaignWorkingHours(rules: unknown): { start: number; end: number; days: number[] } | null {
  if (!rules || typeof rules !== "object") return null;
  const hours = (rules as { workingHours?: unknown }).workingHours;
  if (!hours || typeof hours !== "object") return null;
  const h = hours as Partial<{ start: number; end: number; days: number[] }>;
  if (typeof h.start === "number" && typeof h.end === "number" && Array.isArray(h.days)) {
    return { start: h.start, end: h.end, days: h.days };
  }
  return null;
}
