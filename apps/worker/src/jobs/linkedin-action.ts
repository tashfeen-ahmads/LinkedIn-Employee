import { checkAction } from "@le/linkedin";
import {
  canTransition,
  containsLink,
  exclusionReason,
  matchExclusion,
  renderCta,
  type CampaignProspectStatus,
  INVITE_NOTE_MAX_CHARS,
  CTA_PLACEHOLDER,
  renderPitch,
  usesPitch,
} from "@le/shared";
import type { Db } from "@le/db";
import { readCampaignCta } from "../cta.js";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { applyHealth, recordAction, toUsage, type AccountRecord, ACCOUNT_USAGE_COLUMNS } from "../accounts.js";
import { syncConversationToCrm } from "../crm.js";
import { loadExclusions } from "../exclusions.js";
import { clearHold, flagForHuman } from "../holds.js";
import { pitchFor } from "../pitch.js";
import { createBookingLink } from "./book.js";
import type { LinkedInActionJob } from "../queues.js";

/**
 * Performs one LinkedIn action. Everything that touches a real account funnels
 * through here so the limiter, the health check and the audit log cannot be
 * bypassed by adding a new caller.
 */
/**
 * Said on the campaign screen, so a person dropped from a list is a decision
 * somebody can read rather than a name that quietly went missing.
 */
export function alreadyContactedReason(lastContactedAt: string): string {
  return `already contacted on ${lastContactedAt.slice(0, 10)} — nobody is contacted twice, in any campaign`;
}

export async function runLinkedInAction(ctx: WorkerContext, job: LinkedInActionJob): Promise<void> {
  if (job.kind === "reply") return sendApprovedReply(ctx, job);

  const { db } = ctx;
  const { data: cp } = await db
    .from("campaign_prospects")
    .select(
      "id, workspace_id, campaign_id, prospect_id, status, last_step_sent, invitation_id, invite_note, variant_id",
    )
    .eq("id", job.campaignProspectId)
    .single();
  if (!cp) return;

  const { data: campaign } = await db
    .from("campaigns")
    .select(
      "id, status, connection_note, linkedin_account_id, owner_user_id, cta_id, cta_kind, cta_url, cta_label",
    )
    .eq("id", cp.campaign_id)
    .single();
  if (!campaign || campaign.status !== "running") return;

  const { data: prospect } = await db
    .from("prospects")
    .select("id, provider_id, linkedin_url, first_name, company, do_not_contact, last_contacted_at")
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

  // Once we have reached out to somebody, we do not reach out to them again.
  //
  // Not "unless they replied", and not "unless it was a different campaign".
  // The second message a stranger gets from the same company under a different
  // pretext is the one that makes the first look like a mail-merge, and the
  // Prospects page has promised for months that nobody here can be contacted
  // twice — a promise nothing enforced at the moment it mattered.
  //
  // Checked immediately before sending rather than only when a list is built,
  // for the same reason the exclusion list is. Two campaigns built from the
  // same customer profile read `prospects` before either of them writes to it,
  // so both can queue the same person quite legitimately; there is no moment
  // earlier than this one at which the question has a settled answer. An
  // invitation is a first contact by definition, so any contact at all is
  // already too much.
  if (job.kind === "invite" && prospect.last_contacted_at) {
    await closeProspect(ctx, cp.id, alreadyContactedReason(prospect.last_contacted_at));
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

    // The fallback belonging to this person's angle, read only when there is no
    // written note to send — one row, and only on the path that can use it.
    let variantNote: string | null = null;
    if (!cp.invite_note?.trim() && cp.variant_id) {
      const { data: variant } = await db
        .from("campaign_variants")
        .select("connection_note")
        .eq("id", cp.variant_id)
        .maybeSingle();
      variantNote = variant?.connection_note ?? null;
    }

    if (!prospect.provider_id) {
      await failProspect(ctx, cp.id, "no provider id for prospect");
      return;
    }
    const result = await ctx.linkedin.sendInvitation({
      accountId: accountRow.provider_account_id,
      providerId: prospect.provider_id,
      // The note written for this person when the campaign was built, and read
      // by a human before launch. The campaign template is the fallback for a
      // prospect the writer did not answer for, and for every campaign created
      // before notes existed — so this is additive, and a workspace that has
      // never seen a personalised note keeps working exactly as it did.
      // Empty means no note, not an empty one: the provider omits the field
      // rather than sending a blank line.
      note: inviteNote(cp.invite_note, campaign.connection_note, prospect.first_name, variantNote) || undefined,
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

  // The step belonging to this person's angle, falling back to the campaign's.
  //
  // Same reasoning as the connection note: somebody counted under an angle has
  // to receive that angle, or the results table describes a group that partly
  // got something else. The fallback is not a formality — it is the whole
  // sequence for every prospect on a campaign built before angles existed.
  const step = await stepFor(db, cp.campaign_id, cp.variant_id, job.stepNumber);
  if (!step) return;

  // The destination goes in here rather than being written into the copy, so
  // changing where a campaign points does not mean rewriting three messages and
  // re-reviewing them — and a rep who edits one and forgets another does not
  // end up sending two different destinations.
  // Read through the pointer, so a URL corrected in the library reaches every
  // campaign using it without anybody rewriting a message.
  const cta = await readCampaignCta(db, campaign, job.workspaceId);

  const conversation = await ensureConversation(ctx, {
    workspaceId: cp.workspace_id,
    prospectId: prospect.id,
    linkedinAccountId: accountRow.id,
    campaignId: cp.campaign_id,
  });

  /*
   * A campaign asking for a meeting with nowhere to book one uses ours.
   *
   * `{{cta_link}}` with no destination is left visible on purpose (rule 29):
   * "Book here:" followed by nothing reads as a broken product, and a visible
   * placeholder gets caught on the review screen. But that was written for a
   * campaign pointing at somebody else's page, and it made a campaign with no
   * page at all into a configuration step — four ready messages held up
   * waiting for a Calendly account, when this product owns a booking page that
   * works (rule 18).
   *
   * So a `meeting` campaign with no URL of its own gets this prospect's own
   * booking link. It is per-prospect by construction: the token is the whole
   * authorisation, `bookFromLink` re-derives the free slots and refuses a time
   * that is not among them, and `meetings_one_per_rep_slot` stops two people
   * taking the same one.
   *
   * Only when the copy actually asks for it. Minting a bearer credential for a
   * message that never mentions booking spends a token and a row on nothing.
   */
  let ctaUrl = cta.url;
  if (!ctaUrl && cta.kind === "meeting" && step.message.includes(CTA_PLACEHOLDER)) {
    ctaUrl = await createBookingLink(ctx, {
      workspaceId: cp.workspace_id,
      repUserId: accountRow.user_id,
      prospectId: prospect.id,
      conversationId: conversation.id,
    });
  }
  /*
   * The offer comes from the one approved pitch, not from the campaign's copy.
   *
   * Rule 40. A step written as `{{pitch}}` is a pointer, exactly as
   * `{{cta_link}}` is: improving the pitch improves every campaign that uses it
   * without rewriting a message or re-reviewing copy a human already approved.
   *
   * Unlike the CTA, an unresolved pitch is never left visible and sent anyway.
   * A missing destination costs a link; a missing pitch is the entire body of
   * the message, and what goes out is the literal characters `{{pitch}}` or a
   * greeting with nothing after it. Both reach a real person under the rep's
   * own name, so this refuses instead.
   */
  const withPitch = renderPitch(
    step.message,
    // This person's own angle picks the line, falling back to the workspace
    // default. An angle owns its prospect end to end (rule 28), so the
    // follow-up argues the pain their invitation named.
    usesPitch(step.message) ? await pitchFor(db, cp.workspace_id, cp.variant_id) : null,
  );
  if (!withPitch.ok) {
    /*
     * Held, not failed, and the schedule is left alone: this step sends itself
     * the moment somebody approves a pitch. Closing the prospect would spend a
     * real person on a piece of copy that had not been written yet, and there
     * is no second chance at a first follow-up.
     */
    await flagForHuman(db, conversation.id, withPitch.reason);
    console.error("a follow-up is waiting for an approved pitch", {
      campaignProspectId: cp.id,
      workspaceId: cp.workspace_id,
    });
    return;
  }

  const body = renderCta(renderTemplate(withPitch.message, prospect.first_name), ctaUrl);

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

  // The next step is read the same way. Reading the campaign's here while the
  // message came from the angle would schedule the follow-up to a delay the
  // angle did not choose, and an angle whose sequence is shorter than the
  // campaign's would keep going past its own end.
  const nextStep = await stepFor(db, cp.campaign_id, cp.variant_id, job.stepNumber + 1);

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
  // Only the reply hold. A conversation also waiting on a manual booking stays
  // flagged: the reply going out now says nothing about whether that meeting
  // reached anyone's diary.
  await clearHold(db, conversation.id, "reply");
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

/**
 * The message for one step of one prospect's sequence.
 *
 * An angle's step when they were assigned an angle and that angle has one;
 * otherwise the campaign's. Two queries at most, and only the second when the
 * first finds nothing — a prospect on a campaign with no angles never pays for
 * the lookup.
 */
async function stepFor(
  db: Db,
  campaignId: string,
  variantId: string | null,
  stepNumber: number,
): Promise<{ message: string; delay_days: number } | null> {
  if (variantId) {
    // The angle's whole sequence, not just this step. An angle that wrote a
    // sequence owns it end to end: falling through to the campaign's step 2
    // because this angle only wrote one would send that group an opener in one
    // voice and a follow-up in another, and the results would no longer be
    // measuring a single thing. The end of the angle's sequence is the end.
    const { data: own } = await db
      .from("campaign_steps")
      .select("message, delay_days, step_number")
      .eq("campaign_id", campaignId)
      .eq("variant_id", variantId);
    if (own?.length) return own.find((s) => s.step_number === stepNumber) ?? null;
    // No sequence of its own: an angle stored without one, which the schema
    // does not produce but a partial write could. The campaign's is better
    // than silence.
  }
  const { data } = await db
    .from("campaign_steps")
    .select("message, delay_days")
    .eq("campaign_id", campaignId)
    .is("variant_id", null)
    .eq("step_number", stepNumber)
    .maybeSingle();
  return data ?? null;
}

/**
 * Puts the prospect's name into a template, whichever way the author wrote it.
 *
 * `{{first_name}}` was the only supported spelling and "anything else stays
 * literal by design" was the comment defending it. The design was wrong the
 * first time somebody typed a placeholder from memory: every campaign and
 * follow-up in this deployment was written with `[Name]`, so the message that
 * reached a real prospect opened
 *
 *     Thanks for connecting, [Name].
 *
 * A literal placeholder in a message signed by a real rep is worse than any
 * formatting problem this function was protecting against, and "by design" is
 * not a defence when the design produces that. So the spellings people
 * actually use are accepted — braces or brackets, one word or two, any case.
 *
 * `there` remains the fallback when the provider gave us no first name.
 * "Thanks for connecting, there" reads slightly oddly and reads as written by
 * a person; the alternative is a name-shaped hole.
 */
const NAME_PLACEHOLDER = /(\{\{|\{|\[)\s*(?:first[\s_-]*name|name|fname)\s*(\}\}|\}|\])/gi;

export function renderTemplate(template: string, firstName: string | null): string {
  return template.replace(NAME_PLACEHOLDER, firstName?.trim() || "there");
}

/**
 * What this person is actually sent.
 *
 * A personalised note is already written for one named person, so it is sent
 * verbatim — running it through the template renderer would be a no-op at best
 * and would rewrite the writer's words at worst.
 *
 * Blank falls back rather than sending nothing: an invitation with no note is
 * still delivered by LinkedIn, so an empty string here would quietly turn a
 * personalised campaign into a bare connection request nobody chose to send.
 */
export function inviteNote(
  personalized: string | null,
  template: string,
  firstName: string | null,
  /**
   * The note belonging to the angle this person was assigned, when they were
   * assigned one.
   *
   * Preferred over the campaign's own note, because the campaign's is written
   * for no particular angle: falling back to it would move this person into an
   * unnamed fourth variant while the results table still counts them under the
   * one they were assigned. The measurement would then be of a group that
   * partly received something else.
   */
  variantTemplate?: string | null,
): string {
  const note = personalized?.trim();
  // A connection request never carries a link.
  //
  // LinkedIn penalises links in invitations and they measurably cut
  // acceptance, and the prompt saying so is not what makes it true — a model
  // that ignores the instruction once, or a human who pastes a URL into a
  // template, reaches a real account with real standing. So the text is
  // checked rather than trusted, exactly as opt-outs are.
  //
  // Dropping to no note at all is the right fallback, not stripping the URL out
  // of the sentence: an invitation with no note is ordinary on LinkedIn and
  // costs a little acceptance, while a sentence with its link surgically
  // removed reads as broken and is worse than either.
  //
  // Length is checked here for the same reason and with the same answer. A
  // note over LinkedIn's limit is not shortened by them — the whole invitation
  // is refused, off a capped daily allowance, against a real person on a
  // reviewed list. And it must not be shortened here either: a paragraph cut
  // at 200 characters arrives mid-sentence under a real rep's name, which is
  // worse than the template it falls back to. Notes already stored from before
  // the limit was corrected are caught by this on the way out.
  if (note && !containsLink(note) && note.length <= INVITE_NOTE_MAX_CHARS) return note;

  /*
   * The fallback is checked too, and leaving it unchecked was half a fix.
   *
   * A personalised note over the limit correctly fell back to the campaign
   * template — and the template was 222 characters, so it failed identically
   * and the send looked exactly as broken as before. Every guard on this path
   * has to cover the value that is actually sent, not the one that was
   * rejected first.
   *
   * No note at all is the last resort and it always succeeds: an invitation
   * without a note is ordinary on LinkedIn and costs a little acceptance,
   * where a refused invitation costs the whole contact and a day's allowance
   * slot. Nothing is truncated here for the reason it is never truncated
   * anywhere on this path: a sentence cut at 200 characters reaches a real
   * person mid-word under a real rep's name.
   */
  const fallback = variantTemplate?.trim() || template;
  const rendered = renderTemplate(fallback, firstName);
  if (containsLink(rendered)) return "";
  return rendered.length <= INVITE_NOTE_MAX_CHARS ? rendered : "";
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
