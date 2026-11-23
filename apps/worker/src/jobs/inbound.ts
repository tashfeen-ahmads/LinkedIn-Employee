import {
  applyRules,
  classifyReply,
  containsOptOut,
  draftReply,
  DRAFT_PROMPT_VERSION,
  readConversation,
  type ConversationRead,
  type ConversationTurn,
} from "@le/agents";
import {
  parseCustomerProfile,
  RulesOfEngagementSchema,
  canTransition,
  draftLinkCheck,
  extractLinks,
  effectiveIntent,
  hasOwnBookingLink,
  matchExclusion,
  replyMove,
  type CampaignProspectStatus,
  type ReplyClassification,
} from "@le/shared";
import type { WorkerContext } from "../context.js";
import { pitchFor } from "../pitch.js";
import { agentForCampaign, voiceOf } from "../agent.js";
import { knowledgeFor } from "../knowledge.js";
import { businessFor } from "../brand.js";
import { recordEvent } from "../context.js";
import { flagForHuman } from "../holds.js";
import { enqueueOnce, jobId } from "../queues.js";
import type { InboundMessageJob, Queues } from "../queues.js";
import { ensureConversation, newerInboundExists } from "./linkedin-action.js";
import { offerSlots, resolveCalendar, type CalendarBinding } from "../calendar.js";
import { syncConversationToCrm, syncMeetingToCrm } from "../crm.js";
import { bookAcceptedSlot } from "./booking.js";
import { readCampaignCta } from "../cta.js";
import { rulesForPlan, workspaceFeatures } from "../billing.js";
import { loadExclusions } from "../exclusions.js";
import { sendOnce } from "../email.js";
import { newMessageEmail } from "@le/email";

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
    .select("id, workspace_id, user_id, provider_account_id, connected_at")
    .eq("id", job.linkedinAccountId)
    .single();
  if (!account) return;

  /*
   * Who wrote it: by the sender's LinkedIn id, and failing that by the chat.
   *
   * The id is one field of somebody else's payload, and the chat is one we
   * opened ourselves: a message from the other side of a conversation this
   * product started is a reply from that prospect whatever the sender field
   * says. Matching only the id, a reply whose sender came back in a different
   * form matched nobody and was dropped without a trace, while every screen
   * read "no replies yet".
   */
  const known =
    (await findSender(ctx, job.workspaceId, job.fromProviderId)) ??
    (await findByChat(ctx, job.workspaceId, account.id, job.providerChatId));
  /*
   * Somebody we never wrote to, who wrote to the rep first.
   *
   * They were counted and dropped: a person who found the rep and opened a
   * conversation was never answered, while every screen read "no replies".
   * A new conversation is taken on (`adoptNewConversation`); a thread the rep
   * already had, or one they have written in by hand, is the rep's own and is
   * still only counted. The count only, never the words or who sent them
   * (rule 15).
   */
  const adoption = known ? null : await adoptNewConversation(ctx, job, account);
  const prospect = known ?? (adoption && "prospect" in adoption ? adoption.prospect : null);
  if (!prospect) {
    await recordEvent(db, {
      workspaceId: job.workspaceId,
      name: "inbound.unmatched",
      subjectType: "linkedin_account",
      subjectId: account.id,
      payload: {
        hasSender: Boolean(job.fromProviderId),
        hasChat: Boolean(job.providerChatId),
        why: adoption && "skipped" in adoption ? adoption.skipped : "no sender or chat",
      },
    }).catch(() => undefined);
    return;
  }

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

  const campaignProspect = await stopSequence(ctx, prospect.id, { doNotContact: prospect.do_not_contact });
  /*
   * The campaign this reply is answered under, even when no row is open.
   *
   * A reply to the last message of a sequence arrives after maintenance has
   * closed the row (`sequence completed`). `stopSequence` reopens that one,
   * but when it cannot (a do-not-contact prospect, a row closed for any other
   * reason) the conversation still belongs to a campaign, and answering it as
   * nobody's fell back to the schema's defaults: approval mode, a meeting
   * goal, no agent and no brand, whatever the campaign had been set to.
   */
  const campaignId = await linkConversationToCampaign(
    ctx,
    conversation.id,
    prospect.id,
    campaignProspect?.campaign_id ?? (await conversationCampaign(ctx, conversation.id)),
  );

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

  /*
   * A newer message from them is the one to answer.
   *
   * People write in bursts: "I'm not sure", then "what you mean" eight
   * seconds later. Each message was answered on its own, minutes apart, the
   * second reply contradicting the first, and one prospect was asked the same
   * question three times while he had already moved on. The latest message's
   * own run answers with every earlier one in its history, so an older one
   * stops here.
   */
  if (await newerInboundExists(ctx, conversation.id, job.receivedAt)) {
    await recordEvent(db, {
      workspaceId: job.workspaceId,
      name: "reply.superseded",
      subjectType: "conversation",
      subjectId: conversation.id,
      payload: { reason: "a newer message from the prospect will be answered instead" },
    });
    return;
  }

  /*
   * A conversation already waiting for the rep is not Nora's to carry on.
   *
   * A recruiter asked for the rep's resume, was told it was attached, wrote
   * back that it had not come through, and was told it was being sent again
   * (Freelancer, 22 Nov 2026). Each message was answered on its own as if
   * nothing were waiting. Once a person has to step in, every later message
   * in that conversation waits for them too, until they send a reply or mark
   * it handled. A follow-up held for copy is not about this conversation and
   * does not count.
   */
  const { data: standing } = await db
    .from("conversations")
    .select("needs_human, needs_human_reason, needs_human_kind")
    .eq("id", conversation.id)
    .maybeSingle();
  const standingHold =
    standing?.needs_human === true && standing.needs_human_kind !== "copy"
      ? ((standing.needs_human_reason as string | null) ?? "an earlier message is waiting for you")
      : null;

  const { data: campaign } = campaignId
    ? await db
        .from("campaigns")
        .select(
          "id, customer_profile_id, rules, reply_mode, owner_user_id, cta_id, cta_kind, cta_url, cta_label",
        )
        .eq("id", campaignId)
        .single()
    : { data: null };

  // What the plan includes decides how far the agent may go on its own: on
  // Pro every reply waits for a person and nobody is booked without one.
  const features = await workspaceFeatures(db, job.workspaceId);
  const rules = rulesForPlan(
    RulesOfEngagementSchema.parse({
      ...(campaign?.rules && typeof campaign.rules === "object" ? campaign.rules : {}),
      ...(campaign?.reply_mode ? { mode: campaign.reply_mode } : {}),
      // No campaign: somebody who wrote to the rep first. They are answered
      // the way the workspace said replies are handled, not held for a person
      // by the schema's default while they wait (`workspaceReplyRules`).
      ...(campaign ? {} : await workspaceReplyRules(ctx, job.workspaceId)),
    }),
    features,
  );

  const history = await loadHistory(ctx, conversation.id, inbound.id as string);
  // The agent this conversation belongs to, resolved before anything reads it.
  // A conversation with no campaign, or on a campaign built before agents,
  // resolves to null and behaves exactly as it always did.
  const agent = campaignId ? await agentForCampaign(ctx.db, campaignId) : null;
  const [knowledge, pitch] = await Promise.all([
    // This brand's documents and the shared ones, never another agent's.
    loadKnowledge(ctx, job.workspaceId, agent?.id ?? null),
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
        .eq("id", campaignProspect.id)
        // An outcome already recorded is never overwritten (rules 7 and 24).
        .not("status", "in", "(closed,opted_out,failed)");
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
  // The campaign's agent's brand over the workspace's business, so a reply on
  // brand B's campaign never introduces brand A (`businessFor`).
  const business = await businessFor(ctx.db, job.workspaceId, agent?.id ?? null);
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

  /*
   * A rep with their own scheduling link books on it, never on ours.
   *
   * The calendar this product owns knows only what we put in it (rule 18),
   * and a rep who gave us their Calendly keeps their real diary there
   * (rule 31). Handed both, the agent offered our times beside their link, and
   * an acceptance was booked into a calendar that cannot see the meeting they
   * already have at that hour. So with their own link there are no offered
   * times and nothing is booked here: the link is the way to a meeting.
   */
  const ownBookingLink = hasOwnBookingLink(rep?.booking_url);

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
  if (calendar && !ownBookingLink) {
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
      // Pro confirms a booking by hand; Autopilot books it.
      confirmFirst: !features.autoBooking,
    });
    if (outcome.status === "booked") {
      bookedMeeting = true;
      await syncMeetingToCrm(db, ctx.env, { workspaceId: job.workspaceId, meetingId: outcome.meetingId });
    } else if (outcome.status === "already_booked") {
      // Confirming the meeting they have: the reply confirms it too, and
      // offers no further times.
      bookedMeeting = true;
    } else if (outcome.status === "held") {
      bookingHeld = outcome.reason;
    }
  }

  const slots = calendar && !bookedMeeting && !ownBookingLink
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
  // The campaign's own link joins these only when this reply may send it
  // (`sendableLink`, below).
  const allowedLinks = [
    ...knowledge.flatMap((doc) => extractLinks(doc.content ?? "")),
    // The pitch is copy a person approved, so an address inside it is an
    // address they approved. Left out, a pitch that names the company's own
    // site would hold every draft that repeated it — the agent punished for
    // quoting the text it was told to use.
    ...extractLinks(pitch ?? ""),
  ].filter((link): link is string => Boolean(link));

  /*
   * What this reply may do, decided by what they said (`replyMove`). Somebody
   * who has just said they are not ready gets no pitch, no link and no times,
   * and somebody who already has the link is not sent it a second time. The
   * link and the times are taken away here as well as forbidden in the prompt,
   * so a draft that pitches anyway is held by the link check, not trusted.
   */
  const linkAlreadySent = Boolean(
    offeredLink && history.some((turn) => turn.role === "rep" && turn.text.includes(offeredLink)),
  );
  /*
   * The whole conversation is read before anything is written: what they have
   * told us, the tools they use, and whether the problem the offer solves is
   * theirs at all. A prospect who said Odoo already holds their documents and
   * then answered "Yes" was pitched exactly that problem with a booking link.
   * A read that fails costs the reply nothing it had before.
   */
  let read: ConversationRead | null = null;
  try {
    read = await readConversation(agents, {
      business,
      profile: customerProfile,
      pitch: pitch ?? undefined,
      history,
      message: job.text,
    });
  } catch (error) {
    console.error("could not read the conversation before replying", { conversationId: conversation.id, error });
  }
  const lastRepMessage = [...history].reverse().find((turn) => turn.role === "rep")?.text;
  const facts = {
    // Solved by their own account, and they have not asked for the next step
    // since: no pitch, no link, whatever the classifier made of the words.
    alreadySolved: read?.problemStatus === "already_solved" && read.askedForNextStep !== true,
    painConfirmed: read?.problemStatus === "confirmed",
    askedForNextStep: read?.askedForNextStep === true,
    closing: read?.conversationState === "closing",
    lastRepMessage,
    // Who is approaching whom: only somebody weighing our offer hears it.
    agenda: read?.theirAgenda,
    fromCampaign: Boolean(campaign),
  };
  // The words win over a warm misreading: "when I can convince the owner" is
  // not a yes, whatever the classifier said, and "Yes" answers our question.
  /*
   * A conversation no campaign owns that turns out to be a group is the
   * rep's, whoever started it: an introduction thread is answered by the
   * person being introduced. Unreadable counts as a group, because guessing
   * wrong here is a machine talking in front of several real people.
   */
  let groupChat = false;
  if (!campaign && job.providerChatId && account.provider_account_id) {
    groupChat = await ctx.linkedin
      .countChatOthers({ accountId: account.provider_account_id, chatId: job.providerChatId })
      .then((others) => others !== 1)
      .catch(() => true);
  }
  const intent = effectiveIntent(classification.intent, job.text, facts);
  const move = replyMove(intent, job.text, { linkAlreadySent, ...facts });
  if (!move.reply && !bookedMeeting && !bookingHeld) {
    // An auto-reply or spam: answering it is a message to nobody.
    await recordEvent(db, {
      workspaceId: job.workspaceId,
      name: "reply.not_answered",
      subjectType: "conversation",
      subjectId: conversation.id,
      payload: { intent: classification.intent },
    });
    return;
  }
  const sendableLink = move.link ? offeredLink : null;

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
      intent,
      // What to offer, rather than leaving the agent to argue for the product
      // from the business profile and reach a different conclusion in every
      // conversation.
      pitch: pitch ?? undefined,
      rules: {
        ...rules,
        // The one link it may send, decided by what the campaign is asking
        // for. Absent means it may send none.
        ...(sendableLink ? { bookingLink: sendableLink } : { bookingLink: undefined }),
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
      //
      // A rep with their own scheduling link has none here either: `slots`
      // is empty for them (`ownBookingLink`, above), so the link is offered
      // and never our times beside it.
      availableSlots: goal === "meeting" && move.slots ? slots.readable : [],
      bookedMeeting,
      move,
      read: read ?? undefined,
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
  const linkCheck = draftLinkCheck(draft.message, sendableLink ? [sendableLink, ...allowedLinks] : allowedLinks);

  // The times this message offers, as the prospect will read them (rule 6).
  // Storing every slot handed to the agent meant "the second one" was matched
  // against a list the prospect never saw, and booked a time nobody offered.
  const offer = draft.proposesMeeting
    ? slotsInDraft(draft.message, draft.proposedSlots ?? [], slots)
    : { iso: [], unmapped: [] };
  const slotCheck =
    offer.unmapped.length > 0
      ? {
          ok: false as const,
          reason: `The reply offers a time that is not on your calendar's list (${offer.unmapped.join("; ")}). Check the times before sending.`,
        }
      : { ok: true as const };
  if (!slotCheck.ok) {
    console.error("held a draft offering a time the calendar did not produce", {
      conversationId: conversation.id,
      slots: offer.unmapped,
    });
  }

  // Still reading like a template after its one rewrite: a person finishes it
  // rather than a prospect receiving it (`voiceProblems`).
  const voiceCheck = draft.voiceProblems.length
    ? { ok: false as const, reason: `The reply did not read like a person wrote it: ${draft.voiceProblems.join(" ")}` }
    : { ok: true as const };

  const gate: { action: "send" | "hold_for_human"; reason?: string } = !linkCheck.ok
    ? { action: "hold_for_human", reason: linkCheck.reason }
    : !voiceCheck.ok
    ? { action: "hold_for_human", reason: voiceCheck.reason }
    : !slotCheck.ok
      ? { action: "hold_for_human", reason: slotCheck.reason }
      : bookingHeld
      ? { action: "hold_for_human", reason: bookingHeld }
      : groupChat
      ? { action: "hold_for_human", reason: GROUP_CHAT_HOLD }
      : move.holdReason
      ? { action: "hold_for_human", reason: move.holdReason }
      : standingHold
      ? { action: "hold_for_human", reason: `${STANDING_HOLD} ${standingHold}` }
      : decision.action === "send"
        ? { action: "send" }
        : { action: "hold_for_human", reason: decision.reason };
  if (!linkCheck.ok) {
    console.error("held a draft carrying a link nobody gave the agent", {
      conversationId: conversation.id,
      links: linkCheck.links,
    });
  }

  /*
   * One answer per conversation, the latest.
   *
   * A draft still pending was written for an earlier message. The inbox shows
   * the newest draft on a conversation and lists any conversation with one
   * pending, so the stale answer came straight back after the rep sent the new
   * one, ready to go out as a second reply. The schema agrees: only one
   * pending draft per conversation is allowed, so without this the new draft
   * could not be stored at all.
   */
  await db
    .from("reply_drafts")
    .update({ status: "superseded", resolved_at: new Date().toISOString() })
    .eq("workspace_id", job.workspaceId)
    .eq("conversation_id", conversation.id)
    .eq("status", "pending");

  const { data: saved } = await db
    .from("reply_drafts")
    .insert({
      workspace_id: job.workspaceId,
      conversation_id: conversation.id,
      in_reply_to: inbound.id,
      body: draft.message,
      proposes_meeting: draft.proposesMeeting,
      // The ISO slots this message offered, in the order the prospect reads
      // them — not every slot the agent was handed. The booking step matches
      // "the second one" against this list, so it has to be exactly what was
      // shown, and nothing at all when a named time could not be traced.
      proposed_slots: (slotCheck.ok ? offer.iso : []) as never,
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
  // A recruiter keen to talk about the rep, or a vendor keen to sell, is not
  // interest in the campaign's offer and is not counted as it.
  const buyer = !facts.agenda || facts.agenda === "evaluating_our_offer" || facts.agenda === "unclear";
  if (intent === "interested" && campaignProspect && buyer) {
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
  const fromName = [prospect.first_name, prospect.last_name].filter(Boolean).join(" ").trim() || "Somebody";
  if (gate.action === "hold_for_human") {
    await flagForHuman(db, conversation.id, gate.reason ?? "held for review");
    await notifyOwnerOfMessage(ctx, {
      ownerUserId: account.user_id as string,
      conversationId: conversation.id,
      fromName,
      text: job.text,
      whatNoraDid: `Nora has not replied. ${gate.reason ?? "This one needs you."} A draft is waiting in your inbox, and nothing has been sent.`,
      at: new Date(job.receivedAt),
      held: gate.reason ?? "held for review",
    });
    return;
  }
  await notifyOwnerOfMessage(ctx, {
    ownerUserId: account.user_id as string,
    conversationId: conversation.id,
    fromName,
    text: job.text,
    whatNoraDid: `Nora is replying: “${draft.message}”`,
    at: new Date(job.receivedAt),
  });

  if (saved) {
    // `enqueueOnce`, not `add`: a finished job must never hold this id
    // (rule 44), or the rep's Send and the maintenance sweep are both refused
    // as duplicates of work that is already over.
    await enqueueOnce(
      queues.linkedinAction,
      "reply",
      { kind: "reply", workspaceId: job.workspaceId, conversationId: conversation.id, draftId: saved.id as string },
      // A short pause before a machine-written reply leaves, so a burst of
      // messages gets one answer: a newer one supersedes this draft at send.
      { jobId: jobId("reply", saved.id as string), delay: REPLY_SETTLE_MS },
    );
  }
}

/**
 * How the workspace said replies are handled, for a conversation no campaign
 * owns. "Let Nora run it" (`autonomy: autonomous`, rule 65) answers on its
 * own; anything else, or an answer that could not be read, is drafted for a
 * person, which is what the schema's default already did.
 */
export async function workspaceReplyRules(
  ctx: WorkerContext,
  workspaceId: string,
): Promise<{ mode?: "autopilot"; autonomy?: "autonomous" }> {
  // "Let Nora run it" was answered about campaigns. A workspace that never
  // launched one has not let Nora loose on anything: Palma's owner, stuck on
  // setup's last step, had twenty-four chats answered in his name (20 Nov).
  if (!(await hasLaunched(ctx, workspaceId))) return {};
  const { data, error } = await ctx.db.from("workspaces").select("onboarding").eq("id", workspaceId).maybeSingle();
  if (error || !data) return {};
  const answers = (data.onboarding ?? {}) as { autonomy?: unknown };
  return answers.autonomy === "autonomous" ? { mode: "autopilot", autonomy: "autonomous" } : {};
}

/** Whether the workspace has ever launched a campaign. Unreadable counts as no. */
export async function hasLaunched(ctx: WorkerContext, workspaceId: string): Promise<boolean> {
  const { count, error } = await ctx.db
    .from("campaigns")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .not("launched_at", "is", null);
  return !error && (count ?? 0) > 0;
}

/** At most one "new message" email per conversation in this many hours. */
const NEW_MESSAGE_EMAIL_EVERY_HOURS = 6;

/**
 * Tells the account's owner a person wrote, the day it happens, and what Nora
 * did about it. An owner found out from LinkedIn itself that a reply had gone
 * out in a chat they had never opened. Never fatal: the message is stored and
 * answered whether or not the email goes.
 */
export async function notifyOwnerOfMessage(
  ctx: WorkerContext,
  input: {
    ownerUserId: string;
    conversationId: string;
    fromName: string;
    text: string;
    whatNoraDid: string;
    at: Date;
    /**
     * Why Nora is waiting for the owner, when it is. A hold is always told:
     * it has its own email per reason, never swallowed by the "Nora is
     * replying" email that went out for an earlier message the same hour.
     */
    held?: string;
  },
): Promise<void> {
  if (!ctx.email) return;
  try {
    const { data: owner } = await ctx.db.from("profiles").select("email").eq("id", input.ownerUserId).maybeSingle();
    if (!owner?.email) return;
    const bucket = Math.floor(input.at.getTime() / (NEW_MESSAGE_EMAIL_EVERY_HOURS * 3_600_000));
    await sendOnce(ctx.db, ctx.email, {
      userId: input.ownerUserId,
      step: input.held
        ? `held-message:${input.conversationId}:${shortHash(input.held)}:${bucket}`
        : `new-message:${input.conversationId}:${bucket}`,
      kind: "transactional",
      message: newMessageEmail({
        to: owner.email as string,
        appUrl: ctx.env.APP_URL,
        fromName: input.fromName,
        theirWords: input.text,
        whatNoraDid: input.whatNoraDid,
        needsYou: Boolean(input.held),
      }),
    });
  } catch (err) {
    console.error("could not email the owner about a new message", { conversationId: input.conversationId, reason: String(err) });
  }
}

/** A short stable key for a hold's reason, so one email goes per reason. */
function shortHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/** Said when a message arrives in a conversation that is already waiting for the rep. */
export const STANDING_HOLD = "This conversation is already waiting for you, so Nora is not replying in it.";

/** How long a machine-written reply waits for the prospect to finish typing. */
export const REPLY_SETTLE_MS = 75_000;



/**
 * The prospect a message came from.
 *
 * `provider_id` carries no unique key, so one person can sit on two rows (two
 * imports, a search that found them before an id was resolved). A
 * `maybeSingle()` errored on the second row, the error was read as "nobody",
 * and the reply was dropped without a trace. The choice is deterministic: the
 * row somebody actually contacted, most recently first, then the newest. An
 * opt-out on any of the rows is an opt-out of the person (rule 7). A lookup
 * that fails is thrown, so the queue retries it and a failure past its retries
 * is listed, rather than read as a stranger's message.
 */
/** The prospect on the other side of a chat this account already has with them. */
async function findByChat(
  ctx: WorkerContext,
  workspaceId: string,
  linkedinAccountId: string,
  providerChatId: string,
): ReturnType<typeof findSender> {
  if (!providerChatId) return null;
  const { data: conversation } = await ctx.db
    .from("conversations")
    .select("prospect_id")
    .eq("workspace_id", workspaceId)
    .eq("linkedin_account_id", linkedinAccountId)
    .eq("provider_chat_id", providerChatId)
    .maybeSingle();
  if (!conversation?.prospect_id) return null;
  const { data: row } = await ctx.db
    .from("prospects")
    .select("id, workspace_id, first_name, last_name, do_not_contact")
    .eq("workspace_id", workspaceId)
    .eq("id", conversation.prospect_id)
    .maybeSingle();
  if (!row) return null;
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    first_name: row.first_name,
    last_name: row.last_name,
    do_not_contact: row.do_not_contact === true,
  };
}

/** Said on the inbox for a group conversation Nora will not answer on its own. */
export const GROUP_CHAT_HOLD =
  "This is a group conversation, so Nora drafted a reply for you to check rather than answering in front of several people.";

/** Their messages a new conversation may already hold when it is taken on. */
const NEW_CONVERSATION_MAX_THEIR_MESSAGES = 6;

type Adoption =
  | { prospect: { id: string; workspace_id: string; first_name: string | null; last_name: string | null; do_not_contact: boolean } }
  | { skipped: string };

/**
 * Takes on a new conversation somebody started with the rep.
 *
 * Only a NEW one: every message in the chat arrived after the account was
 * connected here, the rep has written nothing in it by hand, and it is still
 * short. Anything else is a thread the rep already had, with a friend, a
 * client or a colleague, and a machine answering it under their name is the
 * one thing worse than not answering. Who they are and what they want is
 * then read like any other conversation: a recruiter, a vendor or a partner
 * is answered on their own terms, and somebody the rep knows is drafted for
 * the rep (`replyMove`, `holdReason`).
 *
 * The prospect row it writes takes that person out of every future search,
 * which is right: they are already in conversation (rules 24, 27). A person on
 * the exclusion list is never taken on. A lookup that fails takes nobody on.
 */
export async function adoptNewConversation(
  ctx: WorkerContext,
  job: InboundMessageJob,
  account: { id: string; user_id: string; provider_account_id: string | null; connected_at: string | null },
): Promise<Adoption> {
  if (!job.fromProviderId || !job.providerChatId || !account.provider_account_id) return { skipped: "no sender or chat" };
  // Nothing launched, nothing taken on: the owner has not started using Nora.
  if (!(await hasLaunched(ctx, job.workspaceId))) return { skipped: "nothing launched" };
  let history: Awaited<ReturnType<WorkerContext["linkedin"]["getChatHistory"]>>;
  try {
    history = await ctx.linkedin.getChatHistory({
      accountId: account.provider_account_id,
      chatId: job.providerChatId,
      limit: 50,
    });
  } catch {
    return { skipped: "chat history unreadable" };
  }
  const decision = isNewConversation(history, account.connected_at);
  if (decision !== "new") return { skipped: decision };
  // A group (an introduction thread, a team chat) is never one person
  // approaching the rep: Nora answered "did you see this? @All" and then
  // promised to follow up with somebody it had never spoken to (Palma).
  let others: number;
  try {
    others = await ctx.linkedin.countChatOthers({ accountId: account.provider_account_id, chatId: job.providerChatId });
  } catch {
    return { skipped: "chat members unreadable" };
  }
  if (others !== 1) return { skipped: others > 1 ? "a group conversation" : "chat members unreadable" };

  let profile: Awaited<ReturnType<WorkerContext["linkedin"]["getProfile"]>>;
  try {
    profile = await ctx.linkedin.getProfile({ accountId: account.provider_account_id, providerId: job.fromProviderId });
  } catch {
    return { skipped: "profile unreadable" };
  }
  const excluded = matchExclusion(await loadExclusions(ctx.db, job.workspaceId), {
    company: profile.company ?? null,
    linkedinUrl: profile.linkedinUrl,
  });
  if (excluded) return { skipped: "on the exclusion list" };

  const { data: inserted, error } = await ctx.db
    .from("prospects")
    .insert({
      workspace_id: job.workspaceId,
      provider_id: job.fromProviderId,
      linkedin_url: profile.linkedinUrl,
      first_name: profile.firstName,
      last_name: profile.lastName,
      headline: profile.headline ?? null,
      title: profile.title ?? null,
      company: profile.company ?? null,
      location: profile.location ?? null,
      about: profile.about ?? null,
      owner_user_id: account.user_id,
      signals: { source: "inbound" } as never,
    })
    .select("id, workspace_id, first_name, last_name, do_not_contact")
    .single();
  // Written a moment ago by the other door (webhook and poll both deliver).
  const row = inserted ?? (error ? await findSender(ctx, job.workspaceId, job.fromProviderId) : null);
  if (!row) return { skipped: "could not store the person" };
  if (inserted) {
    await recordEvent(ctx.db, {
      workspaceId: job.workspaceId,
      name: "inbound.adopted",
      subjectType: "prospect",
      subjectId: inserted.id as string,
    }).catch(() => undefined);
  }
  return {
    prospect: {
      id: row.id as string,
      workspace_id: row.workspace_id as string,
      first_name: (row.first_name as string | null) ?? null,
      last_name: (row.last_name as string | null) ?? null,
      do_not_contact: Boolean(row.do_not_contact),
    },
  };
}

/**
 * Is this chat a new conversation somebody started, or a thread the rep
 * already had? Pure, and the whole rule. Unknown is never "new".
 */
export function isNewConversation(
  history: ReadonlyArray<{ fromMe: boolean; sentAt: string }>,
  connectedAt: string | null,
): "new" | "empty history" | "the rep has written in it" | "older than this account's connection" | "a long thread" {
  if (history.length === 0) return "empty history";
  if (history.some((m) => m.fromMe)) return "the rep has written in it";
  const since = connectedAt ? Date.parse(connectedAt) : NaN;
  if (!Number.isFinite(since)) return "older than this account's connection";
  if (history.some((m) => !(Date.parse(m.sentAt) >= since))) return "older than this account's connection";
  if (history.length > NEW_CONVERSATION_MAX_THEIR_MESSAGES) return "a long thread";
  return "new";
}

async function findSender(
  ctx: WorkerContext,
  workspaceId: string,
  providerId: string,
): Promise<{ id: string; workspace_id: string; first_name: string | null; last_name: string | null; do_not_contact: boolean } | null> {
  const { data, error } = await ctx.db
    .from("prospects")
    .select("id, workspace_id, first_name, last_name, do_not_contact, last_contacted_at, created_at")
    .eq("workspace_id", workspaceId)
    .eq("provider_id", providerId)
    .limit(20);
  if (error) throw new Error(`could not look up the sender of a reply: ${error.message}`);
  const rows = (data ?? []) as Array<{
    id: string;
    workspace_id: string;
    first_name: string | null;
    last_name: string | null;
    do_not_contact: boolean | null;
    last_contacted_at: string | null;
    created_at: string | null;
  }>;
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    console.warn("a reply matched several prospect rows; answering on the most recently contacted", {
      workspaceId,
      rows: rows.length,
    });
  }
  const time = (value: string | null) => (value ? Date.parse(value) || 0 : 0);
  const [chosen] = [...rows].sort(
    (a, b) =>
      time(b.last_contacted_at) - time(a.last_contacted_at) ||
      time(b.created_at) - time(a.created_at) ||
      a.id.localeCompare(b.id),
  );
  return {
    id: chosen!.id,
    workspace_id: chosen!.workspace_id,
    first_name: chosen!.first_name,
    last_name: chosen!.last_name,
    do_not_contact: rows.some((row) => row.do_not_contact === true),
  };
}

/**
 * The ISO slots a draft offered, traced back from the readable strings the
 * agent reports it used to the list it was handed. A string that does not
 * trace is `unmapped` — a time the model wrote that the calendar never
 * produced — and the caller holds the draft. When the agent names none, the
 * message itself is read for the listed strings. Ordered as they appear in
 * the message when every one does, since that is the order "the second one"
 * counts in.
 */
export function slotsInDraft(
  message: string,
  proposed: string[],
  slots: { iso: string[]; readable: string[] },
): { iso: string[]; unmapped: string[] } {
  const key = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  const isoFor = new Map<string, string>();
  slots.readable.forEach((readable, index) => {
    const iso = slots.iso[index];
    if (iso) isoFor.set(key(readable), iso);
  });
  const text = key(message);

  const named = proposed.length
    ? proposed
    : slots.readable.filter((readable) => text.includes(key(readable)));

  const iso: string[] = [];
  const unmapped: string[] = [];
  for (const slot of named) {
    const match = isoFor.get(key(slot));
    if (!match) unmapped.push(slot);
    else if (!iso.includes(match)) iso.push(match);
  }

  const position = (slot: string) => {
    const index = slots.iso.indexOf(slot);
    return index < 0 ? -1 : text.indexOf(key(slots.readable[index]!));
  };
  if (iso.every((slot) => position(slot) >= 0)) iso.sort((a, b) => position(a) - position(b));
  return { iso, unmapped };
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
 * campaign keeps it. Returns the campaign the reply is answered under.
 */
async function linkConversationToCampaign(
  ctx: WorkerContext,
  conversationId: string,
  prospectId: string,
  campaignId: string | null,
): Promise<string | null> {
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
  if (!id) return null;
  await ctx.db.from("conversations").update({ campaign_id: id }).eq("id", conversationId).is("campaign_id", null);
  return id;
}

/** The reason maintenance closes a row whose sequence has run out. */
export const SEQUENCE_COMPLETED = "sequence completed";

/** The campaign a conversation is already tied to, if any. */
async function conversationCampaign(ctx: WorkerContext, conversationId: string): Promise<string | null> {
  const { data } = await ctx.db.from("conversations").select("campaign_id").eq("id", conversationId).maybeSingle();
  return (data?.campaign_id as string | null | undefined) ?? null;
}

/**
 * A reply ends the automated sequence; the conversation takes over.
 *
 * The open row first. Failing that, the row maintenance closed because its
 * last step had gone out (`closeExhaustedSequences`): somebody answering the
 * final follow-up is the reply the sequence was written to get, and with that
 * row skipped the reply was answered under no campaign and never counted in
 * its funnel. That row, and only that one, moves to `replied`. A row closed
 * for anything else (an opt-out, do-not-contact, the exclusion list, the
 * never-twice rule, an expired invitation) stays closed, and so does every
 * row of a person on the do-not-contact list (rules 7, 14 and 24).
 */
async function stopSequence(
  ctx: WorkerContext,
  prospectId: string,
  options: { doNotContact?: boolean } = {},
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
  if (!cp) return options.doNotContact ? null : reopenCompletedSequence(ctx, prospectId);

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

/** The latest row closed only because its sequence ran out, moved to `replied`. */
async function reopenCompletedSequence(
  ctx: WorkerContext,
  prospectId: string,
): Promise<{ id: string; campaign_id: string; variant_id: string | null } | null> {
  const { data: done } = await ctx.db
    .from("campaign_prospects")
    .select("id, campaign_id, variant_id, status_reason")
    .eq("prospect_id", prospectId)
    .eq("status", "closed")
    .eq("status_reason", SEQUENCE_COMPLETED)
    .order("closed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!done) return null;
  const { data: moved } = await ctx.db
    .from("campaign_prospects")
    .update({
      status: "replied",
      status_reason: null,
      replied_at: new Date().toISOString(),
      closed_at: null,
      next_action_at: null,
    })
    .eq("id", done.id)
    // Only while it is still exactly as read: closed, for that reason.
    .eq("status", "closed")
    .eq("status_reason", done.status_reason ?? SEQUENCE_COMPLETED)
    .select("id");
  // Moved or not, this is the campaign the conversation belongs to. Unmoved,
  // it is context only: nothing below may write to a row it did not reopen.
  if (!moved?.length) return null;
  return { id: done.id, campaign_id: done.campaign_id, variant_id: done.variant_id ?? null };
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
    // The latest forty, put back in order. Ascending with a limit kept the
    // oldest forty, so a long conversation was answered without its most
    // recent turns, which are the ones the reply is about.
    .order("created_at", { ascending: false })
    .limit(40);
  return [...(data ?? [])]
    .reverse()
    .filter((m) => m.id !== excludeMessageId)
    .map((m) => ({
      role: m.direction === "outbound" ? ("rep" as const) : ("prospect" as const),
      text: m.body,
      at: m.created_at,
    }));
}

async function loadKnowledge(ctx: WorkerContext, workspaceId: string, agentId: string | null) {
  return knowledgeFor(ctx.db, workspaceId, agentId);
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
