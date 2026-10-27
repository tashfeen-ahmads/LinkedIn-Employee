import {
  backOff,
  checkAction,
  classifyProviderError,
  dailyInviteCap,
  inviteFloorMs,
  invitePaceWaitMs,
  jitteredRetryMs,
  localDate,
  localDayStart,
  localMonth,
  localMonthStart,
  mightBeNoteQuota,
  msUntilNextLocalMidnight,
  nextGapMs,
  noteAllowance,
  planOf,
  warmStillCounts,
  workingMsLeftToday,
  workingMsAhead,
  type AccountHealth,
  type PostReaction,
} from "@le/linkedin";
import {
  canTransition,
  containsLink,
  hasOwnBookingLink,
  exclusionReason,
  matchExclusion,
  renderCta,
  titleCaseCta,
  type CampaignProspectStatus,
  INVITE_NOTE_MAX_CHARS,
  CTA_PLACEHOLDER,
  LINKEDIN_LIMITS,
  renderPitch,
  usesPitch,
  renderMerge,
  parseHeadline,
  missingFields,
  type MergeValues,
} from "@le/shared";
import { FIRST_MESSAGE_PROMPT_VERSION } from "@le/agents";
import { readCampaignCta } from "../cta.js";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import {
  applyHealth,
  recordAction,
  resetCountersIfNeeded,
  toUsage,
  type AccountRecord,
  ACCOUNT_USAGE_COLUMNS,
} from "../accounts.js";
import { stepFor } from "../sequence.js";
import { warmUpWaitMs } from "../warm.js";
import { accountCampaignIds, lastInviteAt, warmedWaitingOnAccount } from "../pace.js";
import { syncConversationToCrm } from "../crm.js";
import { loadExclusions } from "../exclusions.js";
import { clearHold, flagForHuman } from "../holds.js";
import { HELD_FOR_COPY, HELD_FOR_PITCH, pitchFor } from "../pitch.js";
import { agentForCampaign } from "../agent.js";
import { createBookingLink } from "./book.js";
import { OUTREACH_PAUSE_RETRY_MS, outreachPause } from "../platform.js";
import { workspaceEntitlement } from "../billing.js";

/** How long an invitation waits for a plan to be chosen before it looks again. */
const NOT_ENTITLED_RETRY_MS = 6 * 60 * 60_000;
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
  if (job.kind === "engage") return sendEngagement(ctx, job);

  const { db } = ctx;
  const { data: cp } = await db
    .from("campaign_prospects")
    .select(
      "id, workspace_id, campaign_id, prospect_id, status, last_step_sent, invitation_id, invite_note, variant_id, warmed_at, next_action_at, invite_refusals, first_message, first_message_prompt_version",
    )
    .eq("id", job.campaignProspectId)
    .single();
  if (!cp) return;

  const { data: campaign } = await db
    .from("campaigns")
    .select(
      "id, status, connection_note, linkedin_account_id, owner_user_id, cta_id, cta_kind, cta_url, cta_label, daily_invite_cap, warm_up",
    )
    .eq("id", cp.campaign_id)
    .single();
  if (!campaign || campaign.status !== "running") return;

  const { data: prospect } = await db
    .from("prospects")
    // Everything a message may be written from. `headline` is here because it
    // is the fallback for rows stored before `company` and `title` were ever
    // populated — which is all of them, up to today.
    .select(
      "id, provider_id, linkedin_url, first_name, last_name, company, title, headline, location, do_not_contact, last_contacted_at",
    )
    .eq("id", cp.prospect_id)
    .single();
  if (!prospect) return;

  // A prospect can be banned between scheduling and sending.
  if (prospect.do_not_contact) {
    await closeProspect(ctx, cp.id, "prospect marked do not contact", cp.status);
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
    await closeProspect(ctx, cp.id, exclusionReason(excluded), cp.status);
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
  //
  // Warming counts too, and it was not covered here at first. A profile view
  // is visible to the person — LinkedIn notifies them — so looking up somebody
  // this workspace has already written to is a second approach under a
  // different pretext, which is the exact thing this rule exists to stop. It
  // also spends the allowance twice over: once on the view, and again on the
  // invitation that the check below would refuse anyway.
  if ((job.kind === "invite" || job.kind === "warm_up") && prospect.last_contacted_at) {
    /*
     * ...but only somebody still waiting to be invited is closed for it.
     *
     * The commonest way to arrive here with a contact on record is not a
     * second campaign at all: it is this campaign's own invitation, already
     * sent, reached again by a second job for the same row — Send one now
     * taking a prospect whose delayed job was still sitting in the queue, or
     * a finished job revived by the pacing loop. Closing on that wrote
     * "already contacted" over somebody who was `invited` and waiting to
     * accept, and took them out of their own campaign's follow-ups. A row past
     * `queued` has had its first contact from this campaign, so there is
     * nothing left for an invitation or a view to do: leave it exactly as it is.
     */
    if (cp.status !== "queued") return;
    await closeProspect(ctx, cp.id, alreadyContactedReason(prospect.last_contacted_at), "queued");
    return;
  }

  const { data: accountRow } = await db
    .from("linkedin_accounts")
    .select(ACCOUNT_USAGE_COLUMNS)
    .eq("id", campaign.linkedin_account_id)
    .single();
  if (!accountRow || accountRow.status !== "active" || !accountRow.provider_account_id) return;

  /*
   * The operator's kill switch, checked on the one path every send takes
   * (rule 1). The pacing loop stops enqueuing while it is set, but jobs already
   * sitting delayed in the queue were placed before it — and they fire straight
   * through a switch that only the loop reads. Waiting, never failing: nobody
   * here did anything wrong, and lifting the switch resumes them.
   */
  const paused = await outreachPause(db);
  if (paused) {
    throw new RescheduleError(`outreach_paused: ${paused}`, jitteredRetryMs(OUTREACH_PAUSE_RETRY_MS, "outreach_paused"));
  }

  /*
   * The plan, checked here as well as in the pacing loop, for the same reason
   * as the switch above: an invitation queued on day fourteen of a trial would
   * otherwise go out on day fifteen. Waiting, never failing, so choosing a plan
   * is the whole of what it takes for the queue to carry on; and a plan that
   * could not be read waits too, because a failed read is not permission.
   */
  const entitled = await workspaceEntitlement(db, job.workspaceId);
  if (!entitled?.canSend) {
    throw new RescheduleError(
      `not_entitled: ${entitled?.reason ?? "plan unreadable"}`,
      jitteredRetryMs(NOT_ENTITLED_RETRY_MS, "not_entitled"),
    );
  }

  const { data: profile } = await db.from("profiles").select("timezone").eq("id", accountRow.user_id).single();
  const timezone = profile?.timezone ?? "UTC";
  // The rep's own day, rolled over here as well as in the pacing loop. The loop
  // only visits accounts with a running campaign, so a job reaching an account
  // the loop has stopped visiting would otherwise be judged on whatever day the
  // counters last saw — refused for ever on yesterday's total.
  const account = await resetCountersIfNeeded(db, accountRow as AccountRecord, localDate(new Date(), timezone));
  const usage = toUsage(account, timezone);

  /*
   * The provider's own hold, re-checked immediately before the call.
   *
   * Rule 1, applied to the throttle. The pacing loop checks this before it
   * enqueues, but jobs already sitting delayed in the queue were scheduled
   * before the hold existed — and they fire straight through it. That is not
   * theoretical: after LinkedIn throttled this account, eight more invitations
   * went out over the following hour from jobs queued minutes earlier, each
   * one another rejected request logged against an account LinkedIn had
   * already decided to slow down.
   *
   * Invitations only. A hold is LinkedIn refusing new connection requests; a
   * follow-up to somebody who has already accepted is a different action on an
   * open conversation, and stopping those would silence the half of the funnel
   * the campaign exists for.
   */
  if (job.kind === "invite" && accountRow.invites_paused_until) {
    const until = Date.parse(accountRow.invites_paused_until);
    if (Number.isFinite(until) && until > Date.now()) {
      // Jittered, so everything the hold caught does not wake in the same
      // second it lifts and then drain at exactly the two-minute floor.
      throw new RescheduleError(
        accountRow.invites_paused_reason ?? "the provider is refusing invitations",
        jitteredRetryMs(until - Date.now(), "held"),
      );
    }
  }

  // Second limiter check, immediately before the call. The first was minutes
  // ago at scheduling time and the account may have been used since.
  const kind = job.kind === "invite" ? "invite" : job.kind === "warm_up" ? "profile_view" : "message";
  const decision = checkAction(kind, usage, new Date());
  if (!decision.allowed) {
    throw new RescheduleError(decision.reason, jitteredRetryMs(decision.retryAfterMs, decision.reason));
  }

  // The campaign's own daily cap is re-checked immediately before the call,
  // after the row is claimed and with every claim in flight counted: see
  // `claimsOverCap`. A cap enforced only where work is scheduled is a cap on
  // scheduling — Send one now and a job revived after a restart never passed
  // through the loop's budget.

  if (job.kind === "warm_up") {
    /*
     * The first thing this product ever does that the prospect can see.
     *
     * A connection request arriving cold is a stranger's name among thirty
     * that week. The same request, to somebody who saw this account view their
     * profile a few hours earlier, arrives to a name they half recognise, and
     * the published benchmarks put that at roughly a third more acceptances.
     *
     * Everything above this line already applied — do-not-contact, the shared
     * exclusion list, never-contacted-twice — because a view is visible to the
     * person and "never contact this account" is a promise a colleague made to
     * a customer. A view is not a message, but it is not nothing either.
     */
    if (cp.status !== "queued") return;
    /*
     * Never looked at twice while the first look still counts — and looked at
     * again once it does not.
     *
     * This was `if (cp.warmed_at) return`, which was right for a view an hour
     * old and wrong for one four days old. The pacing loop re-queues a stale
     * warm-up precisely because the familiarity it bought has gone, and the
     * invite path refuses to send on it; this job then declined because the
     * column was set. Nothing cleared it, so the prospect sat in `queued` for
     * ever, the job was revived every five minutes, and every one of those
     * no-ops was reported as "warmed 1 profile(s)" — work that never happened,
     * stamped as the last thing the loop did.
     */
    if (warmStillCounts(cp.warmed_at, new Date())) return;
    if (!prospect.provider_id) {
      await failProspect(ctx, cp.id, "no provider id for prospect");
      return;
    }

    /*
     * Not a view the invitation cannot follow today.
     *
     * The loop queues a day's views a few minutes apart, so the last of them
     * can run an hour after the loop decided there was room. Viewed at ten to
     * five, the invitation falls due after hours, nothing can place it, the
     * view goes stale overnight and the person is looked at a second time the
     * next morning. Asked here, at the moment of looking, with the same
     * arithmetic that decides the wait below; the loop offers the view again
     * tomorrow, when it can be spent at full value.
     */
    const waitingOnAccount = await warmedWaitingOnAccount(db, accountRow.id, cp.id);
    const wait = warmUpWaitMs(
      Math.random,
      workingMsAhead(new Date(), usage.workingHours, usage.timezone),
      (waitingOnAccount + 1) * inviteFloorMs(usage),
    );
    if (wait === null) return;

    const viewed = await ctx.linkedin.viewProfile({
      accountId: accountRow.provider_account_id,
      providerId: prospect.provider_id,
    });
    if (!viewed.ok) {
      /*
       * A refused view is not a refused person.
       *
       * It costs nothing and proves nothing, so the invitation is simply sent
       * cold when its turn comes. Failing them here would spend a real name on
       * a request that was never made — and warming is an improvement to the
       * invitation, not a precondition for it.
       *
       * "Sent cold" has to be written down to happen. The comment said so for
       * months while the row went back unwarmed, and a warm-up campaign only
       * invites people whose view still counts: the person was never invited
       * and the view was retried every five minutes for ever. Stamping the
       * attempt makes them invitable now, without a wait, and without counting
       * a view that LinkedIn refused against the day's allowance.
       */
      console.error("could not warm a prospect", { campaignProspectId: cp.id, error: viewed.error });
      await db
        .from("campaign_prospects")
        // Stamped as a view that has already matured, because no view happened
        // to wait for: the invitation may go at once, and the send path's
        // "never sooner than the wait after a view" is satisfied by a view
        // that was never taken.
        .update({ warmed_at: new Date(Date.now() - LINKEDIN_LIMITS.warmUpToInviteMinMs).toISOString(), next_action_at: null })
        .eq("id", cp.id)
        .eq("status", "queued");
      await recordEvent(db, {
        workspaceId: cp.workspace_id,
        name: "prospect.warm_refused",
        subjectType: "campaign_prospect",
        subjectId: cp.id,
        payload: { reason: String(viewed.error ?? "refused").slice(0, 200) },
      });
      return;
    }

    /*
     * Then the invitation, but not yet.
     *
     * A view and a connection request in the same minute is one automated
     * burst wearing two hats, and it is the pattern LinkedIn's own heuristics
     * watch for. Three quarters of an hour to four hours later is a person who
     * looked somebody up, thought about it, and got round to reaching out. The
     * working-hours check and the ordinary gap still apply on top: this is the
     * earliest the invitation may go, not a promise that it goes then.
     */
    // Written down before it is counted. A count that fails throws and the
    // job is retried, and a retry that found no record of the view would look
    // at them a second time — the invitation below has the longer version.
    await db
      .from("campaign_prospects")
      .update({
        warmed_at: new Date().toISOString(),
        next_action_at: new Date(Date.now() + wait).toISOString(),
      })
      .eq("id", cp.id);
    await recordAction(db, accountRow.id, "profile_view");

    await recordEvent(db, {
      workspaceId: cp.workspace_id,
      name: "prospect.warmed",
      subjectType: "campaign_prospect",
      subjectId: cp.id,
    });
    return;
  }

  if (job.kind === "invite") {
    if (!canTransition(cp.status as CampaignProspectStatus, "invited")) return;

    /*
     * A hold of this person's own, re-checked here as the account's is.
     *
     * "Already invited recently" puts the row back with a wait, and the loop
     * honours it — but Send one now took the oldest queued row whatever it
     * carried, and asked LinkedIn the question it had answered a minute ago.
     * Rule 1: the send path is where a rule becomes a rule.
     */
    const heldUntil = cp.next_action_at ? Date.parse(cp.next_action_at) : NaN;
    if (Number.isFinite(heldUntil) && heldUntil > Date.now()) {
      throw new RescheduleError("prospect_hold", jitteredRetryMs(heldUntil - Date.now(), "prospect_hold"));
    }

    /*
     * On a warm-up campaign, only on a view that still counts and has had time
     * to land.
     *
     * The loop placed warmed invitations inside the window, but an invitation
     * placed after hours was deferred to the next morning and sent there on a
     * seventeen-hour-old view, or minutes after the re-warm the morning tick
     * had queued — and Send one now invited people nobody had looked at. A
     * stale view is left for the loop to re-warm; an unripe one waits its turn.
     *
     * The one exception is the probe. While LinkedIn has been refusing this
     * account, one invitation goes before any view is spent (see the loop), and
     * that invitation is cold by design.
     */
    const probing = (accountRow.invite_throttle_streak ?? 0) >= 1;
    if (campaign.warm_up && !probing) {
      if (!warmStillCounts(cp.warmed_at, new Date())) return;
      const ripe = Date.parse(cp.warmed_at!) + LINKEDIN_LIMITS.warmUpToInviteMinMs;
      if (ripe > Date.now()) {
        throw new RescheduleError("warm_up_wait", jitteredRetryMs(ripe - Date.now(), "warm_up_wait"));
      }
    }

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

    /*
     * Who the invitation comes from, and what this person's own details are.
     *
     * The follow-up path has resolved these for months and the invitation path
     * never did — it passed the first name alone, so every other field in a
     * fallback template survived substitution and was delivered verbatim. The
     * invitation is the one message that cannot be taken back: it is the first
     * thing a stranger ever reads, and it is spent off a capped allowance.
     */
    const inviteAgent = await agentForCampaign(db, cp.campaign_id);
    const { data: inviteSender } = await db
      .from("profiles")
      .select("full_name")
      .eq("id", accountRow.user_id)
      .maybeSingle();

    /*
     * The row is claimed before LinkedIn is asked, in one conditional write.
     *
     * Every check above is a read, and two sends of the same person both pass
     * every read before either writes: Send one now pressed twice, or pressed
     * while the loop's job for that row was firing. Each asked LinkedIn, and
     * one stranger received two connection requests under a real rep's name.
     * A claim matched by `queued` and an empty (or expired) lease lets exactly
     * one of them through; the other matches nothing and stops here.
     */
    if (!(await claimInvite(db, cp.id))) return;

    /*
     * ...and the caps are re-read with every claim in flight counted.
     *
     * At one under the cap, two sends that each read "one left" both went.
     * Counting the claims after taking our own turns that into at most one:
     * whichever counts second sees both, and backs off.
     */
    const overCap = await claimsOverCap(db, {
      campaignId: cp.campaign_id,
      campaignCap: campaign.daily_invite_cap,
      accountId: accountRow.id,
      timezone,
    });
    if (overCap) {
      await releaseInvite(db, cp.id);
      throw new RescheduleError(
        overCap,
        jitteredRetryMs(msUntilNextLocalMidnight(new Date(), timezone), overCap),
      );
    }

    /*
     * ...and the day's pace, measured from this account's last invitation
     * (rule 64). After the claim for the same reason as the caps: two jobs
     * waking together both read the same last invitation, so another claim in
     * flight counts as an invitation that has just gone. Rescheduled with the
     * ordinary jitter on top, so a held backlog wakes at different moments and
     * finds its own place in the day instead of draining at the floor.
     */
    const paceWait = await invitePaceWait(db, {
      accountId: accountRow.id,
      campaignProspectId: cp.id,
      usage,
    });
    if (paceWait > 0) {
      await releaseInvite(db, cp.id);
      throw new RescheduleError("pace", jitteredRetryMs(paceWait, "too_soon"));
    }

    // The note written for this person when the campaign was built, and read
    // by a human before launch. The campaign template is the fallback for a
    // prospect the writer did not answer for, and for every campaign created
    // before notes existed — so this is additive, and a workspace that has
    // never seen a personalised note keeps working exactly as it did.
    // Empty means no note, not an empty one: the provider omits the field
    // rather than sending a blank line.
    let note: string | undefined =
      inviteNote(
        cp.invite_note,
        campaign.connection_note,
        prospect.first_name,
        variantNote,
        mergeValuesFor(prospect, inviteSender, inviteAgent),
      ) || undefined;

    /*
     * A free LinkedIn account may attach a note to only a few invitations a
     * month (FREE_NOTES_PER_MONTH). Past that, LinkedIn refuses the whole
     * invitation with the words it uses for a real throttle, and this account
     * was held for days over it: every account that sent in October stopped
     * exactly after its third note. So once the month's notes are spent the
     * invitation goes without one, which LinkedIn allows. The note decides
     * nothing else: the caps, the hold and every check above still apply.
     */
    const plan = planOf(accountRow);
    const month = localMonth(new Date(), timezone);
    if (note && plan === "basic") {
      const allowance = noteAllowance({
        plan,
        notesSentThisMonth: await notesSentThisMonth(db, accountRow.id, timezone),
        exhaustedMonth: accountRow.notes_exhausted_month,
        month,
      });
      if (!allowance.allowed) note = undefined;
    }

    const send = (withNote: string | undefined) =>
      ctx.linkedin.sendInvitation({
        accountId: accountRow.provider_account_id!,
        providerId: prospect.provider_id!,
        note: withNote,
      });

    let result: Awaited<ReturnType<typeof ctx.linkedin.sendInvitation>>;
    try {
      result = await send(note);
      /*
       * Refused with a note on a free account: ask once more without it.
       *
       * LinkedIn's note limit and its invitation throttle arrive as the same
       * sentence, so the text cannot tell them apart and the second request
       * does. Accepted, it was the note: the month is marked spent and every
       * invitation after this one goes without. Refused again, it is the
       * account, and the refusal below is handled exactly as before.
       */
      if (!result.ok && note && plan === "basic" && mightBeNoteQuota(result.error)) {
        await db.from("linkedin_accounts").update({ notes_exhausted_month: month }).eq("id", accountRow.id);
        await recordEvent(db, {
          workspaceId: cp.workspace_id,
          name: "invite.note_refused",
          subjectType: "campaign_prospect",
          subjectId: cp.id,
          payload: { month, provider: (result.error ?? "").slice(0, 300) },
        });
        note = undefined;
        result = await send(undefined);
      }
    } catch (err) {
      // Thrown, not refused: the job is retried, and the retry must not find
      // the row still held by an attempt that is over.
      await releaseInvite(db, cp.id);
      throw err;
    }
    if (result.health) await applyHealth(db, accountRow, result.health, { email: ctx.email, appUrl: ctx.env.APP_URL });
    if (!result.ok) {
      await handleInviteRefusal(ctx, {
        campaignProspectId: cp.id,
        workspaceId: cp.workspace_id,
        accountId: accountRow.id,
        error: result.error ?? "invitation failed",
        refusals: cp.invite_refusals ?? 0,
      });
      return;
    }
    /*
     * What happened is written down before it is counted.
     *
     * LinkedIn has the invitation now, and nothing can take it back. The
     * counter write is a separate statement that can fail (rule 2 says it must
     * then throw, and it does), and a thrown job is retried — which used to
     * find the row still `queued`, the prospect never contacted, and send the
     * same stranger a second connection request. So the row moves and the
     * prospect is stamped first: a retry then meets `invited` and stops, and
     * the never-twice record exists whatever happens to the count. The price
     * of the opposite failure is one uncounted invitation, raised loudly; the
     * price of this order being wrong was a duplicate under a real rep's name.
     */
    await db
      .from("campaign_prospects")
      .update({
        status: "invited",
        invited_at: new Date().toISOString(),
        invitation_id: result.providerId ?? null,
        next_action_at: null,
        // An earlier refusal's words are history once LinkedIn has said yes;
        // left in place the screen reported an invited person as refused.
        status_reason: null,
        invite_claimed_at: null,
        // What the month's note count is read from.
        invite_note_sent: Boolean(note),
      })
      .eq("id", cp.id);
    await db.from("prospects").update({ last_contacted_at: new Date().toISOString() }).eq("id", prospect.id);
    await recordAction(db, accountRow.id, "invite");
    /*
     * The streak is cleared by a send that worked, and by nothing else.
     *
     * Not by time and not by a refusal that turned out to be about one
     * recipient: the only evidence that LinkedIn is accepting invitations from
     * this account again is LinkedIn accepting one. Clearing it on anything
     * weaker walks the next throttle back to a six hour wait after two days of
     * being refused.
     */
    if (accountRow.invite_throttle_streak) {
      await db.from("linkedin_accounts").update({ invite_throttle_streak: 0 }).eq("id", accountRow.id);
    }
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
  const stepRow = await stepFor(db, cp.campaign_id, cp.variant_id, job.stepNumber);
  if (!stepRow) return;
  // Step 1 is the message written for this person when they accepted, when
  // there is one (rule 66). Every later step, and anybody without one, gets
  // the campaign's own copy.
  const personal = job.stepNumber === 1 ? (cp as { first_message?: string | null }).first_message?.trim() : null;
  const step = personal ? { ...stepRow, message: personal } : stepRow;
  /*
   * Which prompt wrote the words that go out, so a regression traces back to
   * the change that caused it (Conventions). Every sent message stored null
   * here, so nothing could say which writer a bad follow-up came from.
   *
   * The personal first message carries the version it was written with, and
   * a campaign step the version stored on it when it was written or revised
   * (migration 0059). Null for a step a person wrote or edited, or one older
   * than the column: today's writer constant would name a prompt that never
   * touched those words.
   */
  const promptVersion = personal
    ? ((cp as { first_message_prompt_version?: string | null }).first_message_prompt_version ?? FIRST_MESSAGE_PROMPT_VERSION)
    : ((step as { prompt_version?: string | null }).prompt_version ?? null);

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
  /*
   * The campaign's agent, resolved once and read by everything below.
   *
   * It decides the offer this person hears and the name the message comes
   * from. Resolved here rather than at each use for the reason two readings
   * are always wrong: they drift, and nothing on the screen says which one
   * actually sent.
   *
   * Null is a real answer. A campaign built before agents existed keeps every
   * behaviour it had, which is what makes the whole feature additive.
   */
  const agent = await agentForCampaign(db, cp.campaign_id);

  const withPitch = renderPitch(
    step.message,
    // This person's own angle picks the line, then the campaign's agent, then
    // the workspace default. An angle owns its prospect end to end (rule 28),
    // so the follow-up argues the pain their invitation named.
    usesPitch(step.message)
      ? await pitchFor(db, cp.workspace_id, cp.variant_id, agent?.id ?? null)
      : null,
  );
  if (!withPitch.ok) {
    /*
     * Held, not failed, and the schedule is left alone: this step sends itself
     * the moment somebody approves a pitch. Closing the prospect would spend a
     * real person on a piece of copy that had not been written yet, and there
     * is no second chance at a first follow-up.
     */
    // Flagged as `copy`, not as a reply: there is no draft to read here, and
    // the act that releases it is approving a line on the Agents screen. Sending
    // a manual reply must not clear it.
    await flagForHuman(db, conversation.id, withPitch.reason, "copy");
    // Said on the row as well, in the one sentence the pacing loop recognises,
    // so its next offer of this step is not reported as the loop's work.
    await db
      .from("campaign_prospects")
      .update({ status_reason: HELD_FOR_PITCH })
      .eq("id", cp.id)
      .eq("status", cp.status);
    console.error("a follow-up is waiting for an approved pitch", {
      campaignProspectId: cp.id,
      workspaceId: cp.workspace_id,
    });
    return;
  }

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
   *
   * And only once the message is known to be sendable, which is why this sits
   * after the pitch check rather than before it. A follow-up held for a pitch
   * is revived by the pacing loop until somebody approves one, and minted here
   * first it wrote a fresh booking link on every revival — a live bearer
   * credential per attempt, for a message that never went anywhere.
   */
  let ctaUrl = cta.url;
  if (!ctaUrl && cta.kind === "meeting" && withPitch.message.includes(CTA_PLACEHOLDER)) {
    // The sender's own scheduling link first (rule 31). It is asked for on
    // the call-to-action step and stored on their profile, and the reply agent
    // already offers it; this step sent the product's booking page instead, so
    // a rep who gave their Calendly in setup saw it on no screen and in no
    // follow-up, and read the call to action as never picked up.
    const { data: rep } = await db.from("profiles").select("booking_url").eq("id", accountRow.user_id).maybeSingle();
    // The same reading the campaign page uses, so the screen and the send agree.
    ctaUrl = hasOwnBookingLink(rep?.booking_url) ? (rep?.booking_url?.trim() ?? null) : null;
  }
  if (!ctaUrl && cta.kind === "meeting" && withPitch.message.includes(CTA_PLACEHOLDER)) {
    ctaUrl = await createBookingLink(ctx, {
      workspaceId: cp.workspace_id,
      repUserId: accountRow.user_id,
      prospectId: prospect.id,
      conversationId: conversation.id,
    });
  }

  // Who is sending, so `{{rep_name}}` is the rep's own name rather than a
  // placeholder reaching a stranger.
  const { data: sender } = await db
    .from("profiles")
    .select("full_name")
    .eq("id", accountRow.user_id)
    .maybeSingle();

  /*
   * The agent decides the name on the message, and the rep's own is the
   * fallback.
   *
   * Reading the profile alone made the agent's "writes as" field a setting that
   * changed nothing — and a rep who edits a field, watches the message go out
   * unchanged, and concludes the screen is lying does not come back to it. The
   * two are genuinely different: "Tashfeen" reads like a person and a full
   * legal name reads like a signature block, which is exactly the difference
   * between a note and a mailshot.
   */
  const body = renderCta(
    renderTemplate(
      withPitch.message,
      prospect.first_name,
      mergeValuesFor(prospect, sender, agent),
    ),
    ctaUrl,
  )
    // A pitch ends its own sentence, so "{{pitch}}." reached people as
    // "…never happen.. Want a call?" Punctuation only; no word changes.
    .replace(/([.?!])\.(?=\s|$)/g, "$1");

  /*
   * Nothing goes out with a placeholder still in it.
   *
   * `{{company}}` reached a live prospect: the writer used a field this
   * prospect has no value for, `renderMerge` left it visible so the review
   * screen would catch it, and nothing stopped it at the one moment it
   * mattered. The same is true of `{{cta_link}}` on a campaign with no
   * destination. A literal pair of braces under a real rep's name reads as a
   * mail merge that broke, which is worse than a day's delay. So it is held
   * exactly as a missing pitch is: flagged as copy, schedule untouched, sent
   * the moment the step is fixed.
   */
  const unfilled = [...new Set([...body.matchAll(/\{\{\s*[#^/]?\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1]!))];
  if (unfilled.length) {
    await flagForHuman(
      db,
      conversation.id,
      `A follow-up still has ${unfilled.map((f) => `{{${f}}}`).join(", ")} in it, which would reach the prospect as written. Edit the step and it sends on the next run.`,
      "copy",
    );
    await db
      .from("campaign_prospects")
      .update({ status_reason: HELD_FOR_COPY })
      .eq("id", cp.id)
      .eq("status", cp.status);
    return;
  }

  /*
   * Nor with the call to action pasted in as its label.
   *
   * "If yes, Book a Free Consultation and pick a time" went to real people:
   * a button's name typed into a sentence, which reads as software filling a
   * slot. The writers and the nightly repair check for it, and copy stored
   * before either did is still on the conveyor belt, so it is held here too,
   * exactly as an unfilled placeholder is: flagged as copy, schedule
   * untouched, sent the moment the step is reworded. The known label only:
   * the rendered text carries the prospect's company, which may well be in
   * title case. And the step's own words only, before the approved pitch
   * goes in: a pitch is approved text (rule 40) that the repair never
   * rewrites, so a label inside it would hold every follow-up for good while
   * telling the rep to fix a step that does not contain it.
   */
  const pastedCta = titleCaseCta(step.message.replace(/\{\{\s*pitch\s*\}\}/gi, ""), cta.label, { generic: false });
  if (pastedCta) {
    await flagForHuman(
      db,
      conversation.id,
      `A follow-up pastes the call to action "${pastedCta}" into a sentence like a button. Reword the step in plain words and it sends on the next run.`,
      "copy",
    );
    await db
      .from("campaign_prospects")
      .update({ status_reason: HELD_FOR_COPY })
      .eq("id", cp.id)
      .eq("status", cp.status);
    return;
  }

  const result = await ctx.linkedin.sendMessage({
    accountId: accountRow.provider_account_id,
    chatId: conversation.provider_chat_id ?? undefined,
    providerId: prospect.provider_id ?? undefined,
    text: body,
  });
  if (result.health) await applyHealth(db, accountRow, result.health, { email: ctx.email, appUrl: ctx.env.APP_URL });
  if (!result.ok) {
    /*
     * A provider that did not answer has not refused this person.
     *
     * Every failed follow-up used to be final: `failed`, no next action, and
     * the one person on the campaign who had accepted never written to again —
     * over a 503 or a 429 that said in its own words to try later. The same
     * classifier the invitation path trusts decides here (it is conservative:
     * anything it does not recognise is still permanent), and a retryable
     * refusal puts the step back on the schedule after the provider's own
     * cooldown, jittered so a provider outage does not come back as a burst.
     * The status is untouched, so the step that failed is the step that is
     * tried again.
     */
    const verdict = classifyProviderError(result.error);
    if (verdict.kind === "retry_later") {
      await db
        .from("campaign_prospects")
        .update({
          status_reason: result.error ?? verdict.summary,
          next_action_at: new Date(Date.now() + verdict.cooldownMs + nextGapMs()).toISOString(),
        })
        .eq("id", cp.id)
        .eq("status", cp.status);
      return;
    }
    await failProspect(ctx, cp.id, result.error ?? "message failed");
    return;
  }

  // The next step is read the same way. Reading the campaign's here while the
  // message came from the angle would schedule the follow-up to a delay the
  // angle did not choose, and an angle whose sequence is shorter than the
  // campaign's would keep going past its own end.
  const nextStep = await stepFor(db, cp.campaign_id, cp.variant_id, job.stepNumber + 1);

  /*
   * Written down before it is counted, for the reason the invitation gives: a
   * counter write that fails throws, the job is retried, and a retry that
   * found the row still at the previous step would send this message again.
   * Moved on first, a retry meets a transition it cannot make and stops.
   */
  await db
    .from("campaign_prospects")
    .update({
      status: target,
      last_step_sent: job.stepNumber,
      next_action_at: nextStep ? addDays(new Date(), nextStep.delay_days).toISOString() : null,
      // A hold or a cooldown this step was waiting on is over once it is sent.
      status_reason: null,
    })
    .eq("id", cp.id);
  await db.from("prospects").update({ last_contacted_at: new Date().toISOString() }).eq("id", prospect.id);
  await noteOutbound(db, conversation, result.chatId);
  await db.from("messages").insert({
    workspace_id: cp.workspace_id,
    conversation_id: conversation.id,
    direction: "outbound",
    source: "agent",
    body,
    provider_message_id: result.providerId ?? null,
    prompt_version: promptVersion,
    sent_at: new Date().toISOString(),
  });
  // The follow-up this conversation was held for has gone, so its copy hold
  // is over. Nothing else ever cleared it: approving the pitch released the
  // message on the next tick and left the conversation in the inbox, asking
  // somebody to approve a line that was already approved and already sent.
  // Only the copy kind — a reply or booking hold on the same conversation is
  // about something this send says nothing about.
  await clearHold(db, conversation.id, "copy");
  await recordAction(db, accountRow.id, "message");
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
    .select("id, workspace_id, conversation_id, body, prompt_version, status, resolved_by")
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

  /*
   * The operator's kill switch holds machine-written replies (rule 59).
   *
   * A reply a person approved (`resolved_by` set) still goes: that is a human
   * answering a human, which is what migration 0041 promised and what the
   * pause was never meant to stop. An autopilot reply is the agent writing
   * from a real account on the morning LinkedIn started restricting them, so
   * it waits. Waiting, never failing: the draft stays approved and goes the
   * moment the switch is lifted.
   */
  const replyPause = draft.resolved_by ? null : await outreachPause(db);
  if (replyPause) {
    throw new RescheduleError(
      `outreach_paused: ${replyPause}`,
      jitteredRetryMs(OUTREACH_PAUSE_RETRY_MS, "outreach_paused"),
    );
  }

  // A human approving a draft does not exempt it from the caps: it is still a
  // message leaving a real LinkedIn account, and the limiter is the only thing
  // between a campaign and a restriction. Rule 1 in CLAUDE.md.
  const { data: replyProfile } = await db
    .from("profiles")
    .select("timezone")
    .eq("id", account.user_id)
    .single();
  const replyZone = replyProfile?.timezone ?? "UTC";
  // Rolled over on the rep's own date here too: an account whose campaigns
  // have all finished is never visited by the pacing loop, and its counters
  // would otherwise hold the last campaign day's total — every approved reply
  // refused on a cap that was spent weeks ago.
  const replyAccount = await resetCountersIfNeeded(db, account as AccountRecord, localDate(new Date(), replyZone));
  const replyDecision = checkAction("message", toUsage(replyAccount, replyZone), new Date());
  if (!replyDecision.allowed) {
    throw new RescheduleError(replyDecision.reason, jitteredRetryMs(replyDecision.retryAfterMs, replyDecision.reason));
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
  if (!result.ok) {
    /*
     * A reply the provider would not send is never finished as if it were.
     *
     * This returned, and the job completed: the draft stayed `approved`, the
     * conversation was not held, nothing was recorded, and a prospect who had
     * written back warmly was never answered while every screen showed a
     * conversation dealt with. The provider's own sentence went nowhere.
     *
     * "Try later" is tried later, after the provider's own cooldown. Anything
     * else is put in front of a person: the draft is marked failed, the
     * provider's words are kept, and the conversation is held as a reply to
     * write — because that is the act that finishes it.
     */
    const refusal = classifyProviderError(result.error);
    if (refusal.kind === "retry_later") {
      throw new RescheduleError(refusal.summary, jitteredRetryMs(refusal.cooldownMs, "reply_retry_later"));
    }
    const words = (result.error ?? "the provider refused the message").slice(0, 300);
    await db
      .from("reply_drafts")
      .update({ status: "failed", resolved_at: new Date().toISOString() })
      .eq("id", draft.id)
      .eq("status", "approved");
    await flagForHuman(db, conversation.id, `The reply could not be sent: ${words}`, "reply");
    await recordEvent(db, {
      workspaceId: draft.workspace_id,
      name: "reply.failed",
      subjectType: "conversation",
      subjectId: conversation.id,
      payload: { draftId: draft.id, provider: words },
    });
    return;
  }

  // The draft is marked sent before the send is counted, so a counter write
  // that throws cannot hand the retry an `approved` draft to send a second
  // time — the invitation path explains the trade.
  await db.from("reply_drafts").update({ status: "sent", resolved_at: new Date().toISOString() }).eq("id", draft.id);
  await noteOutbound(db, conversation, result.chatId);
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
  await recordAction(db, account.id, "message");
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

/**
 * What a sent message tells the conversation row: when it last moved, and the
 * chat it lives in.
 *
 * Neither was ever written on the way out. `last_message_at` moved only on an
 * inbound message, so a thread the agent had just written to sorted as if it
 * had been silent for days; and the chat a first message opened was dropped, so
 * every later message started a new chat by attendee instead of continuing
 * the one the prospect was reading. The chat id is only ever filled in, never
 * replaced: a thread does not move.
 */
async function noteOutbound(
  db: WorkerContext["db"],
  conversation: { id: string; provider_chat_id: string | null },
  chatId: string | undefined,
): Promise<void> {
  const patch: { last_message_at: string; provider_chat_id?: string } = { last_message_at: new Date().toISOString() };
  if (chatId && !conversation.provider_chat_id) patch.provider_chat_id = chatId;
  await db.from("conversations").update(patch).eq("id", conversation.id);
}

/**
 * Ends one prospect's place in a campaign — only if they are still where the
 * caller saw them.
 *
 * An unconditional write here closed whatever the row had become in the
 * meantime: a second job for the same person, arriving after the first had
 * already invited them, overwrote `invited` with "already contacted" and took
 * somebody waiting to accept out of their own campaign. Conditional on the
 * status that was read, a close decided about a row that has since moved
 * matches nothing and changes nothing.
 */
async function closeProspect(
  ctx: WorkerContext,
  campaignProspectId: string,
  reason: string,
  expectedStatus: CampaignProspectStatus,
): Promise<void> {
  await ctx.db
    .from("campaign_prospects")
    .update({ status: "closed", status_reason: reason, closed_at: new Date().toISOString(), next_action_at: null })
    .eq("id", campaignProspectId)
    .eq("status", expectedStatus);
}

async function failProspect(ctx: WorkerContext, campaignProspectId: string, reason: string): Promise<void> {
  await ctx.db
    .from("campaign_prospects")
    .update({ status: "failed", status_reason: reason, next_action_at: null, invite_claimed_at: null })
    .eq("id", campaignProspectId);
}

/**
 * How long a claim on an invitation holds. Long enough for any provider call
 * to finish, short enough that a process which died mid-send does not strand
 * the person for more than a few ticks.
 */
export const INVITE_CLAIM_LEASE_MS = 10 * 60_000;

/**
 * Takes this row for one send, or reports that somebody else has it.
 *
 * Conditional on `queued` and on the lease being free, in one statement per
 * case — an empty lease, or one old enough that its holder is gone — because
 * the whole point is that two callers cannot both read "free" and both write.
 */
async function claimInvite(db: WorkerContext["db"], campaignProspectId: string): Promise<boolean> {
  const now = new Date();
  const free = await db
    .from("campaign_prospects")
    .update({ invite_claimed_at: now.toISOString() })
    .eq("id", campaignProspectId)
    .eq("status", "queued")
    .is("invite_claimed_at", null)
    .select("id");
  if (free.data?.length) return true;
  const expired = await db
    .from("campaign_prospects")
    .update({ invite_claimed_at: now.toISOString() })
    .eq("id", campaignProspectId)
    .eq("status", "queued")
    .lt("invite_claimed_at", new Date(now.getTime() - INVITE_CLAIM_LEASE_MS).toISOString())
    .select("id");
  return Boolean(expired.data?.length);
}

async function releaseInvite(db: WorkerContext["db"], campaignProspectId: string): Promise<void> {
  await db.from("campaign_prospects").update({ invite_claimed_at: null }).eq("id", campaignProspectId);
}

/**
 * How long this invitation must wait for the day's pace on its account, or 0.
 *
 * Read across every campaign on the account, because LinkedIn sees one
 * account, not campaigns: the last invitation sent from any of them, and any
 * other invitation claimed and mid-send right now.
 */
async function invitePaceWait(
  db: WorkerContext["db"],
  input: { accountId: string; campaignProspectId: string; usage: ReturnType<typeof toUsage> },
): Promise<number> {
  const now = new Date();
  const ids = await accountCampaignIds(db, input.accountId);
  if (!ids.length) return 0;
  const leaseStart = new Date(now.getTime() - INVITE_CLAIM_LEASE_MS).toISOString();
  const [last, { data: claims }] = await Promise.all([
    lastInviteAt(db, input.accountId),
    db
      .from("campaign_prospects")
      .select("id")
      .in("campaign_id", ids)
      .eq("status", "queued")
      .gte("invite_claimed_at", leaseStart),
  ]);
  const inFlight = (claims ?? []).some((row) => row.id !== input.campaignProspectId);
  return invitePaceWaitMs({ usage: input.usage, lastInviteAt: last, inFlight, now });
}

/**
 * Which cap, if any, this claimed invitation would take past its limit with
 * every other claim in flight counted — or null when it may go.
 *
 * Read after the claim, so our own is in the count. The account's counters
 * are read fresh rather than from the row the job started with, because the
 * point is what the other sends did in the meantime.
 */
/**
 * Invitations sent with a note this month, across every campaign on the account.
 *
 * Counted from what was sent rather than kept as a counter, because the answer
 * only ever needs to be roughly right: two sends racing past it at once is at
 * worst one note over the limit, and that refusal is caught and resent without
 * the note. Rows from before notes were recorded count as having had one,
 * because until then every invitation did unless its note was empty.
 */
export async function notesSentThisMonth(db: WorkerContext["db"], accountId: string, timezone: string): Promise<number> {
  const { data: campaigns } = await db.from("campaigns").select("id").eq("linkedin_account_id", accountId);
  const ids = (campaigns ?? []).map((c) => c.id);
  if (!ids.length) return 0;
  const since = localMonthStart(new Date(), timezone).toISOString();
  const [{ count: invited }, { count: withoutNote }] = await Promise.all([
    db.from("campaign_prospects").select("id", { count: "exact", head: true }).in("campaign_id", ids).gte("invited_at", since),
    db
      .from("campaign_prospects")
      .select("id", { count: "exact", head: true })
      .in("campaign_id", ids)
      .gte("invited_at", since)
      .eq("invite_note_sent", false),
  ]);
  return Math.max(0, (invited ?? 0) - (withoutNote ?? 0));
}

async function claimsOverCap(
  db: WorkerContext["db"],
  input: { campaignId: string; campaignCap: number; accountId: string; timezone: string },
): Promise<"campaign_daily_cap" | "daily_invite_cap" | "weekly_invite_cap" | null> {
  const now = new Date();
  const leaseStart = new Date(now.getTime() - INVITE_CLAIM_LEASE_MS).toISOString();

  if (Number.isFinite(input.campaignCap)) {
    const [{ count: sent }, { count: claimed }] = await Promise.all([
      db
        .from("campaign_prospects")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", input.campaignId)
        .gte("invited_at", localDayStart(now, input.timezone).toISOString()),
      db
        .from("campaign_prospects")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", input.campaignId)
        .eq("status", "queued")
        .gte("invite_claimed_at", leaseStart),
    ]);
    if ((sent ?? 0) + (claimed ?? 0) > input.campaignCap) return "campaign_daily_cap";
  }

  const { data: campaigns } = await db.from("campaigns").select("id").eq("linkedin_account_id", input.accountId);
  const ids = (campaigns ?? []).map((c) => c.id);
  const { count: claimedOnAccount } = ids.length
    ? await db
        .from("campaign_prospects")
        .select("id", { count: "exact", head: true })
        .in("campaign_id", ids)
        .eq("status", "queued")
        .gte("invite_claimed_at", leaseStart)
    : { count: 0 };
  const { data: fresh } = await db
    .from("linkedin_accounts")
    .select(ACCOUNT_USAGE_COLUMNS)
    .eq("id", input.accountId)
    .maybeSingle();
  if (!fresh) return null;
  const usage = toUsage(fresh as AccountRecord, input.timezone);
  const inFlight = claimedOnAccount ?? 0;
  if (usage.invitesThisWeek + inFlight > LINKEDIN_LIMITS.invitesPerWeek) return "weekly_invite_cap";
  if (usage.invitesToday + inFlight > dailyInviteCap(usage.firstActionAt, now)) return "daily_invite_cap";
  return null;
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
 * With no first name from the provider, a greeting reads "Hi there," and
 * anywhere else the name is left out with its comma ("Thanks for
 * connecting."), never "there" standing where the name was (`renderMerge`).
 */
const NAME_PLACEHOLDER = /(\{\{|\{|\[)\s*(?:first[\s_-]*name|name|fname)\s*(\}\}|\}|\])/gi;

/**
 * Puts this prospect's own details into a campaign's copy.
 *
 * It used to substitute the first name and nothing else, so "regarding
 * {{company}}" reached a stranger with the placeholder still in it. Every
 * field now resolves, and a field we do not have changes the sentence rather
 * than leaving a hole — see `renderMerge`.
 *
 * `{{name}}` and `[Name]` are still read as the first name, because that is
 * what people type and a placeholder sent verbatim is worse than being relaxed
 * about reading it.
 */
export function renderTemplate(
  template: string,
  firstName: string | null,
  values: Partial<MergeValues> = {},
): string {
  const named = template.replace(NAME_PLACEHOLDER, "{{first_name}}");
  return renderMerge(named, { ...values, first_name: firstName ?? values.first_name ?? null });
}

/** Everything a message may be written from, for one prospect and one rep. */
export function mergeValuesFor(
  prospect: {
    first_name?: string | null;
    last_name?: string | null;
    company?: string | null;
    title?: string | null;
    headline?: string | null;
    location?: string | null;
  },
  rep: { full_name?: string | null } | null,
  /**
   * The campaign's agent, when it has one.
   *
   * Its `from_name` is the name a prospect actually reads, and the rep's own
   * is the fallback — a campaign built before agents existed has no agent and
   * must keep behaving exactly as it did.
   */
  agent?: { fromName: string | null } | null,
): Partial<MergeValues> {
  // The stored columns first; the headline is the fallback for rows written
  // before those columns were ever filled in.
  const parsed = parseHeadline(prospect.headline);
  return {
    first_name: prospect.first_name ?? null,
    last_name: prospect.last_name ?? null,
    company: prospect.company?.trim() || parsed.company,
    title: prospect.title?.trim() || parsed.title,
    location: prospect.location ?? null,
    rep_name: agent?.fromName?.trim() || rep?.full_name || null,
  };
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
  /**
   * Everything else the template may be written from — the company, the title,
   * and the name the invitation comes from.
   *
   * Left out, every field but `{{first_name}}` survives substitution and is
   * delivered verbatim. That was latent for as long as the Targeting Agent
   * wrote every template and only ever used the name, and it stopped being
   * latent the moment a seeded agent arrived carrying `{{rep_name}}`: a
   * prospect the writer had not answered for would have read "Hi Jane,
   * {{rep_name}} here regarding {{company}}."
   */
  values: Partial<MergeValues> = {},
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

  /*
   * A field this prospect has no value for means no note, not a note with a
   * hole in it.
   *
   * `renderMerge` deliberately leaves an unresolved `{{company}}` visible
   * rather than substituting a blank, because on a review screen a visible
   * placeholder is caught and "regarding your ." is not. Nobody reviews this
   * one: it is the fallback, chosen at the moment of sending, for the prospect
   * the writer did not answer for. So the same reasoning that leaves it
   * visible upstream is what drops it here — and dropping to no note at all is
   * what this function already does with a link and with an over-length note,
   * for the same reason each time.
   *
   * A template that should degrade rather than disappear says so with a
   * conditional block, which is why `DEFAULT_OPENER_TEMPLATE` carries one.
   *
   * `first_name` is the exception, and it is the same exception `renderMerge`
   * already makes: it resolves to "there" after a greeting and to nothing
   * elsewhere, which is what a person writes when they cannot see a name. Counting it as a hole would send no note at all to
   * every prospect whose first name LinkedIn did not give us — a real cost, to
   * avoid a greeting that reads perfectly ordinary.
   */
  const merged = { ...values, first_name: firstName ?? values.first_name ?? null };
  if (missingFields(fallback, merged).some((field) => field !== "first_name")) return "";

  const rendered = renderTemplate(fallback, firstName, values);
  if (containsLink(rendered)) return "";
  return rendered.length <= INVITE_NOTE_MAX_CHARS ? rendered : "";
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * How many refusals about one recipient close their row. LinkedIn's
 * "invited recently" block lasts weeks; a second refusal a day after the first
 * is the evidence that waiting will not change the answer.
 */
export const RECIPIENT_REFUSALS_BEFORE_CLOSING = 2;

/** Thrown when the limiter denies an action that was already scheduled. */
/**
 * A like or a comment on a prospect's post (rule 68), sent here for the same
 * reasons every other action is: the limiter, the pause, the plan, the
 * exclusion list and do-not-contact are all read immediately before the call.
 *
 * Skipped, never retried into a burst, when the day's allowance is spent: a
 * like that waits until tomorrow is a like on an older post, and an old post
 * is the one that reads as a bot. Never sent while LinkedIn is throttling the
 * account's invitations, because adding activity to an account the platform
 * has started to doubt is the opposite of what this is for.
 */
async function sendEngagement(
  ctx: WorkerContext,
  job: Extract<LinkedInActionJob, { kind: "engage" }>,
): Promise<void> {
  const { db } = ctx;
  const { data: row } = await db
    .from("engagement_actions")
    .select(
      "id, workspace_id, linkedin_account_id, prospect_id, campaign_id, post_id, post_at, kind, reaction_type, body, status, scheduled_for",
    )
    .eq("id", job.engagementId)
    .eq("workspace_id", job.workspaceId)
    .maybeSingle();
  if (!row || row.status !== "queued") return;

  const skip = async (reason: string) => {
    await db.from("engagement_actions").update({ status: "skipped", reason }).eq("id", row.id).eq("status", "queued");
  };

  // Late is skipped, never sent: a pause lifting or a backlog waking must not
  // become a burst of likes on posts from last week.
  const nowMs = Date.now();
  if (row.scheduled_for && nowMs - Date.parse(row.scheduled_for) > ENGAGE_LATE_MS) {
    return skip("it could not go out near the time it was planned");
  }
  if (row.post_at && nowMs - Date.parse(row.post_at) > LINKEDIN_LIMITS.engagePostMaxAgeDays * 86_400_000) {
    return skip("the post is too old now");
  }
  if (row.campaign_id) {
    const { data: campaign } = await db
      .from("campaigns")
      .select("status")
      .eq("id", row.campaign_id)
      .eq("workspace_id", row.workspace_id)
      .maybeSingle();
    if (campaign?.status !== "running") return skip("the campaign is not running");
  }

  // Each kind has its own switch (migration 0058), read at the moment of
  // sending. A row from before the comment switch follows the old shared one.
  const { data: workspace } = await db
    .from("workspaces")
    .select("engage_posts, engage_comments")
    .eq("id", row.workspace_id)
    .maybeSingle();
  if (row.kind === "comment") {
    const commentsOn =
      typeof workspace?.engage_comments === "boolean" ? workspace.engage_comments : workspace?.engage_posts === true;
    if (!commentsOn) return skip("commenting is turned off for this workspace");
  } else if (!workspace?.engage_posts) {
    return skip("liking is turned off for this workspace");
  }

  if (row.prospect_id) {
    const { data: prospect } = await db
      .from("prospects")
      .select("id, company, linkedin_url, do_not_contact")
      .eq("id", row.prospect_id)
      .eq("workspace_id", row.workspace_id)
      .maybeSingle();
    if (!prospect) return skip("that prospect no longer exists");
    if (prospect.do_not_contact) return skip("prospect marked do not contact");
    const excluded = matchExclusion(await loadExclusions(db, row.workspace_id), {
      company: prospect.company,
      linkedinUrl: prospect.linkedin_url,
    });
    if (excluded) return skip(exclusionReason(excluded));
    // Somebody who asked to be left alone, or whose conversation is over, is
    // not engaged with on any campaign.
    const { data: ended } = await db
      .from("campaign_prospects")
      .select("id")
      .eq("workspace_id", row.workspace_id)
      .eq("prospect_id", prospect.id)
      .in("status", ["opted_out", "negative", "closed", "failed"])
      .limit(1);
    if (ended?.length) return skip("their conversation is over or they asked to stop");
  }

  const paused = await outreachPause(db);
  if (paused) {
    throw new RescheduleError(`outreach_paused: ${paused}`, jitteredRetryMs(OUTREACH_PAUSE_RETRY_MS, "outreach_paused"));
  }
  const entitled = await workspaceEntitlement(db, row.workspace_id);
  if (!entitled?.canSend) return skip("the workspace has no plan that sends");

  const { data: accountRow } = await db
    .from("linkedin_accounts")
    .select(ACCOUNT_USAGE_COLUMNS)
    .eq("id", row.linkedin_account_id)
    .single();
  if (!accountRow || accountRow.status !== "active" || !accountRow.provider_account_id) {
    return skip("the LinkedIn account is not active");
  }
  if (accountRow.invites_paused_until && Date.parse(accountRow.invites_paused_until) > Date.now()) {
    return skip("LinkedIn is holding this account's invitations, so it stays quiet");
  }

  const { data: owner } = await db.from("profiles").select("timezone").eq("id", accountRow.user_id).single();
  const timezone = owner?.timezone ?? "UTC";
  const account = await resetCountersIfNeeded(db, accountRow as AccountRecord, localDate(new Date(), timezone));
  const kind = row.kind === "comment" ? "post_comment" : "post_reaction";
  const decision = checkAction(kind, toUsage(account, timezone));
  if (!decision.allowed) {
    if (decision.reason === "daily_reaction_cap" || decision.reason === "daily_comment_cap") {
      return skip("today's allowance for this is spent");
    }
    throw new RescheduleError(decision.reason, jitteredRetryMs(decision.retryAfterMs, decision.reason));
  }

  // Claimed before the call: a job retried after a successful post, or re-run
  // after a restart mid-call, finds the row no longer queued and posts nothing.
  const { data: claimed } = await db
    .from("engagement_actions")
    .update({ status: "sending" })
    .eq("id", row.id)
    .eq("status", "queued")
    .select("id");
  if (!claimed?.length) return;

  const result =
    row.kind === "comment"
      ? row.body?.trim()
        ? await ctx.linkedin.commentOnPost({ accountId: accountRow.provider_account_id, postId: row.post_id, text: row.body.trim() })
        : { ok: false, error: "no comment was written" }
      : await ctx.linkedin.reactToPost({
          accountId: accountRow.provider_account_id,
          postId: row.post_id,
          reaction: (row.reaction_type as PostReaction | null) ?? "like",
        });
  // A restriction or a slow-down applies to the whole account, exactly as on
  // every other send.
  if (result.health) await applyHealth(db, accountRow, result.health, { email: ctx.email, appUrl: ctx.env.APP_URL });
  if (!result.ok) {
    // The screen gets words; the provider's own text names our supplier and a
    // route (rule 54), so it goes to an event for whoever runs the deployment.
    await db
      .from("engagement_actions")
      .update({ status: "failed", reason: engagementRefusal(row.kind, result.health) })
      .eq("id", row.id);
    await recordEvent(db, {
      workspaceId: row.workspace_id,
      name: "engagement.refused",
      subjectType: "engagement_action",
      subjectId: row.id,
      payload: { kind: row.kind, cause: (result.error ?? "refused").slice(0, 500), health: result.health ?? null },
    }).catch(() => undefined);
    return;
  }

  // Marked sent before it is counted: a counter that fails to write raises
  // (rule 2) and the job is retried, and the retry must find nothing to send.
  const now = new Date().toISOString();
  await db.from("engagement_actions").update({ status: "sent", sent_at: now, reason: null }).eq("id", row.id);
  // Counted in the same statement as every other action (rule 2).
  await recordAction(db, accountRow.id, kind);
  if (row.prospect_id) {
    await db.from("prospects").update({ last_engaged_at: now }).eq("id", row.prospect_id).eq("workspace_id", row.workspace_id);
  }
}

/** How late a planned like or comment may still go out. */
export const ENGAGE_LATE_MS = 3 * 60 * 60_000;

function engagementRefusal(kind: string, health: AccountHealth | undefined): string {
  if (health === "restricted") return "LinkedIn is restricting the account, so it was not sent";
  if (health === "warning") return "LinkedIn asked the account to slow down, so it was not sent";
  return kind === "comment"
    ? "LinkedIn did not accept the comment. The post may be gone or closed to comments"
    : "LinkedIn did not accept the like. The post may be gone";
}

export class RescheduleError extends Error {
  constructor(
    readonly reason: string,
    readonly retryAfterMs: number,
  ) {
    super(`rate limited: ${reason}, retry in ${Math.round(retryAfterMs / 1000)}s`);
    this.name = "RescheduleError";
  }
}

/**
 * What to do with an invitation the provider would not send.
 *
 * Every refusal used to mean the same thing — `failed`, no next action, that
 * person gone from the campaign for good. Most of LinkedIn's refusals are not
 * that. The common one is
 *
 *     422 cannot_resend_yet — You have reached a temporary provider limit.
 *     Please try again later.
 *
 * and on a single morning seven real prospects were written off on that
 * sentence in twenty-five minutes, while the loop kept posting fresh
 * invitations to an account LinkedIn had already decided to slow down. The rep
 * reads "7 failed" and concludes the list was bad. The list was fine.
 *
 * So a retryable refusal does two things, and the second matters more than the
 * first. The prospect goes back to `queued` — they were never asked, so
 * "failed" is not a fact about them. And invitations stop **for the whole
 * account**, because the limit is LinkedIn's opinion of the account rather than
 * of this person, and failing one row at a time means the next tick walks the
 * next prospect into the same wall. One throttle must cost one attempt, not a
 * campaign.
 *
 * A refusal we do not recognise still fails permanently (`classifyProviderError`
 * is conservative on purpose): retrying an unknown error against LinkedIn for
 * ever is how an account gets restricted.
 */
async function handleInviteRefusal(
  ctx: WorkerContext,
  input: {
    campaignProspectId: string;
    workspaceId: string;
    accountId: string;
    error: string;
    /** Refusals about this recipient before this one. */
    refusals?: number;
  },
): Promise<void> {
  /*
   * A refused request is still a request, and the gap counts from it.
   *
   * `last_action_at` moved only when a send was counted, so a refusal left the
   * account looking idle and the next job went straight after it — two
   * requests inside the two-minute floor, the second into an account LinkedIn
   * had just pushed back on. Not a counter (rule 2 is about those): only the
   * time, which the limiter reads for its gap.
   */
  await ctx.db.from("linkedin_accounts").update({ last_action_at: new Date().toISOString() }).eq("id", input.accountId);

  const verdict = classifyProviderError(input.error);
  if (verdict.kind === "permanent") {
    await failProspect(ctx, input.campaignProspectId, input.error);
    return;
  }

  /*
   * How long we have already been refused decides how long we wait next.
   *
   * The streak is read before the cooldown is computed, because a flat six
   * hours is right the first time and wrong every time after it: this account
   * was refused nine times in seventy-five minutes on one afternoon, then once
   * every six hours for as long as the campaign stayed running. Each of those
   * is a rejected request logged against an account LinkedIn has already
   * decided to slow down.
   *
   * Only account-wide refusals count. "This recipient was invited recently" is
   * a fact about one row and says nothing about whether LinkedIn is accepting
   * invitations from this account.
   */
  /*
   * One reading of "is this about the account", used everywhere below.
   *
   * It was written out four times, and the fourth was added by this change —
   * which quietly moved what the mutation guarding this rule was flipping, so
   * the guard passed while testing nothing. Two readings of a rule drift; four
   * readings of it are a guard aimed at whichever one happens to be first in
   * the file.
   */
  const accountWide = verdict.scope === "account";

  let streak = 0;
  if (accountWide) {
    const { data: account } = await ctx.db
      .from("linkedin_accounts")
      .select("invite_throttle_streak")
      .eq("id", input.accountId)
      .maybeSingle();
    streak = account?.invite_throttle_streak ?? 0;
  }

  const cooldownMs = accountWide ? backOff(verdict.cooldownMs, streak) : verdict.cooldownMs;
  const until = new Date(Date.now() + cooldownMs);

  /*
   * A recipient LinkedIn keeps refusing is let go, with LinkedIn's reason.
   *
   * "Already invited recently" is a block LinkedIn keeps for weeks. Requeued
   * with a day's wait and nothing counting, the same person was asked again
   * every day for as long as the campaign ran — each a rejected request logged
   * against the account, for an invitation that was never going to be
   * accepted. Twice is enough evidence. The row is closed, not failed and not
   * quietly dropped: a name that leaves a reviewed list says why (rule 24).
   */
  const refusals = (input.refusals ?? 0) + (accountWide ? 0 : 1);
  if (!accountWide && refusals >= RECIPIENT_REFUSALS_BEFORE_CLOSING) {
    await ctx.db
      .from("campaign_prospects")
      .update({
        status: "closed",
        status_reason: `LinkedIn refused to invite this person ${refusals} times: ${verdict.summary} (${input.error.slice(0, 200)})`,
        closed_at: new Date().toISOString(),
        next_action_at: null,
        invite_claimed_at: null,
        invite_refusals: refusals,
      })
      .eq("id", input.campaignProspectId)
      .eq("status", "queued");
    await recordEvent(ctx.db, {
      workspaceId: input.workspaceId,
      name: "invite.recipient_closed",
      subjectType: "campaign_prospect",
      subjectId: input.campaignProspectId,
      payload: { refusals, reason: verdict.summary, provider: input.error },
    });
    return;
  }

  /*
   * Who the refusal is about decides who waits.
   *
   * "An invitation has already been sent recently to this recipient" is a fact
   * about that recipient. Reading it as an account-wide throttle put a live
   * account into a twenty-four hour hold over one awkward row, and the other
   * twenty-five people on the list could not be written to — one prospect
   * silencing a campaign, which is the failure the account-wide pause was
   * built to prevent, pointed the wrong way.
   */
  if (accountWide) {
    // Never shortened by a later refusal during the same throttle. A fifteen
    // minute network blip arriving inside a six hour invitation limit would
    // otherwise cut that limit short and walk the account straight back in.
    const { data: held } = await ctx.db
      .from("linkedin_accounts")
      .select("invites_paused_until")
      .eq("id", input.accountId)
      .maybeSingle();
    const standing = held?.invites_paused_until ? Date.parse(held.invites_paused_until) : 0;
    const extendsHold = !Number.isFinite(standing) || standing < until.getTime();

    // One statement, with the hold fields in it only when the hold actually
    // moves. Written as two branches it had an arm reachable only by two jobs
    // racing past the send-time check together — real, but not reproducible
    // from this entry point, so it would have been a branch no test could
    // honestly cover. The streak is counted either way: every refusal is
    // another request LinkedIn logged, whether or not it pushed the hold out.
    await ctx.db
      .from("linkedin_accounts")
      .update({
        ...(extendsHold
          ? { invites_paused_until: until.toISOString(), invites_paused_reason: verdict.summary }
          : {}),
        invite_throttle_streak: streak + 1,
      })
      .eq("id", input.accountId);
  }

  await ctx.db
    .from("campaign_prospects")
    // Back in the queue, not failed. `status_reason` still carries the
    // provider's words so the screen can say why they are waiting rather than
    // leaving a silent row somebody assumes is stuck.
    //
    // `next_action_at` holds *this* person back when the refusal was about
    // them. Without it a prospect-scoped refusal is no wait at all: the next
    // tick picks them straight back up and asks LinkedIn the same question it
    // just answered.
    //
    // An account-wide refusal holds this person back past the hold as well,
    // so the probe after it is somebody else. Left at null, the row the probe
    // fell on was first in line again the moment the hold lifted: the same
    // person refused on every probe, and everybody else waited behind them.
    .update({
      status: "queued",
      status_reason: input.error,
      next_action_at: accountWide ? new Date(until.getTime() + verdict.cooldownMs).toISOString() : until.toISOString(),
      invite_claimed_at: null,
      invite_refusals: refusals,
    })
    .eq("id", input.campaignProspectId);

  await recordEvent(ctx.db, {
    workspaceId: input.workspaceId,
    name: "invite.throttled",
    subjectType: "campaign_prospect",
    subjectId: input.campaignProspectId,
    payload: {
      until: until.toISOString(),
      scope: verdict.scope,
      reason: verdict.summary,
      provider: input.error,
      // How many refusals in a row this is. One is a throttle; eleven is a
      // different conversation, and the difference was in nobody's reach.
      streak: accountWide ? streak + 1 : undefined,
    },
  });
}
